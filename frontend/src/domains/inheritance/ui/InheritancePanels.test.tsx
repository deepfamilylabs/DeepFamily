// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InheritanceClaimPanel } from "./InheritanceClaimPanel";
import { InheritanceCreatePanel } from "./InheritanceCreatePanel";
import { InheritanceDepositPanel } from "./InheritanceDepositPanel";

// Real English templates, so assertions see what a user reads rather than keys.
vi.mock("react-i18next", async () => {
  const en = (await import("../../../locales/en/index.json")).default as Record<string, unknown>;
  const template = (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        en,
      );
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const text = template(key);
        return typeof text === "string"
          ? text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""))
          : key;
      },
      i18n: { language: "en" },
    }),
  };
});

const TX_HASH = "0x5ed69a4b1740fa35a978b6de5b8eb78843d1cf764a4fb3052cb5a4da22f661cd";
// review.credential (123456789) as the 32-byte word the InheritanceCreated event indexes.
const CREDENTIAL_HEX = `0x${"0".repeat(56)}075bcd15`;

const labelOf = (value: string) => screen.getByText(value).previousElementSibling?.textContent;

const review = {
  credential: 123456789n,
  rootPersonHash: `0x${"11".repeat(32)}`,
  rootVersionIndex: 1,
  trustedEndorserCount: 1,
  amountPerPeriod: 10n ** 18n,
  amount: 10n ** 18n,
};

describe("inheritance panels", () => {
  afterEach(() => {
    cleanup();
  });

  it("names the id to share after set-up and labels the credential and transaction", () => {
    render(
      <InheritanceCreatePanel
        rootIdentityForm={<div />}
        state={{ step: "success", review, id: 3n, transactionHash: TX_HASH }}
        recentReward={0n}
        disabled={false}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText("Inheritance #3 is set up.")).toBeTruthy();
    expect(
      screen.getByText("Share the id 3 with family members who want to top it up."),
    ).toBeTruthy();
    expect(labelOf(CREDENTIAL_HEX)).toBe("Credential");
    expect(labelOf(TX_HASH)).toBe("Transaction");
  });

  it("shows the heir the credential a search matched, including when nothing is under it", () => {
    render(
      <InheritanceClaimPanel
        heirIdentityForm={<div />}
        rootIdentityForm={<div />}
        state={{
          step: "found",
          lookup: {
            heirPersonHash: `0x${"22".repeat(32)}`,
            rootPersonHash: review.rootPersonHash,
            rootVersionIndex: 1,
            credential: review.credential,
            versionIndex: 1,
            endorser: `0x${"e1".repeat(20)}`,
            rows: [],
          },
        }}
        account={`0x${"aa".repeat(20)}`}
        disabled={false}
        onSearch={vi.fn()}
        onClaim={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    // Same value, same format as the set-up result, so the two can be compared.
    expect(labelOf(CREDENTIAL_HEX)).toBe("Credential");
    expect(screen.getByText("No inheritance yet")).toBeTruthy();
  });

  it("looks up an id pasted as it is shown, but not a transaction hash", () => {
    const onLookup = vi.fn();
    render(
      <InheritanceDepositPanel
        state={{ step: "idle" }}
        disabled={false}
        onLookup={onLookup}
        onDeposit={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Inheritance id");
    const lookup = screen.getByRole("button", { name: "Look up" }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: TX_HASH } });
    expect(lookup.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(input, { target: { value: " #3 " } });
    expect(lookup.disabled).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(lookup);
    expect(onLookup).toHaveBeenCalledWith(3n);
  });
});
