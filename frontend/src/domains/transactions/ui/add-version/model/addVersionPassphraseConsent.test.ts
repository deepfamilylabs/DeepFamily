import { describe, expect, it } from "vitest";
import {
  areAddVersionConsentsSatisfied,
  classifyAddVersionPassphrase,
  invalidateAddVersionPassphraseConsents,
  sameAddVersionPassphraseConsentContext,
} from "./addVersionPassphraseConsent";
import type { AddVersionConsents, AddVersionPassphraseConsentContext } from "./addVersionTypes";

function confirmedBaseConsents(overrides: Partial<AddVersionConsents> = {}): AddVersionConsents {
  return {
    hash: true,
    age: true,
    legal: true,
    passphrase: true,
    personPassphraseRisk: false,
    fatherPassphraseRisk: false,
    motherPassphraseRisk: false,
    ...overrides,
  };
}

function context(
  overrides: Partial<AddVersionPassphraseConsentContext> = {},
): AddVersionPassphraseConsentContext {
  return {
    risks: { person: "ordinary", father: "empty", mother: "empty" },
    present: { person: true, father: false, mother: false },
    ...overrides,
  };
}

describe("AddVersion passphrase consent policy", () => {
  it("classifies protocol-normalized empty, Unicode White_Space, and ordinary passphrases", () => {
    expect(classifyAddVersionPassphrase("")).toBe("empty");
    expect(classifyAddVersionPassphrase("\u00a0\u2003\t\n")).toBe("unicode-whitespace");
    expect(classifyAddVersionPassphrase("\u0085\u1680\u2028\u3000")).toBe("unicode-whitespace");
    expect(classifyAddVersionPassphrase("  family secret  ")).toBe("ordinary");
    expect(classifyAddVersionPassphrase("\u200b")).toBe("ordinary");
    expect(() => classifyAddVersionPassphrase("\ud800")).not.toThrow();
    expect(classifyAddVersionPassphrase("\ud800")).toBe("ordinary");
  });

  it("requires a separate irreversible/no-secret confirmation for an empty self passphrase", () => {
    const emptySelf = context({
      risks: { person: "empty", father: "empty", mother: "empty" },
    });
    expect(areAddVersionConsentsSatisfied(confirmedBaseConsents(), emptySelf)).toBe(false);
    expect(
      areAddVersionConsentsSatisfied(
        confirmedBaseConsents({ personPassphraseRisk: true }),
        emptySelf,
      ),
    ).toBe(true);
  });

  it("requires independent father and mother confirmations when those parents are non-null", () => {
    const riskyParents = context({
      risks: {
        person: "ordinary",
        father: "empty",
        mother: "unicode-whitespace",
      },
      present: { person: true, father: true, mother: true },
    });
    expect(
      areAddVersionConsentsSatisfied(
        confirmedBaseConsents({ fatherPassphraseRisk: true }),
        riskyParents,
      ),
    ).toBe(false);
    expect(
      areAddVersionConsentsSatisfied(
        confirmedBaseConsents({
          fatherPassphraseRisk: true,
          motherPassphraseRisk: true,
        }),
        riskyParents,
      ),
    ).toBe(true);
  });

  it("does not trigger father or mother confirmation for null parents", () => {
    const nullParents = context({
      risks: {
        person: "ordinary",
        father: "empty",
        mother: "unicode-whitespace",
      },
      present: { person: true, father: false, mother: false },
    });
    expect(areAddVersionConsentsSatisfied(confirmedBaseConsents(), nullParents)).toBe(true);
  });

  it("keeps the general offline-guessing consent mandatory for ordinary passphrases", () => {
    expect(
      areAddVersionConsentsSatisfied(confirmedBaseConsents({ passphrase: false }), context()),
    ).toBe(false);
    expect(areAddVersionConsentsSatisfied(confirmedBaseConsents(), context())).toBe(true);
  });

  it.each(["person", "father", "mother"] as const)(
    "invalidates the universal and %s-specific confirmation after a passphrase edit",
    (role) => {
      const original = confirmedBaseConsents({
        personPassphraseRisk: true,
        fatherPassphraseRisk: true,
        motherPassphraseRisk: true,
      });
      const invalidated = invalidateAddVersionPassphraseConsents(original, role);
      expect(invalidated.passphrase).toBe(false);
      expect(invalidated[`${role}PassphraseRisk`]).toBe(false);
    },
  );

  it("fails closed when an active role's current risk differs from the rendered confirmation", () => {
    const rendered = context({
      risks: { person: "empty", father: "ordinary", mother: "empty" },
    });
    const changedSelf = context({
      risks: { person: "unicode-whitespace", father: "ordinary", mother: "empty" },
    });
    expect(sameAddVersionPassphraseConsentContext(rendered, changedSelf)).toBe(false);

    const changedNullFather = context({
      risks: { person: "empty", father: "unicode-whitespace", mother: "empty" },
    });
    expect(sameAddVersionPassphraseConsentContext(rendered, changedNullFather)).toBe(true);

    const fatherBecamePresent = context({
      risks: { person: "empty", father: "ordinary", mother: "empty" },
      present: { person: true, father: true, mother: false },
    });
    expect(sameAddVersionPassphraseConsentContext(rendered, fatherBecamePresent)).toBe(false);
  });
});
