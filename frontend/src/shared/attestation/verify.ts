import { ethers } from "ethers";
import {
  SIG_SUITE_ECDSA_SECP256K1_V1,
  SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1,
  SIG_SUITE_PQ_ML_DSA_V1,
} from "./catalogue";
import { computeAttestationPayloadDigest } from "./digest";
import type { AttestationRef, SignedAttestationEnvelope } from "./types";

export type VerifyEnvelopeResult = {
  ok: boolean;
  status: string;
  recoveredAddress?: string;
};

export function verifySignedAttestationEnvelope(
  ref: AttestationRef,
  envelope: SignedAttestationEnvelope,
): VerifyEnvelopeResult {
  const payloadDigest = computeAttestationPayloadDigest(envelope.payload);
  if (payloadDigest.toLowerCase() !== envelope.payloadDigest.toLowerCase()) {
    return { ok: false, status: "payload-digest-mismatch" };
  }
  if (payloadDigest.toLowerCase() !== ref.attestationPayloadDigest.toLowerCase()) {
    return { ok: false, status: "attestation-payload-digest-mismatch" };
  }
  if (envelope.payload.actionDigest.toLowerCase() !== ref.actionDigest.toLowerCase()) {
    return { ok: false, status: "action-digest-mismatch" };
  }
  if (
    envelope.payload.actionType !== ref.actionType ||
    envelope.payload.subjectType !== ref.subjectType ||
    envelope.payload.subjectHash.toLowerCase() !== ref.subjectHash.toLowerCase() ||
    envelope.payload.signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase() ||
    envelope.payload.signatureSuiteId !== ref.signatureSuiteId ||
    envelope.payload.issuedAt !== ref.issuedAt ||
    envelope.payload.expiresAt !== ref.expiresAt ||
    envelope.payload.revocationType !== ref.revocationType ||
    envelope.payload.revocationRef.toLowerCase() !== ref.revocationRef.toLowerCase()
  ) {
    return { ok: false, status: "reference-payload-mismatch" };
  }

  if (ref.signatureSuiteId === SIG_SUITE_PQ_ML_DSA_V1) {
    return { ok: false, status: "unsupported-signature-suite" };
  }

  if (ref.signatureSuiteId === SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1) {
    const ecdsa = envelope.signatures.find((entry) => entry.signatureSuiteId === SIG_SUITE_ECDSA_SECP256K1_V1);
    const pq = envelope.signatures.find((entry) => entry.signatureSuiteId === SIG_SUITE_PQ_ML_DSA_V1);
    if (!ecdsa || !pq) return { ok: false, status: "hybrid-envelope-incomplete" };
    if (ecdsa.signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase()) {
      return { ok: false, status: "signer-key-mismatch" };
    }
    const ecdsaResult = verifyEcdsaPayloadDigest(ref, payloadDigest, ecdsa.signature);
    if (!ecdsaResult.ok) return ecdsaResult;
    return { ok: true, status: "partial-ecdsa-only", recoveredAddress: ecdsaResult.recoveredAddress };
  }

  if (ref.signatureSuiteId !== SIG_SUITE_ECDSA_SECP256K1_V1) {
    return { ok: false, status: "unknown-signature-suite" };
  }

  const ecdsa = envelope.signatures.find((entry) => entry.signatureSuiteId === SIG_SUITE_ECDSA_SECP256K1_V1);
  if (!ecdsa) return { ok: false, status: "signature-missing" };
  if (ecdsa.signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase()) {
    return { ok: false, status: "signer-key-mismatch" };
  }
  return verifyEcdsaPayloadDigest(ref, payloadDigest, ecdsa.signature);
}

function verifyEcdsaPayloadDigest(
  ref: AttestationRef,
  payloadDigest: string,
  signature: string,
): VerifyEnvelopeResult {
  try {
    const recoveredAddress = ethers.verifyMessage(ethers.getBytes(payloadDigest), signature);
    const signerKeyId = ethers.zeroPadValue(recoveredAddress.toLowerCase(), 32);
    if (signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase()) {
      return { ok: false, status: "signer-key-mismatch", recoveredAddress };
    }
    return { ok: true, status: "signature-verified", recoveredAddress };
  } catch {
    return { ok: false, status: "signature-verification-failed" };
  }
}
