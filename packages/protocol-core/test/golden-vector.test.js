import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_ARGON2ID_PROFILE,
  PERSON_VERSION_SCHEMA,
  PROTOCOL_IMPLEMENTATION_STATUS,
  ZERO_BYTES32,
  asUint8Array,
  buildFilePasswordBytes,
  buildIdentityPasswordBytes,
  bytesToHex,
  computeFormat1Aad,
  computeDisclosureBinding,
  computePersonVersionContentCommitment,
  computeVersionHash,
  decryptPersonVersionEnvelope,
  decryptPersonVersionRuntime,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  packSubmitterAndSelfSuiteId,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  roundTripPersonVersionEnvelope,
  serializeCanonicalPersonVersion,
} from "../index.js";
import {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
} from "../../proof-core/index.js";

const vectorPath = fileURLToPath(
  new URL("../../../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const manifestPath = fileURLToPath(
  new URL("../../../protocol-release-manifest.json", import.meta.url),
);
const generatorPath = fileURLToPath(
  new URL("../scripts/generate-golden-vector.mjs", import.meta.url),
);
const vector = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const metadata = parseCanonicalPersonVersion(asUint8Array(vector.metadata.canonicalJsonHex));
const identity = {
  fullName: metadata.person.fullName,
  gender: metadata.person.gender,
  birthYear: metadata.person.birthYear,
  birthMonth: metadata.person.birthMonth,
  birthDay: metadata.person.birthDay,
  isBirthBC: metadata.person.isBirthBC,
};
const context = {
  chainId: BigInt(vector.context.chainId),
  deepFamilyProxy: vector.context.deepFamilyProxy,
  personHash: vector.context.personHash,
  fatherHash: vector.context.fatherHash,
  fatherVersionIndex: BigInt(vector.context.fatherVersionIndex),
  motherHash: vector.context.motherHash,
  motherVersionIndex: BigInt(vector.context.motherVersionIndex),
  versionCommitment: BigInt(vector.context.versionCommitment),
};

function sequentialRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

test("release manifest and implementation keep suite 1 explicitly candidate/provisional", () => {
  assert.equal(PROTOCOL_IMPLEMENTATION_STATUS.productionFrozen, false);
  assert.equal(CANDIDATE_ARGON2ID_PROFILE.provisional, true);
  assert.equal(manifest.releaseStatus, "development");
  assert.equal(manifest.identitySuites["1"].status, "candidate-awaiting-device-benchmark");
  assert.equal(manifest.fileKdfSuites["1"].status, "candidate-awaiting-device-benchmark");
  assert.deepEqual(manifest.identitySuites["1"].kdf, {
    algorithm: "Argon2id",
    version: 19,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    outputBytes: 32,
  });
});

test("empty passphrase golden vector runs full domain-separated identity Argon2id", async () => {
  const material = await deriveIdentityMaterial({
    identity,
    rawPassphrase: vector.identity.rawPassphrase,
    identitySuiteId: vector.identity.identitySuiteId,
  });
  assert.equal(
    bytesToHex(buildIdentityPasswordBytes("")),
    vector.identity.identityPasswordInputHex,
  );
  assert.equal(bytesToHex(buildFilePasswordBytes("")), vector.identity.filePasswordInputHex);
  assert.notDeepEqual(buildIdentityPasswordBytes(""), buildFilePasswordBytes(""));
  assert.equal(bytesToHex(material.identitySalt), vector.identity.identitySaltHex);
  assert.equal(bytesToHex(material.derivedSecretBytes), vector.identity.argon2idOutputHex);
  assert.equal(material.derivedSecretField.toString(), vector.identity.derivedSecretField);
  assert.notEqual(material.derivedSecretField, 0n);
  assert.equal(material.packedBirthGenderField.toString(), vector.identity.packedBirthGenderField);
  assert.equal(material.nameField.toString(), vector.identity.nameField);
  assert.equal(material.suiteCommitment.toString(), vector.identity.suiteCommitment);
  assert.equal(material.nameSecretCommitment.toString(), vector.identity.nameSecretCommitment);
  assert.equal(material.identityCommitment.toString(), vector.identity.identityCommitment);
  assert.equal(material.personHash, vector.identity.personHash);
});

test("golden canonical bytes, digest limbs, commitment, versionHash and 15-word AAD are exact", () => {
  assert.equal(metadata.schema, PERSON_VERSION_SCHEMA);
  assert.equal(
    new TextDecoder().decode(serializeCanonicalPersonVersion(metadata)),
    vector.metadata.canonicalJsonUtf8,
  );
  const prepared = computePersonVersionContentCommitment({
    metadata,
    derivedSecretField: BigInt(vector.identity.derivedSecretField),
  });
  assert.equal(bytesToHex(prepared.canonicalJsonBytes), vector.metadata.canonicalJsonHex);
  assert.equal(prepared.contentDigest, vector.metadata.contentDigest);
  assert.equal(prepared.contentDigestLo.toString(), vector.metadata.contentDigestLo);
  assert.equal(prepared.contentDigestHi.toString(), vector.metadata.contentDigestHi);
  assert.equal(prepared.versionCommitment.toString(), vector.metadata.versionCommitment);
  assert.equal(computeVersionHash(context), vector.context.versionHash);
  assert.equal(
    packSubmitterAndSelfSuiteId(vector.context.submitter, 1).toString(),
    vector.context.submitterAndSelfSuiteId,
  );
  const aad = computeFormat1Aad({ context, identitySuiteId: 1 });
  assert.equal(aad.contextPreimage.length, 480);
  assert.equal(bytesToHex(aad.contextPreimage), vector.context.contextPreimageHex);
  assert.equal(aad.contextHash, vector.context.contextHash);
  assert.equal(bytesToHex(aad.wrapAAD), vector.context.wrapAADHex);
  assert.equal(bytesToHex(aad.contentAAD), vector.context.contentAADHex);
});

test("golden vector freezes every PersonRelation and DisclosureBinding public signal in order", () => {
  const relation = vector.zkPublicSignals.personRelation;
  const disclosure = vector.zkPublicSignals.disclosureBinding;
  const relationManifest = manifest.proofRoutes.find((route) => route.purpose === "PersonRelation");
  const disclosureManifest = manifest.proofRoutes.find(
    (route) => route.purpose === "DisclosureBinding",
  );

  assert.equal(relation.purpose, PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.purpose);
  assert.equal(relation.circuitId, 1);
  assert.deepEqual(relation.publicSignalOrder, [
    ...PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder,
  ]);
  assert.deepEqual(
    relation.publicSignalOrder,
    relationManifest.publicSignals.map(({ name }) => name),
  );
  assert.equal(relation.publicSignals.length, PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.length);
  assert.equal(relation.publicSignals[0], vector.identity.identityCommitment);
  assert.equal(relation.publicSignals[1], "0");
  assert.equal(relation.publicSignals[2], "0");
  assert.equal(relation.publicSignals[3], vector.context.submitterAndSelfSuiteId);
  assert.equal(relation.publicSignals[4], vector.metadata.versionCommitment);

  const expectedDisclosureBinding = computeDisclosureBinding({
    nameField: vector.identity.nameField,
    packedBirthGenderField: vector.identity.packedBirthGenderField,
    suiteCommitment: vector.identity.suiteCommitment,
  });
  assert.equal(disclosure.purpose, DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.purpose);
  assert.equal(disclosure.circuitId, 1);
  assert.deepEqual(disclosure.publicSignalOrder, [
    ...DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder,
  ]);
  assert.deepEqual(
    disclosure.publicSignalOrder,
    disclosureManifest.publicSignals.map(({ name }) => name),
  );
  assert.equal(disclosure.publicSignals.length, DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.length);
  assert.equal(disclosure.publicSignals[0], vector.identity.identityCommitment);
  assert.equal(disclosure.publicSignals[1], expectedDisclosureBinding.toString());
  assert.equal(disclosure.publicSignals[2], BigInt(vector.context.submitter).toString());
  assert.equal(disclosure.publicSignals[3], vector.identity.suiteCommitment);
});

test("golden vector generator reproduces the committed bytes and manifest hash", () => {
  const output = execFileSync(process.execPath, [generatorPath, "--check"], {
    encoding: "utf8",
  });
  assert.match(output, new RegExp(`sha256=${manifest.goldenVectors.sha256}\\n$`, "u"));
});

test("fixed randomness reproduces the byte-exact DFM1 envelope and production round-trip", async () => {
  const encrypted = await encryptPersonVersionEnvelope({
    metadata,
    rawPassphrase: "",
    identitySuiteId: 1,
    context,
    randomBytes: sequentialRandom(),
  });
  assert.equal(bytesToHex(encrypted.envelope), vector.envelope.envelopeHex);
  assert.equal(encrypted.payloadHash, vector.envelope.payloadHash);
  assert.equal(encrypted.envelopeLength, vector.envelope.payloadLength);
  const parsed = parseFormat1Envelope(encrypted.envelope);
  assert.equal(bytesToHex(encrypted.envelope.slice(0, 112)), vector.envelope.headerHex);
  assert.equal(bytesToHex(parsed.fileSalt), vector.envelope.fileSaltHex);
  assert.equal(bytesToHex(parsed.wrapIV), vector.envelope.wrapIVHex);
  assert.equal(bytesToHex(parsed.contentIV), vector.envelope.contentIVHex);
  assert.equal(bytesToHex(parsed.wrappedDEK), vector.envelope.wrappedDEKHex);
  assert.equal(bytesToHex(parsed.wrappedDEKTag), vector.envelope.wrappedDEKTagHex);
  assert.equal(bytesToHex(parsed.contentCiphertext), vector.envelope.contentCiphertextHex);
  assert.equal(bytesToHex(parsed.contentTag), vector.envelope.contentTagHex);

  const validated = await roundTripPersonVersionEnvelope({
    envelope: encrypted.envelope,
    rawPassphrase: "",
    context,
    expectedMetadata: metadata,
    submitterAndSelfSuiteId: vector.context.submitterAndSelfSuiteId,
    expectedSubmitter: vector.context.submitter,
  });
  assert.equal(validated.metadataUnlockValidated, true);
  assert.deepEqual(validated.metadata, metadata);

  const runtime = new Uint8Array(encrypted.envelope.length + 1);
  runtime.set(encrypted.envelope, 1);
  const fromRuntime = await decryptPersonVersionRuntime({
    runtimeCode: runtime,
    payloadLength: encrypted.envelope.length,
    payloadHash: encrypted.payloadHash,
    rawPassphrase: "",
    context,
  });
  assert.deepEqual(fromRuntime.metadata, metadata);

  await assert.rejects(
    roundTripPersonVersionEnvelope({
      envelope: encrypted.envelope,
      rawPassphrase: "",
      context,
      expectedMetadata: metadata,
      submitterAndSelfSuiteId: packSubmitterAndSelfSuiteId(vector.context.submitter, 2),
      expectedSubmitter: vector.context.submitter,
    }),
    (error) => error.code === "PACKED_IDENTITY_SUITE_MISMATCH",
  );
});

test("fresh randomness changes envelope/hash but not content commitment or versionHash", async () => {
  const first = await encryptPersonVersionEnvelope({
    metadata,
    rawPassphrase: "",
    identitySuiteId: 1,
    context,
    randomBytes: sequentialRandom(80),
  });
  const second = await encryptPersonVersionEnvelope({
    metadata,
    rawPassphrase: "",
    identitySuiteId: 1,
    context,
    randomBytes: sequentialRandom(160),
  });
  assert.notDeepEqual(first.envelope, second.envelope);
  assert.notEqual(first.payloadHash, second.payloadHash);
  assert.equal(context.versionCommitment.toString(), vector.metadata.versionCommitment);
  assert.equal(computeVersionHash(context), vector.context.versionHash);
});

test("wrong password, wrong AAD context and a self-consistent false declared commitment fail closed", async () => {
  const envelope = asUint8Array(vector.envelope.envelopeHex);
  await assert.rejects(
    decryptPersonVersionEnvelope({ envelope, rawPassphrase: "wrong", context }),
    (error) => error.code === "AES_GCM_AUTHENTICATION_FAILED",
  );
  await assert.rejects(
    decryptPersonVersionEnvelope({
      envelope,
      rawPassphrase: "",
      context: { ...context, chainId: context.chainId + 1n },
    }),
    (error) => error.code === "AES_GCM_AUTHENTICATION_FAILED",
  );

  const falseContext = { ...context, versionCommitment: context.versionCommitment + 1n };
  const malicious = await encryptPersonVersionEnvelope({
    metadata,
    rawPassphrase: "",
    identitySuiteId: 1,
    context: falseContext,
    randomBytes: sequentialRandom(32),
  });
  await assert.rejects(
    decryptPersonVersionEnvelope({
      envelope: malicious.envelope,
      rawPassphrase: "",
      context: falseContext,
    }),
    (error) => error.code === "VERSION_COMMITMENT_MISMATCH",
  );
});

test("parent-only references keep a nonzero parent hash with versionIndex zero", () => {
  const parentOnly = {
    ...context,
    fatherHash: `0x${"33".repeat(32)}`,
    fatherVersionIndex: 0n,
  };
  assert.doesNotThrow(() => computeFormat1Aad({ context: parentOnly, identitySuiteId: 1 }));
  assert.throws(
    () =>
      computeFormat1Aad({
        context: { ...context, fatherHash: ZERO_BYTES32, fatherVersionIndex: 1n },
        identitySuiteId: 1,
      }),
    /zero father hash/,
  );
});
