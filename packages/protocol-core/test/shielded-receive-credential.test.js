import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import {
  SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  buildShieldedReceiveCredentialPublicSignals,
  computeShieldedAuthorizationAlias,
  computeShieldedReceiveCredentialFingerprint,
  computeShieldedValueOwnerCommitment,
  createShieldedReceiveDiversifier,
  decodeShieldedReceiveCredential,
  deriveShieldedReceivePublicKey,
  deriveShieldedReceiveOwnerNonce,
  encodeShieldedReceiveCredential,
  readShieldedReceiveAddressMetadata,
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
  createShieldedReceiveDiversifier(0n, 1900000000n, new Uint8Array(16).fill(1)),
);
const base = {
  authorizationAlias: computeShieldedAuthorizationAlias(identity),
  authorizationCounter: 0n,
  expiresAt: 1900000000n,
  ownerCommitment: computeShieldedValueOwnerCommitment(
    13n,
    deriveShieldedReceiveOwnerNonce(receiveKey),
  ),
  viewingKey: receiveKey,
  proof,
};

async function withMetadata(patch) {
  const statement = { ...base, ...patch };
  statement.viewingKey = await deriveShieldedReceivePublicKey(
    new Uint8Array(32).fill(17),
    createShieldedReceiveDiversifier(
      statement.authorizationCounter,
      statement.expiresAt,
      receiveKey.subarray(16, 32),
    ),
  );
  statement.ownerCommitment = computeShieldedValueOwnerCommitment(
    13n,
    deriveShieldedReceiveOwnerNonce(statement.viewingKey),
  );
  return statement;
}

test("receive transport packs metadata into its address and version/mode into one byte", () => {
  const encoded = encodeShieldedReceiveCredential(base);
  const decoded = decodeShieldedReceiveCredential(encoded);
  assert.match(encoded, /^dfrecv1/u);
  assert.equal(bech32m.fromWords(bech32m.decode(encoded, false).words).length, 385);
  assert.equal(encoded.length, 629);
  assert.equal(decoded.purpose, "receive");
  assert.equal(SHIELDED_RECEIVE_CREDENTIAL_VERSION, 1);
  assert.equal(decoded.receiveCodeVersion, 1);
  assert.equal(decoded.publicSignals.at(-1), 1n);
  const packet = bech32m.fromWords(bech32m.decode(encoded, false).words);
  assert.equal(packet[0], 2);
  assert.deepEqual(packet.subarray(65, 129), receiveKey);
  assert.deepEqual(readShieldedReceiveAddressMetadata(decoded.viewingKey), {
    authorizationCounter: 0n,
    expiresAt: base.expiresAt,
  });
  const independent = decodeShieldedReceiveCredential(
    encodeShieldedReceiveCredential({ ...base, keyMode: 1 }),
  );
  assert.equal(independent.keyMode, 1);
  assert.equal("identityCommitment" in decoded, false);
  assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(base));
  assert.equal(decoded.publicSignals.length, 8);
  for (const field of [
    "identitySuiteId",
    "independentKeySuiteId",
    "independentKeyDerivationVersion",
  ])
    assert.equal(Object.hasOwn(decoded, field), false);
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
    assert.equal(decoded.publicSignals.length, 9);
    assert.equal(decoded.publicSignals[3], 19n);
    assert.equal(decoded.authorizationAlias, base.authorizationAlias);
    assert.equal(decoded.identityCommitment, 19n);
    assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(input));
    const packet = bech32m.fromWords(bech32m.decode(code, false).words);
    assert.equal(packet.length, 401);
    assert.equal(code.length, 655);
    assert.equal(packet[0], (1 << 1) | keyMode);
    const stripped = new Uint8Array([...packet.slice(0, 49), ...packet.slice(81)]);
    // Structural stripping cannot preserve the original verified public vector.
    assert.throws(() =>
      decodeShieldedReceiveCredential(bech32m.encode("dfrecv", bech32m.toWords(stripped), false)),
    );
    const legacy = Uint8Array.of(1, keyMode, ...packet.subarray(1));
    assert.equal(legacy.length, 402);
    assert.throws(() => decodeShieldedReceiveCredential(
      bech32m.encode("dffund", bech32m.toWords(legacy), false),
    ));
    for (const length of [400, 402, 403]) {
      const wrongLength = new Uint8Array(length);
      wrongLength.set(packet.subarray(0, length));
      assert.throws(() => decodeShieldedReceiveCredential(
        bech32m.encode("dffund", bech32m.toWords(wrongLength), false),
      ));
    }
    for (const unsupported of [0, 1, 4, 5, 255]) {
      const malformed = packet.slice();
      malformed[0] = unsupported;
      assert.throws(() => decodeShieldedReceiveCredential(
        bech32m.encode("dffund", bech32m.toWords(malformed), false),
      ));
    }
  }
});

