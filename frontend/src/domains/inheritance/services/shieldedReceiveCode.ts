import type { ShieldedStateReadMode } from "../../../shared/config/shieldedStateReadMode";
import {
  decodeShieldedReceiveCredential,
  wrapIdentityCommitmentAsPersonHash,
  type IdentityFields,
} from "@deepfamily/protocol-core";
import { getBigInt } from "ethers";
import { getFundingPassphraseError } from "../../../shared/crypto/passphraseStrength";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import { InheritanceError } from "../model/inheritanceErrors";

declare const verifiedRecipient: unique symbol;

/**
 * Payment keys from a receive code whose proof verified in the ZK worker. Only
 * verifyShieldedReceiveCode creates this type, so funding and transfers cannot use
 * keys that the recipient's identity did not authorize.
 */
export type VerifiedShieldedRecipient = {
  readonly identityCommitment?: bigint;
  readonly disclosure?: "anonymous" | "fund";
  readonly authorizationAlias?: string;
  readonly authorizationCounter?: string;
  readonly expiresAt?: string;
  readonly ownerCommitment: bigint;
  readonly viewingKey: string;
  readonly personHash?: string;
  readonly keyMode: 0 | 1;
  readonly identitySuiteId: number;
  readonly independentKeySuiteId: number;
  readonly independentKeyDerivationVersion: number;
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
  const identityCommitment = result.identityCommitment === undefined ? undefined : getBigInt(result.identityCommitment);
  if (
    identityCommitment !== undefined && wrapIdentityCommitmentAsPersonHash(identityCommitment).toLowerCase() !==
    result.personHash?.toLowerCase()
  ) {
    throw new ShieldedReceiveCodeError("invalid");
  }
  return {
    disclosure: result.disclosure,
    authorizationAlias: result.authorizationAlias,
    authorizationCounter: result.authorizationCounter,
    expiresAt: result.expiresAt,
    identityCommitment,
    ownerCommitment: getBigInt(result.ownerCommitment),
    viewingKey: result.viewingKey,
    personHash: result.personHash,
    keyMode: result.keyMode,
    identitySuiteId: result.identitySuiteId,
    independentKeySuiteId: result.independentKeySuiteId,
    independentKeyDerivationVersion: result.independentKeyDerivationVersion,
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
    const decoded = decodeShieldedReceiveCredential(code);
    return decoded.disclosure === "fund" && decoded.identityCommitment !== undefined
      ? wrapIdentityCommitmentAsPersonHash(decoded.identityCommitment) : null;
  } catch {
    return null;
  }
}

/** Create another person's code from their details. Their secret stays in the ZK worker. */
export async function createShieldedReceiveCodeForRecipient(credentials: {
  identity: IdentityFields;
  rawPassphrase: string;
  disclosure?: "anonymous" | "fund";
  context: { rpcUrl: string; chainId: string; factoryAddress: string; stateReadMode?: ShieldedStateReadMode };
  expiresAt: string;
}): Promise<string> {
  const passphraseError = getFundingPassphraseError(credentials.rawPassphrase);
  if (passphraseError) throw new InheritanceError(passphraseError);
  const { code } = await zkWorkerCall("createShieldedReceiveCodeFromCredentials", credentials, {
    timeoutMs: RECEIVE_CODE_TIMEOUT_MS,
  });
  return code;
}
