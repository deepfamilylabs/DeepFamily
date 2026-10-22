import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import {
  buildShieldedReceiveCredentialPublicSignals,
  computeShieldedAuthorizationAlias,
  computeShieldedReceiveCredentialFingerprint,
  decodeShieldedReceiveCredential,
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
const base = {
  authorizationAlias: computeShieldedAuthorizationAlias(identity),
  authorizationCounter: 0n,
  expiresAt: 1900000000n,
  ownerCommitment: 23n,
  viewingKey: new Uint8Array(32).fill(17),
  proof,
};

test("anonymous transport carries canonical R, counter and expiry without identity", () => {
  const encoded = encodeShieldedReceiveCredential(base);
  const decoded = decodeShieldedReceiveCredential(encoded);
  assert.match(encoded, /^dfrecv1/u);
  assert.equal(bech32m.fromWords(bech32m.decode(encoded, false).words).length, 373);
  assert.equal(decoded.disclosure, "anonymous");
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

test("Fund disclosure authenticates I and shares the same R across key modes", () => {
  for (const keyMode of [0, 1]) {
    const input = { ...base, disclosure: "fund", identityCommitment: 19n, keyMode };
    const code = encodeShieldedReceiveCredential(input);
    const decoded = decodeShieldedReceiveCredential(code);
    assert.match(code, /^dffund1/u);
    assert.equal(decoded.publicSignals.length, 12);
    assert.equal(decoded.publicSignals[3], 19n);
    assert.equal(decoded.authorizationAlias, base.authorizationAlias);
    assert.equal(decoded.identityCommitment, 19n);
    assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(input));
    const packet = bech32m.fromWords(bech32m.decode(code, false).words);
    const stripped = new Uint8Array([...packet.slice(0, 53), ...packet.slice(85)]);
    // Structural stripping cannot preserve the original verified public vector.
    const anonymous = decodeShieldedReceiveCredential(
      bech32m.encode("dfrecv", bech32m.toWords(stripped), false),
    );
    assert.notDeepEqual(anonymous.publicSignals, decoded.publicSignals);
  }
});

test("fingerprint binds every authenticated field and excludes randomized proof bytes", () => {
  const fingerprint = computeShieldedReceiveCredentialFingerprint(base);
  assert.equal(computeShieldedReceiveCredentialFingerprint({ ...base, proof: {} }), fingerprint);
  for (const patch of [
    { authorizationAlias: base.authorizationAlias + 1n },
    { authorizationCounter: 1n },
    { expiresAt: base.expiresAt + 1n },
    { ownerCommitment: 29n },
    { keyMode: 1 },
    { viewingKey: new Uint8Array(32).fill(18) },
  ]) {
    assert.notEqual(
      computeShieldedReceiveCredentialFingerprint({ ...base, ...patch }),
      fingerprint,
    );
  }
});

test("credential parsing rejects old formats, wrong prefixes, noncanonical fields and proof points", () => {
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
    { authorizationCounter: 1n << 64n },
    { expiresAt: 0n },
    { expiresAt: 1n << 64n },
    { keyMode: 2 },
    { receiveCodeVersion: 1 },
    { viewingKey: new Uint8Array(32) },
    { authorizationAlias: 0n },
  ]) {
    assert.throws(() => encodeShieldedReceiveCredential({ ...base, ...patch }));
  }
  const packet = bech32m.fromWords(bech32m.decode(encoded, false).words);
  packet[0] = 1;
  assert.throws(() =>
    decodeShieldedReceiveCredential(bech32m.encode("dfrecv", bech32m.toWords(packet), false)),
  );
  assert.throws(() => decodeShieldedReceiveCredential(encoded.slice(0, -1)));
  assert.throws(() => decodeShieldedReceiveCredential(null));
});
