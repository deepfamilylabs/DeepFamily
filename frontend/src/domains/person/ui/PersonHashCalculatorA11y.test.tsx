// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui";
import { createRef } from "react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "./PersonHashCalculator";
import type { PersonIdentityCandidate } from "../../../shared/workers/cryptoWorkerClient";

const release = vi.hoisted(() => ({ suites: [1] }));
vi.mock("@deepfamily/protocol-core", async importOriginal => ({
  ...await importOriginal<typeof import("@deepfamily/protocol-core")>(),
  get DEFAULT_IDENTITY_SUITE_ID() { return release.suites[0]; },
  get SUPPORTED_IDENTITY_SUITE_IDS() { return release.suites; },
}));

const workerCall = vi.hoisted(() =>
  vi.fn<
    (
      method: string,
      params: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<{ identityHash: string } | PersonIdentityCandidate[]>
  >(() => new Promise(() => {})),
);

vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({ cryptoWorkerCall: workerCall }));

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  workerCall.mockClear();
  release.suites = [1];
});

describe("PersonHashCalculator accessibility", () => {
  it("does not render an add-version protocol control when the release defaults to suite 1", () => {
    release.suites = [1, 2];
    render(<ToastProvider><PersonHashCalculator identityRole="person" /></ToastProvider>);
    expect(screen.queryByRole("button", { name: "addVersion.identityProtocol" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps a manual selection made during discovery and reuses candidates when switching back", async () => {
    release.suites = [2, 1];
    vi.useFakeTimers();
    const ref = createRef<PersonHashCalculatorHandle>();
    const candidates: PersonIdentityCandidate[] = [
      { identitySuiteId: 2, personHash: "0x" + "22".repeat(32), history: "registered" },
      { identitySuiteId: 1, personHash: "0x" + "11".repeat(32), history: "none" },
    ];
    let finishLookup!: (result: PersonIdentityCandidate[]) => void;
    workerCall.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }));
    render(<ToastProvider>
      <PersonHashCalculator ref={ref} identityRole="father" initialValues={{ fullName: "Alice" }}
        identityLookupContext={{ chainId: 31337, rpcUrl: "http://localhost", familyAddress: "family" }} />
    </ToastProvider>);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    const protocol = screen.getByRole("button", { name: "addVersion.identityProtocol" });
    fireEvent.click(protocol);
    fireEvent.click(screen.getByRole("option", { name: "addVersion.identityProtocol" }));
    await act(async () => finishLookup(candidates));
    expect(ref.current?.getPublicFormData()).toMatchObject({ identitySuiteId: 1, resolvedPersonHash: candidates[1].personHash });
    fireEvent.click(protocol);
    fireEvent.click(screen.getByRole("option", { name: /addVersion.defaultProtocol/ }));
    expect(ref.current?.getPublicFormData()).toMatchObject({ identitySuiteId: 2, resolvedPersonHash: candidates[0].personHash });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(workerCall).toHaveBeenCalledTimes(1);
  });

  it("waits for matching passphrases, retries failed discovery and discards the resolved identity after edits", async () => {
    vi.useFakeTimers();
    const ref = createRef<PersonHashCalculatorHandle>();
    const context = { chainId: 31337, rpcUrl: "http://localhost", familyAddress: "family" };
    const match: PersonIdentityCandidate = { identitySuiteId: 1, personHash: "0x" + "ab".repeat(32), history: "registered" };
    workerCall.mockRejectedValueOnce(new Error("RPC unavailable")).mockResolvedValueOnce([match]);
    render(
      <ToastProvider>
        <PersonHashCalculator ref={ref} showTitle={false} requirePassphraseConfirmation
          identityLookupContext={context} initialValues={{ fullName: "Alice" }} />
      </ToastProvider>,
    );
    const password = screen.getByLabelText("Identity passphrase");
    const repeat = screen.getByPlaceholderText("Repeat the identity passphrase (empty is allowed)");
    fireEvent.change(password, { target: { value: "old credentials" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(workerCall).not.toHaveBeenCalled();
    fireEvent.change(repeat, { target: { value: "old credentials" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("alert").textContent).toContain("addVersion.identityLookupFailed");
    expect(ref.current?.getPublicFormData().identitySuiteId).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(ref.current?.getPublicFormData()).toMatchObject({ identitySuiteId: 1, resolvedPersonHash: match.personHash });
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(password, { target: { value: "new credentials" } });
    expect(ref.current?.getPublicFormData().resolvedPersonHash).toBeUndefined();
    act(() => ref.current?.clearSecretInputs());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(workerCall).toHaveBeenCalledTimes(2);
  });
  it("reads identity credentials without automatically calculating a hash when disabled", async () => {
    vi.useFakeTimers();
    const ref = createRef<PersonHashCalculatorHandle>();
    render(
      <ToastProvider>
        <PersonHashCalculator
          ref={ref}
          showTitle={false}
          computeHash={false}
          showPassphraseGuidance={false}
          initialValues={{ fullName: "Alice" }}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("search.hashCalculator.nameInputPlaceholder"), {
      target: { value: "Bob" },
    });
    const passphrase = screen.getByLabelText("Identity passphrase") as HTMLInputElement;
    fireEvent.change(passphrase, {
      target: { value: "  x  " },
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(ref.current?.getPublicFormData()).toMatchObject({
      fullName: "Bob",
      hasPassphrase: true,
    });
    expect(ref.current?.getSecretInputs()).toEqual({ passphrase: "  x  " });
    expect(workerCall).not.toHaveBeenCalled();
    expect(screen.queryByText("Computing identity hash...")).toBeNull();
    expect(screen.queryByText("search.hashCalculator.calculatedHash:")).toBeNull();
    expect(screen.queryByRole("button", { name: "Identity passphrase help" })).toBeNull();
    expect(screen.queryByText(/Characters used/)).toBeNull();
    expect(screen.queryByText("Weak")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show identity passphrase" }));
    expect(passphrase.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide identity passphrase" }));
    expect(passphrase.type).toBe("password");
    fireEvent.change(passphrase, { target: { value: "x\ud800" } });
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("invalid for these credentials");
    expect(passphrase.getAttribute("aria-invalid")).toBe("true");
    expect(passphrase.getAttribute("aria-describedby")).toBe(error.id);

    act(() => ref.current?.clearSecretInputs());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(ref.current?.getSecretInputs()).toEqual({ passphrase: "" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(workerCall).not.toHaveBeenCalled();
  });

  it("cancels outdated identity jobs on input changes and unmount", async () => {
    const { unmount } = render(
      <ToastProvider>
        <PersonHashCalculator showTitle={false} initialValues={{ fullName: "Alice" }} />
      </ToastProvider>,
    );
    await waitFor(() => expect(workerCall).toHaveBeenCalledTimes(1));
    const firstSignal = workerCall.mock.calls[0][2]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    fireEvent.change(screen.getByPlaceholderText("search.hashCalculator.nameInputPlaceholder"), {
      target: { value: "Bob" },
    });
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(workerCall).toHaveBeenCalledTimes(2));
    const nextSignal = workerCall.mock.calls[1][2]?.signal;
    expect(nextSignal?.aborted).toBe(false);

    unmount();
    expect(nextSignal?.aborted).toBe(true);
  });

  it.each([false, true])(
    "clears both passphrases and cancels hashing on pagehide persisted=%s",
    async (persisted) => {
      vi.useFakeTimers();
      render(
        <ToastProvider>
          <PersonHashCalculator
            showTitle={false}
            requirePassphraseConfirmation
            initialValues={{ fullName: "Alice" }}
          />
        </ToastProvider>,
      );
      const passphrase = screen.getByLabelText("Identity passphrase") as HTMLInputElement;
      const confirmation = screen.getByPlaceholderText(
        "Repeat the identity passphrase (empty is allowed)",
      ) as HTMLInputElement;
      fireEvent.change(passphrase, { target: { value: "pagehide-secret-7aQ!" } });
      fireEvent.change(confirmation, { target: { value: "pagehide-secret-7aQ!" } });
      fireEvent.click(screen.getByRole("button", { name: "Show identity passphrase" }));
      fireEvent.click(screen.getByRole("button", { name: "Show passphrase" }));
      await act(async () => vi.advanceTimersByTimeAsync(300));
      const signal = workerCall.mock.calls[workerCall.mock.calls.length - 1]?.[2]?.signal;
      expect(signal?.aborted).toBe(false);
      const callCount = workerCall.mock.calls.length;

      act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted })));

      expect(passphrase.value).toBe("");
      expect(confirmation.value).toBe("");
      expect(passphrase.type).toBe("password");
      expect(confirmation.type).toBe("password");
      expect(signal?.aborted).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(workerCall).toHaveBeenCalledTimes(callCount);
    },
  );

  it("keeps credentials out of public callbacks and clears detached inputs on unmount", () => {
    const onPublicFormChange = vi.fn();
    const { unmount } = render(
      <ToastProvider>
        <PersonHashCalculator
          computeHash={false}
          requirePassphraseConfirmation
          onPublicFormChange={onPublicFormChange}
        />
      </ToastProvider>,
    );
    const passphrase = screen.getByLabelText("Identity passphrase") as HTMLInputElement;
    const confirmation = screen.getByPlaceholderText(
      "Repeat the identity passphrase (empty is allowed)",
    ) as HTMLInputElement;
    const secret = "unmount-secret-a\u030a-8kP!";
    fireEvent.change(passphrase, { target: { value: secret } });
    fireEvent.change(confirmation, { target: { value: secret } });

    expect(onPublicFormChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPassphrase: true }),
    );
    expect(JSON.stringify(onPublicFormChange.mock.calls)).not.toContain(secret);
    expect(onPublicFormChange.mock.calls.every(([data]) => !("passphrase" in data))).toBe(true);
    expect(passphrase.getAttribute("value")).toBeNull();
    expect(confirmation.getAttribute("value")).toBeNull();
    unmount();

    expect(passphrase.value).toBe("");
    expect(confirmation.value).toBe("");
  });

  it("remasks a revealed passphrase when the browser loses focus", () => {
    render(
      <ToastProvider>
        <PersonHashCalculator computeHash={false} />
      </ToastProvider>,
    );
    const passphrase = screen.getByLabelText("Identity passphrase") as HTMLInputElement;
    fireEvent.change(passphrase, { target: { value: "focus-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Show identity passphrase" }));
    expect(passphrase.type).toBe("text");

    act(() => window.dispatchEvent(new Event("blur")));

    expect(passphrase.type).toBe("password");
    expect(passphrase.value).toBe("focus-secret");
  });

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

  it("counts whitespace-only identity input as the empty public passphrase", () => {
    const ref = createRef<PersonHashCalculatorHandle>();
    render(
      <ToastProvider>
        <PersonHashCalculator ref={ref} showTitle={false} />
      </ToastProvider>,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Enter a personal passphrase, preferably 15 or more characters"),
      { target: { value: "\u00a0\u3000" } },
    );

    expect(ref.current?.hasPassphrase()).toBe(false);
    expect(screen.queryByText(/Characters used:/)).toBeNull();
    expect(screen.getByText(/Only leading and trailing whitespace is removed/)).toBeTruthy();
  });

  it("shows a refused passphrase error and removes a previously computed hash", async () => {
    const hash = `0x${"12".repeat(32)}`;
    const onComputedHashChange = vi.fn();
    workerCall.mockImplementationOnce(async () => ({ identityHash: hash }));
    render(
      <ToastProvider>
        <PersonHashCalculator
          showTitle={false}
          initialValues={{ fullName: "Alice" }}
          onComputedHashChange={onComputedHashChange}
        />
      </ToastProvider>,
    );

    await waitFor(() => expect(onComputedHashChange).toHaveBeenLastCalledWith(hash));
    const passphraseInput = screen.getByLabelText("Identity passphrase");
    fireEvent.change(passphraseInput, {
      target: { value: "family\ud800motto" },
    });

    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("invalid for these credentials");
    expect(passphraseInput.getAttribute("aria-invalid")).toBe("true");
    expect(passphraseInput.getAttribute("aria-describedby")).toBe(error.id);
    expect(screen.queryByText(hash)).toBeNull();
    await waitFor(() => expect(onComputedHashChange).toHaveBeenLastCalledWith(""));
    expect(workerCall).toHaveBeenCalledTimes(1);
  });

  it("does not treat two different refused passphrases as matching", () => {
    // Refused input normalizes to "", so comparing only normalized forms would
    // call any two refused passphrases a match and hide a real typo.
    const malformed = "\ud800";
    const ref = createRef<PersonHashCalculatorHandle>();
    render(
      <ToastProvider>
        <PersonHashCalculator ref={ref} showTitle={false} requirePassphraseConfirmation />
      </ToastProvider>,
    );
    const first = screen.getByPlaceholderText(
      "Enter a personal passphrase, preferably 15 or more characters",
    );
    const second = screen.getByPlaceholderText("Repeat the identity passphrase (empty is allowed)");

    fireEvent.change(first, { target: { value: `family${malformed}motto` } });
    fireEvent.change(second, { target: { value: `other${malformed}words` } });
    expect(ref.current?.passphrasesMatch()).toBe(false);

    fireEvent.change(second, { target: { value: `family${malformed}motto` } });
    expect(ref.current?.passphrasesMatch()).toBe(true);
  });

  it.each([
    [false, "\u0085 phrase\u3000", "phrase", true],
    [false, "e\u0301-secret", "é-secret", false],
    [false, "a\u00a0b", "a b", false],
    [false, "family\tmotto", "family\tmotto", true],
    [true, "\u0085 phrase\u3000", "phrase", true],
    [true, "e\u0301-secret", "é-secret", false],
    [true, "a\u00a0b", "a b", false],
    [true, "a·b", "c·d", false],
    [true, "张·王\u200d", "张·王\u200d", true],
    [true, "Ａ-secret", "A-secret", false],
    [true, "family\tmotto", "family\tmotto", true],
  ])(
    "uses the same trim-only confirmations in every credential form (independent=%s, first=%s)",
    (independentKeyCredentials, firstValue, secondValue, expectedMatch) => {
      const ref = createRef<PersonHashCalculatorHandle>();
      render(
        <ToastProvider>
          <PersonHashCalculator
            ref={ref}
            showTitle={false}
            computeHash={false}
            requirePassphraseConfirmation
            independentKeyCredentials={independentKeyCredentials}
          />
        </ToastProvider>,
      );
      fireEvent.change(screen.getByLabelText("Identity passphrase"), {
        target: { value: firstValue },
      });
      fireEvent.change(
        screen.getByPlaceholderText("Repeat the identity passphrase (empty is allowed)"),
        {
          target: { value: secondValue },
        },
      );
      expect(ref.current?.passphrasesMatch()).toBe(expectedMatch);
    },
  );

  it.each(["name", "passphrase", "confirmation"])(
    "rejects multiline paste into the %s field without changing its original value",
    (field) => {
      render(
        <ToastProvider>
          <PersonHashCalculator
            showTitle={false}
            computeHash={false}
            requirePassphraseConfirmation
          />
        </ToastProvider>,
      );
      const input = (
        field === "name"
          ? screen.getByPlaceholderText("search.hashCalculator.nameInputPlaceholder")
          : field === "passphrase"
            ? screen.getByLabelText("Identity passphrase")
            : screen.getByPlaceholderText("Repeat the identity passphrase (empty is allowed)")
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "existing text" } });
      const accepted = fireEvent.paste(input, {
        clipboardData: { getData: () => "first\r\nsecond" },
      });
      expect(accepted).toBe(false);
      expect(input.value).toBe("existing text");
      const error = screen.getByRole("alert");
      expect(error.textContent).toContain("cannot preserve line breaks");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);

      expect(fireEvent.paste(input, { clipboardData: { getData: () => "single line" } })).toBe(
        true,
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
