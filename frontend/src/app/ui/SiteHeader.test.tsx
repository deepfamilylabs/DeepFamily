// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import SiteHeader from "./SiteHeader";

const mocks = vi.hoisted(() => ({
  activePath: "/people",
  setActivePath: vi.fn(),
  toggleMobileSidebar: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const labels: Record<string, string> = {
        "navigation.home": "Home",
        "navigation.familyTree": "Family",
        "navigation.people": "People",
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
    isMobileOpen: false,
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <SiteHeader />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("SiteHeader", () => {
  beforeEach(() => {
    mocks.activePath = "/people";
    mocks.setActivePath.mockReset();
    mocks.toggleMobileSidebar.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("starts after the rail so the two never overlap", () => {
    const { container } = renderHeader();

    expect(container.querySelector("header")?.className).toContain("md:pl-16");
  });

  it("leaves the desktop bar to the nav — no page title where the brand was", () => {
    const { container } = renderHeader();

    // /people is not a nav entry and must not be spelled out anywhere either.
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/people");
    expect(container.querySelector("header")?.textContent).not.toContain("People");
  });

  it("hands a query to /search rather than searching in the bar itself", () => {
    renderHeader();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  0xabc  " } });
    fireEvent.submit(screen.getByRole("search"));

    expect(screen.getByTestId("location").textContent).toBe("/search?q=0xabc");
    expect(mocks.setActivePath).toHaveBeenCalledWith("/search");
  });

  it("ignores an empty query instead of navigating to a blank search", () => {
    renderHeader();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("search"));

    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("carries no section entries — the rail owns those", () => {
    const { container } = renderHeader();

    expect(container.querySelector("nav")).toBeNull();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    // Only the mobile brand mark links out of the header.
    expect(hrefs).toEqual(["/"]);
  });

  it("keeps the brand and the drawer trigger for the breakpoints with no rail", () => {
    renderHeader();

    // Below md the rail is off-canvas, so the brand belongs to the header again.
    const brand = screen.getByTestId("logo").closest("div");
    expect(brand?.className).toContain("md:hidden");
    expect(screen.getByText("Deepfamily")).toBeTruthy();

    const trigger = screen.getByLabelText("Open menu");
    expect(trigger.getAttribute("aria-controls")).toBe("global-sidebar");

    fireEvent.click(trigger);
    expect(mocks.toggleMobileSidebar).toHaveBeenCalledTimes(1);
  });
});
