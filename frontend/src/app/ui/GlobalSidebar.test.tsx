// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import GlobalSidebar from "./GlobalSidebar";

const mocks = vi.hoisted(() => ({
  isMobileOpen: false,
  isDesktop: true,
  activePath: "/familyTree",
  closeMobileSidebar: vi.fn(),
  setActivePath: vi.fn(),
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
      };
      return labels[key] ?? fallback ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("../context", () => ({
  useSidebar: () => ({
    isMobileOpen: mocks.isMobileOpen,
    closeMobileSidebar: mocks.closeMobileSidebar,
    activePanel: null,
    togglePanel: mocks.togglePanel,
    closePanel: mocks.closePanel,
  }),
  useTheme: () => ({ isDark: false, toggleTheme: mocks.toggleTheme }),
  useActivePath: () => ({ activePath: mocks.activePath, setActivePath: mocks.setActivePath }),
}));

vi.mock("../../shared/ui", () => ({
  useResponsiveModalMode: () => mocks.isDesktop,
}));

vi.mock("./Logo", () => ({
  default: (props: any) => <svg data-testid="logo" {...props} />,
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <GlobalSidebar />
    </MemoryRouter>,
  );
}

describe("GlobalSidebar", () => {
  beforeEach(() => {
    mocks.isMobileOpen = false;
    mocks.isDesktop = true;
    mocks.activePath = "/familyTree";
    mocks.closeMobileSidebar.mockReset();
    mocks.setActivePath.mockReset();
    mocks.closePanel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("runs the full viewport height and stacks above the header", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar");

    expect(rail?.className).toContain("inset-y-0");
    expect(rail?.className).not.toContain("md:top-16");
    // The header is z-100: the rail has to win the top-left corner it now owns.
    expect(rail?.className).toContain("md:z-110");
  });

  it("holds the brand, collapsed to the mark until the labels come in", () => {
    renderSidebar();

    const wordmark = screen.getByText("Deepfamily");
    expect(wordmark.className).toContain("opacity-0");
    expect(wordmark.closest("a")?.getAttribute("href")).toBe("/");
    // Collapsed rows name themselves with a tooltip; so does the mark.
    expect(screen.getByTitle("Deepfamily")).toBeTruthy();
  });

  it("orders the rail routes first and the settings after them", () => {
    const { container } = renderSidebar();

    const labels = [...container.querySelectorAll('[id^="sidebar-item-"]')].map((row) =>
      row.getAttribute("aria-label"),
    );

    expect(labels).toEqual(["Home", "Family", "Actions", "Language", "Theme", "Logo"]);
  });

  it("lights the row for the section the route belongs to, not the open panel", () => {
    mocks.activePath = "/people";
    renderSidebar();

    // /people is a family volume, so Family stays lit.
    const family = screen.getByLabelText("Family");
    expect(family.getAttribute("aria-current")).toBe("page");
    expect(family.className).toContain("text-orange-600");
    expect(screen.getByLabelText("Home").getAttribute("aria-current")).toBeNull();
  });

  it("routes are links, so they open in a new tab like any other", () => {
    renderSidebar();

    expect(screen.getByLabelText("Actions").getAttribute("href")).toBe("/actions");
  });

  it("drops the entries the bottom nav already carries from the mobile drawer", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    // Home and Family are one tap away down there; Actions is not.
    expect(screen.queryByLabelText("Home")).toBeNull();
    expect(screen.queryByLabelText("Family")).toBeNull();
    expect(screen.getByLabelText("Actions")).toBeTruthy();
  });

  it("closes the drawer when a route row is picked", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    fireEvent.click(screen.getByLabelText("Actions"));
    expect(mocks.setActivePath).toHaveBeenCalledWith("/actions");
    expect(mocks.closeMobileSidebar).toHaveBeenCalled();
  });

  it("releases focus after a pointer click, so the rail collapses on mouse-out", () => {
    renderSidebar();

    const actions = screen.getByLabelText("Actions");
    actions.focus();
    fireEvent.click(actions, { detail: 1 });

    // focus-within would otherwise hold the rail open after the pointer left.
    expect(document.activeElement).not.toBe(actions);
  });

  it("keeps focus for keyboard activation — it is the only way back to the rail", () => {
    renderSidebar();

    const actions = screen.getByLabelText("Actions");
    actions.focus();
    fireEvent.click(actions, { detail: 0 });

    expect(document.activeElement).toBe(actions);
  });

  it("closes the language panel once a language is picked", () => {
    renderSidebar();

    fireEvent.click(screen.getByText("简体中文"));

    expect(mocks.closePanel).toHaveBeenCalled();
  });

  it("shows the wordmark and the close button in the mobile drawer", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    expect(screen.getByText("Deepfamily").className).toContain("opacity-100");
    expect(screen.getByLabelText("Close menu").className).toContain("md:hidden");
  });
});