test("fingerprint binds every authenticated field and excludes randomized proof bytes", async () => {
  const fingerprint = computeShieldedReceiveCredentialFingerprint(base);
  assert.equal(computeShieldedReceiveCredentialFingerprint({ ...base, proof: {} }), fingerprint);
  for (const patch of [
    { authorizationAlias: base.authorizationAlias + 1n },
    await withMetadata({ authorizationCounter: 1n }),
    await withMetadata({ expiresAt: base.expiresAt + 1n }),
    { ownerCommitment: 29n },
    { keyMode: 1 },
    {
      viewingKey: await deriveShieldedReceivePublicKey(
        new Uint8Array(32).fill(17),
        createShieldedReceiveDiversifier(0n, base.expiresAt, new Uint8Array(16).fill(2)),
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
  for (const unsupported of [0, 1, 4, 5, 255]) {
    packet[0] = unsupported;
    assert.throws(() =>
      decodeShieldedReceiveCredential(bech32m.encode("dfrecv", bech32m.toWords(packet), false)),
    );
  }
  assert.throws(() => decodeShieldedReceiveCredential(encoded.slice(0, -1)));
  assert.throws(() => decodeShieldedReceiveCredential(null));
  const canonical = bech32m.fromWords(bech32m.decode(encoded, false).words);
  for (const length of [384, 386, 394, 402, 405]) {
    const wrongLength = new Uint8Array(length);
    wrongLength.set(canonical.subarray(0, length));
    assert.throws(() => decodeShieldedReceiveCredential(
      bech32m.encode("dfrecv", bech32m.toWords(wrongLength), false),
    ));
  }
});

test("receive addresses diversify their owner commitment while retaining the identity alias", async () => {
  const changed = await deriveShieldedReceivePublicKey(
    new Uint8Array(32).fill(17),
    createShieldedReceiveDiversifier(0n, base.expiresAt, new Uint8Array(16).fill(3)),
  );
  const first = decodeShieldedReceiveCredential(encodeShieldedReceiveCredential(base));
  const second = decodeShieldedReceiveCredential(
    encodeShieldedReceiveCredential({
      ...base,
      viewingKey: changed,
      ownerCommitment: computeShieldedValueOwnerCommitment(
        13n,
        deriveShieldedReceiveOwnerNonce(changed),
      ),
    }),
  );
  assert.notDeepEqual(first.viewingKey, second.viewingKey);
  assert.equal(first.authorizationAlias, second.authorizationAlias);
  assert.notEqual(first.ownerCommitment, second.ownerCommitment);
  assert.notDeepEqual(first.publicSignals.slice(4, 6), second.publicSignals.slice(4, 6));
  const changedDiversifier = receiveKey.slice();
  changedDiversifier[16] ^= 1;
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

test("address metadata preserves uint64 boundaries and enforces statement consistency", async () => {
  assert.deepEqual(
    createShieldedReceiveDiversifier(
      0x0102030405060708n,
      0x1112131415161718n,
      new Uint8Array(16).fill(0x99),
    ),
    Uint8Array.from([
      1, 2, 3, 4, 5, 6, 7, 8,
      0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
      ...new Uint8Array(16).fill(0x99),
    ]),
  );
  for (const authorizationCounter of [0n, (1n << 64n) - 1n]) {
    for (const expiresAt of [1n, (1n << 64n) - 1n]) {
      const input = await withMetadata({ authorizationCounter, expiresAt });
      const decoded = decodeShieldedReceiveCredential(encodeShieldedReceiveCredential(input));
      assert.equal(decoded.authorizationCounter, authorizationCounter);
      assert.equal(decoded.expiresAt, expiresAt);
      assert.deepEqual(decoded.publicSignals, buildShieldedReceiveCredentialPublicSignals(input));
    }
  }
  for (const patch of [{ authorizationCounter: 1n }, { expiresAt: base.expiresAt + 1n }]) {
    assert.throws(() => encodeShieldedReceiveCredential({ ...base, ...patch }), /must match/u);
    assert.throws(() => buildShieldedReceiveCredentialPublicSignals({ ...base, ...patch }), /must match/u);
  }
  for (const [counter, expiry] of [
    [-1n, 1n], [1n << 64n, 1n], [0n, 0n], [0n, -1n], [0n, 1n << 64n],
  ]) assert.throws(() => createShieldedReceiveDiversifier(counter, expiry));
  for (const length of [0, 15, 17, 32]) {
    assert.throws(() => createShieldedReceiveDiversifier(0n, 1n, new Uint8Array(length)));
  }
  const first = createShieldedReceiveDiversifier(7n, 19n);
  const second = createShieldedReceiveDiversifier(7n, 19n);
  assert.deepEqual(first.subarray(0, 16), second.subarray(0, 16));
  assert.notDeepEqual(first.subarray(16), second.subarray(16));
  // Metadata extraction alone makes no assertion about the point or issuer.
  assert.deepEqual(readShieldedReceiveAddressMetadata(new Uint8Array(64)), {
    authorizationCounter: 0n, expiresAt: 0n,
  });
  assert.throws(() => readShieldedReceiveAddressMetadata(new Uint8Array(32)));
});
