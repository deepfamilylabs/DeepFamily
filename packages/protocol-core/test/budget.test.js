import test from "node:test";
import assert from "node:assert/strict";
import { poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import {
  deriveReceiveKeyMaterial,
  computeReceiveAuthorization,
  encodeReceiveCode,
  computeFamilyTag,
  computeRoleStatusIndex,
  computeCapabilityBinding,
} from "../receive-code.js";
import {
  BUDGET_NOTE_PAYLOAD_BYTES,
  computePolicyCommitment,
  computeBudgetKey,
  computeBudgetNoteCommitment,
  encodeBudgetNotePayload,
  decodeBudgetNotePayload,
  decryptBudgetNote,
  verifyBudgetNotePayload,
  prepareBudgetDeposit,
  prepareBudgetClaim,
  computePeriodNullifier,
  prepareTransfer,
} from "../budget.js";
import { encryptShieldedNote, decryptShieldedNote } from "../shielded-hpke.js";
import {
  computeShieldedPoolDomain,
  computeShieldedCiphertextHashField,
  computeShieldedValueNoteCommitment,
  computeShieldedScopedPurpose,
} from "../shielded-inheritance.js";
import {
  encodeShieldedValueNotePayload,
  verifyShieldedNotePayload,
} from "../shielded-note-codec.js";

// These are builder/codec integration tests; echo prover callbacks are not cryptographic proof evidence.
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};
const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000004321" };
const authorizerScope = "0x0000000000000000000000000000000000001234";
const policy = {
  familyCommitment: 101n,
  parentVersion: 3n,
  rate: 5n,
  periodDays: 30n,
  policySalt: 29n,
  allocationKeyCommitment: 31n,
};
const asOf = 1_900_000_000n;
const fundPublicFields = [
  "chainId",
  "pool",
  "commonBinding",
  "codeAlias",
  "nonce",
  "ownerCommitment",
  "viewKeyLo",
  "viewKeyHi",
  "capabilityBinding",
  "familyTag",
  "parentVersion",
  "policyCommitment",
  "budgetKey",
  "eligibleFrom",
  "inputRoot",
  "inputNullifier",
  "outputCommitments",
  "ciphertextHashes",
];
const claimPublicFields = [
  "chainId",
  "pool",
  "codeAlias",
  "nonce",
  "ownerCommitment",
  "viewKeyLo",
  "viewKeyHi",
  "policyCommitment",
  "budgetKey",
  "eligibleFrom",
  "asOf",
  "inputRoot",
  "inputNullifier",
  "periodNullifier",
  "outputCommitments",
  "ciphertextHashes",
  "authorizerScope",
  "issuanceRoot",
  "childRoleIndex",
  "endorsementRoleIndex",
  "trustedRoleIndex",
];
const echo = (fields) => async (witness) => ({
  proof,
  publicSignals: fields.flatMap((key) => witness[key]),
});
async function fixture() {
  const recipient = await deriveReceiveKeyMaterial({
    masterKey: new Uint8Array(32).fill(37),
    chainId: scope.chainId,
    authorizerScope,
    codeIndex: 2n,
    codeRootSecret: 23n,
  });
  const donor = await deriveReceiveKeyMaterial({
    masterKey: new Uint8Array(32).fill(39),
    chainId: scope.chainId,
    authorizerScope,
    codeIndex: 7n,
  });
  const common = computeReceiveAuthorization({ ...recipient, expiresAt: 2_000_000_000n });
  const cap = {
    issuanceRoot: 997n,
    parentVersion: policy.parentVersion,
    familyTag: computeFamilyTag({ familyCommitment: policy.familyCommitment, nonce: common.nonce }),
    childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: 13n }),
    endorsementRoleIndex: computeRoleStatusIndex({ role: "endorsement", roleSecret: 17n }),
    trustedRoleIndex: computeRoleStatusIndex({ role: "trusted", roleSecret: 19n }),
    proof,
  };
  cap.capabilityBinding = computeCapabilityBinding(common, cap);
  const code = encodeReceiveCode({ ...common, proof, capabilities: [cap] });
  const donorNote = { ownerCommitment: donor.ownerCommitment, amount: 25n, nonce: 43n };
  const ciphertext = await encryptShieldedNote({
    ...scope,
    recipientPublicKey: donor.viewingKey,
    payload: encodeShieldedValueNotePayload(donorNote, scope),
  });
  const donorNoteCommitment = computeShieldedValueNoteCommitment(
    { ...donorNote, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
    scope,
  );
  const input = {
    code,
    authorizerScope,
    policy,
    asOf,
    budgetPeriods: 2n,
    donor: {
      ...donorNote,
      ownerSecret: donor.ownerSecret,
      viewingKey: donor.viewingKey,
      ciphertext,
      membership: { depth: 0n, index: 0n, siblings: [], root: donorNoteCommitment },
    },
    readBudgetRecord: async () => null,
    verifyAuthorization: async () => true,
    verifyCapability: async () => true,
    checkEligibility: async () => true,
    proveFund: echo(fundPublicFields),
    verifyFund: async () => true,
    budgetNonce: 47n,
    changeNonce: 53n,
  };
  const qualification = {
    familyRoot: policy.familyCommitment,
    parentVersion: policy.parentVersion,
    issueNonce: 83n,
    endorser: 89n,
    xChild: 13n,
    xEndorse: 17n,
    xTrust: 19n,
    credentialSalt: 97n,
    credentialDepth: 0n,
    credentialIndex: 0n,
    credentialSiblings: [],
  };
  const u = poseidon3([73204n, recipient.codeRootSecret, qualification.issueNonce]);
  const fact = poseidon7([
    73101n,
    u,
    policy.familyCommitment,
    qualification.endorser,
    policy.parentVersion,
    qualification.xChild,
    qualification.xEndorse,
  ]);
  const trusted = poseidon5([
    73102n,
    policy.familyCommitment,
    qualification.endorser,
    policy.parentVersion,
    qualification.xTrust,
  ]);
  qualification.issuanceRoot = poseidon5([
    73400n,
    fact,
    trusted,
    qualification.credentialSalt,
    poseidon3([74000n, scope.chainId, BigInt(authorizerScope)]),
  ]);
  return { input, recipient, donor, common, qualification };
}

