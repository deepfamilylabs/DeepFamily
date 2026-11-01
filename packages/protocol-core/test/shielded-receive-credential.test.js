import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import {
  SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  buildShieldedReceiveCredentialPublicSignals,
  computeShieldedAuthorizationAlias,
  computeShieldedReceiveCredentialFingerprint,
  decodeShieldedReceiveCredential,
  deriveShieldedReceivePublicKey,
  encodeShieldedReceiveCredential,
} from "../index.js";

// Transport-only fixture. Real issuer proofs are verified in circuit tests.
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
const identity = { identityCommitment: 19n, derivedSecretField: 13n };
const receiveKey = await deriveShieldedReceivePublicKey(
  new Uint8Array(32).fill(17),
  new Uint8Array(32).fill(1),
);
const base = {
  authorizationAlias: computeShieldedAuthorizationAlias(identity),
  authorizationCounter: 0n,
  expiresAt: 1900000000n,
  ownerCommitment: 23n,
  viewingKey: receiveKey,
  proof,
};

test("receive transport carries canonical R, counter and expiry without identity", () => {
  const encoded = encodeShieldedReceiveCredential(base);
  const decoded = decodeShieldedReceiveCredential(encoded);
  assert.match(encoded, /^dfrecv1/u);
  assert.equal(bech32m.fromWords(bech32m.decode(encoded, false).words).length, 405);
  assert.equal(decoded.purpose, "receive");
  assert.equal(SHIELDED_RECEIVE_CREDENTIAL_VERSION, 1);
  assert.equal(decoded.receiveCodeVersion, 1);
  assert.equal(decoded.publicSignals.at(-1), 1n);
  assert.equal(bech32m.fromWords(bech32m.decode(encoded, false).words)[0], 1);
  assert.equal("identityCommitment" in decoded, false);
  assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(base));
  assert.equal(decoded.publicSignals.length, 11);
  assert.equal(decoded.authorizationAlias, base.authorizationAlias);
  assert.equal(decoded.authorizationCounter, 0n);
  assert.equal(decoded.expiresAt, base.expiresAt);
  assert.throws(
    () => encodeShieldedReceiveCredential({ ...base, identityCommitment: 19n }),
    /must not include/u,
  );
});

test("Fund purpose authenticates I and shares the same R across key modes", () => {
  for (const keyMode of [0, 1]) {
    const input = {
      ...base,
      purpose: "fund",
      identityCommitment: 19n,
      keyMode,
      viewingKey: new Uint8Array(32).fill(17),
    };
    const code = encodeShieldedReceiveCredential(input);
    const decoded = decodeShieldedReceiveCredential(code);
    assert.match(code, /^dffund1/u);
    assert.equal(decoded.purpose, "fund");
    assert.equal(decoded.publicSignals.length, 12);
    assert.equal(decoded.publicSignals[3], 19n);
    assert.equal(decoded.authorizationAlias, base.authorizationAlias);
    assert.equal(decoded.identityCommitment, 19n);
    assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(input));
    const packet = bech32m.fromWords(bech32m.decode(code, false).words);
    const stripped = new Uint8Array([...packet.slice(0, 53), ...packet.slice(85)]);
    // Structural stripping cannot preserve the original verified public vector.
    assert.throws(() =>
      decodeShieldedReceiveCredential(bech32m.encode("dfrecv", bech32m.toWords(stripped), false)),
    );
  }
});

test("fingerprint binds every authenticated field and excludes randomized proof bytes", async () => {
  const fingerprint = computeShieldedReceiveCredentialFingerprint(base);
  assert.equal(computeShieldedReceiveCredentialFingerprint({ ...base, proof: {} }), fingerprint);
  for (const patch of [
    { authorizationAlias: base.authorizationAlias + 1n },
    { authorizationCounter: 1n },
    { expiresAt: base.expiresAt + 1n },
    { ownerCommitment: 29n },
    { keyMode: 1 },
    {
      viewingKey: await deriveShieldedReceivePublicKey(
        new Uint8Array(32).fill(17),
        new Uint8Array(32).fill(2),
      ),
    },
  ]) {
    assert.notEqual(
      computeShieldedReceiveCredentialFingerprint({ ...base, ...patch }),
      fingerprint,
    );
  }
});

test("credential parsing accepts only the fresh-v1 format and canonical fields", () => {
  const encoded = encodeShieldedReceiveCredential(base);
  assert.deepEqual(
    decodeShieldedReceiveCredential(encoded.toUpperCase()),
    decodeShieldedReceiveCredential(encoded),
  );
  assert.deepEqual(
    decodeShieldedReceiveCredential(` ${encoded.slice(0, 90)}\n${encoded.slice(90)} `),
    decodeShieldedReceiveCredential(encoded),
  );
  for (const patch of [
    { purpose: "transfer" },
    { authorizationCounter: 1n << 64n },
    { expiresAt: 0n },
    { expiresAt: 1n << 64n },
    { keyMode: 2 },
    { receiveCodeVersion: 0 },
    { receiveCodeVersion: 2 },
    { viewingKey: new Uint8Array(32) },
    { viewingKey: new Uint8Array(64) },
    { viewingKey: new Uint8Array(32).fill(17) },
    { authorizationAlias: 0n },
  ]) {
    assert.throws(() => encodeShieldedReceiveCredential({ ...base, ...patch }));
  }
  const packet = bech32m.fromWords(bech32m.decode(encoded, false).words);
  for (const unsupported of [0, 2, 255]) {
    packet[0] = unsupported;
    assert.throws(() =>
      decodeShieldedReceiveCredential(bech32m.encode("dfrecv", bech32m.toWords(packet), false)),
    );
  }
  assert.throws(() => decodeShieldedReceiveCredential(encoded.slice(0, -1)));
  assert.throws(() => decodeShieldedReceiveCredential(null));
});

test("receive addresses bind their diversifier and point without changing owner or alias", async () => {
  const changed = await deriveShieldedReceivePublicKey(
    new Uint8Array(32).fill(17),
    new Uint8Array(32).fill(3),
  );
  const first = decodeShieldedReceiveCredential(encodeShieldedReceiveCredential(base));
  const second = decodeShieldedReceiveCredential(
    encodeShieldedReceiveCredential({ ...base, viewingKey: changed }),
  );
  assert.notDeepEqual(first.viewingKey, second.viewingKey);
  assert.equal(first.authorizationAlias, second.authorizationAlias);
  assert.equal(first.ownerCommitment, second.ownerCommitment);
  assert.notDeepEqual(first.publicSignals.slice(4, 6), second.publicSignals.slice(4, 6));
  const changedDiversifier = receiveKey.slice();
  changedDiversifier[0] ^= 1;
  assert.notEqual(
    computeShieldedReceiveCredentialFingerprint({ ...base, viewingKey: changedDiversifier }),
    first.fingerprint,
  );
  const invalidPoint = receiveKey.slice();
  invalidPoint.fill(0, 32);
  assert.throws(() => encodeShieldedReceiveCredential({ ...base, viewingKey: invalidPoint }));
  assert.throws(() =>
    encodeShieldedReceiveCredential({ ...base, purpose: "fund", identityCommitment: 19n }),
  );
});
