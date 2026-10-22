// RESEARCH ONLY. EVM compatibility of the already-generated Claim proofs.
// Deploys only a stateless verifier; no pool, Claim entry point or value ledger.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import hre from "hardhat";

assert.ok(process.env.DEEPFAMILY_CLAIM_VIEW_OUT, "Expected temporary Claim research output directory");
const out = path.resolve(process.env.DEEPFAMILY_CLAIM_VIEW_OUT);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const summary = read(path.join(out, "summary.json"));
assert.equal(summary.counts.validRealProofs, 10, "Expected the recorded ten-proof Claim suite");
const sourceFile = path.join(out, "ClaimViewVerifier.sol");
const source = fs.readFileSync(sourceFile, "utf8");
const solc = process.env.DEEPFAMILY_RESEARCH_SOLC ?? path.join(os.homedir(),
  "Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const input = {
  language: "Solidity",
  sources: {"ClaimViewVerifier.sol": {content: source}},
  settings: {
    optimizer: {enabled: true, runs: 1}, viaIR: true, evmVersion: "cancun",
    outputSelection: {"*": {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]}},
  },
};
const compiled = JSON.parse(execFileSync(solc, ["--standard-json"], {
  input: JSON.stringify(input), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
}));
assert.deepEqual((compiled.errors ?? []).filter(error => error.severity === "error"), []);
const artifact = compiled.contracts["ClaimViewVerifier.sol"].ClaimViewVerifier;
assert.ok(artifact.abi.some(item => item.name === "verifyProof"));

const connection = await hre.network.create();
try {
  const {ethers} = connection;
  const [signer] = await ethers.getSigners();
  const verifier = await new ethers.ContractFactory(artifact.abi,
    artifact.evm.bytecode.object, signer).deploy();
  await verifier.waitForDeployment();
  const deployed = await ethers.provider.getCode(await verifier.getAddress());
  assert.notEqual(deployed, "0x");
  const checks = [];
  const cases = [];
  for (let caseIndex = 0; caseIndex < summary.validProofs.length; caseIndex++) {
    const item = summary.validProofs[caseIndex];
    assert.equal(item.passed, true);
    assert.equal(path.basename(item.name), item.name);
    const proofFile = path.join(out, item.name + ".solidity.json");
    const proof = read(proofFile);
    assert.equal(proof.publicSignals.length, 27);
    assert.equal(await verifier.verifyProof.staticCall(proof.a, proof.b, proof.c,
      proof.publicSignals), true, item.name + ": real EVM verifier");
    checks.push({test: item.name + ": existing real proof accepted by deployed EVM verifier", passed: true});
    const mutationIndex = caseIndex % proof.publicSignals.length;
    const changed = [...proof.publicSignals];
    changed[mutationIndex] = String(BigInt(changed[mutationIndex]) + 1n);
    assert.equal(await verifier.verifyProof.staticCall(proof.a, proof.b, proof.c,
      changed), false, item.name + ": public mutation must reject");
    checks.push({test: item.name + ": changed public signal " + mutationIndex + " rejected", passed: true});
    cases.push({name: item.name, proofFile, acceptedExistingProof: true,
      changedPublicIndex: mutationIndex, changedPublicRejected: true});
  }
  const result = {
    scope: "EVM compatibility of ten existing real proposed Claim proofs; stateless verifier only, no Claim entry point or ledger integration",
    sourceFile,
    sourceSHA256: createHash("sha256").update(source).digest("hex"),
    sourceProofSummary: path.join(out, "summary.json"),
    chainId: String((await ethers.provider.getNetwork()).chainId),
    compiler: "solc 0.8.28, optimizer runs=1, viaIR, Cancun",
    verifierRuntimeBytes: (deployed.length - 2) / 2,
    counts: {existingRealProofsAccepted: cases.length, publicMutationsRejected: cases.length,
      checksPassed: checks.length},
    checks, cases,
    limitations: [
      "The same ten proofs from the standalone Claim script are reused, not ten additional independent proofs",
      "Calls execute the real deployed verifier with supplied public inputs; no pool derives actual chain/address or authenticates canonical note/lineage roots",
      "No Claim entry point, nullifier ledger, output tree, value custody or shared sequential transaction history is executed",
      "Synthetic ciphertext hashes and fixture roots remain; this does not prove HPKE correctness or product recovery",
      "Local EDR and insecure development setup only; no production deployment or ceremony",
    ],
  };
  fs.writeFileSync(path.join(out, "contract-results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({passed: true, ...result.counts,
    verifierRuntimeBytes: result.verifierRuntimeBytes}, null, 2));
} finally {
  await connection.close();
}
