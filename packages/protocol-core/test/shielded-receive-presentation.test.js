import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, keccak256 } from "ethers";
import {
  buildShieldedIdentityAuthorizationState,
  computeShieldedReceiveActionHash,
  computeShieldedReceiveCredentialBinding,
  emptyShieldedReceiveAuthorizations,
  prepareShieldedReceivePresentation,
  rebuildShieldedIdentityAuthorizationState,
  getShieldedIdentityAuthorizationWitness,
  SHIELDED_RECEIVE_PROOF_LIFETIME,
} from "../index.js";

const credential = {
  disclosure: "anonymous",
  authorizationAlias: 13n,
  authorizationCounter: 0n,
  expiresAt: 1900000000n,
  ownerCommitment: 23n,
  viewingKey: new Uint8Array(32).fill(17),
  // Transport fixture only: real issuer and presentation verification run in the prover tests.
  proof: {
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
      ["1", "0"],
    ],
    pi_c: ["7", "8", "1"],
  },
};
const request = {
  credential,
  state: buildShieldedIdentityAuthorizationState(),
  chainId: 31337n,
  consumer: "0x1111111111111111111111111111111111111111",
  action: 1,
  messageId: 17,
  payloadHash: `0x${"ab".repeat(32)}`,
  checkpointId: 1,
  asOf: 1800000000n,
  salt: 37n,
};

test("presentation authenticates an operation without publishing its reusable credential", () => {
  const result = prepareShieldedReceivePresentation(request);
  assert.equal(result.publicSignals.length, 11);
  assert.equal(result.presentation.depth, "0");
  assert.equal(result.presentation.absent, "1");
  assert.equal(result.presentation.siblings.length, 64);
  assert.equal(result.publicSignals[9], request.asOf + SHIELDED_RECEIVE_PROOF_LIFETIME);
  assert.equal(result.deadline, result.publicSignals[9]);
  assert.equal(result.publicSignals[10], computeShieldedReceiveCredentialBinding(request));
  assert.equal(result.request.kind, "anonymous");
  assert.equal(result.request.credentialPublicSignals.length, 11);
  assert.equal(result.publicSignals.includes(credential.authorizationAlias), false);
  assert.equal(result.publicSignals.includes(credential.ownerCommitment), false);
  assert.equal(result.publicSignals.includes(credential.expiresAt), false);
  assert.deepEqual(
    prepareShieldedReceivePresentation({ ...request, payloadHash: new Uint8Array(32).fill(171) })
      .publicSignals,
    result.publicSignals,
  );
  for (const patch of [
    { action: 2 },
    { action: 3 },
    { salt: 0 },
    { checkpointId: 0 },
    { asOf: credential.expiresAt },
    { payloadHash: "0x12" },
    { asOf: (1n << 64n) - 100n, credential: { ...credential, expiresAt: (1n << 64n) - 1n } },
  ])
    assert.throws(() => prepareShieldedReceivePresentation({ ...request, ...patch }));
});

test("a code unexpired at asOf keeps its deadline even when that deadline passes the expiry", () => {
  const last = prepareShieldedReceivePresentation({ ...request, asOf: credential.expiresAt - 1n });
  assert.equal(last.deadline, credential.expiresAt - 1n + SHIELDED_RECEIVE_PROOF_LIFETIME);
  assert.ok(last.deadline > credential.expiresAt);
  const later = prepareShieldedReceivePresentation({ ...request, asOf: request.asOf + 600n });
  assert.notEqual(later.publicSignals[9], prepareShieldedReceivePresentation(request).publicSignals[9]);
});

test("current state rejects revoked code and renewed code retains original recipient keys", () => {
  const state = buildShieldedIdentityAuthorizationState([[13n, 1n]]);
  assert.throws(() => prepareShieldedReceivePresentation({ ...request, state }), /revoked/u);
  const renewed = prepareShieldedReceivePresentation({
    ...request,
    state,
    checkpointId: 2,
    credential: { ...credential, authorizationCounter: 1n },
  });
  assert.equal(renewed.presentation.absent, "0");
  assert.equal(renewed.recipientBinding, computeShieldedReceiveCredentialBinding(request));
  const fund = { ...credential, disclosure: "fund", identityCommitment: 101n };
  const original = computeShieldedReceiveCredentialBinding({ credential: fund, salt: 37n });
  for (const patch of [
    { identityCommitment: 102n },
    { ownerCommitment: 24n },
    { keyMode: 1 },
    { viewingKey: new Uint8Array(32).fill(18) },
    { authorizationAlias: 14n },
  ])
    assert.notEqual(
      computeShieldedReceiveCredentialBinding({ credential: { ...fund, ...patch }, salt: 37n }),
      original,
    );
  assert.equal(
    prepareShieldedReceivePresentation({ ...request, action: 3, messageId: 0, credential: fund })
      .request.kind,
    "fund",
  );
  assert.throws(() => prepareShieldedReceivePresentation({ ...request, credential: fund }));
});

