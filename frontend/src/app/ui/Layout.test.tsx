// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

vi.mock("../../shared/ui", async () => ({
  PageContainer: (await import("../../shared/ui/PageContainer")).default,
}));

vi.mock("./SiteHeader", () => ({
  default: () => <div data-testid="site-header">site-header</div>,
}));

vi.mock("./GlobalSidebar", () => ({
  default: () => <div data-testid="global-sidebar">global-sidebar</div>,
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
          <Route path="/create" element={<div data-testid="page-content">create-content</div>} />
          <Route
            path="/inheritance"
            element={<div data-testid="page-content">inheritance-content</div>}
          />
          <Route path="/people" element={<div data-testid="page-content">people-content</div>} />
          <Route path="/family" element={<div data-testid="page-content">tree-content</div>} />
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

  it.each([
    ["/create", "create-content"],
    ["/inheritance", "inheritance-content"],
  ])("gives %s the same content width, page spacing and rail offset", (route, content) => {
    const { container } = renderLayout(route);
    const main = container.querySelector("main");
    const pageContainer = main?.firstElementChild;

    expect(screen.getByTestId("page-content").textContent).toBe(content);
    expect(screen.getByTestId("page-content").parentElement).toBe(pageContainer);
    expect(main?.classList.contains("md:pl-16")).toBe(true);
    expect(main?.querySelectorAll(".max-w-7xl")).toHaveLength(1);
    for (const className of [
      "max-w-7xl",
      "mx-auto",
      "px-4",
      "sm:px-6",
      "lg:px-8",
      "pt-10",
      "pb-[calc(var(--app-statusbar-h)+1rem)]",
    ]) {
      expect(pageContainer?.classList.contains(className)).toBe(true);
    }
  });

  it.each([
    ["/", "home-content"],
    ["/people", "people-content"],
    ["/family", "tree-content"],
    ["/genealogyBook", "genealogy-content"],
  ])("keeps %s full-width behind the shared rail", (route, content) => {
    const { container } = renderLayout(route);
    const main = container.querySelector("main");

    expect(screen.getByTestId("page-content").textContent).toBe(content);
    expect(screen.getByTestId("page-content").parentElement).toBe(main);
    expect(main?.querySelector(".max-w-7xl")).toBeNull();
    expect(main?.classList.contains("md:pl-16")).toBe(true);
    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByTestId("global-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("floating-action-button")).toBeNull();
    expect(screen.getByTestId("status-bar")).toBeTruthy();
  });

  it("keeps the status bar on every route — it replaced the landing-page footer", () => {
    renderLayout("/create");

    expect(screen.getByTestId("status-bar")).toBeTruthy();
  });
});
