#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCOM_LINUX_X64_SHA256, CIRCOM_VERSION } from "./fetch-circom.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const manifestPath = path.join(projectRoot, "circuits", "zk-artifacts-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

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

function assertSameFile(actualPath, expectedPath, label) {
  const actual = sha256(actualPath);
  const expected = sha256(expectedPath);
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

const snarkjsBinary = absolute(
  process.platform === "win32" ? "node_modules/.bin/snarkjs.cmd" : "node_modules/.bin/snarkjs",
);
const renameVerifierScript = absolute("scripts/rename-zk-verifier.mjs");
const circomBinary = absolute("bin/circom");

requireFile(snarkjsBinary, "snarkjs CLI (run `npm install` first)");
requireFile(circomBinary, "pinned Circom compiler (run `npm run zk:fetch` first)");
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
assertHash(circomBinary, CIRCOM_LINUX_X64_SHA256, "Pinned Circom compiler");

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
    run(snarkjsBinary, ["zkey", "export", "verificationkey", committedZkey, exportedVkey]);
    run(snarkjsBinary, ["zkey", "export", "solidityverifier", committedZkey, exportedVerifier]);
    run(process.execPath, [renameVerifierScript, exportedVerifier, circuit.verifierContractName]);

    assertSameFile(exportedVkey, committedVkey, `${circuit.name} verification key`);
    assertSameFile(exportedVerifier, verifier, `${circuit.name} Solidity verifier`);
    console.log(
      `${circuit.name}: compiled R1CS/WASM and zkey-derived vkey/Solidity verifier match`,
    );
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
