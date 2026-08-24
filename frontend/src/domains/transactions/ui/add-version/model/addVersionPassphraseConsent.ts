import { isUnicodeWhiteSpaceOnly, normalizePassphrase } from "@deepfamily/protocol-core";
import type {
  AddVersionConsents,
  AddVersionIdentityRole,
  AddVersionPassphraseConsentContext,
  AddVersionPassphraseRisk,
  AddVersionPassphraseRisks,
} from "./addVersionTypes";

export const PASSPHRASE_RISK_CONSENT_KEYS = {
  person: "personPassphraseRisk",
  father: "fatherPassphraseRisk",
  mother: "motherPassphraseRisk",
} as const satisfies Record<AddVersionIdentityRole, keyof AddVersionConsents>;

export function defaultAddVersionPassphraseRisks(): AddVersionPassphraseRisks {
  return {
    person: "empty",
    father: "empty",
    mother: "empty",
  };
}

/** Classifies the exact protocol passphrase bytes: NFKD, with no trimming. */
export function classifyAddVersionPassphrase(rawPassphrase: string): AddVersionPassphraseRisk {
  let normalized: string;
  try {
    normalized = normalizePassphrase(rawPassphrase);
  } catch {
    // Browser text controls normally replace malformed scalar input, but a
    // programmatic DOM mutation can still expose an isolated surrogate. Keep
    // React event handling total; the protocol KDF remains authoritative and
    // will reject the malformed value before any proof or transaction work.
    return "ordinary";
  }
  if (normalized.length === 0) return "empty";
  return isUnicodeWhiteSpaceOnly(normalized) ? "unicode-whitespace" : "ordinary";
}

export function passphraseRiskNeedsExplicitConsent(risk: AddVersionPassphraseRisk): boolean {
  return risk !== "ordinary";
}

export function invalidateAddVersionPassphraseConsents(
  consents: AddVersionConsents,
  role: AddVersionIdentityRole,
): AddVersionConsents {
  return {
    ...consents,
    // The universal warning and this role's risk warning are both tied to the
    // passphrase the user had reviewed. A subsequent edit must invalidate both.
    passphrase: false,
    [PASSPHRASE_RISK_CONSENT_KEYS[role]]: false,
  };
}

export function areAddVersionConsentsSatisfied(
  consents: AddVersionConsents,
  context: AddVersionPassphraseConsentContext,
): boolean {
  if (!consents.hash || !consents.age || !consents.legal || !consents.passphrase) return false;

  return (Object.keys(PASSPHRASE_RISK_CONSENT_KEYS) as AddVersionIdentityRole[]).every((role) => {
    if (!context.present[role]) return true;
    if (!passphraseRiskNeedsExplicitConsent(context.risks[role])) return true;
    return consents[PASSPHRASE_RISK_CONSENT_KEYS[role]];
  });
}

/**
 * Compares the rendered consent context with a fresh imperative form snapshot.
 * Risks for null parents are intentionally ignored; their passphrases are not
 * read or derived by the AddVersion flow.
 */
export function sameAddVersionPassphraseConsentContext(
  rendered: AddVersionPassphraseConsentContext,
  current: AddVersionPassphraseConsentContext,
): boolean {
  const roles = Object.keys(PASSPHRASE_RISK_CONSENT_KEYS) as AddVersionIdentityRole[];
  return roles.every((role) => {
    if (rendered.present[role] !== current.present[role]) return false;
    return !current.present[role] || rendered.risks[role] === current.risks[role];
  });
}
