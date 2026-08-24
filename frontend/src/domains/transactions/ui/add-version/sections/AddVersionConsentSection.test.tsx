// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddVersionConsents } from "../model/addVersionTypes";
import { AddVersionConsentSection } from "./AddVersionConsentSection";

const t = (_key: string, fallback?: string) => fallback ?? _key;

const consents: AddVersionConsents = {
  hash: false,
  age: false,
  legal: false,
  passphrase: false,
  personPassphraseRisk: false,
  fatherPassphraseRisk: false,
  motherPassphraseRisk: false,
};

afterEach(cleanup);

describe("AddVersionConsentSection", () => {
  it("shows the self empty-passphrase warning without triggering null-parent warnings", () => {
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        passphraseContext={{
          risks: { person: "empty", father: "empty", mother: "unicode-whitespace" },
          present: { person: true, father: false, mother: false },
        }}
        consentError={null}
        onToggleConsent={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByText(/empty identity passphrase for this person/i)).toBeTruthy();
    expect(screen.queryByText(/empty identity passphrase for the father/i)).toBeNull();
    expect(screen.queryByText(/mother's identity passphrase consists only/i)).toBeNull();
  });

  it("renders and toggles independent risk confirmations for non-null parents", () => {
    const onToggleConsent = vi.fn();
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        passphraseContext={{
          risks: {
            person: "ordinary",
            father: "empty",
            mother: "unicode-whitespace",
          },
          present: { person: true, father: true, mother: true },
        }}
        consentError={null}
        onToggleConsent={onToggleConsent}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    fireEvent.click(screen.getByText(/empty identity passphrase for the father/i));
    fireEvent.click(screen.getByText(/mother's identity passphrase consists only/i));
    expect(onToggleConsent.mock.calls).toEqual([
      ["fatherPassphraseRisk"],
      ["motherPassphraseRisk"],
    ]);
  });

  it("keeps only the four universal confirmations for ordinary passphrases", () => {
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        passphraseContext={{
          risks: { person: "ordinary", father: "ordinary", mother: "ordinary" },
          present: { person: true, father: true, mother: true },
        }}
        consentError={null}
        onToggleConsent={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByText(/permanently attempt offline passphrase guesses/i)).toBeTruthy();
  });
});
