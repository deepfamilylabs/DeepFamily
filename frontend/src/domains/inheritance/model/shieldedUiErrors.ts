import type { TFunction } from "i18next";
import { normalizeFriendlyError, type ChainFriendlyError } from "../../../shared/lib/errors";

/** Domain validation has stable codes; older Worker messages remain readable across versions. */
const DOMAIN_KEYS: Record<string, string> = {
  passphraseDisallowed: "search.hashCalculator.passphraseDisallowed",
  lineageIncompatible: "shielded.familyRecordsIncompatible",
  snapshotMismatch: "shielded.walletKeys.reviewAgain",
  amountInvalid: "shielded.walletKeys.amountInvalid",
  periodsInvalid: "shielded.walletKeys.periodsInvalid",
  periodDaysInvalid: "shielded.periodDaysInvalid",
};
const LEGACY_MESSAGES: readonly [RegExp, string][] = [
  [/wrong network/i, "shielded.walletChanged"],
  [/proof expired|eligibility snapshot expired|receive authorization expired/i, "shielded.walletKeys.reviewAgain"],
  [/reorganized/i, "shielded.walletKeys.reviewAgain"],
  [/submission block.*(?:unavailable|invalid)/i, "shielded.unreachable"],
  [/no provider/i, "wallet.connectDescription"],
  [/no gas balance/i, "errors.contractError.INSUFFICIENT_FUNDS"],
  [/determine.*gas price/i, "archive.errors.feeUnavailable"],
  [/^Choose a public withdrawal destination\.$|^Unshield recipient must (?:be nonzero|not be the pool)$/im, "shielded.invalidExitRecipient"],
];

/** Marks wording translated by the calling flow, including parameterized messages. */
export class ShieldedUiMessageError extends Error {
  readonly code = "SHIELDED_UI_MESSAGE";
}

export function normalizeShieldedUiError(
  cause: unknown,
  t: TFunction,
  options: { fallbackKey?: string; message?: string } = {},
): ChainFriendlyError {
  const friendly = normalizeFriendlyError(cause, t);
  const source = cause && typeof cause === "object" ? cause as { code?: unknown; message?: unknown } : {};
  const raw = typeof source.message === "string" ? source.message : "";
  const code = typeof source.code === "string" ? source.code : raw;
  let message = options.message;
  if (!message && code === "SHIELDED_UI_MESSAGE") message = raw;
  if (!message && (code === "nameRequired" || code === "passphraseRequired")) {
    message = `${t(code === "nameRequired" ? "search.hashCalculator.name" : "search.hashCalculator.passphrase")}: ${t("search.validation.required")}`;
  }
  if (!message && Object.prototype.hasOwnProperty.call(DOMAIN_KEYS, code)) message = t(DOMAIN_KEYS[code]);
  if (!message) {
    const legacy = LEGACY_MESSAGES.find(([pattern]) => pattern.test(`${raw}\n${friendly.details}`));
    if (legacy) message = t(legacy[1]);
  }
  // Validation already translated by this flow must survive the shared boundary.
  if (!message && friendly.type === "UNKNOWN_ERROR" && (/\p{Script=Han}/u.test(raw) || /^(shielded|errors|transaction)\./.test(raw))) message = raw;
  return {
    ...friendly,
    message: message ?? (friendly.type === "UNKNOWN_ERROR" ? t(options.fallbackKey ?? "shielded.unknownError") : friendly.message),
  };
}
