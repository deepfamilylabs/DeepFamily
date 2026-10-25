import assert from "node:assert/strict";
import test from "node:test";
import {
  computeIdentityFromDerivedSecret, createFamilyCommitment, createRoleOpening,
  createSourceFact, createSourceTrust, prepareEligibilityIssue,
} from "../index.js";
import { eligibilityFixture } from "../../../circuits/test/receive_fixture.mjs";

const identity = { fullName: " subject", isBirthBC: false, birthYear: 2010, birthMonth: 5, birthDay: 17, gender: 1 };
const material = computeIdentityFromDerivedSecret({ identity, identitySuiteId: 1, derivedSecretField: 123456n });
function fixture() {
  const expected = eligibilityFixture({ nameField: material.nameField });
  const w = expected.witness;
  return { expected, input: { identity, identitySuiteId: 1, derivedSecretField: w.derivedSecretField,
    chainId: w.chainId, authorizerScope: w.authorizerScope, parentIdentity: w.parentIdentity,
    parentVersion: w.parentVersion, endorser: w.endorser, familySalt: w.familySalt,
    xChild: w.xChild, xEndorse: w.xEndorse, xTrust: w.xTrust, sourceFactSalt: w.sourceFactSalt,
    sourceTrustSalt: w.sourceTrustSalt, issueNonce: w.issueNonce, credentialSalt: w.credentialSalt,
    sourcePath: { root: w.sourceRoot, depth: 0n, index: 0n, siblings: [] },
    trustedPath: { root: w.trustedRoot, depth: 0n, index: 0n, siblings: [] } } };
}
test("eligibility controllers create independent random private role openings and salted family roots", () => {
  const a = createRoleOpening("child"), b = createRoleOpening("child");
  assert.notEqual(a.secret, b.secret);
  assert.notEqual(a.commitment, b.commitment);
  const f = createFamilyCommitment({ parentIdentity: 55n });
  assert.equal(createFamilyCommitment({ parentIdentity: 55n, familySalt: f.familySalt }).familyCommitment, f.familyCommitment);
  assert.notEqual(createFamilyCommitment({ parentIdentity: 55n }).familyCommitment, f.familyCommitment);
  assert.throws(() => createRoleOpening("unknown"));
});
test("authenticated openings and production identity build exactly the Issue circuit statement", () => {
  const { input, expected } = fixture();
  const actual = prepareEligibilityIssue(input);
  assert.equal(createSourceFact({ ...input, childIdentity: material.identityCommitment }).factLeaf, expected.sourceLeaf);
  assert.equal(createSourceTrust(input).trustLeaf, expected.trustedLeaf);
  assert.deepEqual(actual.publicSignals, expected.publicSignals);
  assert.equal(actual.familyRoot, expected.familyRoot);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.witness, (_, v) => typeof v === "bigint" ? String(v) : v)), expected.witness);
  assert.equal(actual.publicSignals.length, 5);
  assert.ok(!actual.publicSignals.includes(material.identityCommitment));
});
test("wrong identity, replaced roles and unauthenticated paths fail before proving", () => {
  const { input } = fixture();
  for (const change of [{ derivedSecretField: 555n }, { xChild: 555n }, { xTrust: 555n }, { sourceFactSalt: 555n },
    { sourcePath: { ...input.sourcePath, root: 555n } }, { sourcePath: { ...input.sourcePath, depth: 65n } }])
    assert.throws(() => prepareEligibilityIssue({ ...input, ...change }));
  assert.throws(() => prepareEligibilityIssue({ ...input, xChild: undefined }));
});
