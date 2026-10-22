import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RECEIVE_CIRCUIT_VERSION } from "../../packages/receive-prover/browser.mjs";

export const RECEIVE_DEVELOPMENT_MANIFEST = "circuits/receive-development-manifest.json";
export const RECEIVE_PRODUCTION_MANIFEST = "circuits/receive-production-manifest.json";
export const RECEIVE_BUILD_MANIFEST = "build-manifest.json";
export const RECEIVE_CIRCUITS = Object.freeze({
  anonymous: Object.freeze({
    issuer: "shielded_anonymous_receive_credential",
    contractName: "AnonymousReceivePresentationVerifier",
    publicSignals: 11,
  }),
  fund: Object.freeze({
    issuer: "shielded_fund_receive_credential",
    contractName: "FundReceivePresentationVerifier",
    publicSignals: 11,
  }),
  attachment: Object.freeze({
    issuer: "shielded_anonymous_receive_credential",
    contractName: "AttachedReceivePresentationVerifier",
    publicSignals: 14,
  }),
});
const SHA256 = /^[0-9a-f]{64}$/u;
const ARTIFACTS = ["receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"];
// Presentation proving files can be much larger than the Circom keys. Hash in
// bounded chunks so checking a complete set does not retain gigabytes of buffers.
export function receiveArtifactSha256(file) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(file, "r");
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sameKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function receiveProverSourceHashes({ root = process.cwd() } = {}) {
  const directory = path.join(root, "packages/receive-prover");
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".go") && !name.endsWith("_test.go"));
  files.push("go.mod", "go.sum", "poseidon-constants.json");
  return Object.fromEntries(
    files.sort().map((name) => [name, receiveArtifactSha256(path.join(directory, name))]),
  );
}

export function receiveLoaderSourceHashes({ root = process.cwd() } = {}) {
  return Object.fromEntries(
    ["browser.mjs", "worker.mjs", "wasm_exec.js"].map((name) => [
      name,
      receiveArtifactSha256(path.join(root, "packages/receive-prover", name)),
    ]),
  );
}

export function assertReceiveSourceSnapshot(actual, expected, label) {
  assert(
    sameKeys(actual, Object.keys(expected)),
    `${label} source catalog mismatch; rebuild and regenerate matching receive artifacts`,
  );
  for (const [name, digest] of Object.entries(expected)) {
    assert(
      actual[name] === digest,
      `${label} stale source: ${name}; rebuild and regenerate matching receive artifacts`,
    );
  }
}

export function readReceiveBuildSnapshot({ root = process.cwd(), outDir } = {}) {
  const file = path.join(outDir, RECEIVE_BUILD_MANIFEST);
  assert(
    fs.existsSync(file),
    "Receive build source snapshot not found (run `npm run zk:build` first)",
  );
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(
    snapshot.schema === "deepfamily/receive-prover-build@1",
    "Unsupported receive build snapshot",
  );
  assertReceiveSourceSnapshot(
    snapshot.sourceFiles,
    receiveProverSourceHashes({ root }),
    "Receive build",
  );
  const native = process.platform === "win32" ? "receive-prover.exe" : "receive-prover";
  for (const name of [native, "receive-prover.wasm", "wasm_exec.js"]) {
    assert(
      SHA256.test(snapshot.artifacts?.[name] ?? "") &&
        receiveArtifactSha256(path.join(outDir, name)) === snapshot.artifacts[name],
      `Receive build artifact mismatch: ${name}`,
    );
  }
  return snapshot;
}

