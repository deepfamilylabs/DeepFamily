import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import {
  ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
  ATTESTATION_REF_VERSION_V1,
  DOMAIN_ATTESTATION_PAYLOAD,
  REVOCATION_TYPE_NONE,
  SIG_SUITE_ECDSA_SECP256K1_V1,
  SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1,
  SIG_SUITE_PQ_ML_DSA_V1,
  SUBJECT_TYPE_VERSION,
  ZERO_REF,
} from "./catalogue";
import { computeAttestationPayloadDigest, computeHighTrustEndorsementActionDigest, computeVersionSubjectHash } from "./digest";
import { deriveAttestationStatus } from "./status";
import { verifySignedAttestationEnvelope } from "./verify";
import type { AttestationRef, CanonicalAttestationPayload, SignedAttestationEnvelope } from "./types";

const wallet = new ethers.Wallet("0x59c6995e998f97a5a004497e5da0391390ddfa41c096f0b7ea1e80f2b5f9b8f1");
const signerKeyId = ethers.zeroPadValue(wallet.address.toLowerCase(), 32);
const personHash = `0x${"11".repeat(32)}`;
const contractAddress = "0x0000000000000000000000000000000000000abc";

function buildPayloadAndRef(signatureSuiteId = SIG_SUITE_ECDSA_SECP256K1_V1) {
  const subjectHash = computeVersionSubjectHash(personHash, 1);
  const actionDigest = computeHighTrustEndorsementActionDigest({
    chainId: 31337,
    contractAddress,
    actor: wallet.address,
    personHash,
    versionIndex: 1,
  });
  const payload: CanonicalAttestationPayload = {
    domain: DOMAIN_ATTESTATION_PAYLOAD,
    schemaVersion: 1,
    actionType: ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
    chainId: 31337,
    contractAddress,
    subjectType: SUBJECT_TYPE_VERSION,
    subjectHash,
    actionDigest,
    issuedAt: 100,
    expiresAt: 200,
    signerKeyId,
    signatureSuiteId,
    revocationType: REVOCATION_TYPE_NONE,
    revocationRef: ZERO_REF,
    nonce: "test",
  };
  const payloadDigest = computeAttestationPayloadDigest(payload);
  const ref: AttestationRef = {
    attestationRefVersion: ATTESTATION_REF_VERSION_V1,
    subjectType: payload.subjectType,
    subjectHash,
    actionType: payload.actionType,
    actionDigest,
    attestationPayloadDigest: payloadDigest,
    signatureSuiteId,
    signerKeyId,
    uri: "ipfs://attestation-test",
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revocationType: payload.revocationType,
    revocationRef: payload.revocationRef,
  };
  return { payload, payloadDigest, ref };
}

describe("attestation verification", () => {
  it("verifies ECDSA payloads against the anchored ref", async () => {
    const { payload, payloadDigest, ref } = buildPayloadAndRef();
    const envelope: SignedAttestationEnvelope = {
      envelopeVersion: 1,
      payload,
      payloadDigest,
      signatures: [
        {
          signatureSuiteId: SIG_SUITE_ECDSA_SECP256K1_V1,
          signerKeyId,
          signature: await wallet.signMessage(ethers.getBytes(payloadDigest)),
        },
      ],
    };

    expect(verifySignedAttestationEnvelope(ref, envelope)).toMatchObject({
      ok: true,
      status: "signature-verified",
      recoveredAddress: wallet.address,
    });
    expect(
      deriveAttestationStatus({
        ref,
        verificationStatus: "signature-verified",
        trustedSignerKeyIds: [signerKeyId],
        now: 150,
      }),
    ).toBe("signer-trusted");
    expect(deriveAttestationStatus({ ref, now: 150 })).toBe("attestation-anchored");
  });

  it("rejects payload/ref time drift", async () => {
    const { payload, payloadDigest, ref } = buildPayloadAndRef();
    const envelope: SignedAttestationEnvelope = {
      envelopeVersion: 1,
      payload,
      payloadDigest,
      signatures: [
        {
          signatureSuiteId: SIG_SUITE_ECDSA_SECP256K1_V1,
          signerKeyId,
          signature: await wallet.signMessage(ethers.getBytes(payloadDigest)),
        },
      ],
    };

    expect(
      verifySignedAttestationEnvelope(
        {
          ...ref,
          expiresAt: ref.expiresAt + 1,
        },
        envelope,
      ),
    ).toMatchObject({ ok: false, status: "reference-payload-mismatch" });
  });

  it("keeps hybrid verification partial and unsupported for trust", async () => {
    const { payload, payloadDigest, ref } = buildPayloadAndRef(SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1);
    const envelope: SignedAttestationEnvelope = {
      envelopeVersion: 1,
      payload,
      payloadDigest,
      signatures: [
        {
          signatureSuiteId: SIG_SUITE_ECDSA_SECP256K1_V1,
          signerKeyId,
          signature: await wallet.signMessage(ethers.getBytes(payloadDigest)),
        },
        {
          signatureSuiteId: SIG_SUITE_PQ_ML_DSA_V1,
          signerKeyId,
          signature: "0xpq-placeholder",
        },
      ],
    };

    const result = verifySignedAttestationEnvelope(ref, envelope);
    expect(result).toMatchObject({ ok: true, status: "partial-ecdsa-only" });
    expect(
      deriveAttestationStatus({
        ref,
        verificationStatus: result.status,
        trustedSignerKeyIds: [signerKeyId],
        now: 150,
      }),
    ).toBe("partial-ecdsa-only");
  });

  it("does not treat PQ-only envelopes as verified in v1", () => {
    const { payload, payloadDigest, ref } = buildPayloadAndRef(SIG_SUITE_PQ_ML_DSA_V1);
    expect(
      verifySignedAttestationEnvelope(ref, {
        envelopeVersion: 1,
        payload,
        payloadDigest,
        signatures: [
          {
            signatureSuiteId: SIG_SUITE_PQ_ML_DSA_V1,
            signerKeyId,
            signature: "0xpq-placeholder",
          },
        ],
      }),
    ).toMatchObject({ ok: false, status: "unsupported-signature-suite" });
  });
});
