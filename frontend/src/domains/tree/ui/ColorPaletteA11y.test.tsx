// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColorThemeProvider } from "../context";
import ColorPalette from "./ColorPalette";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
});

describe("ColorPalette accessibility", () => {
  it("labels the color popover and closes it from keyboard", () => {
    render(
      <ColorThemeProvider>
        <ColorPalette />
      </ColorThemeProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Change color theme" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    const palette = screen.getByRole("group", { name: "Color themes" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(palette.id);
    expect(screen.getByRole("button", { name: "Set color theme to Red" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "Color themes" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
