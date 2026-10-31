import {
  IDENTITY_SUITE_CANDIDATE_1,
  SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  buildShieldedReceiveCredentialPublicSignals,
  computeShieldedAuthorizationAlias,
  computeShieldedOwnerCommitment,
  computeShieldedReceiveCredentialFingerprint,
  canonicalizeFullName,
  computeIdentityFromDerivedSecret,
  decodeShieldedReceiveCredential,
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedReceiveCredential,
  wipeBytes,
  wrapIdentityCommitmentAsPersonHash,
  type IdentityFields,
  type ShieldedReceiveCredentialProof,
} from "@deepfamily/protocol-core";
import { JsonRpcProvider, hexlify, getBigInt, getBytes, type BigNumberish } from "ethers";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";
import { getFundingPassphraseError } from "../crypto/passphraseStrength";
import {
  createIdentityAuthorizationContract,
  loadShieldedIdentityAuthorizationWitnessForMode,
} from "../clients/shieldedIdentityAuthorizationChain";
import {
  normalizeShieldedStateReadMode,
  type ShieldedStateReadMode,
} from "../config/shieldedStateReadMode";
import { createShieldedPoolFactoryContract } from "../clients/contractFactory";
import { generateShieldedProof, SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS } from "./shieldedZk";

/** The identity material a receive-code proof needs; it stays inside the ZK worker. */
export type ShieldedReceiveCodeIdentity = {
  identity: IdentityFields;
  identitySuiteId: number;
  derivedSecretField: string | bigint;
  keyMode: 0 | 1;
  keyMaterial: { ownerSecret: BigNumberish; ownerCommitment: BigNumberish; hpkeIkm: string };
  disclosure?: "anonymous" | "fund";
  authorizationCounter: BigNumberish;
  expiresAt: BigNumberish;
};

export type ShieldedReceiveCodeCheck =
  | {
      ok: true;
      identityCommitment?: string;
      disclosure: "anonymous" | "fund";
      authorizationAlias: string;
      authorizationCounter: string;
      expiresAt: string;
      ownerCommitment: string;
      viewingKey: string;
      personHash?: string;
      keyMode: 0 | 1;
      identitySuiteId: number;
      independentKeySuiteId: number;
      independentKeyDerivationVersion: number;
      fingerprint: string;
    }
  | { ok: false; reason: "malformed" | "invalid" };

