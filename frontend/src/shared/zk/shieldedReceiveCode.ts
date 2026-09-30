import {
  IDENTITY_SUITE_CANDIDATE_1,
  buildShieldedReceiveCodePublicSignals,
  canonicalizeFullName,
  computeIdentityFromDerivedSecret,
  decodeShieldedReceiveCode,
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedReceiveCode,
  wipeBytes,
  wrapIdentityCommitmentAsPersonHash,
  type IdentityFields,
} from "@deepfamily/protocol-core";
import { hexlify } from "ethers";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";
import { classifyProtocolPassphraseRisk } from "../crypto/passphraseStrength";
import { generateShieldedProof, SHIELDED_RECEIVE_CODE_VERIFICATION_KEY } from "./shieldedZk";

/** The identity material a receive-code proof needs; it stays inside the ZK worker. */
export type ShieldedReceiveCodeIdentity = {
  identity: IdentityFields;
  identitySuiteId: number;
  derivedSecretField: string | bigint;
};

export type ShieldedReceiveCodeCheck =
  | {
      ok: true;
      identityCommitment: string;
      ownerCommitment: string;
      viewingKey: string;
      personHash: string;
    }
  | { ok: false; reason: "malformed" | "invalid" };

/** Derive the payment keys and prove that this identity chose them. */
export async function createShieldedReceiveCode(input: ShieldedReceiveCodeIdentity) {
  const material = computeIdentityFromDerivedSecret(input);
  const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const publicSignals = buildShieldedReceiveCodePublicSignals({
    identityCommitment: material.identityCommitment,
    ownerCommitment: keys.ownerCommitment,
    viewingKey,
  });
  const { proof } = await generateShieldedProof({
    circuit: "receiveCode",
    witness: {
      identityCommitment: publicSignals[0].toString(),
      ownerCommitment: publicSignals[1].toString(),
      viewKeyLo: publicSignals[2].toString(),
      viewKeyHi: publicSignals[3].toString(),
      nameField: material.nameField.toString(),
      derivedSecretField: material.derivedSecretField.toString(),
      isBirthBC: Number(material.identity.isBirthBC),
      birthYear: material.identity.birthYear,
      birthMonth: material.identity.birthMonth,
      birthDay: material.identity.birthDay,
      gender: material.identity.gender,
      suiteId: material.identitySuiteId,
    },
    expectedPublicSignals: publicSignals.map(String),
  });
  return {
    code: encodeShieldedReceiveCode({
      identityCommitment: material.identityCommitment,
      ownerCommitment: keys.ownerCommitment,
      viewingKey,
      proof,
    }),
    personHash: material.personHash,
  };
}

/**
 * Create another person's receive code from their identity details and passphrase. The
 * derived secret never leaves this worker; the caller receives only the shareable code.
 */
export async function createShieldedReceiveCodeFromCredentials(input: {
  identity: IdentityFields;
  rawPassphrase: string;
}) {
  if (classifyProtocolPassphraseRisk(input.rawPassphrase) === "disallowed") {
    throw new Error("Recipient passphrase is disallowed");
  }
  let material;
  try {
    material = await deriveIdentityMaterial({
      identity: { ...input.identity, fullName: canonicalizeFullName(input.identity.fullName) },
      rawPassphrase: input.rawPassphrase,
      identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
    });
    return await createShieldedReceiveCode(material);
  } catch (cause) {
    // Keep the passphrase out of messages that return to the page.
    const message = cause instanceof Error ? cause.message : "";
    throw new Error(
      message && !message.includes(input.rawPassphrase)
        ? message
        : "Receive code could not be created",
    );
  } finally {
    wipeBytes(material?.identitySalt);
    wipeBytes(material?.derivedSecretBytes);
  }
}

/**
 * snarkjs only checks that proof points lie on the curve. A BN254 G2 point must also lie in
 * the prime-order subgroup, as the EVM pairing precompile requires.
 */
export async function isInG2Subgroup(pi_b: readonly (readonly string[])[]) {
  const curve = await snarkjs.curves.getCurveFromName("bn128");
  const point = curve.G2.fromObject([
    [BigInt(pi_b[0][0]), BigInt(pi_b[0][1])],
    [BigInt(pi_b[1][0]), BigInt(pi_b[1][1])],
    [1n, 0n],
  ]);
  return curve.G2.isValid(point) && curve.G2.isZero(curve.G2.timesScalar(point, curve.r));
}

/**
 * Check a pasted code. A code that fails its checksum was copied incompletely; a well-formed
 * code whose contents or proof fail was altered and must not be paid.
 */
export async function verifyShieldedReceiveCode(code: string): Promise<ShieldedReceiveCodeCheck> {
  let decoded;
  try {
    decoded = decodeShieldedReceiveCode(code);
  } catch (cause) {
    const malformed =
      (cause as { code?: string } | null)?.code === "INVALID_SHIELDED_RECEIVE_CODE_ENCODING";
    return { ok: false, reason: malformed ? "malformed" : "invalid" };
  }
  try {
    const verified =
      (await isInG2Subgroup(decoded.proof.pi_b)) &&
      (await snarkjs.groth16.verify(
        SHIELDED_RECEIVE_CODE_VERIFICATION_KEY,
        decoded.publicSignals.map(String),
        decoded.proof,
      ));
    if (!verified) return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    identityCommitment: decoded.identityCommitment.toString(),
    ownerCommitment: decoded.ownerCommitment.toString(),
    viewingKey: hexlify(decoded.viewingKey),
    personHash: wrapIdentityCommitmentAsPersonHash(decoded.identityCommitment),
  };
}