/** Checks the complete public presentation set, including its fixed issuer and Solidity pins. */
export function inspectReceiveArtifacts({ root = process.cwd(), requireProduction = false } = {}) {
  root = path.resolve(root);
  const production = fs.existsSync(path.join(root, RECEIVE_PRODUCTION_MANIFEST));
  assert(
    !requireProduction || production,
    "Receive presentation production manifest not found; development keys cannot authorize a production release",
  );
  const manifestFile = path.join(
    root,
    production ? RECEIVE_PRODUCTION_MANIFEST : RECEIVE_DEVELOPMENT_MANIFEST,
  );
  if (!fs.existsSync(manifestFile))
    throw Object.assign(
      new Error(
        "Receive presentation manifest not found (run `npm run zk:development:setup` first)",
      ),
      { code: "ENOENT" },
    );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert(
    manifest.schema ===
      (production
        ? "deepfamily/receive-production-keys@1"
        : "deepfamily/receive-development-keys@1") &&
      manifest.developmentOnly === !production &&
      manifest.productionReady === production,
    "Receive manifest must explicitly identify its development or production key lifecycle",
  );
  assert(
    manifest.circuitVersion === RECEIVE_CIRCUIT_VERSION,
    "Receive presentation circuit version mismatch",
  );
  assert(
    sameKeys(manifest.kinds, Object.keys(RECEIVE_CIRCUITS)),
    "Receive presentation manifest must contain exactly all three circuit kinds",
  );
  assertReceiveSourceSnapshot(
    manifest.sourceFiles,
    receiveProverSourceHashes({ root }),
    "Receive presentation",
  );
  assertReceiveSourceSnapshot(
    manifest.loaderSources,
    receiveLoaderSourceHashes({ root }),
    "Receive loader",
  );
  const checkFile = (relative, expected, label) => {
    assert(SHA256.test(expected ?? ""), `${label} requires a SHA-256 digest`);
    const file = path.join(root, relative);
    if (!fs.existsSync(file))
      throw Object.assign(new Error(`${label} not found: ${relative}`), { code: "ENOENT" });
    assert(
      fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),
      `${label} must be a regular non-symlink file`,
    );
    assert(receiveArtifactSha256(file) === expected, `${label} SHA-256 mismatch: ${relative}`);
  };
  if (production) {
    assert(
      manifest.trustModel === "single-operator" &&
        manifest.minimumContributors === 1 &&
        manifest.contributorCount === 1 &&
        /^[0-9a-f]{40}$/u.test(manifest.releaseCommit ?? "") &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(manifest.ceremonyId ?? ""),
      "Receive production ceremony identity or trust model is invalid",
    );
    checkFile(
      "circuits/shielded-production-manifest.json",
      manifest.issuerManifestSha256,
      "Receive production issuer manifest",
    );
    const issuer = JSON.parse(
      fs.readFileSync(path.join(root, "circuits/shielded-production-manifest.json"), "utf8"),
    );
    assert(
      issuer.status === "production" &&
        issuer.productionReady === true &&
        issuer.developmentOnly === false,
      "Receive production ceremony requires production credential issuers",
    );
    assert(
      /^go version go\d+\.\d+\.\d+ \S+$/u.test(manifest.toolchain?.goVersion ?? "") &&
        SHA256.test(manifest.toolchain?.goBinarySha256 ?? ""),
      "Receive production Go toolchain evidence is invalid",
    );
  }
  const runtime = {
    "receive-prover.wasm": manifest.runtime?.wasmSha256,
    "wasm_exec.js": manifest.runtime?.wasmExecSha256,
  };
  for (const [file, expected] of Object.entries(runtime))
    checkFile(`frontend/public/zk/receive/${file}`, expected, `Receive ${file}`);
  checkFile(
    "packages/receive-prover/wasm_exec.js",
    runtime["wasm_exec.js"],
    "Vendored receive Go runtime",
  );
  for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
    const entry = manifest.kinds[kind];
    assert(
      entry.contractName === spec.contractName && entry.publicSignals === spec.publicSignals,
      `${kind} receive verifier identity or public signal count mismatch`,
    );
    assert(
      Number.isSafeInteger(entry.constraints) && entry.constraints > 0,
      `${kind} receive constraints must be positive`,
    );
    checkFile(
      `frontend/public/zk/shielded/${spec.issuer}.vkey.json`,
      entry.issuerVkSha256,
      `${kind} fixed issuer key`,
    );
    const directory = `frontend/public/zk/receive/${kind}`;
    checkFile(`${directory}/manifest.json`, entry.manifestSha256, `${kind} receive manifest`);
    const item = JSON.parse(fs.readFileSync(path.join(root, directory, "manifest.json"), "utf8"));
    assert(
      item.kind === kind &&
        item.circuitVersion === RECEIVE_CIRCUIT_VERSION &&
        item.productionCeremony === production &&
        item.setup === (production ? "single-operator-mpc" : "insecure-local-development") &&
        (!production || item.ceremonyId === manifest.ceremonyId) &&
        item.publicSignals === spec.publicSignals &&
        item.constraints === entry.constraints &&
        item.issuerVkSha256 === entry.issuerVkSha256,
      `${kind} receive manifest does not match its pinned ${production ? "production" : "development"} circuit`,
    );
    assertReceiveSourceSnapshot(item.sourceFiles, manifest.sourceFiles, `${kind} receive circuit`);
    assert(
      sameKeys(entry.artifacts, ARTIFACTS) && sameKeys(item.artifacts, ARTIFACTS),
      `${kind} receive artifact catalog mismatch`,
    );
    assert(
      sameKeys(item.runtimeArtifacts, Object.keys(runtime)),
      `${kind} receive runtime catalog mismatch`,
    );
    for (const [file, expected] of Object.entries(runtime))
      assert(
        item.runtimeArtifacts[file] === expected,
        `${kind} receive ${file} runtime pin mismatch`,
      );
    for (const file of ARTIFACTS) {
      assert(
        entry.artifacts[file] === item.artifacts[file],
        `${kind} receive ${file} pin mismatch`,
      );
      checkFile(
        file === "ReceiptVerifier.sol"
          ? `contracts/${spec.contractName}.sol`
          : `${directory}/${file}`,
        entry.artifacts[file],
        `${kind} receive ${file}`,
      );
    }
    if (production) {
      const evidence = entry.ceremony;
      const expectedDir = `release-evidence/receive/${kind}`;
      assert(
        evidence?.path === `${expectedDir}/ceremony.json`,
        `${kind} ceremony evidence path mismatch`,
      );
      checkFile(evidence.path, evidence.sha256, `${kind} public ceremony record`);
      const ceremony = JSON.parse(fs.readFileSync(path.join(root, evidence.path), "utf8"));
      assert(
        ceremony.schema === "deepfamily/receive-gnark-ceremony@1" &&
          ceremony.trustModel === "single-operator" &&
          ceremony.minimumContributors === 1 &&
          ceremony.contributorCount === 1 &&
          ceremony.randomnessSource === "crypto/rand" &&
          ceremony.finalizationSource ===
            "crypto/rand, generated after the corresponding contribution" &&
          ceremony.contractName === spec.contractName &&
          ceremony.r1csSha256 === entry.artifacts["receipt.r1cs"] &&
          ceremony.publicSignals === spec.publicSignals &&
          ceremony.constraints === entry.constraints &&
          ceremony.domainSize === 2 ** Math.ceil(Math.log2(entry.constraints)),
        `${kind} public ceremony binding mismatch`,
      );
      assert(
        sameKeys(ceremony.artifacts, ["receipt.pk", "receipt.vk", "ReceiptVerifier.sol"]),
        `${kind} ceremony artifact catalog mismatch`,
      );
      for (const file of Object.keys(ceremony.artifacts))
        assert(
          ceremony.artifacts[file] === entry.artifacts[file],
          `${kind} ceremony key pin mismatch: ${file}`,
        );
      for (const phase of ["phase1", "phase2"]) {
        assert(
          evidence[phase]?.path === `${expectedDir}/${phase}.contribution` &&
            ceremony[phase]?.file === `${phase}.contribution` &&
            ceremony[phase].sha256 === evidence[phase].sha256 &&
            SHA256.test(ceremony[phase].finalization ?? ""),
          `${kind} ${phase} contribution record mismatch`,
        );
        checkFile(
          evidence[phase].path,
          evidence[phase].sha256,
          `${kind} ${phase} public contribution`,
        );
      }
    }
  }
  return {
    status: production ? "production" : "development",
    circuitCount: Object.keys(RECEIVE_CIRCUITS).length,
    manifestSha256: receiveArtifactSha256(manifestFile),
  };
}