test("policy/key/note commitments match the frozen scoped production-compatible schema", async () => {
  const { input, common } = await fixture();
  const prepared = await prepareBudgetDeposit(input, scope);
  const domain = computeShieldedPoolDomain(scope);
  const tag = (purpose) => poseidon3([1032n, domain, purpose]);
  const policyCommitment = poseidon7([tag(1010n), 101n, 3n, 5n, 29n, 31n, 30n]);
  const budgetKey = poseidon3([tag(75001n), common.codeAlias, policyCommitment]);
  const [lo, hi] = prepared.publicSignals.slice(6, 8);
  assert.equal(prepared.policyCommitment, policyCommitment);
  assert.equal(prepared.budgetKey, budgetKey);
  assert.equal(
    computeBudgetNoteCommitment(
      { ...prepared.note, ciphertextHashField: prepared.ciphertextHashes[0] },
      scope,
    ),
    poseidon8([
      tag(75002n),
      policyCommitment,
      budgetKey,
      poseidon4([75003n, common.ownerCommitment, lo, hi]),
      asOf + 7200n,
      5n,
      10n,
      poseidon3([75004n, 47n, prepared.ciphertextHashes[0]]),
    ]),
  );
  assert.notEqual(computePolicyCommitment(policy, { ...scope, chainId: 1n }), policyCommitment);
  assert.notEqual(
    computeBudgetKey({ codeAlias: common.codeAlias + 1n, policyCommitment }, scope),
    budgetKey,
  );
});

