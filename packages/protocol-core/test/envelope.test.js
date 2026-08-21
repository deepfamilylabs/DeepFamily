import test from "node:test";
import assert from "node:assert/strict";
import {
  DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
  UnsupportedProtocolError,
  assembleFormat1Envelope,
  computeFormat1Aad,
  computePayloadHash,
  parseEnvelopeCommonPrefix,
  parseFormat1Envelope,
  verifyMetadataRuntimeCode,
  ZERO_BYTES32,
} from "../index.js";

const fill = (length, value) => new Uint8Array(length).fill(value);

function envelope(contentLength = 3) {
  return assembleFormat1Envelope({
    identitySuiteId: 1,
    fileSalt: fill(16, 0x11),
    wrapIV: fill(12, 0x22),
    contentIV: fill(12, 0x33),
    wrappedDEK: fill(32, 0x44),
    wrappedDEKTag: fill(16, 0x55),
    contentCiphertext: fill(contentLength, 0x66),
    contentTag: fill(16, 0x77),
  });
}

test("DFM1 format 1 assembly uses the frozen offsets and exact length formula", () => {
  const bytes = envelope();
  assert.equal(bytes.length, 131);
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x44, 0x46, 0x4d, 0x31]);
  assert.deepEqual(Array.from(bytes.slice(0x0a, 0x10)), [0, 112, 0, 0, 0, 3]);
  assert.deepEqual(Array.from(bytes.slice(0x10, 0x18)), [0, 0, 0, 1, 0, 0, 0, 0]);
  const parsed = parseFormat1Envelope(bytes);
  assert.equal(parsed.identitySuiteId, 1);
  assert.equal(parsed.contentCiphertextLength, 3);
  assert.deepEqual(parsed.contentCiphertext, fill(3, 0x66));
  assert.deepEqual(parsed.contentTag, fill(16, 0x77));
});

test("common prefix remains opaque while strict dispatch rejects unknown format/suites before KDF", () => {
  const unknownFormat = envelope();
  unknownFormat[4] = 99;
  assert.equal(parseEnvelopeCommonPrefix(unknownFormat).formatVersion, 99);
  assert.throws(() => parseFormat1Envelope(unknownFormat), UnsupportedProtocolError);

  const unknownIdentity = envelope();
  unknownIdentity.set([0, 0, 0, 2], 0x10);
  assert.throws(
    () => parseFormat1Envelope(unknownIdentity),
    (error) => error.code === "UNSUPPORTED_IDENTITY_SUITE",
  );

  const unknownKdf = envelope();
  unknownKdf[9] = 2;
  assert.throws(
    () => parseFormat1Envelope(unknownKdf),
    (error) => error.code === "UNSUPPORTED_FILE_KDF_SUITE",
  );
});

test("format parser rejects flags/reserved/length tampering and accepts exact 16 KiB maximum", () => {
  for (const [offset, code] of [
    [5, "NONZERO_ENVELOPE_FLAGS"],
    [20, "NONZERO_ENVELOPE_RESERVED"],
    [10, "INVALID_HEADER_LENGTH"],
    [15, "ENVELOPE_LENGTH_MISMATCH"],
  ]) {
    const mutated = envelope();
    mutated[offset] ^= 1;
    assert.throws(
      () => parseFormat1Envelope(mutated),
      (error) => error.code === code,
    );
  }
  const maximum = envelope(DFM1_MAX_CONTENT_CIPHERTEXT_BYTES);
  assert.equal(maximum.length, 16_384);
  assert.equal(parseFormat1Envelope(maximum).contentCiphertextLength, 16_256);
  assert.throws(() => envelope(DFM1_MAX_CONTENT_CIPHERTEXT_BYTES + 1), /out of range/);
});

test("MetadataRef runtime verification strips STOP and checks exact length/hash", () => {
  const bytes = envelope();
  const runtime = new Uint8Array(bytes.length + 1);
  runtime.set(bytes, 1);
  const payloadHash = computePayloadHash(bytes);
  const verified = verifyMetadataRuntimeCode({
    runtimeCode: runtime,
    payloadLength: bytes.length,
    payloadHash,
    requireCommonPrefix: true,
  });
  assert.deepEqual(verified.envelope, bytes);
  assert.equal(verified.prefix.identitySuiteId, 1);

  const missingStop = runtime.slice();
  missingStop[0] = 1;
  assert.throws(
    () =>
      verifyMetadataRuntimeCode({
        runtimeCode: missingStop,
        payloadLength: bytes.length,
        payloadHash,
      }),
    /begin with STOP/,
  );
  assert.throws(
    () =>
      verifyMetadataRuntimeCode({
        runtimeCode: runtime,
        payloadLength: bytes.length - 1,
        payloadHash,
      }),
    /runtime length/,
  );
  const changed = runtime.slice();
  changed.at(-1);
  changed[changed.length - 1] ^= 1;
  assert.throws(
    () =>
      verifyMetadataRuntimeCode({ runtimeCode: changed, payloadLength: bytes.length, payloadHash }),
    /does not match/,
  );
});

test("format 1 AAD is exactly 15 ABI words and context changes alter both authentication domains", () => {
  const context = {
    chainId: 31337n,
    deepFamilyProxy: "0x1111111111111111111111111111111111111111",
    personHash: `0x${"aa".repeat(32)}`,
    fatherHash: ZERO_BYTES32,
    fatherVersionIndex: 0n,
    motherHash: `0x${"bb".repeat(32)}`,
    motherVersionIndex: 0n,
    versionCommitment: 123n,
  };
  const first = computeFormat1Aad({ context, identitySuiteId: 1 });
  const second = computeFormat1Aad({
    context: { ...context, chainId: 31338n },
    identitySuiteId: 1,
  });
  assert.equal(first.contextPreimage.length, 480);
  assert.equal(first.wrapAAD.length, 32);
  assert.equal(first.contentAAD.length, 32);
  assert.notDeepEqual(first.wrapAAD, first.contentAAD);
  assert.notDeepEqual(first.wrapAAD, second.wrapAAD);
  assert.notDeepEqual(first.contentAAD, second.contentAAD);
});
