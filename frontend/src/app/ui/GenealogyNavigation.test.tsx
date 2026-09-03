// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BottomNav from "./BottomNav";
import SiteHeader from "./SiteHeader";

const mocks = vi.hoisted(() => ({
  activePath: "/genealogyBook",
  setActivePath: vi.fn(),
  toggleMobileSidebar: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const labels: Record<string, string> = {
        "navigation.home": "Home",
        "navigation.familyTree": "Tree",
        "navigation.people": "People",
        "navigation.genealogyBook": "Genealogy",
        "navigation.search": "Search",
        "navigation.actions": "Actions",
      };
      return labels[key] || fallback || key;
    },
  }),
}));

vi.mock("../context", () => ({
  useActivePath: () => ({
    activePath: mocks.activePath,
    setActivePath: mocks.setActivePath,
  }),
  useSidebar: () => ({
    toggleMobileSidebar: mocks.toggleMobileSidebar,
  }),
}));

vi.mock("../../shared/ui", () => ({
  PageContainer: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock("./HeaderControls", () => ({
  default: () => <div data-testid="header-controls" />,
}));

vi.mock("./Logo", () => ({
  default: (props: any) => <svg data-testid="logo" {...props} />,
}));

vi.mock("../config/brandBadge", () => ({
  getBadgeConfig: () => null,
}));

describe("genealogy volume navigation", () => {
  beforeEach(() => {
    mocks.activePath = "/genealogyBook";
    mocks.setActivePath.mockReset();
    mocks.toggleMobileSidebar.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the genealogy volumes out of the main navigation (they live on the tree page bar)", () => {
    render(
      <MemoryRouter>
        <SiteHeader />
        <BottomNav />
      </MemoryRouter>,
    );

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));

    expect(hrefs.filter((href) => href === "/genealogyBook")).toHaveLength(0);
    expect(hrefs.filter((href) => href === "/people")).toHaveLength(0);
    expect(screen.queryByText("Genealogy")).toBeNull();
    expect(screen.queryByText("People")).toBeNull();
  });

  it("keeps the family entry selected on the other volumes and on detail routes", () => {
    for (const path of ["/familyTree", "/people", "/genealogyBook", "/person/7", "/editor/7"]) {
      mocks.activePath = path;

      render(
        <MemoryRouter>
          <SiteHeader />
          <BottomNav />
        </MemoryRouter>,
      );

      const familyEntries = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/familyTree")
        .map((link) => link.className);

      expect(familyEntries).toHaveLength(2);
      // Header pill and bottom-nav item both light up for the whole section.
      expect(familyEntries.some((className) => className.includes("bg-slate-900"))).toBe(true);
      expect(familyEntries.some((className) => className.includes("text-orange-600"))).toBe(true);

      cleanup();
    }
  });
});
