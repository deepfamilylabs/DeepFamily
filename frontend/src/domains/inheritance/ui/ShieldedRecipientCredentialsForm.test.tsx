// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";

const workerCall = vi.hoisted(() => vi.fn());
const suites = vi.hoisted(() => ({ supported: null as number[] | null }));

vi.mock("@deepfamily/protocol-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@deepfamily/protocol-core")>();
  return {
    ...actual,
    get DEFAULT_IDENTITY_SUITE_ID() {
      return suites.supported?.[0] ?? actual.DEFAULT_IDENTITY_SUITE_ID;
    },
    get SUPPORTED_IDENTITY_SUITE_IDS() {
      return suites.supported ?? actual.SUPPORTED_IDENTITY_SUITE_IDS;
    },
  };
});
vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({ cryptoWorkerCall: workerCall }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) =>
      typeof fallbackOrOptions === "string" ? fallbackOrOptions : key,
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  workerCall.mockClear();
  suites.supported = null;
});

function renderForm(onChange?: () => void) {
  const ref = createRef<ShieldedRecipientCredentialsFormHandle>();
  render(
    <ToastProvider>
      <ShieldedRecipientCredentialsForm ref={ref} onChange={onChange} />
    </ToastProvider>,
  );
  return ref;
}

function changeName(fullName: string) {
  const input = screen.getByPlaceholderText("search.hashCalculator.nameInputPlaceholder");
  fireEvent.change(input, { target: { value: fullName } });
  return input as HTMLInputElement;
}

function changePassphrase(rawPassphrase: string) {
  const input = screen.getByLabelText("Identity passphrase");
  fireEvent.change(input, { target: { value: rawPassphrase } });
  return input as HTMLInputElement;
}

function chooseOption(currentLabel: string, nextLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: currentLabel }));
  fireEvent.click(screen.getByRole("option", { name: nextLabel }));
}

describe("ShieldedRecipientCredentialsForm", () => {
  it("keeps the secret after a lookup read and clears it once the code is generated", () => {
    const ref = renderForm();
    changeName("Recipient");
    const password = changePassphrase("child identity secret");
    const expected = {
      identity: { fullName: "Recipient", gender: 0, isBirthBC: false, birthYear: 0, birthMonth: 0, birthDay: 0 },
      rawPassphrase: "child identity secret",
    };
    expect(ref.current?.read()).toEqual(expected);
    expect(password.value).toBe("child identity secret");
    let credentials;
    act(() => { credentials = ref.current?.readAndClear(); });
    expect(credentials).toEqual(expected);
    expect(password.value).toBe("");
  });

  it("leaves the suite to the enclosing input and reports every edit", () => {
    suites.supported = [2, 1];
    const onChange = vi.fn();
    renderForm(onChange);
    expect(screen.queryByRole("combobox")).toBeNull();
    onChange.mockClear();
    changeName("Recipient");
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    changePassphrase("another secret");
    expect(onChange).toHaveBeenCalled();
  });

  it("reads the shared identity fields and clears the unchanged raw passphrase immediately", () => {
    const ref = renderForm();
    changeName("张三");
    chooseOption(
      "search.hashCalculator.genderOptions.unknown",
      "search.hashCalculator.genderOptions.male",
    );
    chooseOption("search.hashCalculator.bcOptions.ad", "search.hashCalculator.bcOptions.bc");
    const [year, month, day] = screen.getAllByRole("spinbutton");
    fireEvent.change(year, { target: { value: "35" } });
    fireEvent.change(month, { target: { value: "2" } });
    fireEvent.change(day, { target: { value: "14" } });
    const rawPassphrase = "  child identity secret\u00a0";
    const password = changePassphrase(rawPassphrase);

    let credentials;
    act(() => {
      credentials = ref.current?.readAndClear();
    });
    expect(credentials).toEqual({
      identity: {
        fullName: "张三",
        gender: 1,
        isBirthBC: true,
        birthYear: 35,
        birthMonth: 2,
        birthDay: 14,
      },
      rawPassphrase,
    });
    expect(password.value).toBe("");
  });

  it("preserves public fields while clearing secrets and maps unknown dates to zero", () => {
    const ref = renderForm();
    const name = changeName("  Ａlice  ");
    const password = changePassphrase("recipient secret");
    act(() => ref.current?.clearSecretInputs());
    expect(password.value).toBe("");
    expect(name.value).toBe("  Ａlice  ");

    changePassphrase("x");
    expect(screen.queryByRole("button", { name: "Identity passphrase help" })).toBeNull();
    expect(screen.queryByText("Weak")).toBeNull();
    let credentials;
    act(() => {
      credentials = ref.current?.readAndClear();
    });
    expect(credentials).toEqual({
      identity: {
        fullName: "Ａlice",
        gender: 0,
        isBirthBC: false,
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
      },
      rawPassphrase: "x",
    });
    expect(password.value).toBe("");
  });

  it("keeps recipient edits out of automatic identity-hash worker calls", async () => {
    vi.useFakeTimers();
    const ref = renderForm();
    changeName("Recipient");
    changePassphrase("recipient identity secret");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(workerCall).not.toHaveBeenCalled();
    expect(screen.queryByText("search.hashCalculator.calculatedHash")).toBeNull();
    act(() => ref.current?.clearSecretInputs());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(workerCall).not.toHaveBeenCalled();
  });
});
