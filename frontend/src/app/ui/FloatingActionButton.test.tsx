// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FloatingActionButton from "./FloatingActionButton";

const mocks = vi.hoisted(() => ({
  setActivePath: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../context", () => ({
  useActivePath: () => ({
    setActivePath: mocks.setActivePath,
  }),
}));

function renderFab(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<FloatingActionButton />} />
        <Route path="/actions" element={<FloatingActionButton />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FloatingActionButton", () => {
  afterEach(() => {
    cleanup();
    mocks.setActivePath.mockReset();
  });

  it("labels the icon-only menu button and hides closed actions from keyboard access", () => {
    renderFab();

    const openButton = screen.getByRole("button", { name: "Open actions menu" });

    expect(openButton.getAttribute("aria-expanded")).toBe("false");
    const addVersionAction = screen.getByRole("button", { name: "Add Version" });
    const menu = addVersionAction.closest("[id]");

    expect(menu?.hasAttribute("inert")).toBe(true);
    expect(addVersionAction.getAttribute("tabindex")).toBe("-1");

    fireEvent.click(openButton);

    const closeButton = screen.getByRole("button", { name: "Close actions menu" });

    expect(closeButton.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.hasAttribute("inert")).toBe(false);
    expect(addVersionAction.getAttribute("tabindex")).toBe("0");
  });

  it("moves focus back to the main button before closing the menu", () => {
    renderFab();

    const openButton = screen.getByRole("button", { name: "Open actions menu" });
    fireEvent.click(openButton);

    const addVersionAction = screen.getByRole("button", { name: "Add Version" });
    addVersionAction.focus();
    expect(document.activeElement).toBe(addVersionAction);

    fireEvent.click(screen.getByRole("button", { name: "Close actions menu" }));

    expect(document.activeElement).toBe(openButton);
    expect(openButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses back to its trigger after routing to the actions page", () => {
    renderFab();

    fireEvent.click(screen.getByRole("button", { name: "Open actions menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Version" }));

    // The menu collapses but the button stays mounted, so the shortcut is still
    // available once the actions page has rendered.
    const trigger = screen.getByRole("button", { name: "Open actions menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.setActivePath).toHaveBeenCalledWith("/actions");
  });

  it("still offers the shortcut on the actions page itself", () => {
    renderFab("/actions");

    expect(screen.getByRole("button", { name: "Open actions menu" })).toBeTruthy();
  });
});
