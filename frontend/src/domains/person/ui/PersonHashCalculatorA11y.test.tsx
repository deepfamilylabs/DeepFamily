// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui";
import { PersonHashCalculator } from "./PersonHashCalculator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      const template = typeof fallbackOrOptions === "string" ? fallbackOrOptions : key;
      const values =
        fallbackOrOptions && typeof fallbackOrOptions === "object" ? fallbackOrOptions : options;
      if (key === "search.hashCalculator.passphraseCharCount") {
        return `Characters after NFKD (not trimmed): ${String(values?.count ?? "")}`;
      }
      return template.replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(values?.[name] ?? ""));
    },
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("PersonHashCalculator accessibility", () => {
  it("exposes local themed selects as keyboard listboxes", () => {
    render(
      <ToastProvider>
        <PersonHashCalculator showTitle={false} />
      </ToastProvider>,
    );

    const genderTrigger = screen.getByRole("button", {
      name: "search.hashCalculator.genderOptions.unknown",
    });

    expect(genderTrigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(genderTrigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(genderTrigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox");
    expect(genderTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(genderTrigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(genderTrigger.getAttribute("aria-activedescendant")).toBeTruthy();

    fireEvent.keyDown(genderTrigger, { key: "ArrowDown" });

    const maleOption = screen.getByRole("option", {
      name: "search.hashCalculator.genderOptions.male",
    });
    expect(genderTrigger.getAttribute("aria-activedescendant")).toBe(maleOption.id);

    fireEvent.keyDown(genderTrigger, { key: "Enter" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "search.hashCalculator.genderOptions.male" }),
    ).toBeTruthy();
  });

  it("keeps local themed select pointer selection working", () => {
    render(
      <ToastProvider>
        <PersonHashCalculator showTitle={false} />
      </ToastProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "search.hashCalculator.genderOptions.unknown" }),
    );

    const maleOption = screen.getByRole("option", {
      name: "search.hashCalculator.genderOptions.male",
    });
    fireEvent.mouseDown(maleOption);
    fireEvent.click(maleOption);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "search.hashCalculator.genderOptions.male" }),
    ).toBeTruthy();
  });

  it("exposes passphrase help as a modal dialog", async () => {
    render(
      <ToastProvider>
        <PersonHashCalculator showTitle={false} />
      </ToastProvider>,
    );

    const helpButton = screen.getByRole("button", { name: "Identity passphrase help" });

    helpButton.focus();
    fireEvent.click(helpButton);

    const dialog = screen.getByRole("dialog", { name: "Passphrase Information" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Passphrase Information" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(helpButton));
  });

  it("warns that protocol Unicode whitespace is not trimmed", () => {
    render(
      <ToastProvider>
        <PersonHashCalculator showTitle={false} />
      </ToastProvider>,
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Enter any characters—family mottos or secret phrases. 15+ characters with mixed symbols recommended",
      ),
      { target: { value: "\u0085\u3000" } },
    );

    expect(
      screen.getByText(/contains only Unicode White_Space after NFKD normalization/i),
    ).toBeTruthy();
    expect(screen.getByText("Characters after NFKD (not trimmed): 2")).toBeTruthy();
  });
});
