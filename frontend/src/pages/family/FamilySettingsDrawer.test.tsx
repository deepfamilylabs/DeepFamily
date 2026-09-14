// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilySettingsDrawer } from "./FamilySettingsDrawer";

vi.mock("../../domains/config", () => ({
  FamilyTreeConfigForm: () => <div data-testid="config-form" />,
}));

const t = ((key: string, fallback?: string) => fallback ?? key) as any;

/** The z-index number a Tailwind `z-<n>` class sets, below md (unprefixed). */
function baseZ(className: string) {
  const match = className.split(/\s+/).find((token) => /^z-\d+$/.test(token));
  return match ? Number(match.slice(2)) : null;
}

const FLOATING_ACTION_BUTTON_Z = 10000;
const STATUS_BAR_Z = 10001;

describe("FamilySettingsDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("stays on screen in a scrolling page on a phone, between the header and the status bar", () => {
    render(<FamilySettingsDrawer t={t} open onClose={vi.fn()} layout="document" />);

    const drawer = screen.getByRole("dialog", { name: "Family settings" });
    expect(drawer.className).toContain("fixed");
    expect(drawer.className).toContain("top-[var(--app-header-h)]");
    expect(drawer.className).toContain("bottom-[var(--app-statusbar-h)]");
    // Desktop keeps it in the page flow, sticky below the header.
    expect(drawer.className).toContain("md:sticky");
    expect(drawer.className).toContain("md:z-auto");

    // The backdrop and the close button share a name; the backdrop is the dimmed one.
    const backdrop = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.className.includes("bg-ink/25"));
    expect(backdrop?.className).toContain("fixed");
  });

  it("keeps the viewport layout absolute inside its sized container", () => {
    render(<FamilySettingsDrawer t={t} open onClose={vi.fn()} />);

    const drawer = screen.getByRole("dialog", { name: "Family settings" });
    expect(drawer.className).toContain("absolute");
    expect(drawer.className).not.toMatch(/(^| )fixed( |$)/);
  });

  it("layers over the floating action button and the status bar on a phone", () => {
    render(<FamilySettingsDrawer t={t} open onClose={vi.fn()} layout="document" />);

    const drawer = screen.getByRole("dialog", { name: "Family settings" });
    const backdrop = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.className.includes("bg-ink/25"))!;

    expect(baseZ(drawer.className)).toBeGreaterThan(STATUS_BAR_Z);
    expect(baseZ(backdrop.className)).toBeGreaterThan(FLOATING_ACTION_BUTTON_Z);
    expect(baseZ(drawer.className)).toBeGreaterThan(baseZ(backdrop.className)!);
  });

  it("closes from the backdrop", () => {
    const onClose = vi.fn();
    render(<FamilySettingsDrawer t={t} open onClose={onClose} layout="document" />);

    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Close" })
        .find((b) => b.className.includes("bg-ink/25"))!,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
