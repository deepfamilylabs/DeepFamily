// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

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

vi.mock("./StatusBar", () => ({
  default: () => <div data-testid="status-bar">status-bar</div>,
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
  afterEach(() => {
    cleanup();
  });

  it("renders home as a full-width page shell", () => {
    renderLayout("/");

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByTestId("global-sidebar")).toBeTruthy();
    expect(screen.getByTestId("page-content").textContent).toBe("home-content");
    expect(screen.queryByTestId("page-container")).toBeNull();
    expect(screen.getByTestId("bottom-nav")).toBeTruthy();
    expect(screen.getByTestId("floating-action-button")).toBeTruthy();
    expect(screen.getByTestId("status-bar")).toBeTruthy();
  });

  it("wraps non-full-width pages in PageContainer and keeps the rail offset", () => {
    const { container } = renderLayout("/actions");

    expect(screen.getByTestId("page-container")).toBeTruthy();
    expect(screen.getByTestId("page-content").textContent).toBe("actions-content");

    const main = container.querySelector("main");
    expect(main?.className).toContain("md:pl-16");
  });

  it("keeps tree route full-width behind the same rail offset", () => {
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

  it("keeps the status bar on every route — it replaced the landing-page footer", () => {
    renderLayout("/actions");

    expect(screen.getByTestId("status-bar")).toBeTruthy();
  });
});
