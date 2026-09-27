#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, verifyMessage } from "ethers";

import { assertLocalCircomInstallation } from "./fetch-circom.mjs";
import { CIRCOM_ARTIFACT_FLAGS, CIRCOM_VERSION } from "./lib/circomToolchain.mjs";
import { readZkeyMpcMetadata } from "./lib/zkeyMpcMetadata.mjs";
import { renameZkVerifierSource } from "./rename-zk-verifier.mjs";
import { SHIELDED_CIRCUITS } from "./zk-shielded-build.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_PATH = "circuits/shielded-production-manifest.json";
const EVIDENCE_PATH = "release-evidence/shielded/release-evidence.json";
const SHA256 = /^[0-9a-f]{64}$/;
const BLAKE2B512 = /^[0-9a-f]{128}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SOURCE_ROOTS = [
  "contracts/",
  "circuits/",
  "docs/",
  "frontend/",
  "hardhat/",
  "lib/",
  "packages/",
  "scripts/",
  "tasks/",
  "test/",
];
const SOURCE_SINGLETONS = new Set(["package.json", "package-lock.json", "hardhat.config.mjs"]);
const SOURCE_EXCLUSIONS = new Set([
  MANIFEST_PATH,
  "circuits/zk-artifacts-manifest.json",
  "circuits/zk-ceremony-transcript.json",
]);
const hashBytes = (data) => createHash("sha256").update(data).digest("hex");
const hashFile = (file) => hashBytes(fs.readFileSync(file));
const fail = (message) => {
  throw new Error(message);
};
const requireValue = (condition, message) => {
  if (!condition) fail(message);
};
const requireHash = (value, label) =>
  requireValue(SHA256.test(value ?? ""), `${label} must be SHA-256`);

