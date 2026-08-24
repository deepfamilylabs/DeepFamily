// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui";
import { SecureKeyDerivation } from "./SecureKeyDerivation";

const mocks = vi.hoisted(() => ({
  cryptoWorkerCall: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      const template = typeof fallbackOrOptions === "string" ? fallbackOrOptions : key;
      const values =
        fallbackOrOptions && typeof fallbackOrOptions === "object" ? fallbackOrOptions : options;
      return template.replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(values?.[name] ?? ""));
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: any[]) => mocks.cryptoWorkerCall(...args),
}));

describe("SecureKeyDerivation passphrase policy", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    });
    mocks.cryptoWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockImplementation((method: string) => {
      if (method === "computeIdentityHash") {
        return Promise.resolve({ identityHash: `0x${"12".repeat(32)}` });
      }
      if (method === "deriveKey") {
        return Promise.resolve({
          key: `0x${"34".repeat(32)}`,
          address: `0x${"56".repeat(20)}`,
        });
      }
      return Promise.reject(new Error(`unexpected worker method ${method}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requires an explicit warning for protocol Unicode-whitespace-only input", async () => {
    render(
      <ToastProvider>
        <SecureKeyDerivation />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("search.hashCalculator.nameInputPlaceholder"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Enter any characters—family mottos or secret phrases. 15+ characters with mixed symbols recommended",
      ),
      { target: { value: "\u0085\u3000" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Repeat the identity passphrase (empty is allowed)"),
      { target: { value: "\u0085\u3000" } },
    );

    const deriveButton = screen.getByRole("button", {
      name: "keyDerivation.component.deriveButton",
    });
    await waitFor(() => expect((deriveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(deriveButton);

    expect(await screen.findByText(/recommendations\.unicodeWhitespace/)).toBeTruthy();
    expect(mocks.cryptoWorkerCall).not.toHaveBeenCalledWith(
      "deriveKey",
      expect.anything(),
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "keyDerivation.component.proceedAnyway" }));
    await waitFor(() =>
      expect(mocks.cryptoWorkerCall).toHaveBeenCalledWith(
        "deriveKey",
        expect.objectContaining({
          input: expect.objectContaining({ passphrase: "\u0085\u3000" }),
        }),
        expect.anything(),
      ),
    );
  });
});
