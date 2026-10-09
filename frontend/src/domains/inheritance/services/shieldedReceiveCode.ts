import {
  decodeShieldedReceiveCode,
  wrapIdentityCommitmentAsPersonHash,
  type IdentityFields,
} from "@deepfamily/protocol-core";
import { getBigInt } from "ethers";
import { getFundingPassphraseError } from "../../../shared/crypto/passphraseStrength";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import { InheritanceError } from "../model/inheritanceErrors";

declare const verifiedRecipient: unique symbol;

/**
 * Payment keys from a receive code whose proof verified in the ZK worker. Only
 * verifyShieldedReceiveCode creates this type, so funding and transfers cannot use
 * keys that the recipient's identity did not authorize.
 */
export type VerifiedShieldedRecipient = {
  readonly identityCommitment: bigint;
  readonly ownerCommitment: bigint;
  readonly viewingKey: string;
  readonly personHash: string;
  readonly keyMode: 0 | 1;
  readonly identitySuiteId: number;
  readonly assetSuiteId: number;
  readonly assetDerivationVersion: number;
  readonly fingerprint: string;
  readonly [verifiedRecipient]: true;
};

export class ShieldedReceiveCodeError extends Error {
  constructor(readonly reason: "malformed" | "invalid") {
    super(
      reason === "malformed"
        ? "Receive code is incomplete or mistyped"
        : "Receive code failed verification",
    );
    this.name = "ShieldedReceiveCodeError";
  }
}

// Argon2id derivation and a first proof can each take a while on slower devices.
const RECEIVE_CODE_TIMEOUT_MS = 240_000;

export async function verifyShieldedReceiveCode(code: string): Promise<VerifiedShieldedRecipient> {
  const result = await zkWorkerCall(
    "verifyShieldedReceiveCode",
    { code },
    { timeoutMs: RECEIVE_CODE_TIMEOUT_MS },
  );
  if (!result.ok) throw new ShieldedReceiveCodeError(result.reason);
  const identityCommitment = getBigInt(result.identityCommitment);
  if (
    wrapIdentityCommitmentAsPersonHash(identityCommitment).toLowerCase() !==
    result.personHash.toLowerCase()
  ) {
    throw new ShieldedReceiveCodeError("invalid");
  }
  return {
    identityCommitment,
    ownerCommitment: getBigInt(result.ownerCommitment),
    viewingKey: result.viewingKey,
    personHash: result.personHash,
    keyMode: result.keyMode,
    identitySuiteId: result.identitySuiteId,
    assetSuiteId: result.assetSuiteId,
    assetDerivationVersion: result.assetDerivationVersion,
    fingerprint: result.fingerprint,
  } as VerifiedShieldedRecipient;
}

/**
 * For display before submission only: the person a code names. Its proof is checked by
 * verifyShieldedReceiveCode before any payment uses the code.
 */
export function peekShieldedReceiveCodePersonHash(code: string): string | null {
  if (!code.trim()) return null;
  try {
    return wrapIdentityCommitmentAsPersonHash(decodeShieldedReceiveCode(code).identityCommitment);
  } catch {
    return null;
  }
}

/** The unlocked identity's own code. It is regenerated on demand and never stored. */
export async function createOwnShieldedReceiveCode(
  identity: IdentityMaterialV1Result,
): Promise<string> {
  const { code, personHash } = await zkWorkerCall(
    "createShieldedReceiveCode",
    {
      identity: identity.identity,
      identitySuiteId: identity.identitySuiteId,
      derivedSecretField: identity.derivedSecretField,
    },
    { timeoutMs: RECEIVE_CODE_TIMEOUT_MS },
  );
  if (personHash.toLowerCase() !== identity.personHash.toLowerCase()) {
    throw new Error("Receive code does not belong to the unlocked identity");
  }
  return code;
}

/** Create another person's code from their details. Their secret stays in the ZK worker. */
export async function createShieldedReceiveCodeForRecipient(credentials: {
  identity: IdentityFields;
  rawPassphrase: string;
}): Promise<string> {
  const passphraseError = getFundingPassphraseError(credentials.rawPassphrase);
  if (passphraseError) throw new InheritanceError(passphraseError);
  const { code } = await zkWorkerCall("createShieldedReceiveCodeFromCredentials", credentials, {
    timeoutMs: RECEIVE_CODE_TIMEOUT_MS,
  });
  return code;
}
