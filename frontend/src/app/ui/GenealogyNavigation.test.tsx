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

describe("genealogy book navigation", () => {
  beforeEach(() => {
    mocks.activePath = "/genealogyBook";
    mocks.setActivePath.mockReset();
    mocks.toggleMobileSidebar.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes genealogy book links in the desktop header and mobile bottom nav", () => {
    render(
      <MemoryRouter>
        <SiteHeader />
        <BottomNav />
      </MemoryRouter>,
    );

    const links = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/genealogyBook");

    expect(links).toHaveLength(2);
    expect(screen.getAllByText("Genealogy")).toHaveLength(2);
  });
});
