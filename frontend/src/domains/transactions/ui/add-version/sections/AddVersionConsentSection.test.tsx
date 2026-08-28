// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddVersionConsents } from "../model/addVersionTypes";
import { AddVersionConsentSection } from "./AddVersionConsentSection";

const t = (_key: string, fallback?: string) => fallback ?? _key;

const consents: AddVersionConsents = {
  hash: false,
  legal: false,
  passphrase: false,
};

afterEach(cleanup);

describe("AddVersionConsentSection", () => {
  it("renders exactly the three universal confirmations", () => {
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        consentError={null}
        onToggleConsent={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText(/permanently and cannot be deleted or modified/i)).toBeTruthy();
    expect(screen.getByText(/lawful, truthful, and authorized/i)).toBeTruthy();
    expect(screen.getByText(/guess the passphrase offline/i)).toBeTruthy();
  });

  it("warns that an empty passphrase is the same as no encryption", () => {
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        consentError={null}
        onToggleConsent={vi.fn()}
      />,
    );

    expect(screen.getByText(/an empty one is the same as no encryption at all/i)).toBeTruthy();
  });

  it("reports the toggled consent key", () => {
    const onToggleConsent = vi.fn();
    render(
      <AddVersionConsentSection
        t={t as any}
        consents={consents}
        consentError={null}
        onToggleConsent={onToggleConsent}
      />,
    );

    fireEvent.click(screen.getByText(/guess the passphrase offline/i));
    expect(onToggleConsent.mock.calls).toEqual([["passphrase"]]);
  });
});
