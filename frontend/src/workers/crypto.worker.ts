import { computeIdentityHash } from "../shared/crypto/identityHash";
import type { IdentityHashInput } from "../shared/crypto/identityHash";
import {
  deriveKeyFromPersonData,
  type KeyPurpose,
  type KDFPreset,
} from "../shared/crypto/secureKeyDerivation";
import {
  bytesToHex,
  computePersonVersionContentCommitment,
  decryptPersonVersionEnvelope,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  roundTripPersonVersionEnvelope,
  wipeBytes,
  wipePreparedPersonVersionContent,
  type IdentityFields,
  type MetadataContextInput,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import type {
  EncryptedPersonVersionEnvelopeV1Result,
  IdentityMaterialV1Result,
  PreparedPersonVersionContentV1Result,
  ValidatedPersonVersionV1Result,
} from "../shared/workers/cryptoWorkerClient";

type CryptoWorkerMethods = {
  computeIdentityHash: {
    params: { input: IdentityHashInput };
    result: { identityHash: string };
  };
  deriveKey: {
    params: { input: IdentityHashInput; purpose?: KeyPurpose; preset?: KDFPreset };
    result: {
      key: string;
      address?: string;
      timestamp: number;
      kdfParams: { N: number; r: number; p: number };
      purpose: string;
    };
  };
  deriveIdentityMaterialV1: {
    params: {
      identity: IdentityFields;
      rawPassphrase: string;
      identitySuiteId?: number | string | bigint;
    };
    result: IdentityMaterialV1Result;
  };
  preparePersonVersionContentV1: {
    params: {
      metadata: PersonVersionMetadataInput;
      derivedSecretField: number | string | bigint;
    };
    result: PreparedPersonVersionContentV1Result;
  };
  encryptPersonVersionEnvelopeV1: {
    params: {
      metadata: PersonVersionMetadataInput;
      rawPassphrase: string;
      identitySuiteId?: number | string | bigint;
      context: MetadataContextInput;
    };
    result: EncryptedPersonVersionEnvelopeV1Result;
  };
  roundTripPersonVersionEnvelopeV1: {
    params: {
      envelopeHex: string;
      rawPassphrase: string;
      context: MetadataContextInput;
      expectedMetadata: PersonVersionMetadataInput;
      submitterAndSelfSuiteId?: number | string | bigint;
      expectedSubmitter?: string;
    };
    result: ValidatedPersonVersionV1Result;
  };
  decryptPersonVersionEnvelopeV1: {
    params: {
      envelopeHex: string;
      rawPassphrase: string;
      context: MetadataContextInput;
    };
    result: ValidatedPersonVersionV1Result;
  };
};

type CryptoWorkerRequest = {
  id: number;
  method: keyof CryptoWorkerMethods;
  params: any;
};

type CryptoWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string; code?: string } };

const getErrorShape = (err: unknown): { message: string; name?: string; code?: string } => {
  if (err && typeof err === "object") {
    const anyErr = err as any;
    if (typeof anyErr.message === "string")
      return {
        message: anyErr.message,
        name: typeof anyErr.name === "string" ? anyErr.name : undefined,
        code: typeof anyErr.code === "string" ? anyErr.code : undefined,
      };
  }
  return { message: String(err) };
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

const handlers: {
  [K in keyof CryptoWorkerMethods]: (
    params: CryptoWorkerMethods[K]["params"],
  ) => Promise<CryptoWorkerMethods[K]["result"]> | CryptoWorkerMethods[K]["result"];
} = {
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
  encryptPersonVersionEnvelopeV1: async ({
    metadata,
    rawPassphrase,
    identitySuiteId,
    context,
  }) => {
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

self.addEventListener("message", async (event: MessageEvent<CryptoWorkerRequest>) => {
  let request = event.data || ({} as any);
  const { id, method } = request;
  const post = (resp: CryptoWorkerResponse) => {
    (self as any).postMessage(resp);
  };
  try {
    const handler = (handlers as any)[method];
    if (typeof id !== "number" || !method || typeof handler !== "function") {
      post({ id, ok: false, error: { message: "Invalid crypto worker request" } });
      return;
    }
    const result = await handler(request.params);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: getErrorShape(err) });
  } finally {
    // Never retain a request object (and especially its passphrase string)
    // across worker jobs. JavaScript strings cannot be zeroed, so lifetime is
    // bounded to this message handler and cancellation terminates the realm.
    if (request && typeof request === "object") request.params = undefined;
    request = undefined as any;
  }
});
