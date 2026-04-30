// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndorseTargetForm } from "./endorse/sections/EndorseTargetForm";
import { MintSupplementForm } from "./mint-nft/sections/MintSupplementForm";
import { MintTargetSection } from "./mint-nft/sections/MintTargetSection";

const t = (_key: string, fallback?: string) => fallback ?? _key;

afterEach(() => {
  cleanup();
});

describe("transaction form accessibility", () => {
  it("links endorse person hash format errors to the input", () => {
    render(
      <EndorseTargetForm
        t={t as any}
        personHash="not-a-hash"
        versionIndex={1}
        hashInputInvalid
        hasValidTarget={false}
        isTargetValidOnChain={false}
        displayName=""
        currentEndorsementCount={0}
        onPersonHashChange={vi.fn()}
        onVersionIndexChange={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Search by person hash");
    const alert = screen.getByRole("alert");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.textContent).toContain("Person hash must be");
  });

  it("links mint target person hash format errors to the input", () => {
    render(
      <MintTargetSection
        t={t as any}
        personHash="not-a-hash"
        versionIndex={1}
        hashInputInvalid
        hasValidTarget={false}
        isCheckingStatus={false}
        isEndorsed={false}
        isAlreadyMinted={false}
        hasMissingParents={{ father: false, mother: false }}
        onPersonHashChange={vi.fn()}
        onVersionIndexChange={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("search.versionsQuery.placeholder");
    const alert = screen.getByRole("alert");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.textContent).toContain("Person hash must be");
  });

  it("links mint supplement field errors and hints to their fields", () => {
    const register = (name: string) =>
      ({
        name,
        onBlur: vi.fn(),
        onChange: vi.fn(),
        ref: vi.fn(),
      }) as any;

    render(
      <MintSupplementForm
        t={t as any}
        register={register}
        errors={{
          story: { type: "validate", message: "Story is too long" } as any,
          tokenURI: { type: "validate", message: "Invalid token URI" } as any,
        }}
        setValue={vi.fn() as any}
        watch={(() => false) as any}
      />,
    );

    const story = screen.getByPlaceholderText("Enter a brief life story summary...");
    const tokenUri = screen.getByPlaceholderText("https://... or ipfs://...");

    expect(story.getAttribute("aria-invalid")).toBe("true");
    expect(story.getAttribute("aria-describedby")).toBe("mint-nft-story-error");
    expect(screen.getByText("Story is too long").getAttribute("role")).toBe("alert");

    expect(tokenUri.getAttribute("aria-invalid")).toBe("true");
    expect(tokenUri.getAttribute("aria-describedby")).toBe(
      "mint-nft-token-uri-hint mint-nft-token-uri-error",
    );
    expect(screen.getByText("Invalid token URI").getAttribute("role")).toBe("alert");
  });
});
