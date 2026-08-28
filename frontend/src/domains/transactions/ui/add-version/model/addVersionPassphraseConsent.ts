import type { AddVersionConsents } from "./addVersionTypes";

/**
 * Every passphrase edit invalidates the universal confirmation: the user agreed
 * to the offline-guessing terms for the passphrases they had reviewed, so a new
 * one must be reviewed again. No consent depends on how risky a passphrase is —
 * the single confirmation already covers weak and empty passphrases alike.
 */
export function invalidateAddVersionPassphraseConsents(
  consents: AddVersionConsents,
): AddVersionConsents {
  return { ...consents, passphrase: false };
}

export function areAddVersionConsentsSatisfied(consents: AddVersionConsents): boolean {
  return consents.hash && consents.legal && consents.passphrase;
}