/** Derive the payment keys and prove that this identity chose them. */
export async function createShieldedReceiveCode(input: ShieldedReceiveCodeIdentity): Promise<{ code: string; personHash: string; fingerprint: string }> {
  const material = computeIdentityFromDerivedSecret(input);
  const identityKeys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
  const keyMode = input.keyMode;
  if (keyMode !== 0 && keyMode !== 1) throw new Error("Unsupported receive authorization mode");
  if (!input.keyMaterial) throw new Error("Receive code requires explicit spending material");
  const supplied = input.keyMaterial;
  const keys = {
    ownerSecret: getBigInt(supplied.ownerSecret),
    ownerCommitment: getBigInt(supplied.ownerCommitment),
    hpkeIkm: supplied.hpkeIkm,
  };
  if (
    computeShieldedOwnerCommitment(keys.ownerSecret) !== keys.ownerCommitment ||
    getBytes(keys.hpkeIkm).length !== 32
  )
    throw new Error("Receive key material is inconsistent");
  if (
    keyMode === 0 &&
    (keys.ownerSecret !== identityKeys.ownerSecret ||
      keys.hpkeIkm.toLowerCase() !== identityKeys.hpkeIkm.toLowerCase())
  )
    throw new Error("Identity receive mode requires canonical identity keys");
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const disclosure = input.disclosure ?? "anonymous";
  const statement = {
    disclosure,
    authorizationAlias: computeShieldedAuthorizationAlias(material),
    authorizationCounter: input.authorizationCounter,
    expiresAt: input.expiresAt,
    ...(disclosure === "fund" ? { identityCommitment: material.identityCommitment } : {}),
    ownerCommitment: keys.ownerCommitment,
    viewingKey,
    keyMode,
    identitySuiteId: material.identitySuiteId,
  };
  const publicSignals = buildShieldedReceiveCredentialPublicSignals(statement);
  const { proof } = await generateShieldedProof({
    circuit: disclosure === "fund" ? "fundReceiveCredential" : "anonymousReceiveCredential",
    witness: {
      identityCommitment: String(material.identityCommitment),
      authorizationCounter: String(input.authorizationCounter),
      expiresAt: String(input.expiresAt),
      ownerCommitment: String(keys.ownerCommitment),
      viewKeyLo: String(publicSignals[disclosure === "fund" ? 5 : 4]),
      viewKeyHi: String(publicSignals[disclosure === "fund" ? 6 : 5]),
      keyMode,
      identitySuiteId: material.identitySuiteId,
      independentKeySuiteId: 1,
      independentKeyDerivationVersion: 1,
      receiveCodeVersion: SHIELDED_RECEIVE_CREDENTIAL_VERSION,
      spendingSecret: keys.ownerSecret.toString(),
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
  const code = encodeShieldedReceiveCredential({
    ...statement,
    proof: proof as unknown as ShieldedReceiveCredentialProof,
  });
  return {
    code,
    personHash: material.personHash,
    fingerprint: computeShieldedReceiveCredentialFingerprint(statement),
  };
}

/**
 * Create another person's receive code from their identity details and passphrase. The
 * derived secret never leaves this worker; the caller receives only the shareable code.
 */
export async function createShieldedReceiveCodeFromCredentials(input: {
  identity: IdentityFields;
  rawPassphrase: string;
  disclosure?: "anonymous" | "fund";
  context: {
    rpcUrl: string;
    chainId: string;
    factoryAddress: string;
    stateReadMode?: ShieldedStateReadMode;
  };
  expiresAt: BigNumberish;
}) {
  const passphraseError = getFundingPassphraseError(input.rawPassphrase);
  if (passphraseError) throw new Error(`Funding passphrase rejected: ${passphraseError}`);
  let material;
  try {
    const stateReadMode = normalizeShieldedStateReadMode(input.context.stateReadMode);
    material = await deriveIdentityMaterial({
      identity: { ...input.identity, fullName: canonicalizeFullName(input.identity.fullName) },
      rawPassphrase: input.rawPassphrase,
      identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
    });
    // The remaining proof needs the derived material, never the raw credential.
    input.rawPassphrase = "";
    const provider = new JsonRpcProvider(input.context.rpcUrl);
    try {
      if ((await provider.getNetwork()).chainId !== BigInt(input.context.chainId))
        throw new Error("Receive code chain mismatch");
      const factory = createShieldedPoolFactoryContract(input.context.factoryAddress, provider);
      const alias = computeShieldedAuthorizationAlias(material);
      const address = String(await factory.AUTHORIZATION_STATE());
      const state = await loadShieldedIdentityAuthorizationWitnessForMode(
        createIdentityAuthorizationContract(address, provider),
        alias,
        stateReadMode,
        { chainId: input.context.chainId, authorizationStateAddress: address },
      );
      return await createShieldedReceiveCode({
        ...material,
        keyMode: 0,
        disclosure: input.disclosure,
        authorizationCounter: state.witness.authorizationCounter,
        expiresAt: input.expiresAt,
        keyMaterial: deriveShieldedHeirKeyMaterial(material.derivedSecretField),
      });
    } finally {
      provider.destroy();
    }
  } catch {
    // Library failures can embed normalized/encoded credentials or witnesses.
    throw new Error("Receive code could not be created");
  } finally {
    input.rawPassphrase = "";
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
    decoded = decodeShieldedReceiveCredential(code);
  } catch (cause) {
    const malformed =
      (cause as { code?: string } | null)?.code === "INVALID_SHIELDED_RECEIVE_CREDENTIAL_ENCODING";
    return { ok: false, reason: malformed ? "malformed" : "invalid" };
  }
  try {
    const verified =
      (await isInG2Subgroup(decoded.proof.pi_b)) &&
      (await snarkjs.groth16.verify(
        SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS[decoded.disclosure],
        decoded.publicSignals.map(String),
        decoded.proof,
      ));
    if (!verified) return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    disclosure: decoded.disclosure,
    authorizationAlias: String(decoded.authorizationAlias),
    authorizationCounter: String(decoded.authorizationCounter),
    expiresAt: String(decoded.expiresAt),
    ...(decoded.identityCommitment === undefined
      ? {}
      : { identityCommitment: String(decoded.identityCommitment) }),
    ownerCommitment: decoded.ownerCommitment.toString(),
    viewingKey: hexlify(decoded.viewingKey),
    ...(decoded.identityCommitment === undefined
      ? {}
      : { personHash: wrapIdentityCommitmentAsPersonHash(decoded.identityCommitment) }),
    keyMode: decoded.keyMode as 0 | 1,
    identitySuiteId: decoded.identitySuiteId,
    independentKeySuiteId: decoded.independentKeySuiteId,
    independentKeyDerivationVersion: decoded.independentKeyDerivationVersion,
    fingerprint: decoded.fingerprint,
  };
}
