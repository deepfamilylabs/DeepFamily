// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BottomNav from "./BottomNav";
import GlobalSidebar from "./GlobalSidebar";

const mocks = vi.hoisted(() => ({
  activePath: "/genealogyBook",
  setActivePath: vi.fn(),
  closeMobileSidebar: vi.fn(),
  togglePanel: vi.fn(),
  closePanel: vi.fn(),
  toggleTheme: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const labels: Record<string, string> = {
        "navigation.home": "Home",
        "navigation.familyTree": "Family",
        "navigation.people": "People",
        "navigation.genealogyBook": "Genealogy",
        "navigation.search": "Search",
        "navigation.actions": "Actions",
      };
      return labels[key] || fallback || key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("../context", () => ({
  useActivePath: () => ({
    activePath: mocks.activePath,
    setActivePath: mocks.setActivePath,
  }),
  useSidebar: () => ({
    isMobileOpen: false,
    closeMobileSidebar: mocks.closeMobileSidebar,
    activePanel: null,
    togglePanel: mocks.togglePanel,
    closePanel: mocks.closePanel,
  }),
  useTheme: () => ({ isDark: false, toggleTheme: mocks.toggleTheme }),
}));

vi.mock("../../shared/ui", () => ({
  useResponsiveModalMode: () => true,
}));

vi.mock("./Logo", () => ({
  default: (props: any) => <svg data-testid="logo" {...props} />,
}));

/** The two surfaces that carry section entries: the rail and the bottom nav. */
function renderNavigation() {
  return render(
    <MemoryRouter>
      <GlobalSidebar />
      <BottomNav />
    </MemoryRouter>,
  );
}

describe("genealogy volume navigation", () => {
  beforeEach(() => {
    mocks.activePath = "/genealogyBook";
    mocks.setActivePath.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the genealogy volumes out of the main navigation (they live on the tree page bar)", () => {
    renderNavigation();

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));

    expect(hrefs.filter((href) => href === "/genealogyBook")).toHaveLength(0);
    expect(hrefs.filter((href) => href === "/people")).toHaveLength(0);
    expect(screen.queryByText("Genealogy")).toBeNull();
    expect(screen.queryByText("People")).toBeNull();
  });

  it("keeps the family entry selected on the other volumes and on detail routes", () => {
    for (const path of ["/familyTree", "/people", "/genealogyBook", "/person/7", "/editor/7"]) {
      mocks.activePath = path;

      renderNavigation();

      const familyEntries = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/familyTree");

      // Both surfaces light up for the whole section.
      expect(familyEntries).toHaveLength(2);
      for (const entry of familyEntries) {
        expect(entry.className).toContain("text-orange-600");
      }
      expect(
        familyEntries.some((entry) => entry.getAttribute("aria-current") === "page"),
      ).toBe(true);

      cleanup();
    }
  });
});
