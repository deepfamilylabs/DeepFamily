import { describe, expect, it } from "vitest";
import {
  areAddVersionConsentsSatisfied,
  invalidateAddVersionPassphraseConsents,
} from "./addVersionPassphraseConsent";
import type { AddVersionConsents } from "./addVersionTypes";

function consents(overrides: Partial<AddVersionConsents> = {}): AddVersionConsents {
  return { hash: true, legal: true, passphrase: true, ...overrides };
}

describe("AddVersion consent policy", () => {
  it("requires every universal confirmation", () => {
    expect(areAddVersionConsentsSatisfied(consents())).toBe(true);
    expect(areAddVersionConsentsSatisfied(consents({ hash: false }))).toBe(false);
    expect(areAddVersionConsentsSatisfied(consents({ legal: false }))).toBe(false);
    expect(areAddVersionConsentsSatisfied(consents({ passphrase: false }))).toBe(false);
  });

  it("invalidates only the passphrase confirmation after a passphrase edit", () => {
    expect(invalidateAddVersionPassphraseConsents(consents())).toEqual({
      hash: true,
      legal: true,
      passphrase: false,
    });
  });
});
