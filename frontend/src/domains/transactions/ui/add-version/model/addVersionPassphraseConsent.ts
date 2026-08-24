import { classifyProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";
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
  return classifyProtocolPassphraseRisk(rawPassphrase);
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
