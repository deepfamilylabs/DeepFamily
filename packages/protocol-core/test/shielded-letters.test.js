import test from "node:test";
import assert from "node:assert/strict";
import { getBytes, keccak256 } from "ethers";
import { SNARK_SCALAR_FIELD } from "../constants.js";
import { predictArchiveSegmentCount } from "../archive.js";
import { deriveShieldedHeirKeyMaterial } from "../shielded-inheritance.js";
import { deriveShieldedIndependentKeyMaterial } from "../shielded-independent-key.js";
import { deriveShieldedReceivePublicKey } from "../shielded-receive-encryption.js";
import {
  computeShieldedReceiveCredentialBinding,
  computeShieldedReceiveRecipientBinding,
} from "../shielded-receive-presentation.js";
import {
  SHIELDED_LETTER_ENVELOPE_VERSION,
  buildShieldedLetterHpkeAad,
  computeShieldedLetterCiphertextHash,
  computeShieldedLetterCiphertextHashField,
  createShieldedLetterEnvelope,
  decodeShieldedLetterEnvelope,
  decryptShieldedLetter,
  encodeShieldedLetterEnvelope,
  encryptShieldedLetter,
  normalizeShieldedLetterScope,
  splitShieldedLetterCiphertextHash,
} from "../shielded-letters.js";
import { independentKeyVector } from "./shielded-independent-key.fixture.js";

const LETTERS = "0x0000000000000000000000000000000000000001";
const OTHER_LETTERS = "0x0000000000000000000000000000000000000003";
const context = { chainId: 1030n, lettersAddress: LETTERS, messageId: 44n };
const key = deriveShieldedHeirKeyMaterial(13n);
const publicKey = await deriveShieldedReceivePublicKey(key.hpkeIkm);
const isCode = (code) => (error) => error.code === code;

async function encrypt(envelope, input = {}) {
  return encryptShieldedLetter({ ...context, recipientPublicKey: publicKey, envelope, ...input });
}

async function decrypt(ciphertext, input = {}) {
  return decryptShieldedLetter({
    ...context,
    hpkeIkm: key.hpkeIkm,
    ciphertext,
    ...input,
  });
}

test("canonical letter envelope has a fixed, deterministic binary encoding", () => {
  const envelope = createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "A", salt: 1n });
  assert.deepEqual(envelope, { version: 1, body: "A", salt: 1n, authorizationAlias: 9n });
  const bytes = encodeShieldedLetterEnvelope(envelope);
  assert.equal(
    Buffer.from(bytes).toString("hex"),
    "44464c4501000000" + "0".repeat(63) + "1" + "0".repeat(63) + "9" + "0000000000000001" + "41",
  );
  assert.deepEqual(decodeShieldedLetterEnvelope(bytes), envelope);
  assert.deepEqual(encodeShieldedLetterEnvelope(decodeShieldedLetterEnvelope(bytes)), bytes);
});

test("plain text round-trips exactly without normalizing signatures or Unicode", () => {
  for (const body of ["家书\n落款：家人", "e\u0301 é", "\ufeff正文", "<b>文字</b>\n\u0000🧬"]) {
    const envelope = createShieldedLetterEnvelope({ authorizationAlias: 9n, body, salt: 99n });
    assert.equal(decodeShieldedLetterEnvelope(encodeShieldedLetterEnvelope(envelope)).body, body);
  }
  assert.throws(
    () => createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "", salt: 1n }),
    isCode("EMPTY_SHIELDED_LETTER_BODY"),
  );
  assert.throws(
    () => createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "\ud800", salt: 1n }),
    isCode("ISOLATED_SURROGATE"),
  );
  assert.throws(
    () => createShieldedLetterEnvelope({ authorizationAlias: 9n, body: null, salt: 1n }),
    isCode("INVALID_STRING"),
  );
});

test("message salt is generated once, encoded for recovery and shared with the proof", () => {
  const first = createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "信" });
  const second = createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "信" });
  assert(first.salt > 0n && first.salt < SNARK_SCALAR_FIELD);
  assert.notEqual(first.salt, second.salt);
  assert.deepEqual(decodeShieldedLetterEnvelope(encodeShieldedLetterEnvelope(first)), first);
  assert.throws(() => encodeShieldedLetterEnvelope({ body: "信" }), isCode("INVALID_INTEGER"));
  assert.throws(
    () => createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "信", salt: 0n }),
    isCode("INVALID_SHIELDED_LETTER_FIELD"),
  );
});

