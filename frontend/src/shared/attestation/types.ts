export type Hex32 = `0x${string}`;

export type AttestationRef = {
  attestationRefVersion: number;
  subjectType: number;
  subjectHash: string;
  actionType: number;
  actionDigest: string;
  attestationPayloadDigest: string;
  signatureSuiteId: number;
  signerKeyId: string;
  uri: string;
  issuedAt: number;
  expiresAt: number;
  revocationType: number;
  revocationRef: string;
};

export type CanonicalAttestationPayload = {
  domain: "DeepFamily.Attestation.V1";
  schemaVersion: number;
  actionType: number;
  chainId: number;
  contractAddress: string;
  subjectType: number;
  subjectHash: string;
  actionDigest: string;
  issuedAt: number;
  expiresAt: number;
  signerKeyId: string;
  signatureSuiteId: number;
  revocationType: number;
  revocationRef: string;
  nonce?: string;
  action?: Record<string, unknown>;
};

export type AttestationSignature = {
  signatureSuiteId: number;
  signerKeyId: string;
  signature: string;
  ecdsaAddress?: string;
  publicKeyRef?: string;
  pqSignature?: string;
};

export type SignedAttestationEnvelope = {
  envelopeVersion: 1;
  payload: CanonicalAttestationPayload;
  payloadDigest: string;
  signatures: AttestationSignature[];
};

export type AttestationVerificationStatus =
  | "no-attestation"
  | "attestation-anchored"
  | "reference-accepted"
  | "payload-available"
  | "signature-verified"
  | "signer-trusted"
  | "partial-ecdsa-only"
  | "unsupported-for-trust"
  | "unsupported-signature-suite"
  | "unknown-signature-suite"
  | "signer-key-mismatch"
  | "action-digest-mismatch"
  | "payload-digest-mismatch"
  | "expired"
  | "revoked";
