import {
  DFM1_FORMAT_1_OVERHEAD_BYTES,
  DFM1_MAX_ENVELOPE_BYTES,
  IDENTITY_SUITE_CANDIDATE_1,
  PROTOCOL_GENERATION,
  ZERO_BYTES32,
} from "./constants.js";
import { equalBytesConstantTime, wipeBytes } from "./bytes.js";
import { parseCanonicalPersonVersion, serializeCanonicalPersonVersion } from "./canonical.js";
import {
  assertSubmitterAndSelfSuiteId,
  computeContentDigest,
  computeVersionCommitment,
  computeVersionHash,
} from "./commitments.js";
import { gzipV1, gunzipV1Strict } from "./gzip.js";
import {
  computePayloadHash,
  decryptFormat1Compressed,
  encryptFormat1Compressed,
  parseFormat1Envelope,
} from "./envelope.js";
import { normalizeMetadataContext } from "./aad.js";
import { deriveIdentityMaterial } from "./identity.js";
import { readMetadataEnvelopeFromRef, verifyMetadataRuntimeCode } from "./archive.js";
import { protocolAssert } from "./errors.js";

function assertParentMatchesContext(parent, hash, versionIndex, role) {
  if (hash === ZERO_BYTES32) {
    protocolAssert(parent === null, "PLAINTEXT_CONTEXT_MISMATCH", `${role} must be null`);
    protocolAssert(
      versionIndex === 0n,
      "PLAINTEXT_CONTEXT_MISMATCH",
      `${role} version must be zero`,
    );
    return;
  }
  protocolAssert(parent !== null, "PLAINTEXT_CONTEXT_MISMATCH", `${role} must be present`);
  protocolAssert(
    parent.personHash === hash,
    "PLAINTEXT_CONTEXT_MISMATCH",
    `${role} personHash does not match the chain reference`,
  );
  protocolAssert(
    parent.versionIndex === versionIndex,
    "PLAINTEXT_CONTEXT_MISMATCH",
    `${role} versionIndex does not match the chain reference`,
  );
}

export function assertMetadataMatchesContext(metadata, inputContext) {
  const context = normalizeMetadataContext(inputContext);
  protocolAssert(
    metadata.person.personHash === context.personHash,
    "PLAINTEXT_CONTEXT_MISMATCH",
    "Plaintext personHash does not match the chain version",
  );
  assertParentMatchesContext(
    metadata.parents.father,
    context.fatherHash,
    context.fatherVersionIndex,
    "father",
  );
  assertParentMatchesContext(
    metadata.parents.mother,
    context.motherHash,
    context.motherVersionIndex,
    "mother",
  );
  return context;
}

export function computePersonVersionContentCommitment(input) {
  const canonicalJsonBytes = serializeCanonicalPersonVersion(input.metadata);
  try {
    const digest = computeContentDigest(canonicalJsonBytes);
    const versionCommitment = computeVersionCommitment({
      derivedSecretField: input.derivedSecretField,
      contentDigestLo: digest.contentDigestLo,
      contentDigestHi: digest.contentDigestHi,
    });
    return {
      canonicalJsonBytes,
      contentDigest: digest.contentDigest,
      contentDigestBytes: digest.contentDigestBytes,
      contentDigestLo: digest.contentDigestLo,
      contentDigestHi: digest.contentDigestHi,
      versionCommitment,
    };
  } catch (error) {
    wipeBytes(canonicalJsonBytes);
    throw error;
  }
}

// This is intentionally separate from commitment computation so callers can
// run the versionExists preflight before spending compression/proof/encryption
// work, as required by the v1 creation ordering.
export function compressPersonVersionContent(canonicalJsonBytes) {
  const compressedPlaintext = gzipV1(canonicalJsonBytes);
  protocolAssert(
    DFM1_FORMAT_1_OVERHEAD_BYTES + compressedPlaintext.length <= DFM1_MAX_ENVELOPE_BYTES,
    "ENVELOPE_TOO_LARGE",
    `Compressed metadata cannot fit in the ${DFM1_MAX_ENVELOPE_BYTES}-byte envelope limit`,
  );
  return compressedPlaintext;
}

export function wipePreparedPersonVersionContent(prepared) {
  if (!prepared || typeof prepared !== "object") return;
  wipeBytes(prepared.canonicalJsonBytes);
  wipeBytes(prepared.compressedPlaintext);
  wipeBytes(prepared.contentDigestBytes);
}

export async function encryptPersonVersionEnvelope(input) {
  const canonicalJsonBytes = serializeCanonicalPersonVersion(input.metadata);
  let compressedPlaintext;
  try {
    const context = assertMetadataMatchesContext(input.metadata, input.context);
    compressedPlaintext = gzipV1(canonicalJsonBytes);
    protocolAssert(
      DFM1_FORMAT_1_OVERHEAD_BYTES + compressedPlaintext.length <= DFM1_MAX_ENVELOPE_BYTES,
      "ENVELOPE_TOO_LARGE",
      `Compressed metadata cannot fit in the ${DFM1_MAX_ENVELOPE_BYTES}-byte envelope limit`,
    );
    const result = await encryptFormat1Compressed({
      compressedPlaintext,
      rawPassphrase: input.rawPassphrase,
      identitySuiteId: input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
      context,
      randomBytes: input.randomBytes,
    });
    return {
      envelope: result.envelope,
      payloadHash: result.payloadHash,
      formatVersion: result.header.formatVersion,
      identitySuiteId: result.header.identitySuiteId,
      envelopeLength: result.envelope.length,
      canonicalJsonLength: canonicalJsonBytes.length,
      compressedPlaintextLength: result.header.contentCiphertextLength,
    };
  } finally {
    wipeBytes(canonicalJsonBytes);
    wipeBytes(compressedPlaintext);
  }
}

