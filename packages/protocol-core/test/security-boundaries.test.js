import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SNARK_SCALAR_FIELD,
  ZERO_BYTES32,
  asUint8Array,
  computeFormat1Aad,
  computePersonVersionContentCommitment,
  decryptPersonVersionEnvelope,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  serializeCanonicalPersonVersion,
  wipeBytes,
  wipePreparedPersonVersionContent,
} from "../index.js";

const vectorPath = fileURLToPath(
  new URL("../../../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const vector = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
const vectorMetadata = parseCanonicalPersonVersion(asUint8Array(vector.metadata.canonicalJsonHex));
const vectorContext = Object.freeze({
  chainId: BigInt(vector.context.chainId),
  deepFamilyProxy: vector.context.deepFamilyProxy,
  personHash: vector.context.personHash,
  fatherHash: vector.context.fatherHash,
  fatherVersionIndex: BigInt(vector.context.fatherVersionIndex),
  motherHash: vector.context.motherHash,
  motherVersionIndex: BigInt(vector.context.motherVersionIndex),
  versionCommitment: BigInt(vector.context.versionCommitment),
});

function sequentialRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

function identityFields(metadata) {
  return {
    fullName: metadata.person.fullName,
    gender: metadata.person.gender,
    birthYear: metadata.person.birthYear,
    birthMonth: metadata.person.birthMonth,
    birthDay: metadata.person.birthDay,
    isBirthBC: metadata.person.isBirthBC,
  };
}

function metadataWithParents() {
  const metadata = structuredClone(vectorMetadata);
  metadata.parents = {
    father: {
      fullName: "Father Example",
      gender: 1,
      birthYear: 1950,
      birthMonth: 3,
      birthDay: 4,
      isBirthBC: false,
      personHash: `0x${"33".repeat(32)}`,
      versionIndex: 2n,
    },
    mother: {
      fullName: "Mother Example",
      gender: 2,
      birthYear: 1952,
      birthMonth: 5,
      birthDay: 6,
      isBirthBC: false,
      personHash: `0x${"44".repeat(32)}`,
      versionIndex: 3n,
    },
  };
  return metadata;
}

function prepareMetadataContext(metadata, derivedSecretField) {
  const prepared = computePersonVersionContentCommitment({ metadata, derivedSecretField });
  const father = metadata.parents.father;
  const mother = metadata.parents.mother;
  return {
    prepared,
    context: {
      ...vectorContext,
      personHash: metadata.person.personHash,
      fatherHash: father?.personHash ?? ZERO_BYTES32,
      fatherVersionIndex: father?.versionIndex ?? 0n,
      motherHash: mother?.personHash ?? ZERO_BYTES32,
      motherVersionIndex: mother?.versionIndex ?? 0n,
      versionCommitment: prepared.versionCommitment,
    },
  };
}

async function assertAuthenticationFailure(envelope, context, rawPassphrase = "") {
  await assert.rejects(
    decryptPersonVersionEnvelope({ envelope, rawPassphrase, context }),
    (error) => error?.code === "AES_GCM_AUTHENTICATION_FAILED",
  );
}

test("every encrypted field is individually authenticated", async () => {
  const original = asUint8Array(vector.envelope.envelopeHex);
  const contentLength = parseFormat1Envelope(original).contentCiphertextLength;
  const mutations = [
    ["fileSalt", 0x18],
    ["wrapIV", 0x28],
    ["contentIV", 0x34],
    ["wrappedDEK", 0x40],
    ["wrappedDEKTag", 0x60],
    ["contentCiphertext", 0x70],
    ["contentTag", 0x70 + contentLength],
  ];

  for (const [label, offset] of mutations) {
    const tampered = original.slice();
    tampered[offset] ^= 0x01;
    await assert.rejects(
      decryptPersonVersionEnvelope({
        envelope: tampered,
        rawPassphrase: vector.identity.rawPassphrase,
        context: vectorContext,
      }),
      (error) => {
        assert.equal(error?.code, "AES_GCM_AUTHENTICATION_FAILED", label);
        return true;
      },
    );
  }
  assert.deepEqual(original, asUint8Array(vector.envelope.envelopeHex));
});

test("every chain/person/parent/version context dimension is bound into both AAD domains", async () => {
  const metadata = metadataWithParents();
  const { prepared, context } = prepareMetadataContext(
    metadata,
    BigInt(vector.identity.derivedSecretField),
  );
  try {
    const encrypted = await encryptPersonVersionEnvelope({
      metadata,
      rawPassphrase: vector.identity.rawPassphrase,
      identitySuiteId: 1,
      context,
      randomBytes: sequentialRandom(32),
    });
    const wrongContexts = [
      ["chainId", { ...context, chainId: context.chainId + 1n }],
      ["proxy", { ...context, deepFamilyProxy: `0x${"22".repeat(20)}` }],
      ["person", { ...context, personHash: `0x${"aa".repeat(32)}` }],
      ["father hash", { ...context, fatherHash: `0x${"55".repeat(32)}` }],
      ["father version", { ...context, fatherVersionIndex: context.fatherVersionIndex + 1n }],
      ["mother hash", { ...context, motherHash: `0x${"66".repeat(32)}` }],
      ["mother version", { ...context, motherVersionIndex: context.motherVersionIndex + 1n }],
      ["version commitment", { ...context, versionCommitment: context.versionCommitment + 1n }],
    ];
    const expectedAad = computeFormat1Aad({ context, identitySuiteId: 1 });

    for (const [label, wrongContext] of wrongContexts) {
      const wrongAad = computeFormat1Aad({ context: wrongContext, identitySuiteId: 1 });
      assert.notDeepEqual(wrongAad.wrapAAD, expectedAad.wrapAAD, `${label} wrap AAD`);
      assert.notDeepEqual(wrongAad.contentAAD, expectedAad.contentAAD, `${label} content AAD`);
      await assert.rejects(
        decryptPersonVersionEnvelope({
          envelope: encrypted.envelope,
          rawPassphrase: vector.identity.rawPassphrase,
          context: wrongContext,
        }),
        (error) => {
          assert.equal(error?.code, "AES_GCM_AUTHENTICATION_FAILED", label);
          return true;
        },
      );
    }
  } finally {
    wipePreparedPersonVersionContent(prepared);
  }
});

test("a structurally valid envelope encrypted with a different file passphrase is rejected", async () => {
  const identityPassphrase = "identity-only-passphrase";
  const filePassphrase = "file-only-passphrase";
  const material = await deriveIdentityMaterial({
    identity: identityFields(vectorMetadata),
    rawPassphrase: identityPassphrase,
    identitySuiteId: 1,
  });
  const metadata = structuredClone(vectorMetadata);
  metadata.person.personHash = material.personHash;
  const { prepared, context } = prepareMetadataContext(metadata, material.derivedSecretField);

  try {
    const encrypted = await encryptPersonVersionEnvelope({
      metadata,
      rawPassphrase: filePassphrase,
      identitySuiteId: 1,
      context,
      randomBytes: sequentialRandom(96),
    });

    await assertAuthenticationFailure(encrypted.envelope, context, identityPassphrase);
    await assert.rejects(
      decryptPersonVersionEnvelope({
        envelope: encrypted.envelope,
        rawPassphrase: filePassphrase,
        context,
      }),
      (error) => error?.code === "PERSON_HASH_MISMATCH",
    );
  } finally {
    wipePreparedPersonVersionContent(prepared);
    wipeBytes(material.identitySalt);
    wipeBytes(material.derivedSecretBytes);
  }
});

test("encryption wipes every random-source buffer after taking ownership", async () => {
  const retainedSourceBuffers = [];
  let next = 0;
  const recordingRandom = (length) => {
    const bytes = Uint8Array.from({ length }, () => next++ & 0xff);
    retainedSourceBuffers.push(bytes);
    return bytes;
  };

  const encrypted = await encryptPersonVersionEnvelope({
    metadata: vectorMetadata,
    rawPassphrase: vector.identity.rawPassphrase,
    identitySuiteId: 1,
    context: vectorContext,
    randomBytes: recordingRandom,
  });

  assert.equal(retainedSourceBuffers.length, 4);
  for (const bytes of retainedSourceBuffers) {
    assert.deepEqual(bytes, new Uint8Array(bytes.length));
  }
  assert.equal(parseFormat1Envelope(encrypted.envelope).identitySuiteId, 1);
});

test("commitment failure wipes the transient content-digest byte buffer", () => {
  const expectedDigest = asUint8Array(vector.metadata.contentDigest);
  const originalFill = Uint8Array.prototype.fill;
  let observedDigestWipe = false;
  Uint8Array.prototype.fill = function patchedFill(value, start, end) {
    if (
      value === 0 &&
      this.length === expectedDigest.length &&
      this.every((byte, index) => byte === expectedDigest[index])
    ) {
      observedDigestWipe = true;
    }
    return originalFill.call(this, value, start, end);
  };
  try {
    assert.throws(
      () =>
        computePersonVersionContentCommitment({
          metadata: vectorMetadata,
          derivedSecretField: SNARK_SCALAR_FIELD,
        }),
      (error) => error?.code === "INTEGER_OUT_OF_RANGE",
    );
  } finally {
    Uint8Array.prototype.fill = originalFill;
  }
  assert.equal(observedDigestWipe, true);
});

test("person, parents, tag and biography mutations symmetrically change every content derivative", async () => {
  const baseMetadata = metadataWithParents();
  const derivedSecretField = BigInt(vector.identity.derivedSecretField);
  const baseline = prepareMetadataContext(baseMetadata, derivedSecretField);
  const baselineEncrypted = await encryptPersonVersionEnvelope({
    metadata: baseMetadata,
    rawPassphrase: vector.identity.rawPassphrase,
    identitySuiteId: 1,
    context: baseline.context,
    randomBytes: sequentialRandom(),
  });
  const baselineCiphertext = parseFormat1Envelope(baselineEncrypted.envelope).contentCiphertext;

  const mutations = [
    ["person", (metadata) => (metadata.person.birthDay += 1)],
    ["parents", (metadata) => (metadata.parents.father.fullName = "Father Example II")],
    ["tag", (metadata) => (metadata.tag += "!")],
    ["biography", (metadata) => (metadata.biography += "!")],
  ];

  try {
    for (const [label, mutate] of mutations) {
      const changedMetadata = structuredClone(baseMetadata);
      mutate(changedMetadata);
      const changedIdentityMaterial =
        label === "person"
          ? await deriveIdentityMaterial({
              identity: identityFields(changedMetadata),
              rawPassphrase: vector.identity.rawPassphrase,
              identitySuiteId: 1,
            })
          : null;
      if (changedIdentityMaterial) {
        changedMetadata.person.personHash = changedIdentityMaterial.personHash;
      }
      const changed = prepareMetadataContext(
        changedMetadata,
        changedIdentityMaterial?.derivedSecretField ?? derivedSecretField,
      );
      try {
        const encrypted = await encryptPersonVersionEnvelope({
          metadata: changedMetadata,
          rawPassphrase: vector.identity.rawPassphrase,
          identitySuiteId: 1,
          context: changed.context,
          randomBytes: sequentialRandom(),
        });
        const ciphertext = parseFormat1Envelope(encrypted.envelope).contentCiphertext;
        const decrypted = await decryptPersonVersionEnvelope({
          envelope: encrypted.envelope,
          rawPassphrase: vector.identity.rawPassphrase,
          context: changed.context,
        });

        assert.notDeepEqual(
          serializeCanonicalPersonVersion(changedMetadata),
          baseline.prepared.canonicalJsonBytes,
          `${label} canonical JSON`,
        );
        assert.notEqual(
          changed.prepared.contentDigest,
          baseline.prepared.contentDigest,
          `${label} contentDigest`,
        );
        assert.notEqual(
          changed.prepared.versionCommitment,
          baseline.prepared.versionCommitment,
          `${label} versionCommitment`,
        );
        assert.notDeepEqual(ciphertext, baselineCiphertext, `${label} content ciphertext`);
        assert.notEqual(
          encrypted.payloadHash,
          baselineEncrypted.payloadHash,
          `${label} payloadHash`,
        );
        assert.deepEqual(decrypted.metadata, changedMetadata, `${label} production round-trip`);
        assert.equal(
          decrypted.versionCommitment,
          changed.prepared.versionCommitment,
          `${label} commitment round-trip`,
        );
      } finally {
        wipePreparedPersonVersionContent(changed.prepared);
        wipeBytes(changedIdentityMaterial?.identitySalt);
        wipeBytes(changedIdentityMaterial?.derivedSecretBytes);
      }
    }
  } finally {
    wipePreparedPersonVersionContent(baseline.prepared);
  }
});
