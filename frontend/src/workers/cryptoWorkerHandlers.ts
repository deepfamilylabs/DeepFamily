import {
  bytesToHex,
  computePersonVersionContentCommitment,
  decryptPersonVersionEnvelope,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  roundTripPersonVersionEnvelope,
  wipeBytes,
  wipePreparedPersonVersionContent,
} from "@deepfamily/protocol-core";
import { computeIdentityHash } from "../shared/crypto/identityHash";
import { deriveKeyFromPersonData } from "../shared/crypto/secureKeyDerivation";
import { preflightPersonVersionEnvelopeSizeV1 } from "../shared/metadata/personVersionEnvelopePreflight";
import type {
  CryptoWorkerCallMap,
  ValidatedPersonVersionV1Result,
} from "../shared/workers/cryptoWorkerClient";

export type CryptoWorkerHandlerMap = {
  [K in keyof CryptoWorkerCallMap]: (
    params: CryptoWorkerCallMap[K]["params"],
  ) => Promise<CryptoWorkerCallMap[K]["result"]> | CryptoWorkerCallMap[K]["result"];
};

export type CryptoWorkerRequest = {
  id: number;
  method: keyof CryptoWorkerCallMap;
  params: any;
};

export type CryptoWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string; code?: string } };

const redactPassphrase = (message: string, rawPassphrase: unknown): string => {
  if (typeof rawPassphrase !== "string" || rawPassphrase.length === 0) return message;
  const candidates = new Set([rawPassphrase, rawPassphrase.normalize("NFKD")]);
  let redacted = message;
  for (const candidate of candidates) {
    if (candidate.length > 0) redacted = redacted.split(candidate).join("[REDACTED]");
  }
  return redacted;
};

export const serializeCryptoWorkerError = (
  error: unknown,
  rawPassphrase?: unknown,
): { message: string; name?: string; code?: string } => {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return {
        message: redactPassphrase(record.message, rawPassphrase),
        name: typeof record.name === "string" ? record.name : undefined,
        code: typeof record.code === "string" ? record.code : undefined,
      };
    }
  }
  return { message: redactPassphrase(String(error), rawPassphrase) };
};

const serializeValidatedPersonVersion = (result: {
  metadata: any;
  formatVersion: 1;
  identitySuiteId: number;
  payloadHash: string;
  versionCommitment: bigint;
  metadataUnlockValidated: true;
  protocolGeneration: string;
}): ValidatedPersonVersionV1Result => {
  const serializeParent = (parent: any) =>
    parent === null ? null : { ...parent, versionIndex: parent.versionIndex.toString() };
  return {
    metadata: {
      ...result.metadata,
      person: { ...result.metadata.person },
      parents: {
        father: serializeParent(result.metadata.parents.father),
        mother: serializeParent(result.metadata.parents.mother),
      },
    },
    formatVersion: result.formatVersion,
    identitySuiteId: result.identitySuiteId,
    payloadHash: result.payloadHash,
    versionCommitment: result.versionCommitment.toString(),
    metadataUnlockValidated: true,
    protocolGeneration: result.protocolGeneration,
  };
};

/**
 * Production worker methods kept in a side-effect-free module so the exact
 * client/worker contract and serialization boundary can be exercised without
 * substituting UI mocks or a fake Worker implementation.
 */
