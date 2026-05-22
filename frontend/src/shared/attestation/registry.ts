import { ZERO_REF } from "./catalogue";
import type { AttestationRef } from "./types";

export function normalizeRegistryAttestationRef(raw: any): AttestationRef {
  return {
    attestationRefVersion: Number(raw.attestationRefVersion),
    subjectType: Number(raw.subjectType),
    subjectHash: raw.subjectHash,
    actionType: Number(raw.actionType),
    actionDigest: raw.actionDigest,
    attestationPayloadDigest: raw.attestationPayloadDigest,
    signatureSuiteId: Number(raw.signatureSuiteId),
    signerKeyId: raw.signerKeyId,
    uri: raw.uri,
    issuedAt: Number(raw.issuedAt),
    expiresAt: Number(raw.expiresAt),
    revocationType: Number(raw.revocationType),
    revocationRef: raw.revocationRef,
  };
}

export async function readAnchoredAttestationRef(
  registry: any,
  attestationKey: string,
): Promise<AttestationRef | null> {
  if (typeof registry?.attestationRefs !== "function") {
    throw new Error("Attestation registry contract is required");
  }

  if (typeof registry.attestationRefExists === "function") {
    const exists = await registry.attestationRefExists(attestationKey);
    if (!exists) return null;
  }

  const ref = normalizeRegistryAttestationRef(await registry.attestationRefs(attestationKey));
  return ref.attestationPayloadDigest.toLowerCase() === ZERO_REF.toLowerCase() ? null : ref;
}