test("new and later deposits create independent encrypted contributions while preserving the first timestamp", async () => {
  const { input, recipient, donor, common } = await fixture();
  let fundWitness;
  const first = await prepareBudgetDeposit(
    {
      ...input,
      proveFund: async (witness) => {
        fundWitness = witness;
        return echo(fundPublicFields)(witness);
      },
    },
    scope,
  );
  assert.equal(first.kind, "create");
  assert.equal(first.eligibleFrom, asOf + 7200n);
  assert.equal(first.publicSignals.length, 20);
  assert.equal(first.note.remaining, 10n);
  assert.equal(first.changeNote.amount, 15n);
  assert.equal(fundWitness.donorSiblings.length, 32);
  assert.equal(Object.hasOwn(fundWitness, "oldBudget"), false);
  assert.equal(Object.hasOwn(first, "witness"), false);
  const recovered = await decryptBudgetNote(
    {
      hpkeIkm: recipient.hpkeIkm,
      ciphertext: first.outputCiphertexts[0],
      noteCommitment: first.outputCommitments[0],
    },
    scope,
  );
  assert.deepEqual(recovered.note, first.note);
  assert.equal(recovered.budgetKey, first.budgetKey);
  const changePayload = await decryptShieldedNote({
    ...scope,
    hpkeIkm: donor.hpkeIkm,
    ciphertext: first.outputCiphertexts[1],
  });
  assert.equal(
    verifyShieldedNotePayload(
      {
        payload: changePayload,
        ciphertext: first.outputCiphertexts[1],
        noteCommitment: first.outputCommitments[1],
      },
      scope,
    ).note.amount,
    15n,
  );
  const second = await prepareBudgetDeposit(
    {
      ...input,
      asOf: asOf + 86400n,
      budgetPeriods: 1n,
      budgetNonce: 59n,
      readBudgetRecord: async (key) => {
        assert.equal(key, first.budgetKey);
        return {
          exists: true,
          commonBinding: common.commonBinding,
          policyCommitment: first.policyCommitment,
          eligibleFrom: first.eligibleFrom,
        };
      },
    },
    scope,
  );
  assert.equal(second.kind, "append");
  assert.equal(second.eligibleFrom, first.eligibleFrom);
  assert.equal(second.note.remaining, 5n);
  assert.notEqual(second.outputCommitments[0], first.outputCommitments[0]);
});

test("budget payload is compact, canonical and authenticated to the actual ciphertext and event", async () => {
  const { input, recipient } = await fixture();
  const prepared = await prepareBudgetDeposit(input, scope);
  const payload = encodeBudgetNotePayload(prepared.note, scope);
  assert.equal(payload.length, BUDGET_NOTE_PAYLOAD_BYTES);
  assert.equal(payload.length, 314);
  assert.deepEqual(decodeBudgetNotePayload(payload, scope), prepared.note);
  const decoded = verifyBudgetNotePayload(
    {
      payload,
      ciphertext: prepared.outputCiphertexts[0],
      noteCommitment: prepared.outputCommitments[0],
    },
    scope,
  );
  assert.equal(decoded.noteCommitment, prepared.outputCommitments[0]);
  for (const bytes of [
    payload.slice(0, -1),
    Uint8Array.of(...payload, 0),
    Uint8Array.of(0, ...payload.slice(1)),
  ]) {
    assert.throws(() => decodeBudgetNotePayload(bytes, scope));
  }
  assert.throws(
    () => encodeBudgetNotePayload({ ...prepared.note, remaining: 7n }, scope),
    /whole number/u,
  );
  assert.throws(() =>
    verifyBudgetNotePayload(
      {
        payload,
        ciphertext: prepared.outputCiphertexts[0],
        noteCommitment: prepared.outputCommitments[0] + 1n,
      },
      scope,
    ),
  );
  const changed = prepared.outputCiphertexts[0].slice();
  changed[100] ^= 1;
  await assert.rejects(
    decryptBudgetNote(
      {
        hpkeIkm: recipient.hpkeIkm,
        ciphertext: changed,
        noteCommitment: prepared.outputCommitments[0],
      },
      scope,
    ),
  );
  await assert.rejects(
    decryptBudgetNote(
      {
        hpkeIkm: recipient.hpkeIkm,
        ciphertext: prepared.outputCiphertexts[0],
        noteCommitment: prepared.outputCommitments[0],
      },
      { ...scope, chainId: 1n },
    ),
  );
});

test("deposit refuses wrong family/version, revoked/current-invalid qualification and altered existing records", async () => {
  const { input } = await fixture();
  const first = await prepareBudgetDeposit(input, scope);
  for (const [patch, pattern] of [
    [{ policy: { ...policy, familyCommitment: 102n } }, /does not qualify/u],
    [{ policy: { ...policy, parentVersion: 4n } }, /does not qualify/u],
    [{ checkEligibility: async () => false }, /revoked/u],
    [{ authorizerScope: 99n }, /another registry/u],
    [{ authorizerScope: undefined }, /registry scope/u],
    [{ asOf: 2_000_000_001n }, /expired/u],
    [
      {
        readBudgetRecord: async () => ({
          commonBinding: 1n,
          policyCommitment: first.policyCommitment,
          eligibleFrom: first.eligibleFrom,
        }),
      },
      /another receive/u,
    ],
    [
      {
        readBudgetRecord: async () => ({
          commonBinding: first.code.commonBinding,
          policyCommitment: 1n,
          eligibleFrom: first.eligibleFrom,
        }),
      },
      /another receive/u,
    ],
  ])
    await assert.rejects(prepareBudgetDeposit({ ...input, ...patch }, scope), pattern);
});

