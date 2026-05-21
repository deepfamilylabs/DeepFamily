import type { AttestationRef, AttestationVerificationStatus } from "./types";

export function deriveAttestationStatus(input: {
  ref?: AttestationRef | null;
  verificationStatus?: string | null;
  trustedSignerKeyIds?: string[];
  now?: number;
}): AttestationVerificationStatus {
  if (!input.ref) return "no-attestation";
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (input.ref.expiresAt !== 0 && input.ref.expiresAt < now) return "expired";
  if (!input.verificationStatus) return "attestation-anchored";
  if (input.verificationStatus === "partial-ecdsa-only") return "partial-ecdsa-only";
  if (input.verificationStatus === "unsupported-signature-suite") return "unsupported-signature-suite";
  if (input.verificationStatus === "unknown-signature-suite") return "unknown-signature-suite";
  if (input.verificationStatus !== "signature-verified") {
    return input.verificationStatus as AttestationVerificationStatus;
  }
  const trusted = (input.trustedSignerKeyIds ?? []).some(
    (key) => key.toLowerCase() === input.ref?.signerKeyId.toLowerCase(),
  );
  return trusted ? "signer-trusted" : "signature-verified";
}