test("noncanonical envelope versions, reserved bytes, fields, lengths and UTF-8 are rejected", () => {
  const good = encodeShieldedLetterEnvelope(
    createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "ABC", salt: 9n }),
  );
  for (const [offset, value] of [
    [0, 0],
    [4, 2],
    [5, 1],
    [6, 1],
    [7, 1],
    [79, 2],
  ]) {
    const bad = good.slice();
    bad[offset] = value;
    assert.throws(() => decodeShieldedLetterEnvelope(bad));
  }
  for (const bad of [
    good.subarray(0, 79),
    good.subarray(0, good.length - 1),
    new Uint8Array([...good, 0]),
  ]) {
    assert.throws(
      () => decodeShieldedLetterEnvelope(bad),
      isCode("INVALID_SHIELDED_LETTER_ENVELOPE"),
    );
  }
  const invalidUtf8 = good.slice();
  invalidUtf8[80] = 0xff;
  assert.throws(() => decodeShieldedLetterEnvelope(invalidUtf8), isCode("INVALID_UTF8"));
  const zeroSalt = good.slice();
  zeroSalt.fill(0, 8, 40);
  assert.throws(
    () => decodeShieldedLetterEnvelope(zeroSalt),
    isCode("INVALID_SHIELDED_LETTER_FIELD"),
  );
  const outOfFieldSalt = good.slice();
  outOfFieldSalt.fill(255, 8, 40);
  assert.throws(() => decodeShieldedLetterEnvelope(outOfFieldSalt), isCode("INTEGER_OUT_OF_RANGE"));
  for (const value of [undefined, 0n, SNARK_SCALAR_FIELD]) {
    assert.throws(() =>
      createShieldedLetterEnvelope({ body: "A", salt: 1n, authorizationAlias: value }),
    );
  }
  for (const value of [0, 255]) {
    const badAlias = good.slice();
    badAlias.fill(value, 40, 72);
    assert.throws(() => decodeShieldedLetterEnvelope(badAlias));
  }
  assert.throws(
    () =>
      createShieldedLetterEnvelope({
        authorizationAlias: 9n,
        version: SHIELDED_LETTER_ENVELOPE_VERSION + 1,
        body: "A",
        salt: 1n,
      }),
    isCode("UNSUPPORTED_SHIELDED_LETTER_VERSION"),
  );
});

test("letter ciphertexts cross Archive segment and uint16 payload boundaries", async () => {
  // Diversified framing consumes 197 bytes; test both sides of the 16 KiB edge.
  for (const length of [1, 16186, 16187, 16188, 65536, 262144]) {
    const envelope = createShieldedLetterEnvelope({
      authorizationAlias: 9n,
      body: "x".repeat(length),
      salt: 1n,
    });
    const ciphertext = await encrypt(envelope);
    assert.equal(ciphertext.length, length + 197);
    assert.equal(predictArchiveSegmentCount(ciphertext.length), Math.ceil((length + 197) / 16384));
    assert.deepEqual(await decrypt(ciphertext), envelope);
  }
});

test("diversified letter recovery reuses both key modes without per-code secrets", async () => {
  const independent = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: independentKeyVector.independentKeyRoot,
    independentKeyIdentitySecret: independentKeyVector.independentKeyIdentitySecret,
  });
  for (const material of [key, independent]) {
    const receivingKey = await deriveShieldedReceivePublicKey(material.hpkeIkm);
    const envelope = createShieldedLetterEnvelope({
      authorizationAlias: 9n,
      body: "旧信仍可恢复",
      salt: 77n,
    });
    const ciphertext = await encrypt(envelope, { recipientPublicKey: receivingKey });
    // Restore the same IKM on a fresh context; no code, counter, expiration,
    // sender material or extra recovery token is accepted by this API.
    const recovered = await decrypt(ciphertext, { hpkeIkm: material.hpkeIkm });
    assert.deepEqual(recovered, envelope);
  }
});

test("diversified encryption is randomized and its full archived hash is preserved in proof limbs", async () => {
  const envelope = createShieldedLetterEnvelope({
    authorizationAlias: 9n,
    body: "同一封信",
    salt: 7n,
  });
  const first = await encrypt(envelope);
  const second = await encrypt(envelope);
  assert.notDeepEqual(first, second);
  assert.notEqual(
    computeShieldedLetterCiphertextHash(first),
    computeShieldedLetterCiphertextHash(second),
  );
  assert.equal(computeShieldedLetterCiphertextHash(first), keccak256(first));
  assert.equal(
    computeShieldedLetterCiphertextHashField(first),
    BigInt(keccak256(first)) % SNARK_SCALAR_FIELD,
  );
  const { cipherLo, cipherHi } = splitShieldedLetterCiphertextHash(first);
  assert(cipherLo >= 0n && cipherLo < 1n << 128n);
  assert(cipherHi >= 0n && cipherHi < 1n << 128n);
  assert.equal((cipherHi << 128n) | cipherLo, BigInt(keccak256(first)));
  assert.deepEqual(await decrypt(first, { expectedCiphertextHash: keccak256(first) }), envelope);
});

