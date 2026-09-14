// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleToolbar } from "./PeopleToolbar";

vi.mock("../../../shared/ui", () => ({
  PageContainer: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

const t = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
  const text = fallback ?? key;
  return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? "")) : text;
};

function renderToolbar() {
  const filters: any = {
    searchTerm: "",
    setSearchTerm: vi.fn(),
    filterType: "all",
    sortOrder: "asc",
    setFilterType: vi.fn(),
    setSortOrder: vi.fn(),
    generationOptions: [
      { generation: 1, count: 3 },
      { generation: 2, count: 5 },
    ],
    selectedGenerations: [],
    toggleGeneration: vi.fn(),
    selectGenerationRange: vi.fn(),
    clearGenerations: vi.fn(),
    selectedAddresses: [],
    addressInput: "",
    setAddressInput: vi.fn(),
    handleAddressKeyDown: vi.fn(),
    addAddress: vi.fn(),
    removeAddress: vi.fn(),
    clearFilters: vi.fn(),
    hasRuleFilters: false,
  };
  const view: any = { mode: "grid", setMode: vi.fn() };

  return render(
    <PeopleToolbar t={t as any} filters={filters} view={view} loading={false} filteredCount={82} />,
  );
}

function buttonNamed(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("PeopleToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("never lets a control shrink below its label", () => {
    renderToolbar();

    for (const name of [/Sort:/, /Generations/, /Filter Rules/]) {
      const button = buttonNamed(name);
      expect(button.className).toContain("whitespace-nowrap");
      expect(button.className).toContain("shrink-0");
    }
  });

  it("keeps sort and filters in one group, and the count with the view toggle in another", () => {
    renderToolbar();

    const shaping = buttonNamed(/Sort:/).closest(".flex-wrap");
    expect(shaping?.contains(buttonNamed(/Generations/))).toBe(true);
    expect(shaping?.contains(buttonNamed(/Filter Rules/))).toBe(true);

    // Generations and filter rules share a line that never wraps between them.
    const pair = buttonNamed(/Generations/).parentElement?.parentElement;
    expect(pair).toBe(buttonNamed(/Filter Rules/).parentElement?.parentElement);
    expect(pair).not.toBe(shaping);
    expect(pair?.className).not.toContain("flex-wrap");

    const count = screen.getByText("82 total results");
    const summary = count.parentElement;
    expect(summary?.contains(screen.getByRole("button", { name: "Grid view" }))).toBe(true);
    // Its own full-width line on a phone, with the count and the toggle at its two ends.
    expect(summary?.className).toContain("w-full");
    expect(summary?.className).toContain("justify-between");
    expect(summary?.className).toContain("sm:w-auto");
  });

  it("spans the toolbar with the filter popovers on a phone", () => {
    renderToolbar();

    fireEvent.click(buttonNamed(/Filter Rules/));
    const filterPanel = screen.getByRole("dialog", { name: "Add creator address..." });
    fireEvent.click(buttonNamed(/Generations/));
    const generationPanel = screen.getByRole("dialog", { name: "Generations" });

    for (const panel of [filterPanel, generationPanel]) {
      expect(panel.className).toContain("inset-x-4");
      expect(panel.className).toContain("sm:left-0");
      // Without `relative` below sm, the sticky toolbar is what the panel positions against.
      expect(panel.parentElement?.className).toContain("sm:relative");
      expect(panel.parentElement?.className).not.toMatch(/(^| )relative( |$)/);
    }
  });
});
