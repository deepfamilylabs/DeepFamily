// Isolated research: deleting a public identity field does not hide it if the
// original proof still verifies a candidate identity. Uses synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? process.cwd());
const out = path.resolve(process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-identity-enumeration-")));
fs.mkdirSync(out, { recursive: true });
const requireRepo = createRequire(path.join(root, "package.json"));
const snarkjs = requireRepo("snarkjs");
const protocol = await import(pathToFileURL(path.join(root, "packages/protocol-core/index.js")));
const { buildLineageFixture } = await import(pathToFileURL(path.join(root, "circuits/test/generate_lineage_fixture.mjs")));
const { buildShieldedClaimFixture } = await import(pathToFileURL(path.join(root, "circuits/test/generate_shielded_claim_input.mjs")));
const fixture = buildLineageFixture().witness;
const identity = buildShieldedClaimFixture().heirIdentityCommitment;
const keys = protocol.deriveShieldedHeirKeyMaterial(BigInt(fixture.derivedSecretField));
const viewingKey = await protocol.deriveShieldedViewPublicKey(keys.hpkeIkm);
const signals = protocol.buildShieldedReceiveCodePublicSignals({ identityCommitment: identity, ownerCommitment: keys.ownerCommitment, viewingKey });
const input = {
  ...Object.fromEntries(["nameField", "derivedSecretField", "isBirthBC", "birthYear", "birthMonth", "birthDay", "gender", "suiteId"].map(k => [k, fixture[k]])),
  identityCommitment: String(identity), ownerCommitment: String(keys.ownerCommitment),
  viewKeyLo: String(signals[2]), viewKeyHi: String(signals[3]), keyMode: "0",
  identitySuiteId: "1", independentKeySuiteId: "1", independentKeyDerivationVersion: "1",
  receiveCodeVersion: "1", spendingSecret: String(keys.ownerSecret),
};
const artifacts = path.join(root, "zk-artifacts/shielded");
console.log("Proving existing receive code with a synthetic identity");
const built = await snarkjs.groth16.fullProve(input,
  path.join(artifacts, "shielded_receive_code_js/shielded_receive_code.wasm"),
  path.join(artifacts, "shielded_receive_code_dev_final.zkey"),
  undefined, { singleThread: true }, { singleThread: true });
const vkey = JSON.parse(fs.readFileSync(path.join(artifacts, "shielded_receive_code.vkey.json"), "utf8"));
assert.equal(await snarkjs.groth16.verify(vkey, built.publicSignals, built.proof), true);
// Model a format that omits I but retains the same proof and other public data.
// No name, identity secret, or spending key is given to the verifier below.
const redacted = { proof: built.proof, publicSignalsWithoutIdentity: built.publicSignals.slice(1) };
const candidates = [BigInt(fixture.fatherIdentityCommitment), BigInt(fixture.motherIdentityCommitment), identity, identity + 1n];
const attempts = [];
for (const candidate of candidates) {
  const accepted = await snarkjs.groth16.verify(vkey,
    [String(candidate), ...redacted.publicSignalsWithoutIdentity], redacted.proof);
  assert.equal(accepted, candidate === identity);
  attempts.push({ candidate: String(candidate), accepted });
}
assert.equal(attempts.filter(x => x.accepted).length, 1);
const result = {
  scope: "Real Groth16 verifier test against the existing receive-code circuit; synthetic fixtures only",
  passed: true, candidateCount: candidates.length, acceptedCount: 1,
  result: "Omitting the identity bytes leaves a verification oracle: the original proof identifies its matching candidate identity.",
  limitation: "This tests a redacted legacy proof, not the new private-identity issuance circuit. It demonstrates why changing serialization alone is insufficient.",
  attempts,
};
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
console.log(`Results: ${out}`);
process.exit(0);