test("wrong key, chain, contract, message id and altered bytes fail closed", async () => {
  const ciphertext = await encrypt(
    createShieldedLetterEnvelope({ authorizationAlias: 9n, body: "不得泄露的正文", salt: 3n }),
  );
  const bad = ciphertext.slice();
  bad[bad.length - 1] ^= 1;
  const badEnc = ciphertext.slice();
  badEnc[10] ^= 1;
  for (const input of [
    { hpkeIkm: deriveShieldedHeirKeyMaterial(14n).hpkeIkm },
    { chainId: 1031n },
    { lettersAddress: OTHER_LETTERS },
    { messageId: 45n },
    { ciphertext: bad },
    { ciphertext: badEnc },
  ]) {
    await assert.rejects(decrypt(ciphertext, input), (error) => {
      assert.equal(error.code, "SHIELDED_LETTER_DECRYPTION_FAILED");
      assert.equal(error.cause, undefined);
      assert(!error.message.includes("不得泄露的正文"));
      return true;
    });
  }
  await assert.rejects(
    decrypt(bad, { expectedCiphertextHash: keccak256(ciphertext) }),
    isCode("SHIELDED_LETTER_CIPHERTEXT_HASH_MISMATCH"),
  );
  for (const badFormat of [new Uint8Array(10), ciphertext.subarray(1)]) {
    await assert.rejects(decrypt(badFormat), isCode("INVALID_SHIELDED_LETTER_CIPHERTEXT"));
  }
  await assert.rejects(
    decrypt(ciphertext.subarray(0, ciphertext.length - 1)),
    isCode("SHIELDED_LETTER_DECRYPTION_FAILED"),
  );
});

test("scope and message number reject absent, zero, or noncanonical values", () => {
  assert.deepEqual(normalizeShieldedLetterScope(context), {
    chainId: 1030n,
    lettersAddress: LETTERS,
  });
  for (const input of [
    { ...context, chainId: 1031n },
    { ...context, lettersAddress: OTHER_LETTERS },
    { ...context, messageId: 45n },
  ]) {
    assert.notDeepEqual(buildShieldedLetterHpkeAad(input), buildShieldedLetterHpkeAad(context));
  }
  assert.throws(() => normalizeShieldedLetterScope(null), isCode("MISSING_SHIELDED_LETTER_SCOPE"));
  assert.throws(
    () => buildShieldedLetterHpkeAad({ ...context, chainId: 0n }),
    isCode("INVALID_CHAIN_ID"),
  );
  assert.throws(
    () => buildShieldedLetterHpkeAad({ ...context, chainId: 1n << 64n }),
    isCode("INTEGER_OUT_OF_RANGE"),
  );
  assert.throws(
    () => buildShieldedLetterHpkeAad({ ...context, lettersAddress: "0x" + "0".repeat(40) }),
    isCode("INVALID_SHIELDED_LETTER_ADDRESS"),
  );
  assert.throws(
    () => buildShieldedLetterHpkeAad({ ...context, messageId: 0n }),
    isCode("INVALID_SHIELDED_LETTER_FIELD"),
  );
  assert.throws(
    () => buildShieldedLetterHpkeAad({ ...context, messageId: SNARK_SCALAR_FIELD }),
    isCode("INTEGER_OUT_OF_RANGE"),
  );
});

test("secret and ciphertext input buffers remain owned by their caller", async () => {
  const envelope = createShieldedLetterEnvelope({
    authorizationAlias: 9n,
    body: "原资料不被覆盖",
    salt: 8n,
  });
  const ciphertext = await encrypt(envelope);
  const hpkeIkm = getBytes(key.hpkeIkm);
  const originalIkm = hpkeIkm.slice();
  const originalCiphertext = ciphertext.slice();
  await decrypt(ciphertext, { hpkeIkm });
  assert.deepEqual(hpkeIkm, originalIkm);
  assert.deepEqual(ciphertext, originalCiphertext);
  // The caller may reuse a mutable downloaded buffer after invoking recovery;
  // the decryption's snapshot keeps hash verification and decryption on one payload.
  const pending = decrypt(ciphertext, { hpkeIkm, expectedCiphertextHash: keccak256(ciphertext) });
  ciphertext.fill(0);
  assert.deepEqual(await pending, envelope);
});