test("presentation accepts only an alias-bound path checked against its trusted root", () => {
  const authorizationWitness = getShieldedIdentityAuthorizationWitness(request.state, 13n);
  const pathRequest = {
    ...request,
    state: undefined,
    authorizationWitness,
    authorizationStateRoot: request.state.root,
  };
  assert.deepEqual(
    prepareShieldedReceivePresentation(pathRequest),
    prepareShieldedReceivePresentation(request),
  );
  for (const patch of [
    { authorizationStateRoot: undefined },
    { authorizationStateRoot: 1n },
    { authorizationWitness: { ...authorizationWitness, authorizationAlias: 14n } },
    { authorizationWitness: { ...authorizationWitness, oldValue: 1n } },
  ])
    assert.throws(() => prepareShieldedReceivePresentation({ ...pathRequest, ...patch }));
  const state = buildShieldedIdentityAuthorizationState([[13n, 1n]]);
  assert.throws(
    () =>
      prepareShieldedReceivePresentation({
        ...pathRequest,
        authorizationWitness: getShieldedIdentityAuthorizationWitness(state, 13n),
        authorizationStateRoot: state.root,
      }),
    /revoked/u,
  );
});

test("money action digest binds all operation fields and excludes the attached proofs", () => {
  const data = {
    inputShardIds: [0n, 0n],
    inputRoots: [13n, 13n],
    inputNullifiers: [17n, 19n],
    periodNullifiers: Array(3).fill(0n),
    outputCommitments: [23n, 29n],
    outputCiphertexts: ["0x1234", "0xabcd"],
    relation0: 31n,
    relation1: 37n,
    asOf: 1800000000n,
    lineageCheckpointId: 1n,
    fundMode: 0n,
    budgetKind: 0n,
  };
  const digest = computeShieldedReceiveActionHash(data);
  assert.equal(
    digest,
    keccak256(
      AbiCoder.defaultAbiCoder().encode(
        [
          "uint256[]",
          "uint256[]",
          "uint256[]",
          "uint256[3]",
          "uint256[2]",
          "bytes[2]",
          ...Array(6).fill("uint256"),
        ],
        Object.values(data),
      ),
    ),
  );
  assert.equal(
    computeShieldedReceiveActionHash({ ...data, receiveAuthorizations: [{ proof: "0x1234" }] }),
    digest,
  );
  for (const patch of [
    { outputCommitments: [31n, 29n] },
    { outputCiphertexts: ["0x12", "0xabcd"] },
    { fundMode: 1 },
    { budgetKind: 1 },
    { lineageCheckpointId: 2 },
    { asOf: 1800000001n },
  ])
    assert.notEqual(computeShieldedReceiveActionHash({ ...data, ...patch }), digest);
  const empty = emptyShieldedReceiveAuthorizations();
  empty[0].recipientBinding = 1n;
  assert.equal(empty[1].recipientBinding, 0n);
});

test("event mirror verifies every transition and detects missing or forged history", () => {
  const first = buildShieldedIdentityAuthorizationState([[13n, 1n]]);
  const second = buildShieldedIdentityAuthorizationState([
    [13n, 1n],
    [17n, 1n],
  ]);
  const events = [
    {
      checkpointId: 2n,
      aliasR: 13n,
      oldCounter: 0n,
      newCounter: 1n,
      oldRoot: 0n,
      newRoot: first.root,
    },
    {
      checkpointId: 3n,
      aliasR: 17n,
      oldCounter: 0n,
      newCounter: 1n,
      oldRoot: first.root,
      newRoot: second.root,
    },
  ];
  assert.deepEqual(rebuildShieldedIdentityAuthorizationState(events, second.root), second);
  assert.deepEqual(
    rebuildShieldedIdentityAuthorizationState(events.map((args) => ({ args }))),
    second,
  );
  for (const invalid of [
    [events[1]],
    [events[0], events[0]],
    [{ ...events[0], newRoot: 1n }],
    [{ ...events[0], oldCounter: 1n, newCounter: 2n }],
  ])
    assert.throws(() => rebuildShieldedIdentityAuthorizationState(invalid));
  assert.throws(() => rebuildShieldedIdentityAuthorizationState([], first.root));
});
