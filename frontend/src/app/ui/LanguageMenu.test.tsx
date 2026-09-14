// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LanguageMenu from "./LanguageMenu";

const mocks = vi.hoisted(() => ({
  language: "en",
  changeLanguage: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: mocks.language, changeLanguage: mocks.changeLanguage },
  }),
}));

function trigger() {
  return screen.getByRole("button", { name: /Language/ });
}

describe("LanguageMenu", () => {
  beforeEach(() => {
    mocks.language = "en";
    mocks.changeLanguage.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("names the current language on the trigger", () => {
    mocks.language = "zh-CN";
    render(<LanguageMenu />);

    expect(trigger().textContent).toContain("简体中文");
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("opens the choices with the current one checked, and closes once one is picked", () => {
    render(<LanguageMenu />);

    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: "English" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "简体中文" }));

    expect(mocks.changeLanguage).toHaveBeenCalledWith("zh-CN");
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("dismisses on Escape and on a click outside it", () => {
    render(<LanguageMenu />);

    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("radiogroup")).toBeNull();

    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("opens above the bar and toward the page, since it sits at the right end", () => {
    render(<LanguageMenu />);

    fireEvent.click(trigger());
    const menu = screen.getByRole("radiogroup");
    expect(menu.className).toContain("bottom-full");
    expect(menu.className).toContain("right-0");
  });
});