test("deposit validates donor ownership/membership/value and the exact proof output statement", async () => {
  const { input } = await fixture();
  for (const [patch, pattern] of [
    [{ budgetPeriods: 6n }, /insufficient/u],
    [{ budgetPeriods: 0n }, /nonzero/u],
    [{ donor: { ...input.donor, ownerSecret: 1n } }, /Spending|spending/u],
    [
      { donor: { ...input.donor, membership: { depth: 0n, index: 0n, siblings: [], root: 1n } } },
      /Merkle root/u,
    ],
    [{ donor: { ...input.donor, membership: { depth: 33n, index: 0n, siblings: [] } } }, /range/u],
    [{ proveFund: async () => ({ proof, publicSignals: [1n] }) }, /different public/u],
    [{ verifyFund: async () => false }, /Invalid Fund/u],
  ])
    await assert.rejects(prepareBudgetDeposit({ ...input, ...patch }, scope), pattern);
});

test("claim pays one mature period, preserves keys/time/policy and recovers both real encrypted outputs", async () => {
  const { input, recipient, qualification } = await fixture();
  const deposited = await prepareBudgetDeposit(input, scope);
  const claimInput = {
    authorizerScope,
    qualification,
    checkQualification: async () => true,
    note: deposited.note,
    ciphertext: deposited.outputCiphertexts[0],
    noteCommitment: deposited.outputCommitments[0],
    keyMaterial: recipient,
    membership: { depth: 0n, index: 0n, siblings: [], root: deposited.outputCommitments[0] },
    asOf: deposited.eligibleFrom + 30n * 86400n,
    periodIndex: 0n,
    proveClaim: echo(claimPublicFields),
    verifyClaim: async () => true,
    outputBudgetNonce: 61n,
    valueNonce: 67n,
  };
  let claimWitness;
  const claimed = await prepareBudgetClaim(
    {
      ...claimInput,
      proveClaim: async (witness) => {
        claimWitness = witness;
        return echo(claimPublicFields)(witness);
      },
    },
    scope,
  );
  assert.equal(claimed.publicSignals.length, 23);
  assert.equal(claimed.publicSignals[18], BigInt(authorizerScope));
  assert.equal(claimed.publicSignals[19], qualification.issuanceRoot);
  assert.equal(claimWitness.remainingPeriods, 2n);
  assert.equal(claimed.note.remaining, 5n);
  assert.equal(claimed.note.eligibleFrom, deposited.eligibleFrom);
  assert.equal(claimed.valueNote.amount, 5n);
  assert.equal(claimed.publicInput.budgetKey, deposited.budgetKey);
  assert.equal(
    claimed.periodNullifier,
    poseidon4([computeShieldedScopedPurpose(1017n, scope), 23n, deposited.policyCommitment, 0n]),
  );
  const remainder = await decryptBudgetNote(
    {
      hpkeIkm: recipient.hpkeIkm,
      ciphertext: claimed.outputCiphertexts[0],
      noteCommitment: claimed.outputCommitments[0],
    },
    scope,
  );
  assert.deepEqual(remainder.note, claimed.note);
  const valuePayload = await decryptShieldedNote({
    ...scope,
    hpkeIkm: recipient.hpkeIkm,
    ciphertext: claimed.outputCiphertexts[1],
  });
  assert.equal(
    verifyShieldedNotePayload(
      {
        payload: valuePayload,
        ciphertext: claimed.outputCiphertexts[1],
        noteCommitment: claimed.outputCommitments[1],
      },
      scope,
    ).note.amount,
    5n,
  );
  const afterExpiry = await prepareBudgetClaim({ ...claimInput, asOf: 2_000_000_001n }, scope);
  assert.equal(afterExpiry.note.remaining, 5n); // Code expiration does not lock existing contributions.
});

