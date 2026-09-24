import type { TFunction } from "i18next";
import { ProtocolError } from "@deepfamily/protocol-core";
import { normalizeFriendlyError, type FriendlyError } from "../../../shared/lib/errors";

export type InheritanceErrorCode =
  | "nameRequired"
  | "passphraseDisallowed"
  | "invalidVersionIndex"
  | "invalidRecipient"
  | "rootNotFound"
  | "rootVersionNotFound"
  | "heirNotFound"
  | "notLegitHeir"
  | "notEligibleYet"
  | "nothingToClaim"
  | "identityChanged"
  | "snapshotMismatch"
  | "insufficientBalance"
  | "wrongNetwork"
  | "notWired";

/** A failure the flow recognises and explains in its own words. */
export class InheritanceError extends Error {
  readonly code: InheritanceErrorCode;

  constructor(code: InheritanceErrorCode, message: string = code) {
    super(message);
    this.name = "InheritanceError";
    this.code = code;
  }
}

/** Witness checks that mean the chain does not back the claim, in the flow's own terms. */
const PROTOCOL_CODES: Record<string, InheritanceErrorCode> = {
  INHERITANCE_NOT_YET_ELIGIBLE: "notEligibleYet",
  INHERITANCE_ROOT_NOT_PARENT: "notLegitHeir",
  LINEAGE_LEAF_MISMATCH: "snapshotMismatch",
};

const RETRYABLE: ReadonlySet<InheritanceErrorCode> = new Set(["snapshotMismatch"]);

export function toInheritanceFriendlyError(
  error: unknown,
  t: TFunction,
  contract?: { interface?: unknown } | null,
): FriendlyError {
  const code =
    error instanceof InheritanceError
      ? error.code
      : error instanceof ProtocolError
        ? PROTOCOL_CODES[String(error.code)]
        : undefined;
  if (code) {
    const message = t(`inheritance.errors.${code}`);
    return { type: code, message, details: message, reason: code, retryable: RETRYABLE.has(code) };
  }
  return normalizeFriendlyError(error, t, { contract });
}
