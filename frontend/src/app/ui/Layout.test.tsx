// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

const mocks = vi.hoisted(() => ({
  activeSection: null as string | null,
}));

vi.mock("../context", () => ({
  useSidebar: () => ({
    activeSection: mocks.activeSection,
  }),
}));

vi.mock("../../shared/ui", () => ({
  PageContainer: ({ children, className }: any) => (
    <div data-testid="page-container" data-class-name={className}>
      {children}
    </div>
  ),
}));

vi.mock("./SiteHeader", () => ({
  default: () => <div data-testid="site-header">site-header</div>,
}));

vi.mock("./GlobalSidebar", () => ({
  default: () => <div data-testid="global-sidebar">global-sidebar</div>,
}));

vi.mock("./BottomNav", () => ({
  default: () => <div data-testid="bottom-nav">bottom-nav</div>,
}));

vi.mock("./FloatingActionButton", () => ({
  default: () => <div data-testid="floating-action-button">floating-action-button</div>,
}));

vi.mock("./SiteFooter", () => ({
  default: () => <div data-testid="site-footer">site-footer</div>,
}));

function renderLayout(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div data-testid="page-content">home-content</div>} />
          <Route path="/actions" element={<div data-testid="page-content">actions-content</div>} />
          <Route
            path="/familyTree"
            element={<div data-testid="page-content">tree-content</div>}
          />
          <Route
            path="/genealogyBook"
            element={<div data-testid="page-content">genealogy-content</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  beforeEach(() => {
    mocks.activeSection = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders home as a full-width page shell with footer", () => {
    renderLayout("/");

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByTestId("global-sidebar")).toBeTruthy();
    expect(screen.getByTestId("page-content").textContent).toBe("home-content");
    expect(screen.queryByTestId("page-container")).toBeNull();
    expect(screen.getByTestId("site-footer")).toBeTruthy();
    expect(screen.getByTestId("bottom-nav")).toBeTruthy();
    expect(screen.getByTestId("floating-action-button")).toBeTruthy();
  });

  it("wraps non-full-width pages in PageContainer and applies expanded sidebar padding", () => {
    mocks.activeSection = "familyTree";

    const { container } = renderLayout("/actions");

    expect(screen.getByTestId("page-container")).toBeTruthy();
    expect(screen.queryByTestId("site-footer")).toBeNull();
    expect(screen.getByTestId("page-content").textContent).toBe("actions-content");

    const main = container.querySelector("main");
    expect(main?.className).toContain("md:pl-96");
  });

  it("keeps tree route full-width even when sidebar is collapsed", () => {
    const { container } = renderLayout("/familyTree");

    expect(screen.getByTestId("page-content").textContent).toBe("tree-content");
    expect(screen.queryByTestId("page-container")).toBeNull();

    const main = container.querySelector("main");
    expect(main?.className).toContain("md:pl-16");
  });

  it("keeps genealogy book route full-width for the paper preview surface", () => {
    renderLayout("/genealogyBook");

    expect(screen.getByTestId("page-content").textContent).toBe("genealogy-content");
    expect(screen.queryByTestId("page-container")).toBeNull();
  });
});
