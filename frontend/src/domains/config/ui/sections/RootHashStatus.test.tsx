// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootHashField from "./RootHashField";
import VersionPicker from "./VersionPicker";
import type { PersonVersionLookup } from "../../../transactions/hooks/usePersonVersionOptions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolating like the real `t` does — the version labels are templates,
    // and a literal "Version {{index}}" would pass assertions it should not.
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? "")) : text;
    },
  }),
}));

vi.mock("../../../transactions/ui/shared/ThemedSelect", () => ({
  ThemedSelect: ({ options, disabled }: any) => (
    <div data-testid="themed-select" data-disabled={String(Boolean(disabled))}>
      {options.map((option: any) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));

function lookup(overrides: Partial<PersonVersionLookup> = {}): PersonVersionLookup {
  return {
    personHash: "0x" + "b".repeat(64),
    status: "error",
    versions: [],
    totalVersions: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("RootHashField", () => {
  const HASH = "0x" + "c".repeat(64);

  it("names the chain the person is missing from", () => {
    render(
      <RootHashField
        value={HASH}
        onChange={vi.fn()}
        presence="absent"
        networkName="Conflux eSpace Testnet"
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "No person with this hash on Conflux eSpace Testnet",
    );
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });

  it("waits rather than judging while the lookup is in flight", () => {
    render(
      <RootHashField value={HASH} onChange={vi.fn()} presence="checking" networkName="Localhost" />,
    );

    expect(screen.getByText("Looking for this person…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays silent on a hash the chain carries — the version list is the proof", () => {
    const { container } = render(
      <RootHashField value={HASH} onChange={vi.fn()} presence="present" networkName="Localhost" />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("lets a format complaint stand alone, since that hash was never looked up", () => {
    render(
      <RootHashField
        value="nope"
        onChange={vi.fn()}
        error="familyTree.validation.root"
        presence="absent"
        networkName="Localhost"
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("Root Hash format error");
  });
});

describe("VersionPicker note", () => {
  it("explains the empty list in its own terms when there is no contract", () => {
    // The contract comes from the environment now — no input here can fix it,
    // and the status bar names the chain on the chip itself.
    render(<VersionPicker value={1} onChange={vi.fn()} lookup={lookup()} readerBlocked />);

    expect(screen.getByText("No contract deployed, so versions cannot be read")).toBeTruthy();
    expect(screen.queryByText(/Re-enter the hash/)).toBeNull();
  });

  it("still blames the hash when the reader is fine", () => {
    render(<VersionPicker value={1} onChange={vi.fn()} lookup={lookup()} />);

    expect(screen.getByText("Version lookup failed. Re-enter the hash to retry")).toBeTruthy();
  });

  it("offers no version at all through a dead reader", () => {
    render(<VersionPicker value={1} onChange={vi.fn()} lookup={lookup()} readerBlocked />);

    // The saved index is a leftover from the chain before this one; presenting
    // it as "Version 1" would look like this chain confirmed it.
    expect(screen.queryByText("Version 1")).toBeNull();
    expect(screen.getByTestId("themed-select").getAttribute("data-disabled")).toBe("true");
  });

  it("still labels the saved index while a real lookup is in flight", () => {
    render(<VersionPicker value={1} onChange={vi.fn()} lookup={lookup({ status: "loading" })} />);

    expect(screen.getByText("Version 1")).toBeTruthy();
  });

  it("offers no version for a hash the chain does not carry, but still says why", () => {
    render(
      <VersionPicker
        value={1}
        onChange={vi.fn()}
        lookup={lookup({ status: "ready" })}
        rootAbsent
      />,
    );

    // The saved index is a leftover; presenting it would contradict the note.
    expect(screen.queryByText("Version 1")).toBeNull();
    expect(screen.getByTestId("themed-select").getAttribute("data-disabled")).toBe("true");
    // The root field above carries the sentence; saying it twice is noise.
    expect(screen.queryByText("This hash carries no on-chain version")).toBeNull();
  });

  it("names a hash the chain carries no version for", () => {
    render(<VersionPicker value={1} onChange={vi.fn()} lookup={lookup({ status: "ready" })} />);

    expect(screen.getByText("This hash carries no on-chain version")).toBeTruthy();
  });
});
