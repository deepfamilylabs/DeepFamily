import fs from "node:fs/promises";
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ethers as ethersLib } from "ethers";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const SIG_SUITE_ECDSA_SECP256K1_V1 = 1;
const SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1 = 2;
const SIG_SUITE_PQ_ML_DSA_V1 = 3;

function canonicalize(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("Canonical attestation numbers must be integers");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  throw new Error(`Unsupported canonical attestation value: ${typeof value}`);
}

function normalizeRef(raw) {
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

function assertReferenceMatchesPayload(ref, envelope, payloadDigest) {
  const payload = envelope.payload;
  if (payloadDigest.toLowerCase() !== String(envelope.payloadDigest).toLowerCase()) {
    throw new Error("payloadDigest does not match canonical payload");
  }
  if (payloadDigest.toLowerCase() !== ref.attestationPayloadDigest.toLowerCase()) {
    throw new Error("attestationPayloadDigest does not match chain reference");
  }
  if (
    payload.actionType !== ref.actionType ||
    payload.actionDigest.toLowerCase() !== ref.actionDigest.toLowerCase() ||
    payload.subjectType !== ref.subjectType ||
    payload.subjectHash.toLowerCase() !== ref.subjectHash.toLowerCase() ||
    payload.signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase() ||
    payload.signatureSuiteId !== ref.signatureSuiteId ||
    payload.issuedAt !== ref.issuedAt ||
    payload.expiresAt !== ref.expiresAt ||
    payload.revocationType !== ref.revocationType ||
    payload.revocationRef.toLowerCase() !== ref.revocationRef.toLowerCase()
  ) {
    throw new Error("payload fields do not match chain reference");
  }
}

function verifyEcdsaLeg(ref, payloadDigest, signatureEntry) {
  if (!signatureEntry) throw new Error("missing ECDSA signature");
  if (signatureEntry.signerKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase()) {
    throw new Error("ECDSA signerKeyId does not match chain reference");
  }
  const recovered = ethersLib.verifyMessage(ethersLib.getBytes(payloadDigest), signatureEntry.signature);
  const recoveredKeyId = ethersLib.zeroPadValue(recovered.toLowerCase(), 32);
  if (recoveredKeyId.toLowerCase() !== ref.signerKeyId.toLowerCase()) {
    throw new Error(`ECDSA signer mismatch: recovered ${recovered}`);
  }
  return recovered;
}

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const { deepFamily: defaultDeepFamily } = await ensureIntegratedSystem(connection);
  const deepFamily = args.contract
    ? await ethers.getContractAt("DeepFamily", args.contract)
    : defaultDeepFamily;

  const rawRef = await deepFamily.attestationRefs(args.key);
  const ref = normalizeRef(rawRef);
  if (ref.attestationPayloadDigest === ethers.ZeroHash) {
    throw new Error(`No attestation reference found for key ${args.key}`);
  }

  const envelope = JSON.parse(await fs.readFile(args.envelope, "utf8"));
  const payloadDigest = ethersLib.keccak256(ethersLib.toUtf8Bytes(canonicalize(envelope.payload)));
  assertReferenceMatchesPayload(ref, envelope, payloadDigest);

  if (ref.signatureSuiteId === SIG_SUITE_PQ_ML_DSA_V1) {
    console.log("status: unsupported-for-trust");
    console.log("reason: PQ ML-DSA verification is not implemented in Phase 3 v1");
    return { status: "unsupported-for-trust" };
  }

  if (ref.signatureSuiteId === SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1) {
    const ecdsa = envelope.signatures?.find(
      (entry) => Number(entry.signatureSuiteId) === SIG_SUITE_ECDSA_SECP256K1_V1,
    );
    const pq = envelope.signatures?.find(
      (entry) => Number(entry.signatureSuiteId) === SIG_SUITE_PQ_ML_DSA_V1,
    );
    if (!pq) throw new Error("Hybrid envelope is missing the PQ leg");
    const recovered = verifyEcdsaLeg(ref, payloadDigest, ecdsa);
    console.log("status: partial-ecdsa-only");
    console.log("trust: unsupported-for-trust");
    console.log(`ecdsaRecovered: ${recovered}`);
    return { status: "partial-ecdsa-only", recovered };
  }

  if (ref.signatureSuiteId !== SIG_SUITE_ECDSA_SECP256K1_V1) {
    throw new Error(`Unknown signature suite ${ref.signatureSuiteId}`);
  }

  const ecdsa = envelope.signatures?.find(
    (entry) => Number(entry.signatureSuiteId) === SIG_SUITE_ECDSA_SECP256K1_V1,
  );
  const recovered = verifyEcdsaLeg(ref, payloadDigest, ecdsa);
  console.log("status: signature-verified");
  console.log(`ecdsaRecovered: ${recovered}`);
  return { status: "signature-verified", recovered };
};

export default task("attestation-verify", "Verify an anchored attestation envelope from a local JSON file")
  .addOption({
    name: "key",
    description: "attestationKey bytes32",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "envelope",
    description: "Path to signed attestation envelope JSON",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "contract",
    description: "DeepFamily contract address; defaults to integrated deployment",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
