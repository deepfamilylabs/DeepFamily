import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  asUint8Array,
  normalizePassphrase,
  parseCanonicalPersonVersion,
} from "@deepfamily/protocol-core";
import { describe, expect, it, vi } from "vitest";
import {
  cryptoWorkerHandlers,
  handleCryptoWorkerRequest,
  serializeCryptoWorkerError,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from "./cryptoWorkerHandlers";

const vectorPath = fileURLToPath(
  new URL("../../../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const vector = JSON.parse(fs.readFileSync(vectorPath, "utf8")) as any;
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
const jsonMetadata = JSON.parse(vector.metadata.canonicalJsonUtf8);

describe("production crypto worker handlers", () => {
  it("runs the committed golden vector through the real fresh-v1 handler boundary", async () => {
    const material = await cryptoWorkerHandlers.deriveIdentityMaterialV1({
      identity,
      rawPassphrase: vector.identity.rawPassphrase,
      identitySuiteId: vector.identity.identitySuiteId,
    });
    expect(material).toEqual({
      identitySuiteId: vector.identity.identitySuiteId,
      identity: {
        ...identity,
        fullName: vector.identity.canonicalFullName,
      },
      derivedSecretField: vector.identity.derivedSecretField,
      nameField: vector.identity.nameField,
      packedBirthGenderField: vector.identity.packedBirthGenderField,
      suiteCommitment: vector.identity.suiteCommitment,
      nameSecretCommitment: vector.identity.nameSecretCommitment,
      identityCommitment: vector.identity.identityCommitment,
      personHash: vector.identity.personHash,
    });
    expect(material).not.toHaveProperty("identitySalt");
    expect(material).not.toHaveProperty("derivedSecretBytes");

    const prepared = await cryptoWorkerHandlers.preparePersonVersionContentV1({
      metadata,
      derivedSecretField: material.derivedSecretField,
    });
    expect(prepared).toEqual({
      canonicalJsonLength: (vector.metadata.canonicalJsonHex.length - 2) / 2,
      contentDigestLo: vector.metadata.contentDigestLo,
      contentDigestHi: vector.metadata.contentDigestHi,
      versionCommitment: vector.metadata.versionCommitment,
    });
    expect(prepared).not.toHaveProperty("canonicalJsonBytes");
    expect(prepared).not.toHaveProperty("contentDigest");

    const size = await cryptoWorkerHandlers.preflightPersonVersionEnvelopeSizeV1({ metadata });
    expect(size).toEqual({
      canonicalJsonLength: (vector.metadata.canonicalJsonHex.length - 2) / 2,
      compressedPlaintextLength: (vector.metadata.gzipHex.length - 2) / 2,
      envelopeLength: vector.envelope.payloadLength,
    });

    const committedRoundTrip = await cryptoWorkerHandlers.roundTripPersonVersionEnvelopeV1({
      envelopeHex: vector.envelope.envelopeHex,
      rawPassphrase: vector.identity.rawPassphrase,
      context,
      expectedMetadata: metadata,
      submitterAndSelfSuiteId: vector.context.submitterAndSelfSuiteId,
      expectedSubmitter: vector.context.submitter,
    });
    expect(committedRoundTrip).toMatchObject({
      metadata: jsonMetadata,
      formatVersion: 1,
      identitySuiteId: 1,
      payloadHash: vector.envelope.payloadHash,
      versionCommitment: vector.metadata.versionCommitment,
      metadataUnlockValidated: true,
    });

    const encrypted = await cryptoWorkerHandlers.encryptPersonVersionEnvelopeV1({
      metadata,
      rawPassphrase: vector.identity.rawPassphrase,
      identitySuiteId: vector.identity.identitySuiteId,
      context,
    });
    expect(encrypted).toMatchObject({
      formatVersion: 1,
      identitySuiteId: 1,
      envelopeLength: vector.envelope.payloadLength,
      canonicalJsonLength: size.canonicalJsonLength,
      compressedPlaintextLength: size.compressedPlaintextLength,
    });
    expect(encrypted.envelopeHex).toMatch(/^0x44464d31[0-9a-f]+$/);
    expect(encrypted.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(encrypted).not.toHaveProperty("fileSalt");
    expect(encrypted).not.toHaveProperty("kek");
    expect(encrypted).not.toHaveProperty("dek");

    const decrypted = await cryptoWorkerHandlers.decryptPersonVersionEnvelopeV1({
      envelopeHex: encrypted.envelopeHex,
      rawPassphrase: vector.identity.rawPassphrase,
      context,
    });
    expect(decrypted).toMatchObject({
      metadata: jsonMetadata,
      formatVersion: 1,
      identitySuiteId: 1,
      payloadHash: encrypted.payloadHash,
      versionCommitment: vector.metadata.versionCommitment,
      metadataUnlockValidated: true,
      protocolGeneration: committedRoundTrip.protocolGeneration,
    });
    expect(decrypted).not.toHaveProperty("derivedSecretField");
    expect(decrypted).not.toHaveProperty("contentDigest");
  });

  it("uses NFKD without trimming on both real identity and file KDF paths", async () => {
    const rawPassphrase = "  caf\u00e9  ";
    const normalizedPassphrase = rawPassphrase.normalize("NFKD");
    const material = await cryptoWorkerHandlers.deriveIdentityMaterialV1({
      identity,
      rawPassphrase,
      identitySuiteId: 1,
    });
    const protectedMetadata = structuredClone(metadata);
    protectedMetadata.person.personHash = material.personHash;
    const prepared = await cryptoWorkerHandlers.preparePersonVersionContentV1({
      metadata: protectedMetadata,
      derivedSecretField: material.derivedSecretField,
    });
    const protectedContext = {
      ...context,
      personHash: material.personHash,
      versionCommitment: BigInt(prepared.versionCommitment),
    };
    const encrypted = await cryptoWorkerHandlers.encryptPersonVersionEnvelopeV1({
      metadata: protectedMetadata,
      rawPassphrase,
      identitySuiteId: 1,
      context: protectedContext,
    });

    await expect(
      cryptoWorkerHandlers.decryptPersonVersionEnvelopeV1({
        envelopeHex: encrypted.envelopeHex,
        rawPassphrase: normalizedPassphrase,
        context: protectedContext,
      }),
    ).resolves.toMatchObject({
      metadata: { person: { personHash: material.personHash } },
      versionCommitment: prepared.versionCommitment,
      metadataUnlockValidated: true,
    });
    await expect(
      cryptoWorkerHandlers.decryptPersonVersionEnvelopeV1({
        envelopeHex: encrypted.envelopeHex,
        rawPassphrase: normalizedPassphrase.trim(),
        context: protectedContext,
      }),
    ).rejects.toMatchObject({ code: "AES_GCM_AUTHENTICATION_FAILED" });
  });

  it("dispatches the real handler, serializes failures, and clears each Worker request", async () => {
    const responses: CryptoWorkerResponse[] = [];
    const successRequest: CryptoWorkerRequest = {
      id: 41,
      method: "preparePersonVersionContentV1",
      params: {
        metadata,
        derivedSecretField: vector.identity.derivedSecretField,
      },
    };
    await handleCryptoWorkerRequest(successRequest, (response) => responses.push(response));
    expect(successRequest.params).toBeUndefined();
    expect(responses[0]).toEqual({
      id: 41,
      ok: true,
      result: {
        canonicalJsonLength: (vector.metadata.canonicalJsonHex.length - 2) / 2,
        contentDigestLo: vector.metadata.contentDigestLo,
        contentDigestHi: vector.metadata.contentDigestHi,
        versionCommitment: vector.metadata.versionCommitment,
      },
    });

    const rawPassphrase = "worker-error-passphrase-\u00e9-sentinel";
    const failureRequest: CryptoWorkerRequest = {
      id: 42,
      method: "deriveIdentityMaterialV1",
      params: { identity, rawPassphrase, identitySuiteId: 999 },
    };
    await handleCryptoWorkerRequest(failureRequest, (response) => responses.push(response));
    expect(failureRequest.params).toBeUndefined();
    expect(responses[1]).toMatchObject({
      id: 42,
      ok: false,
      error: {
        name: "UnsupportedProtocolError",
        code: "UNSUPPORTED_IDENTITY_SUITE",
      },
    });
    expect(JSON.stringify(responses)).not.toContain(rawPassphrase);
    expect(
      serializeCryptoWorkerError(
        Object.assign(new Error(`failed for ${rawPassphrase.normalize("NFKD")}`), {
          code: "KDF_FAILED",
        }),
        rawPassphrase,
      ),
    ).toMatchObject({ message: "failed for [REDACTED]", code: "KDF_FAILED" });
  });

  it("redacts nested shared-identity passphrases from Worker errors", async () => {
    const rawPassphrase = "nested-worker-passphrase-\u00e9-sentinel";
    const deriveKey = vi.spyOn(cryptoWorkerHandlers, "deriveKey").mockRejectedValueOnce(
      Object.assign(new Error(`derive failed for ${rawPassphrase.normalize("NFKD")}`), {
        code: "KDF_FAILED",
      }),
    );
    const request: CryptoWorkerRequest = {
      id: 43,
      method: "deriveKey",
      params: {
        input: { ...identity, passphrase: rawPassphrase },
        purpose: "PRIVATE_KEY",
        preset: "FAST",
      },
    };
    const responses: CryptoWorkerResponse[] = [];

    await handleCryptoWorkerRequest(request, (response) => responses.push(response));

    expect(request.params).toBeUndefined();
    expect(responses[0]).toMatchObject({
      id: 43,
      ok: false,
      error: { message: "derive failed for [REDACTED]", code: "KDF_FAILED" },
    });
    expect(JSON.stringify(responses)).not.toContain(rawPassphrase);
    expect(JSON.stringify(responses)).not.toContain(rawPassphrase.normalize("NFKD"));
    deriveKey.mockRestore();
  });

  it("redacts Unicode 17 protocol-normalized secrets even when host ICU differs", async () => {
    const rawPassphrase = "\ua7f1-worker-secret";
    const normalizedPassphrase = normalizePassphrase(rawPassphrase);
    expect(normalizedPassphrase).toBe("S-worker-secret");
    const deriveKey = vi
      .spyOn(cryptoWorkerHandlers, "deriveKey")
      .mockRejectedValueOnce(new Error(`derive failed for ${normalizedPassphrase}`));
    const request: CryptoWorkerRequest = {
      id: 44,
      method: "deriveKey",
      params: {
        input: { ...identity, passphrase: rawPassphrase },
        purpose: "PRIVATE_KEY",
        preset: "FAST",
      },
    };
    const responses: CryptoWorkerResponse[] = [];

    await handleCryptoWorkerRequest(request, (response) => responses.push(response));

    expect(responses[0]).toMatchObject({
      id: 44,
      ok: false,
      error: { message: "derive failed for [REDACTED]" },
    });
    expect(JSON.stringify(responses)).not.toContain(rawPassphrase);
    expect(JSON.stringify(responses)).not.toContain(normalizedPassphrase);
    deriveKey.mockRestore();
  });
});