function checkedFile(root, relativePath, label, prefix = "") {
  requireValue(
    typeof relativePath === "string" && relativePath.length > 0,
    `${label} path is missing`,
  );
  requireValue(
    !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/).includes(".."),
    `${label} path must stay inside the checkout`,
  );
  const normalized = relativePath.replaceAll("\\", "/");
  if (prefix) requireValue(normalized.startsWith(prefix), `${label} must be under ${prefix}`);
  const absolute = path.resolve(root, relativePath);
  requireValue(absolute.startsWith(`${root}${path.sep}`), `${label} path escapes the checkout`);
  let state;
  try {
    state = fs.lstatSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} is missing: ${relativePath}`);
    throw error;
  }
  requireValue(state.isFile() && !state.isSymbolicLink(), `${label} must be an ordinary file`);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(absolute);
  requireValue(
    realFile.startsWith(`${realRoot}${path.sep}`),
    `${label} traverses a symbolic link outside the checkout`,
  );
  return absolute;
}

function readJson(root, relativePath, label, prefix = "") {
  const absolute = checkedFile(root, relativePath, label, prefix);
  try {
    return { value: JSON.parse(fs.readFileSync(absolute, "utf8")), absolute };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function checkHashedFile(root, relativePath, digest, label, prefix = "") {
  requireHash(digest, `${label} digest`);
  const absolute = checkedFile(root, relativePath, label, prefix);
  requireValue(hashFile(absolute) === digest, `${label} SHA-256 mismatch: ${relativePath}`);
  return absolute;
}

function trackedSourceFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) =>
        !SOURCE_EXCLUSIONS.has(file) &&
        !file.startsWith("release-evidence/") &&
        (SOURCE_SINGLETONS.has(file) || SOURCE_ROOTS.some((prefix) => file.startsWith(prefix))),
    )
    .sort();
}

/** A digest over the actual tracked release source, excluding only evidence and cyclic manifests. */
export function sourceBundleSha256(root = DEFAULT_ROOT) {
  const digest = createHash("sha256");
  for (const file of trackedSourceFiles(root)) {
    const absolute = checkedFile(root, file, "tracked source");
    digest.update(file).update("\0").update(hashFile(absolute)).update("\n");
  }
  return digest.digest("hex");
}

function assertCleanCheckout(root) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  requireValue(
    status.trim() === "",
    "Release checkout is not clean; commit and review all sources and evidence first",
  );
}

function assertProductionManifest(root, manifest) {
  requireValue(
    manifest?.schema === "deepfamily/shielded-production-artifacts@1",
    "Shielded production manifest schema is invalid",
  );
  requireValue(
    manifest.status === "production" &&
      manifest.productionReady === true &&
      manifest.developmentOnly === false,
    "Development shielded keys are forbidden for release",
  );
  requireHash(manifest.sourceBundleSha256, "Source bundle digest");
  requireValue(
    sourceBundleSha256(root) === manifest.sourceBundleSha256,
    "Tracked release sources changed since the shielded production manifest",
  );
  requireValue(
    manifest.toolchain?.circomVersion === CIRCOM_VERSION,
    "Shielded Circom version is not pinned to this checkout",
  );
  requireHash(manifest.toolchain?.circomBinarySha256, "Circom binary digest");
  checkHashedFile(
    root,
    "node_modules/snarkjs/build/cli.cjs",
    manifest.toolchain?.snarkjsCliSha256,
    "snarkjs CLI",
    "node_modules/snarkjs/",
  );
  checkHashedFile(root, "package-lock.json", manifest.toolchain?.packageLockSha256, "package lock");
  const ptau = checkHashedFile(
    root,
    manifest.phase1?.path,
    manifest.phase1?.sha256,
    "Phase 1 Powers of Tau",
    "circuits/ptau/",
  );
  const transcript = readJson(
    root,
    manifest.phase2?.transcriptPath,
    "Phase 2 transcript",
    "release-evidence/shielded/",
  );
  requireHash(manifest.phase2?.transcriptSha256, "Phase 2 transcript digest");
  requireValue(
    hashFile(transcript.absolute) === manifest.phase2.transcriptSha256,
    "Phase 2 transcript SHA-256 mismatch",
  );
  requireValue(
    transcript.value?.schema === "deepfamily/shielded-phase2-transcript@1",
    "Phase 2 transcript schema is invalid",
  );
  requireValue(
    transcript.value.status === "production",
    "Phase 2 transcript must attest a production ceremony",
  );
  requireValue(
    transcript.value.phase1Sha256 === manifest.phase1.sha256,
    "Phase 2 transcript uses a different Phase 1 file",
  );

  const actions = Object.keys(SHIELDED_CIRCUITS);
  requireValue(
    Object.keys(manifest.circuits ?? {})
      .sort()
      .join(",") === actions.slice().sort().join(","),
    "Production manifest must contain exactly all nine shielded circuits",
  );
  requireValue(
    Object.keys(transcript.value.circuits ?? {})
      .sort()
      .join(",") === actions.slice().sort().join(","),
    "Phase 2 transcript must cover exactly all nine shielded circuits",
  );
  const artifacts = {};
  for (const [action, source] of Object.entries(SHIELDED_CIRCUITS)) {
    const item = manifest.circuits[action];
    const ceremony = transcript.value.circuits[action];
    requireValue(
      item.source === source,
      `${action} source circuit name differs from the release contract action`,
    );
    requireValue(
      item.publicSignals === (action === "keyRegistration" ? 7 : 32),
      `${action} public-signal count is not the reviewed ABI`,
    );
    const prefix = `zk-artifacts/shielded/${source}`;
    const sourcePath = checkHashedFile(
      root,
      `circuits/${source}.circom`,
      item.sourceSha256,
      `${action} source`,
      "circuits/",
    );
    const r1cs = checkHashedFile(
      root,
      `${prefix}.r1cs`,
      item.r1csSha256,
      `${action} R1CS`,
      "zk-artifacts/shielded/",
    );
    const wasm = checkHashedFile(
      root,
      `${prefix}_js/${source}.wasm`,
      item.wasmSha256,
      `${action} WASM`,
      "zk-artifacts/shielded/",
    );
    const zkey = checkHashedFile(
      root,
      `${prefix}_final.zkey`,
      item.zkeySha256,
      `${action} production zkey`,
      "zk-artifacts/shielded/",
    );
    const vkey = checkHashedFile(
      root,
      `${prefix}.vkey.json`,
      item.verificationKeySha256,
      `${action} verification key`,
      "zk-artifacts/shielded/",
    );
    const browserPrefix = `frontend/public/zk/shielded/${source}`;
    checkHashedFile(
      root,
      `${browserPrefix}.wasm`,
      item.wasmSha256,
      `${action} browser-served WASM`,
      "frontend/public/zk/shielded/",
    );
    checkHashedFile(
      root,
      `${browserPrefix}_final.zkey`,
      item.zkeySha256,
      `${action} browser-served production zkey`,
      "frontend/public/zk/shielded/",
    );
    checkHashedFile(
      root,
      `${browserPrefix}.vkey.json`,
      item.verificationKeySha256,
      `${action} browser-served verification key`,
      "frontend/public/zk/shielded/",
    );
    const verifier = checkHashedFile(
      root,
      item.verifierPath,
      item.verifierSha256,
      `${action} deployed Solidity verifier`,
      "contracts/",
    );
    requireValue(
      /^[A-Z][A-Za-z0-9]{2,79}$/.test(item.verifierContractName ?? ""),
      `${action} verifier contract name is invalid`,
    );
    const parsedVkey = JSON.parse(fs.readFileSync(vkey, "utf8"));
    requireValue(
      parsedVkey.nPublic === item.publicSignals,
      `${action} verification key has ${parsedVkey.nPublic} public signals; expected ${item.publicSignals}`,
    );
    requireValue(
      ceremony?.r1csSha256 === item.r1csSha256,
      `${action} ceremony R1CS digest differs from production manifest`,
    );
    requireValue(
      ceremony?.zkeySha256 === item.zkeySha256,
      `${action} ceremony zkey digest differs from production manifest`,
    );
    requireValue(
      Array.isArray(ceremony.contributions) && ceremony.contributions.length > 0,
      `${action} has no Phase 2 contribution evidence`,
    );
    const names = new Set();
    for (const contribution of ceremony.contributions) {
      requireValue(
        typeof contribution.participantId === "string" &&
          contribution.participantId.trim().length >= 3 &&
          !/development|test|local-only/i.test(contribution.participantId),
        `${action} has an invalid Phase 2 participant`,
      );
      requireValue(
        !names.has(contribution.participantId),
        `${action} repeats a Phase 2 participant`,
      );
      requireValue(
        BLAKE2B512.test(contribution.contributionHash ?? ""),
        `${action} Phase 2 contribution hash is invalid`,
      );
      names.add(contribution.participantId);
    }
    if (ceremony.beacon !== undefined) {
      requireValue(
        typeof ceremony.beacon.name === "string" &&
          ceremony.beacon.name.trim().length >= 3 &&
          BLAKE2B512.test(ceremony.beacon.contributionHash ?? "") &&
          SHA256.test(ceremony.beacon.hash ?? "") &&
          Number.isSafeInteger(ceremony.beacon.numIterationsExp) &&
          ceremony.beacon.numIterationsExp > 0,
        `${action} final Phase 2 beacon evidence is invalid`,
      );
    }
    artifacts[action] = { source, sourcePath, r1cs, wasm, zkey, vkey, verifier, item, ceremony };
  }
  const criteria = manifest.releaseCriteria;
  for (const field of [
    "allocationMaxGas",
    "claim12MaxGas",
    "browserAllocationMaxMs",
    "browserClaim12MaxMs",
    "recoveryMaxMs",
    "recoveryMinEvents",
  ]) {
    requireValue(
      Number.isSafeInteger(criteria?.[field]) && criteria[field] > 0,
      `Production manifest must precommit a positive ${field} release threshold`,
    );
  }
  return { ptau, artifacts, transcript: transcript.value };
}

function auditMessage(scope, manifestSha256, reportSha256) {
  return `DeepFamily shielded audit approval v1\nscope=${scope}\nmanifestSha256=${manifestSha256}\nreportSha256=${reportSha256}`;
}

function assertAudit(root, audit, scope, manifestSha256) {
  requireValue(audit?.decision === "approved", `${scope} independent audit is not approved`);
  requireValue(
    typeof audit.organization === "string" && audit.organization.trim().length >= 3,
    `${scope} auditor organization is missing`,
  );
  requireValue(
    typeof audit.reviewer === "string" && audit.reviewer.trim().length >= 3,
    `${scope} auditor reviewer is missing`,
  );
  checkHashedFile(
    root,
    audit.reportPath,
    audit.reportSha256,
    `${scope} independent audit report`,
    "release-evidence/shielded/",
  );
  let signer;
  try {
    signer = getAddress(audit.signer);
    requireValue(
      verifyMessage(auditMessage(scope, manifestSha256, audit.reportSha256), audit.signature) ===
        signer,
      `${scope} auditor signature does not bind the report and production manifest`,
    );
  } catch (error) {
    fail(`${scope} auditor approval signature is invalid: ${error.message}`);
  }
  return { organization: audit.organization.trim().toLowerCase(), signer };
}

function positiveMeasure(value, label) {
  requireValue(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function assertTestnetReport(report, manifestSha256, criteria) {
  requireValue(
    report?.schema === "deepfamily/shielded-espace-testnet-report@1",
    "Shielded eSpace testnet report schema is invalid",
  );
  requireValue(report.status === "passed", "Shielded eSpace testnet report did not pass");
  requireValue(
    report.manifestSha256 === manifestSha256,
    "Shielded eSpace testnet report uses different production artifacts",
  );
  requireValue(
    report.network === "conflux-espace-testnet" && report.chainId === 71,
    "Testnet report must identify Conflux eSpace testnet chain ID 71",
  );
  for (const [name, limit, expectedPeriods] of [
    ["fullDepthAllocation", "allocationMaxGas", null],
    ["twelvePeriodClaim", "claim12MaxGas", 12],
  ]) {
    const tx = report.transactions?.[name];
    // A well-formed hash is not a verified receipt. Independent reviewers must
    // fetch these transactions from chain ID 71 and inspect their receipts.
    requireValue(TX_HASH.test(tx?.txHash ?? ""), `${name} testnet transaction hash is missing`);
    const used = positiveMeasure(tx.gasUsed, `${name} gas used`);
    const txLimit = positiveMeasure(tx.transactionGasLimit, `${name} transaction gas limit`);
    const blockLimit = positiveMeasure(tx.blockGasLimit, `${name} block gas limit`);
    requireValue(
      used <= txLimit && txLimit <= blockLimit,
      `${name} gas exceeds the transaction or block limit`,
    );
    requireValue(used <= criteria[limit], `${name} exceeds the precommitted release gas threshold`);
    requireValue(
      tx.lineageDepth === 64 && tx.noteDepth === 32,
      `${name} did not exercise the full 64/32-depth paths`,
    );
    if (expectedPeriods !== null)
      requireValue(tx.claimedPeriods === expectedPeriods, `${name} did not exercise 12 periods`);
  }
  const browser = report.browserProof;
  requireValue(
    typeof browser?.device === "string" && browser.device.trim().length >= 3,
    "Browser proof target device is missing",
  );
  requireValue(
    typeof browser?.browser === "string" && browser.browser.trim().length >= 3,
    "Browser proof browser version is missing",
  );
  requireValue(
    positiveMeasure(browser.allocationMs, "Browser allocation proof time") <=
      criteria.browserAllocationMaxMs,
    "Browser allocation proof exceeds precommitted time threshold",
  );
  requireValue(
    positiveMeasure(browser.claim12Ms, "Browser 12-period proof time") <=
      criteria.browserClaim12MaxMs,
    "Browser 12-period proof exceeds precommitted time threshold",
  );
  const recovery = report.recovery;
  requireValue(
    recovery?.cacheCleared === true && recovery.fromPublicEvents === true,
    "Recovery must use public events after clearing the local cache",
  );
  requireValue(
    positiveMeasure(recovery.eventCount, "Recovery event count") >= criteria.recoveryMinEvents,
    "Recovery sample is smaller than precommitted event count",
  );
  requireValue(
    positiveMeasure(recovery.recoveredNotes, "Recovered note count") > 0,
    "Recovery did not find a user's note",
  );
  requireValue(
    positiveMeasure(recovery.durationMs, "Recovery time") <= criteria.recoveryMaxMs,
    "Recovery exceeds precommitted time threshold",
  );
}

function assertReleaseEvidence(root, evidence, manifest, manifestSha256) {
  requireValue(
    evidence?.schema === "deepfamily/shielded-release-evidence@1",
    "Shielded release evidence schema is invalid",
  );
  requireValue(evidence.status === "approved", "Shielded release evidence has not been approved");
  requireValue(
    evidence.manifestSha256 === manifestSha256,
    "Release evidence points to different shielded artifacts",
  );
  const contracts = assertAudit(root, evidence.audits?.contracts, "contracts", manifestSha256);
  const circuits = assertAudit(root, evidence.audits?.circuits, "circuits", manifestSha256);
  requireValue(
    contracts.signer !== circuits.signer,
    "Contract and circuit audits must have distinct external approvers",
  );
  requireValue(
    contracts.organization !== circuits.organization,
    "Contract and circuit audits must come from distinct organizations",
  );
  const testnetPath = checkHashedFile(
    root,
    evidence.testnet?.reportPath,
    evidence.testnet?.reportSha256,
    "Shielded eSpace testnet report",
    "release-evidence/shielded/",
  );
  let report;
  try {
    report = JSON.parse(fs.readFileSync(testnetPath, "utf8"));
  } catch (error) {
    fail(`Shielded eSpace testnet report is not valid JSON: ${error.message}`);
  }
  assertTestnetReport(report, manifestSha256, manifest.releaseCriteria);
}

async function verifyCryptography(root, manifest, { ptau, artifacts, transcript }) {
  const compiler = await assertLocalCircomInstallation({ root });
  requireValue(
    compiler.sha256 === manifest.toolchain.circomBinarySha256,
    "Local Circom compiler differs from reviewed production compiler",
  );
  const snarkjs = checkedFile(root, "node_modules/snarkjs/build/cli.cjs", "snarkjs CLI");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-release-"));
  try {
    // Rebuild every circuit independently from the reviewed source before trusting its R1CS.
    for (const { source, item } of Object.values(artifacts)) {
      execFileSync(
        compiler.path,
        [
          `circuits/${source}.circom`,
          ...CIRCOM_ARTIFACT_FLAGS,
          "-l",
          "node_modules",
          "-l",
          "node_modules/circomlib/circuits",
          "-o",
          temp,
        ],
        { cwd: root, stdio: "inherit" },
      );
      requireValue(
        hashFile(path.join(temp, `${source}.r1cs`)) === item.r1csSha256,
        `${source} rebuilt R1CS differs from production manifest`,
      );
      requireValue(
        hashFile(path.join(temp, `${source}_js`, `${source}.wasm`)) === item.wasmSha256,
        `${source} rebuilt WASM differs from production manifest`,
      );
    }
    // This is intentionally expensive: an unverified Phase 1 or forged Phase 2 can mint DEEP.
    execFileSync(process.execPath, [snarkjs, "powersoftau", "verify", ptau], {
      cwd: root,
      stdio: "inherit",
    });
    for (const [action, { r1cs, zkey, vkey, verifier, item, ceremony }] of Object.entries(
      artifacts,
    )) {
      const mpc = await readZkeyMpcMetadata(zkey);
      requireValue(
        mpc.contributionCount === ceremony.contributions.length + (ceremony.beacon ? 1 : 0),
        `${action} actual zkey contribution count differs from ceremony transcript`,
      );
      ceremony.contributions.forEach((entry, index) => {
        const actual = mpc.contributions[index];
        requireValue(
          actual.type === 0,
          `${action} Phase 2 contribution ${index + 1} is not a normal contribution`,
        );
        requireValue(
          actual.name === entry.participantId,
          `${action} Phase 2 participant name differs from actual zkey`,
        );
        requireValue(
          actual.contributionHash === entry.contributionHash,
          `${action} Phase 2 contribution hash differs from actual zkey`,
        );
      });
      if (ceremony.beacon) {
        const actual = mpc.contributions.at(-1);
        requireValue(actual.type === 1, `${action} final Phase 2 contribution is not a beacon`);
        requireValue(
          actual.name === ceremony.beacon.name,
          `${action} final Phase 2 beacon name differs from actual zkey`,
        );
        requireValue(
          actual.beaconHash === ceremony.beacon.hash,
          `${action} final Phase 2 beacon hash differs from actual zkey`,
        );
        requireValue(
          actual.numIterationsExp === ceremony.beacon.numIterationsExp,
          `${action} final Phase 2 beacon iterations differ from actual zkey`,
        );
        requireValue(
          actual.contributionHash === ceremony.beacon.contributionHash,
          `${action} final Phase 2 beacon contribution differs from actual zkey`,
        );
      }
      execFileSync(process.execPath, [snarkjs, "zkey", "verify", r1cs, ptau, zkey], {
        cwd: root,
        stdio: "inherit",
      });
      const exportedVkey = path.join(temp, `${action}.vkey.json`);
      execFileSync(
        process.execPath,
        [snarkjs, "zkey", "export", "verificationkey", zkey, exportedVkey],
        { cwd: root, stdio: "inherit" },
      );
      requireValue(
        JSON.stringify(JSON.parse(fs.readFileSync(exportedVkey, "utf8"))) ===
          JSON.stringify(JSON.parse(fs.readFileSync(vkey, "utf8"))),
        `${action} verification key is not derived from the final zkey`,
      );
      const exportedSolidity = path.join(temp, `${action}.sol`);
      execFileSync(
        process.execPath,
        [snarkjs, "zkey", "export", "solidityverifier", zkey, exportedSolidity],
        { cwd: root, stdio: "inherit" },
      );
      const generatedSource = renameZkVerifierSource(
        fs.readFileSync(exportedSolidity, "utf8"),
        item.verifierContractName,
      );
      requireValue(
        generatedSource === fs.readFileSync(verifier, "utf8"),
        `${action} checked-in Solidity verifier differs from final zkey output`,
      );
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  requireValue(
    transcript.status === "production",
    "Phase 2 transcript ceased to be production evidence",
  );
}

export async function checkShieldedRelease({ root = DEFAULT_ROOT } = {}) {
  root = path.resolve(root);
  const productionManifest = path.join(root, MANIFEST_PATH);
  if (!fs.existsSync(productionManifest)) {
    const developmentManifest = path.join(root, "zk-artifacts/shielded/development-manifest.json");
    fail(
      `Missing ${MANIFEST_PATH}. ` +
        (fs.existsSync(developmentManifest)
          ? "The existing development-only shielded keys are explicitly forbidden for release. "
          : "") +
        "Generate and independently verify production Phase 2 artifacts first.",
    );
  }
  const { value: manifest } = readJson(
    root,
    MANIFEST_PATH,
    "Shielded production manifest",
    "circuits/",
  );
  const assets = assertProductionManifest(root, manifest);
  const manifestSha256 = hashFile(productionManifest);
  const { value: evidence } = readJson(
    root,
    EVIDENCE_PATH,
    "Shielded release evidence",
    "release-evidence/shielded/",
  );
  assertReleaseEvidence(root, evidence, manifest, manifestSha256);
  assertCleanCheckout(root);
  await verifyCryptography(root, manifest, assets);
  return { manifestSha256, circuitCount: Object.keys(assets.artifacts).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--print-source-digest") {
    console.log(sourceBundleSha256());
  } else if (process.argv.length !== 2) {
    console.error("Usage: npm run zk:shielded:release:check [-- --print-source-digest]");
    process.exitCode = 1;
  } else {
    checkShieldedRelease()
      .then(({ manifestSha256, circuitCount }) => {
        console.log(
          `Shielded automated release checks passed: ${circuitCount} circuits, manifest SHA-256 ${manifestSha256}. Independently verify testnet receipts and auditor identities before release.`,
        );
      })
      .catch((error) => {
        console.error(`[zk-shielded-release-check] ${error.message}`);
        process.exitCode = 1;
      });
  }
}