test("claim rejects premature allowance, wrong subject/key, spent periods and proof/membership substitution", async () => {
  const { input, recipient, qualification } = await fixture();
  const deposited = await prepareBudgetDeposit(input, scope);
  const claimInput = {
    authorizerScope,
    qualification,
    checkQualification: async () => true,
    note: deposited.note,
    ciphertext: deposited.outputCiphertexts[0],
    noteCommitment: deposited.outputCommitments[0],
    keyMaterial: recipient,
    membership: { depth: 0n, index: 0n, siblings: [], root: deposited.outputCommitments[0] },
    asOf: deposited.eligibleFrom + 30n * 86400n,
    periodIndex: 0n,
    proveClaim: echo(claimPublicFields),
    outputBudgetNonce: 61n,
    valueNonce: 67n,
  };
  for (const [patch, pattern] of [
    [{ asOf: claimInput.asOf - 1n }, /not matured/u],
    [{ derivedSecretField: 24n }, /Canonical subject/u],
    [{ qualification: undefined }, /qualification is required/u],
    [{ qualification: { ...qualification, familyRoot: 102n } }, /another family/u],
    [{ qualification: { ...qualification, parentVersion: 4n } }, /another family version/u],
    [{ qualification: { ...qualification, issuanceRoot: 1n } }, /Merkle root/u],
    [{ qualification: { ...qualification, xChild: 14n } }, /Merkle root/u],
    [{ qualification: { ...qualification, credentialSalt: 1n } }, /Merkle root/u],
    [{ checkQualification: async () => false }, /revoked/u],
    [{ keyMaterial: { ...recipient, ownerSecret: 1n } }, /Spending key/u],
    [{ isPeriodSpent: async () => true }, /already claimed/u],
    [{ membership: { ...claimInput.membership, root: 1n } }, /Merkle root/u],
    [{ note: { ...deposited.note, remaining: 5n } }, /published note/u],
    [{ proveClaim: async () => ({ proof, publicSignals: [1n] }) }, /different public/u],
    [{ verifyClaim: async () => false }, /Invalid Claim/u],
  ])
    await assert.rejects(prepareBudgetClaim({ ...claimInput, ...patch }, scope), pattern);
  const shared = {
    derivedSecretField: 23n,
    policyCommitment: deposited.policyCommitment,
    periodIndex: 0n,
  };
  assert.equal(
    computePeriodNullifier(shared, scope),
    computePeriodNullifier({ ...shared, codeAlias: 999n }, scope),
  );
  assert.notEqual(
    computePeriodNullifier(shared, scope),
    computePeriodNullifier({ ...shared, periodIndex: 1n }, scope),
  );
});

test("ordinary transfer uses generic authorization and the same HPKE key without a family-state query", async () => {
  const { input, recipient, donor } = await fixture();
  const transferFields = [
    "chainId",
    "pool",
    "commonBinding",
    "ownerCommitment",
    "viewKeyLo",
    "viewKeyHi",
    "inputRoot",
    "inputNullifier",
    "outputCommitments",
    "ciphertextHashes",
  ];
  const transferred = await prepareTransfer(
    {
      ...input,
      amount: 7n,
      proveTransfer: echo(transferFields),
      recipientNonce: 71n,
      checkEligibility: async () => {
        throw new Error("Ordinary transfer must not query family status");
      },
    },
    scope,
  );
  assert.equal(transferred.publicSignals.length, 12);
  assert.equal(transferred.note.amount, 7n);
  assert.equal(transferred.changeNote.amount, 18n);
  for (const [slot, key, expected] of [
    [0, recipient, 7n],
    [1, donor, 18n],
  ]) {
    const payload = await decryptShieldedNote({
      ...scope,
      hpkeIkm: key.hpkeIkm,
      ciphertext: transferred.outputCiphertexts[slot],
    });
    assert.equal(
      verifyShieldedNotePayload(
        {
          payload,
          ciphertext: transferred.outputCiphertexts[slot],
          noteCommitment: transferred.outputCommitments[slot],
        },
        scope,
      ).note.amount,
      expected,
    );
  }
  await assert.rejects(
    prepareTransfer({ ...input, amount: 26n, proveTransfer: echo(transferFields) }, scope),
    /insufficient/u,
  );
  await assert.rejects(
    prepareTransfer(
      { ...input, amount: 1n, proveTransfer: async () => ({ proof, publicSignals: [1n] }) },
      scope,
    ),
    /different public/u,
  );
});