async function decryptValidatedEnvelope(input) {
  const context = normalizeMetadataContext(input.context);
  const decrypted = await decryptFormat1Compressed({
    envelope: input.envelope,
    rawPassphrase: input.rawPassphrase,
    context,
  });
  let canonicalJsonBytes;
  let identityMaterial;
  let digest;
  try {
    canonicalJsonBytes = gunzipV1Strict(decrypted.compressedPlaintext);
    const metadata = parseCanonicalPersonVersion(canonicalJsonBytes);
    assertMetadataMatchesContext(metadata, context);
    identityMaterial = await deriveIdentityMaterial({
      identity: metadata.person,
      rawPassphrase: input.rawPassphrase,
      identitySuiteId: decrypted.header.identitySuiteId,
    });
    protocolAssert(
      identityMaterial.personHash === context.personHash,
      "PERSON_HASH_MISMATCH",
      "Passphrase and plaintext identity do not reproduce the chain personHash",
    );
    digest = computeContentDigest(canonicalJsonBytes);
    const versionCommitment = computeVersionCommitment({
      derivedSecretField: identityMaterial.derivedSecretField,
      contentDigestLo: digest.contentDigestLo,
      contentDigestHi: digest.contentDigestHi,
    });
    protocolAssert(
      versionCommitment === context.versionCommitment,
      "VERSION_COMMITMENT_MISMATCH",
      "Plaintext does not reproduce the chain versionCommitment",
    );
    if (input.expectedCanonicalJsonBytes) {
      protocolAssert(
        equalBytesConstantTime(canonicalJsonBytes, input.expectedCanonicalJsonBytes),
        "ROUND_TRIP_PLAINTEXT_MISMATCH",
        "Production decoder output differs from the expected canonical plaintext",
      );
    }
    return {
      metadata,
      formatVersion: decrypted.header.formatVersion,
      identitySuiteId: decrypted.header.identitySuiteId,
      payloadHash: computePayloadHash(input.envelope),
      versionCommitment,
      metadataUnlockValidated: true,
      protocolGeneration: PROTOCOL_GENERATION,
    };
  } finally {
    wipeBytes(decrypted.compressedPlaintext);
    wipeBytes(canonicalJsonBytes);
    wipeBytes(identityMaterial?.identitySalt);
    wipeBytes(identityMaterial?.derivedSecretBytes);
    wipeBytes(digest?.contentDigestBytes);
  }
}

export async function decryptPersonVersionEnvelope(input) {
  return decryptValidatedEnvelope(input);
}

export async function roundTripPersonVersionEnvelope(input) {
  const expectedCanonicalJsonBytes = serializeCanonicalPersonVersion(input.expectedMetadata);
  try {
    if (input.submitterAndSelfSuiteId !== undefined) {
      const header = parseFormat1Envelope(input.envelope);
      assertSubmitterAndSelfSuiteId({
        submitterAndSelfSuiteId: input.submitterAndSelfSuiteId,
        expectedSubmitter: input.expectedSubmitter,
        expectedSelfSuiteId: header.identitySuiteId,
      });
    }
    return await decryptValidatedEnvelope({
      envelope: input.envelope,
      rawPassphrase: input.rawPassphrase,
      context: input.context,
      expectedCanonicalJsonBytes,
    });
  } finally {
    wipeBytes(expectedCanonicalJsonBytes);
  }
}

export async function decryptPersonVersionRuntime(input) {
  const verified = verifyMetadataRuntimeCode({
    runtimeCode: input.runtimeCode,
    payloadLength: input.payloadLength,
    payloadHash: input.payloadHash,
    requireCommonPrefix: true,
  });
  return decryptValidatedEnvelope({
    envelope: verified.envelope,
    rawPassphrase: input.rawPassphrase,
    context: input.context,
  });
}

export async function readAndDecryptPersonVersion(input) {
  const verified = await readMetadataEnvelopeFromRef({
    getCode: input.getCode,
    pointer: input.pointer,
    payloadLength: input.payloadLength,
    payloadHash: input.payloadHash,
  });
  return decryptValidatedEnvelope({
    envelope: verified.envelope,
    rawPassphrase: input.rawPassphrase,
    context: input.context,
  });
}

export function computePreparedVersionHash(input) {
  return computeVersionHash({
    personHash: input.context.personHash,
    fatherHash: input.context.fatherHash,
    fatherVersionIndex: input.context.fatherVersionIndex,
    motherHash: input.context.motherHash,
    motherVersionIndex: input.context.motherVersionIndex,
    versionCommitment: input.versionCommitment,
  });
}