test("recipient binding recovery matches the credential and supports both original key modes", async () => {
  const independent = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: independentKeyVector.independentKeyRoot,
    independentKeyIdentitySecret: independentKeyVector.independentKeyIdentitySecret,
  });
  for (const [keyMode, material] of [
    [0n, key],
    [1n, independent],
  ]) {
    const viewingKey = await deriveShieldedReceivePublicKey(material.hpkeIkm);
    const envelope = createShieldedLetterEnvelope({
      authorizationAlias: 9n,
      body: "已过期和撤销的历史家书",
      salt: 77n,
    });
    const opening = {
      authorizationAlias: envelope.authorizationAlias,
      ownerCommitment: material.ownerCommitment,
      keyMode,
      viewingKey,
      salt: envelope.salt,
    };
    const recipientBinding = computeShieldedReceiveRecipientBinding(opening);
    // The binding needs no old code, expiry or authorization checkpoint during recovery.
    assert.equal(
      recipientBinding,
      computeShieldedReceiveCredentialBinding({
        credential: {
          purpose: "receive",
          ...opening,
          expiresAt: 1n,
          authorizationCounter: 123n,
        },
        salt: envelope.salt,
      }),
    );
    const ciphertext = await encrypt(envelope, { recipientPublicKey: viewingKey });
    for (const includeAlias of [false, true]) {
      assert.deepEqual(
        await decrypt(ciphertext, {
          hpkeIkm: material.hpkeIkm,
          expectedRecipient: {
            ownerCommitment: material.ownerCommitment,
            keyMode,
            recipientBinding,
            ...(includeAlias ? { authorizationAlias: envelope.authorizationAlias } : {}),
          },
        }),
        envelope,
      );
    }
  }
});

test("inbox authorization rejects a letter encrypted to this wallet but proved for another recipient", async () => {
  const envelope = createShieldedLetterEnvelope({
    authorizationAlias: 9n,
    body: "不得绕过已撤销的收款授权",
    salt: 77n,
  });
  const otherKeys = deriveShieldedHeirKeyMaterial(14n);
  const otherPublicKey = await deriveShieldedReceivePublicKey(otherKeys.hpkeIkm);
  const otherBinding = computeShieldedReceiveRecipientBinding({
    authorizationAlias: 10n,
    ownerCommitment: otherKeys.ownerCommitment,
    keyMode: 0n,
    viewingKey: otherPublicKey,
    salt: envelope.salt,
  });
  const ciphertext = await encrypt(envelope);
  // Cryptographic decryptability by itself does not establish recipient authorization.
  assert.deepEqual(await decrypt(ciphertext), envelope);
  await assert.rejects(
    decrypt(ciphertext, {
      expectedRecipient: {
        ownerCommitment: key.ownerCommitment,
        keyMode: 0n,
        recipientBinding: otherBinding,
      },
    }),
    (error) => {
      assert.equal(error.code, "SHIELDED_LETTER_DECRYPTION_FAILED");
      assert.equal(error.cause, undefined);
      assert(!error.message.includes(envelope.body));
      return true;
    },
  );
});

test("every recipient-binding field comes from the authenticated opening or trusted wallet", async () => {
  const envelope = createShieldedLetterEnvelope({
    authorizationAlias: 9n,
    body: "binding fields",
    salt: 77n,
  });
  const opening = {
    authorizationAlias: envelope.authorizationAlias,
    ownerCommitment: key.ownerCommitment,
    keyMode: 0n,
    viewingKey: publicKey,
    salt: envelope.salt,
  };
  const expectedRecipient = {
    ownerCommitment: key.ownerCommitment,
    keyMode: 0n,
    recipientBinding: computeShieldedReceiveRecipientBinding(opening),
  };
  const ciphertext = await encrypt(envelope);
  for (const patch of [
    { ownerCommitment: deriveShieldedHeirKeyMaterial(14n).ownerCommitment },
    { keyMode: 1n },
    { authorizationAlias: 10n },
    { recipientBinding: 0n },
    { recipientBinding: SNARK_SCALAR_FIELD },
    {
      recipientBinding: computeShieldedReceiveRecipientBinding({
        ...opening,
        authorizationAlias: 10n,
      }),
    },
    { recipientBinding: computeShieldedReceiveRecipientBinding({ ...opening, salt: 78n }) },
    {
      recipientBinding: computeShieldedReceiveRecipientBinding({
        ...opening,
        viewingKey: await deriveShieldedReceivePublicKey(key.hpkeIkm),
      }),
    },
  ]) {
    await assert.rejects(
      decrypt(ciphertext, { expectedRecipient: { ...expectedRecipient, ...patch } }),
      isCode("SHIELDED_LETTER_DECRYPTION_FAILED"),
    );
  }
  const changedAlias = await encrypt({ ...envelope, authorizationAlias: 10n });
  const changedSalt = await encrypt({ ...envelope, salt: 78n });
  for (const changed of [changedAlias, changedSalt]) {
    await assert.rejects(
      decrypt(changed, { expectedRecipient }),
      isCode("SHIELDED_LETTER_DECRYPTION_FAILED"),
    );
  }
  const pending = decrypt(ciphertext, { expectedRecipient });
  expectedRecipient.ownerCommitment = 1n;
  expectedRecipient.recipientBinding = 1n;
  assert.deepEqual(await pending, envelope);
});
