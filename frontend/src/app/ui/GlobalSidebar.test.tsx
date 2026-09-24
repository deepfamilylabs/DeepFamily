// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import GlobalSidebar from "./GlobalSidebar";

const mocks = vi.hoisted(() => ({
  isMobileOpen: false,
  isDesktop: true,
  activePath: "/family",
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
        "navigation.inheritance": "Inheritance",
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
  default: ({ monochrome, ...props }: any) => (
    <svg data-testid="logo" data-monochrome={monochrome ? "true" : undefined} {...props} />
  ),
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
    mocks.activePath = "/family";
    mocks.closeMobileSidebar.mockReset();
    mocks.setActivePath.mockReset();
    mocks.closePanel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("runs the full viewport height and stacks above the header and status bar", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar");

    expect(rail?.className).toContain("inset-y-0");
    expect(rail?.className).not.toContain("md:top-16");
    // The header is z-100 and the status bar z-10001: the open rail overlays both.
    expect(rail?.className).toContain("md:z-10004");
    expect(rail?.className).not.toContain("md:pb-[var(--app-statusbar-h)]");
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

    expect(labels).toEqual(["Home", "Family", "Create", "Inheritance"]);
  });

  it("keeps the desktop rail to routes — settings and the logo page live in the status bar", () => {
    const { container } = renderSidebar();

    expect(screen.queryByLabelText("Language")).toBeNull();
    expect(screen.queryByLabelText("Theme")).toBeNull();
    expect(screen.queryByText("Logo")).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();
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

  it("lights the inheritance row on its own route", () => {
    mocks.activePath = "/inheritance";
    renderSidebar();

    const inheritance = screen.getByLabelText("Inheritance");
    expect(inheritance.getAttribute("href")).toBe("/inheritance");
    expect(inheritance.getAttribute("aria-current")).toBe("page");
    expect(inheritance.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("marks the current section by shape, not colour alone — solid glyph, outlines elsewhere", () => {
    renderSidebar();

    const glyph = (label: string) => screen.getByLabelText(label).querySelector("svg");
    expect(glyph("Family")?.getAttribute("fill")).toBe("currentColor");
    expect(glyph("Home")?.getAttribute("fill")).toBe("none");
    expect(glyph("Create")?.getAttribute("fill")).toBe("none");
  });

  it("keeps the current section on a fill, and gives other rows one only under the pointer", () => {
    renderSidebar();

    expect(screen.getByLabelText("Family").className).toMatch(/(^|\s)bg-surface-muted(\s|$)/);

    const home = screen.getByLabelText("Home");
    expect(home.className).toContain("hover:bg-surface-muted");
    expect(home.className).not.toMatch(/(^|\s)bg-/);
  });

  it("sits flat beside the page when folded and lifts off it when open", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar")!;

    expect(rail.className).toContain("md:shadow-none");
    fireEvent.mouseEnter(rail);
    expect(rail.className).not.toContain("md:shadow-none");
  });

  it("routes are links, so they open in a new tab like any other", () => {
    renderSidebar();

    expect(screen.getByLabelText("Create").getAttribute("href")).toBe("/create");
  });

  it("carries every route in the mobile drawer, the same as the rail", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    // There is no bottom nav, so the drawer is the only way to them below md.
    expect(screen.getByLabelText("Home").getAttribute("href")).toBe("/");
    expect(screen.getByLabelText("Family").getAttribute("href")).toBe("/family");
    expect(screen.getByLabelText("Create").getAttribute("href")).toBe("/create");
  });

  it("orders the drawer like the rail, then the language and theme rows", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    const { container } = renderSidebar();

    const labels = [...container.querySelectorAll('[id^="sidebar-item-"]')].map((row) =>
      row.getAttribute("aria-label"),
    );

    expect(labels).toEqual(["Home", "Family", "Create", "Inheritance", "Language", "Theme"]);
  });

  it("shows the current language beside its drawer row", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    expect(screen.getByRole("button", { name: "Language" }).textContent).toContain("English");
  });

  it("closes the drawer with the social and legal links the status bar carries", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/privacy", "/terms"]));
    expect(screen.getByLabelText("X").getAttribute("target")).toBe("_blank");
    expect(screen.getByLabelText("Telegram")).toBeTruthy();
    expect(screen.getByLabelText("GitHub")).toBeTruthy();
    const logo = screen.getByRole("link", { name: "Logo" });
    expect(logo.getAttribute("href")).toBe("/logo.html");
    expect(logo.getAttribute("target")).toBe("_blank");
    // An icon leading the social ones, as in the status bar — not a word among the legal links.
    expect(logo.textContent).toBe("");
    expect(logo.querySelector("svg")?.getAttribute("data-monochrome")).toBe("true");
    expect(logo.nextElementSibling).toBe(screen.getByLabelText("X"));
  });

  it("leaves the footer links to the status bar on desktop", () => {
    renderSidebar();

    expect(screen.queryByLabelText("GitHub")).toBeNull();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/terms");
  });

  it("leaves the network menu to the status bar at every breakpoint", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: "RPC network" })).toBeNull();
    cleanup();

    // The status bar is on screen below md too, so the drawer does not repeat it.
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();
    expect(screen.queryByRole("button", { name: "RPC network" })).toBeNull();
  });

  it("closes the drawer when a route row is picked", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    renderSidebar();

    fireEvent.click(screen.getByLabelText("Create"));
    expect(mocks.setActivePath).toHaveBeenCalledWith("/create");
    expect(mocks.closeMobileSidebar).toHaveBeenCalled();
  });

  it("folds the rail straight after a pointer pick, while the pointer is still over it", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar")!;

    fireEvent.mouseEnter(rail);
    expect(rail.className).toContain("md:w-56");

    const actions = screen.getByLabelText("Create");
    actions.focus();
    fireEvent.click(actions, { detail: 1 });

    expect(rail.className).toContain("md:w-16");
    expect(rail.className).not.toContain("md:w-56");
    // focus-within would otherwise hold the rail open all the same.
    expect(document.activeElement).not.toBe(actions);
  });

  it("stays folded until the pointer leaves, then hovering opens it again", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar")!;

    fireEvent.mouseEnter(rail);
    fireEvent.click(screen.getByLabelText("Home"), { detail: 1 });
    fireEvent.mouseEnter(rail);
    expect(rail.className).toContain("md:w-16");

    fireEvent.mouseLeave(rail);
    fireEvent.mouseEnter(rail);
    expect(rail.className).toContain("md:w-56");
  });

  it("folds the rail after picking the brand mark too", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar")!;

    fireEvent.mouseEnter(rail);
    fireEvent.click(screen.getByText("Deepfamily").closest("a")!, { detail: 1 });

    expect(rail.className).toContain("md:w-16");
  });

  it("flips the theme from the drawer without closing it", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
    mocks.toggleTheme.mockReset();
    renderSidebar();
    // Mounting already closes the drawer once (the route-change effect).
    const closesBefore = mocks.closeMobileSidebar.mock.calls.length;

    fireEvent.click(screen.getByRole("switch", { name: "Theme" }), { detail: 1 });

    expect(mocks.toggleTheme).toHaveBeenCalledTimes(1);
    expect(mocks.closeMobileSidebar.mock.calls.length).toBe(closesBefore);
  });

  it("keeps focus and the open rail for keyboard activation — it is the only way back", () => {
    const { container } = renderSidebar();
    const rail = container.querySelector("#global-sidebar")!;

    const actions = screen.getByLabelText("Create");
    actions.focus();
    fireEvent.click(actions, { detail: 0 });

    expect(document.activeElement).toBe(actions);
    expect(rail.className).toContain("md:w-56");
  });

  it("closes the language panel once a language is picked", () => {
    mocks.isDesktop = false;
    mocks.isMobileOpen = true;
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