export const cryptoWorkerHandlers: CryptoWorkerHandlerMap = {
  computeIdentityHash: async ({ input }) => {
    return { identityHash: await computeIdentityHash(input) };
  },
  deriveKey: async ({ input, purpose, preset }) => {
    return await deriveKeyFromPersonData(input, purpose ?? "PRIVATE_KEY", preset ?? "BALANCED");
  },
  deriveIdentityMaterialV1: async ({ identity, rawPassphrase, identitySuiteId }) => {
    let material;
    try {
      material = await deriveIdentityMaterial({ identity, rawPassphrase, identitySuiteId });
      return {
        identitySuiteId: material.identitySuiteId,
        identity: material.identity,
        derivedSecretField: material.derivedSecretField.toString(),
        nameField: material.nameField.toString(),
        packedBirthGenderField: material.packedBirthGenderField.toString(),
        suiteCommitment: material.suiteCommitment.toString(),
        nameSecretCommitment: material.nameSecretCommitment.toString(),
        identityCommitment: material.identityCommitment.toString(),
        personHash: material.personHash,
      };
    } finally {
      wipeBytes(material?.identitySalt);
      wipeBytes(material?.derivedSecretBytes);
    }
  },
  preparePersonVersionContentV1: ({ metadata, derivedSecretField }) => {
    const prepared = computePersonVersionContentCommitment({ metadata, derivedSecretField });
    try {
      return {
        canonicalJsonLength: prepared.canonicalJsonBytes.length,
        contentDigestLo: prepared.contentDigestLo.toString(),
        contentDigestHi: prepared.contentDigestHi.toString(),
        versionCommitment: prepared.versionCommitment.toString(),
      };
    } finally {
      wipePreparedPersonVersionContent(prepared);
    }
  },
  preflightPersonVersionEnvelopeSizeV1: ({ metadata }) =>
    preflightPersonVersionEnvelopeSizeV1(metadata),
  encryptPersonVersionEnvelopeV1: async ({ metadata, rawPassphrase, identitySuiteId, context }) => {
    const encrypted = await encryptPersonVersionEnvelope({
      metadata,
      rawPassphrase,
      identitySuiteId,
      context,
    });
    try {
      return {
        envelopeHex: bytesToHex(encrypted.envelope),
        payloadHash: encrypted.payloadHash,
        formatVersion: encrypted.formatVersion,
        identitySuiteId: encrypted.identitySuiteId,
        envelopeLength: encrypted.envelopeLength,
        canonicalJsonLength: encrypted.canonicalJsonLength,
        compressedPlaintextLength: encrypted.compressedPlaintextLength,
      };
    } finally {
      // The envelope is public, but the worker has no reason to retain its
      // binary working copy after returning the serialized result.
      wipeBytes(encrypted.envelope);
    }
  },
  roundTripPersonVersionEnvelopeV1: async ({
    envelopeHex,
    rawPassphrase,
    context,
    expectedMetadata,
    submitterAndSelfSuiteId,
    expectedSubmitter,
  }) =>
    serializeValidatedPersonVersion(
      await roundTripPersonVersionEnvelope({
        envelope: envelopeHex,
        rawPassphrase,
        context,
        expectedMetadata,
        submitterAndSelfSuiteId,
        expectedSubmitter,
      }),
    ),
  decryptPersonVersionEnvelopeV1: async ({ envelopeHex, rawPassphrase, context }) =>
    serializeValidatedPersonVersion(
      await decryptPersonVersionEnvelope({ envelope: envelopeHex, rawPassphrase, context }),
    ),
};

/** Handles one production Worker message and drops its secret-bearing params. */
export async function handleCryptoWorkerRequest(
  eventData: CryptoWorkerRequest | null | undefined,
  post: (response: CryptoWorkerResponse) => void,
): Promise<void> {
  let request = eventData || ({} as CryptoWorkerRequest);
  const { id, method } = request;
  try {
    const handler = (cryptoWorkerHandlers as any)[method];
    if (typeof id !== "number" || !method || typeof handler !== "function") {
      post({ id, ok: false, error: { message: "Invalid crypto worker request" } });
      return;
    }
    const result = await handler(request.params);
    post({ id, ok: true, result });
  } catch (error) {
    post({
      id,
      ok: false,
      error: serializeCryptoWorkerError(error, request.params?.rawPassphrase),
    });
  } finally {
    // JavaScript strings cannot be zeroed. Bound the structured-clone lifetime
    // to this one job; cancellation additionally terminates the whole realm.
    if (request && typeof request === "object") request.params = undefined;
    request = undefined as any;
  }
}
