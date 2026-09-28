#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_VERSION,
} from "./lib/circomToolchain.mjs";
import { buildSnarkjsCommand, resolveSnarkjsCliPath } from "./lib/snarkjsToolchain.mjs";
import { PRODUCTION_PTAU_SHA256, resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import {
  SHIELDED_PRODUCTION_MANIFEST_PATH,
  SHIELDED_SETUP_CIRCUITS,
  inspectShieldedProductionArtifacts,
} from "./lib/shieldedProductionSetup.mjs";
import { inspectZkReleaseArtifacts, sha256CanonicalTextFile } from "./lib/zkArtifactTrust.mjs";
import { renameZkVerifierSource } from "./rename-zk-verifier.mjs";
import { SHIELDED_CIRCUITS } from "./zk-shielded-build.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const manifestPath = path.join(projectRoot, "circuits", "zk-artifacts-manifest.json");

const circuits = [
  {
    name: "person_commitment",
    builtR1cs: "zk-artifacts/circuits/person_commitment.r1cs",
    builtWasm: "zk-artifacts/circuits/person_commitment_js/person_commitment.wasm",
    committedWasm: "frontend/public/zk/person_commitment.wasm",
    committedZkey: "frontend/public/zk/person_commitment_final.zkey",
    committedVkey: "frontend/public/zk/person_commitment.vkey.json",
    verifier: "contracts/PersonCommitmentVerifier.sol",
    verifierContractName: "PersonCommitmentVerifier",
  },
  {
    name: "disclosure_binding",
    builtR1cs: "zk-artifacts/circuits/disclosure_binding.r1cs",
    builtWasm: "zk-artifacts/circuits/disclosure_binding_js/disclosure_binding.wasm",
    committedWasm: "frontend/public/zk/disclosure_binding.wasm",
    committedZkey: "frontend/public/zk/disclosure_binding_final.zkey",
    committedVkey: "frontend/public/zk/disclosure_binding.vkey.json",
    verifier: "contracts/DisclosureBindingVerifier.sol",
    verifierContractName: "DisclosureBindingVerifier",
  },
];

function absolute(relativePath) {
  return path.join(projectRoot, relativePath);
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertHash(filePath, expected, label) {
  const actual = sha256(filePath);
  if (actual !== expected) {
    throw new Error(
      `${label} does not match the checked-in circuit manifest\n` +
        `  expected: ${expected}\n` +
        `  actual:   ${actual}`,
    );
  }
}

function assertSameFile(actualPath, expectedPath, label, { canonicalText = false } = {}) {
  const hash = canonicalText ? (filePath) => sha256CanonicalTextFile(filePath, label) : sha256;
  const actual = hash(actualPath);
  const expected = hash(expectedPath);
  if (actual !== expected) {
    throw new Error(
      `${label} is stale or was generated from a different artifact\n` +
        `  generated: ${actual}\n` +
        `  committed: ${expected}`,
    );
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

export function checkLegacyArtifacts() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const snarkjsCli = resolveSnarkjsCliPath({ root: projectRoot });
  const renameVerifierScript = absolute("scripts/rename-zk-verifier.mjs");
  const circomBinary = absolute(CIRCOM_CANONICAL_POLICY.binaryPath);

  requireFile(snarkjsCli, "snarkjs CLI (run `npm install` first)");
  requireFile(circomBinary, "canonical Circom compiler (run `npm run zk:fetch` first)");
  const releaseArtifactEvidence = inspectZkReleaseArtifacts({
    root: projectRoot,
    requireBuiltR1cs: true,
  });
  console.log(
    `ZK release manifest: ${releaseArtifactEvidence.trustedSetupStatus}, ` +
      `${releaseArtifactEvidence.trustModel}, ` +
      releaseArtifactEvidence.manifestSha256,
  );
  if (manifest.circomVersion !== CIRCOM_VERSION) {
    throw new Error(
      `Pinned Circom ${CIRCOM_VERSION} does not match manifest version ${manifest.circomVersion}`,
    );
  }
  assertHash(circomBinary, CIRCOM_LINUX_X64_SHA256, "Pinned canonical Circom compiler");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-zk-artifacts-"));
  try {
    for (const circuit of circuits) {
      const builtR1cs = absolute(circuit.builtR1cs);
      const builtWasm = absolute(circuit.builtWasm);
      const committedWasm = absolute(circuit.committedWasm);
      const committedZkey = absolute(circuit.committedZkey);
      const committedVkey = absolute(circuit.committedVkey);
      const verifier = absolute(circuit.verifier);
      const expectedR1csHash = manifest.circuits?.[circuit.name]?.r1csSha256;

      if (!expectedR1csHash) {
        throw new Error(`Missing R1CS hash for ${circuit.name} in ${manifestPath}`);
      }

      requireFile(builtR1cs, `${circuit.name} compiled R1CS (run \`npm run zk:build\` first)`);
      requireFile(builtWasm, `${circuit.name} compiled WASM (run \`npm run zk:build\` first)`);
      requireFile(committedWasm, `${circuit.name} committed WASM`);
      requireFile(committedZkey, `${circuit.name} committed zkey`);
      requireFile(committedVkey, `${circuit.name} committed verification key`);
      requireFile(verifier, `${circuit.name} Solidity verifier`);

      assertHash(builtR1cs, expectedR1csHash, `${circuit.name} R1CS`);
      assertSameFile(builtWasm, committedWasm, `${circuit.name} WASM`);

      const exportedVkey = path.join(tempDir, `${circuit.name}.vkey.json`);
      const exportedVerifier = path.join(tempDir, `${circuit.verifierContractName}.sol`);
      for (const args of [
        ["zkey", "export", "verificationkey", committedZkey, exportedVkey],
        ["zkey", "export", "solidityverifier", committedZkey, exportedVerifier],
      ]) {
        const command = buildSnarkjsCommand({ root: projectRoot, args });
        run(command.executable, command.args);
      }
      run(process.execPath, [renameVerifierScript, exportedVerifier, circuit.verifierContractName]);

      assertSameFile(exportedVkey, committedVkey, `${circuit.name} verification key`, {
        canonicalText: true,
      });
      assertSameFile(exportedVerifier, verifier, `${circuit.name} Solidity verifier`, {
        canonicalText: true,
      });
      console.log(
        `${circuit.name}: compiled R1CS/WASM and zkey-derived vkey/Solidity verifier match`,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return releaseArtifactEvidence;
}

const SHIELDED_DEVELOPMENT_MANIFEST = "circuits/shielded-development-manifest.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function checkShieldedDevelopmentArtifacts({
  root = projectRoot,
  runner = run,
  ptauPath,
  env = process.env,
  platform = process.platform,
} = {}) {
  const manifestFile = path.join(root, SHIELDED_DEVELOPMENT_MANIFEST);
  requireFile(
    manifestFile,
    "shielded development manifest (run `npm run zk:development:setup` first)",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (
    manifest.schema !== "deepfamily/shielded-development-keys@1" ||
    manifest.developmentOnly !== true ||
    manifest.productionReady !== false
  ) {
    throw new Error("Shielded development manifest must explicitly mark all keys development-only");
  }
  if (!SHA256_PATTERN.test(manifest.ptauSha256 ?? "")) {
    throw new Error("Shielded development manifest ptauSha256 must be a SHA-256 digest");
  }
  if (manifest.ptauSha256 !== PRODUCTION_PTAU_SHA256) {
    throw new Error("Shielded development Powers of Tau must match the pinned file");
  }
  const selectedPtauPath =
    typeof ptauPath === "string" && ptauPath.trim() !== ""
      ? path.resolve(root, ptauPath)
      : resolveProductionPtauPath({ root, env, platform });
  requireFile(selectedPtauPath, "shielded development Powers of Tau");
  const ptauState = fs.lstatSync(selectedPtauPath);
  if (
    !ptauState.isFile() ||
    ptauState.isSymbolicLink() ||
    fs.realpathSync(selectedPtauPath) !== selectedPtauPath
  ) {
    throw new Error("Shielded development Powers of Tau must be a regular non-symlink file");
  }
  assertHash(selectedPtauPath, PRODUCTION_PTAU_SHA256, "Shielded development Powers of Tau");
  const expectedActions = Object.keys(SHIELDED_CIRCUITS).sort();
  const actualActions = Object.keys(manifest.circuits ?? {}).sort();
  if (JSON.stringify(actualActions) !== JSON.stringify(expectedActions)) {
    throw new Error("Shielded development manifest must contain exactly all nine circuits");
  }
  const snarkjsCli = resolveSnarkjsCliPath({ root });
  requireFile(snarkjsCli, "snarkjs CLI (run `npm install` first)");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-artifacts-"));
  try {
    for (const [action, name] of Object.entries(SHIELDED_CIRCUITS)) {
      const item = manifest.circuits[action];
      if (item?.source !== name) {
        throw new Error(`${action} development manifest source must be ${name}`);
      }
      const spec = SHIELDED_SETUP_CIRCUITS[action];
      if (
        item.verifierPath !== spec.verifierPath ||
        item.verifierContractName !== spec.verifierContractName
      ) {
        throw new Error(`${action} development verifier identity differs from its circuit action`);
      }
      const prefix = `zk-artifacts/shielded/${name}`;
      const browser = `frontend/public/zk/shielded/${name}`;
      const paths = {
        sourceSha256: `circuits/${name}.circom`,
        r1csSha256: `${prefix}.r1cs`,
        wasmSha256: `${prefix}_js/${name}.wasm`,
        zkeySha256: `${browser}_final.zkey`,
        verificationKeySha256: `${browser}.vkey.json`,
        solidityVerifierSha256: spec.verifierPath,
      };
      for (const [field, relativePath] of Object.entries(paths)) {
        const expectedHash = item[field];
        if (!SHA256_PATTERN.test(expectedHash ?? "")) {
          throw new Error(`${action} development manifest ${field} must be a SHA-256 digest`);
        }
        const file = path.join(root, relativePath);
        requireFile(file, `${action} development ${field}`);
        assertHash(file, expectedHash, `${action} development ${field}`);
      }
      assertSameFile(
        path.join(root, paths.wasmSha256),
        path.join(root, `${browser}.wasm`),
        `${action} browser WASM`,
      );
      const exportedVkey = path.join(tempDir, `${name}.vkey.json`);
      const exportedVerifier = path.join(tempDir, `${name}.sol`);
      for (const args of [
        ["zkey", "export", "verificationkey", path.join(root, paths.zkeySha256), exportedVkey],
        ["zkey", "export", "solidityverifier", path.join(root, paths.zkeySha256), exportedVerifier],
      ]) {
        const command = buildSnarkjsCommand({ root, args });
        runner(command.executable, command.args);
      }
      fs.writeFileSync(
        exportedVerifier,
        renameZkVerifierSource(
          fs.readFileSync(exportedVerifier, "utf8"),
          spec.verifierContractName,
        ),
      );
      assertSameFile(
        exportedVkey,
        path.join(root, paths.verificationKeySha256),
        `${action} development verification key`,
        { canonicalText: true },
      );
      assertSameFile(
        exportedVerifier,
        path.join(root, paths.solidityVerifierSha256),
        `${action} development verifier`,
        { canonicalText: true },
      );
      console.log(`${action}: development R1CS/WASM and zkey-derived verifier match`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return { status: "development", circuitCount: expectedActions.length };
}

export function checkShieldedArtifacts({
  root = projectRoot,
  productionInspector = inspectShieldedProductionArtifacts,
} = {}) {
  if (fs.existsSync(path.join(root, SHIELDED_PRODUCTION_MANIFEST_PATH))) {
    const result = productionInspector({ root });
    const circuitCount = Object.keys(result.artifacts).length;
    if (circuitCount !== Object.keys(SHIELDED_CIRCUITS).length) {
      throw new Error("Shielded production artifact check must cover all nine circuits");
    }
    console.log(`Shielded production manifest: ${circuitCount} circuits, ` + result.manifestSha256);
    return { status: "production", circuitCount };
  }
  return checkShieldedDevelopmentArtifacts({ root });
}

export function main() {
  const legacy = checkLegacyArtifacts();
  const shielded = checkShieldedArtifacts();
  return { legacy, shielded };
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[check-zk-artifacts] ${error.message}`);
    process.exitCode = 1;
  }
}
