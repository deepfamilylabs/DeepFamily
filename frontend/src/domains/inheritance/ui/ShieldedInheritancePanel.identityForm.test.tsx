// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { PersonHashCalculatorHandle } from "../../person";
import { ToastProvider } from "../../../shared/ui";
import type { ShieldedAssetSessionState } from "../../../shared/workers/shieldedAssetWorkerTypes";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";
import {
  ShieldedIdentitySessionProvider,
  useShieldedPageIdentitySession,
} from "./ShieldedIdentitySessionContext";
import { SHIELDED_IDENTITY_IDLE_TIMEOUT_MS } from "./useShieldedIdentitySession";

const mocks = vi.hoisted(() => ({
  supportedSuites: null as number[] | null,
  call: vi.fn(),
  crypto: vi.fn<
    (
      method: string,
      params: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<{ identityHash: string }>
  >(() => new Promise(() => {})),
  cancel: vi.fn(async () => {}),
  terminate: vi.fn(),
  terminateZk: vi.fn(),
  generation: 0,
  listeners: new Set<() => void>(),
  form: null as PersonHashCalculatorHandle | null,
}));

vi.mock("@deepfamily/protocol-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@deepfamily/protocol-core")>();
  return {
    ...actual,
    get SUPPORTED_IDENTITY_SUITE_IDS() {
      return mocks.supportedSuites ?? actual.SUPPORTED_IDENTITY_SUITE_IDS;
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (key === "shielded.identitySuiteOption" && typeof options === "object") return `Suite ${options.suite}`;
      return key === "shielded.submit" && typeof options === "object" ? `${key}:${options.action}` : key;
    },
    i18n: { language: "en" },
  }),
}));
vi.mock("../../config", () => ({
  useConfig: () => ({
    rpcUrl: "https://rpc.example",
    chainId: 31337,
    tokenAddress: "0x0000000000000000000000000000000000000003",
  }),
}));
vi.mock("../../tree", () => ({ useTreeGraphData: () => ({ nodesData: {} }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => null }));
vi.mock("../../../shared/config/env", () => ({
  getShieldedPoolFactoryDeploymentBlock: () => 10,
  getPrivateLetterArchiveAddress: () => "",
  getPrivateLetterArchiveDeploymentBlock: () => 0,
  getEventScanConfig: () => ({ blockChunk: 10_000 }),
}));
vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({ cryptoWorkerCall: mocks.crypto }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({ terminateZkWorker: mocks.terminateZk }));
vi.mock("../../../shared/workers/shieldedAssetWorkerClient", () => ({
  shieldedAssetWorkerCall: mocks.call,
  cancelShieldedAssetPreview: mocks.cancel,
  terminateShieldedAssetWorker: mocks.terminate,
  getShieldedAssetWorkerGeneration: () => mocks.generation,
  subscribeShieldedAssetWorkerLock: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock("../services/shieldedReceiveCode", () => ({
  verifyShieldedReceiveCode: vi.fn(),
  createShieldedReceiveCodeForRecipient: vi.fn(),
  peekShieldedReceiveCodePersonHash: () => null,
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitShield: vi.fn(),
  submitFund: vi.fn(),
  submitClaim: vi.fn(),
  submitPrivateTransfer: vi.fn(),
  submitUnshield: vi.fn(),
}));
// Keep the real form and its React Hook Form state; expose its existing public
// handle so the tests also check the values a subsequent unlock would submit.
vi.mock("../../person", async () => {
  const React = await import("react");
  const { default: PersonHashCalculator } = await vi.importActual<{ default: typeof import("../../person").PersonHashCalculator }>("../../person/ui/PersonHashCalculator");
  return {
    PersonHashCalculator: React.forwardRef<
      PersonHashCalculatorHandle,
      React.ComponentProps<typeof PersonHashCalculator>
    >((props, ref) => (
      <PersonHashCalculator
        {...props}
        ref={(handle) => {
          mocks.form = handle;
          if (typeof ref === "function") ref(handle);
          else if (ref) ref.current = handle;
        }}
      />
    )),
  };
});

const address = "0x00000000000000000000000000000000000000aa";
const identity = {
  handle: "identity:1",
  identitySuiteId: 1,
  identityCommitment: "1",
  personHash: "0x" + "01".repeat(32),
  identity: { fullName: "Alice" },
};
const unlocked: ShieldedAssetSessionState = {
  credentials: { handle: "credentials:1" },
  identity,
  independentKey: null,
};
const modules = {
  chainId: 31337n,
  poolAddress: address,
  assetKind: "native",
  assetSymbol: "CFX",
  tokenDecimals: 18,
  poolDeploymentBlock: 20,
  pool: {},
  factory: { target: address },
  deepFamily: { target: address },
  lineageIndex: { target: address },
} as unknown as ShieldedPageModules;
const signer = { getAddress: vi.fn(async () => address) } as unknown as Signer;
const emptyWallet = {
  toBlock: 30,
  blockHash: "0xabc",
  notes: [],
  policies: [],
  templates: [],
  claims: [],
  parentVersions: [],
  children: [],
};

function SessionObserver() {
  const { identity: currentIdentity, identityDraft } = useShieldedPageIdentitySession();
  return (
    <output data-testid="session-state">
      {JSON.stringify({ identity: currentIdentity, identityDraft })}
    </output>
  );
}

function panel(enabled = true) {
  return (
    <ToastProvider>
      <ShieldedIdentitySessionProvider scope="31337:factory" enabled={enabled}>
        <ShieldedInheritancePanel modules={modules} signer={signer} account={address} />
        <SessionObserver />
      </ShieldedIdentitySessionProvider>
    </ToastProvider>
  );
}

function sessionState() {
  return JSON.parse(screen.getByTestId("session-state").textContent ?? "null");
}

function nameInput() {
  return screen.getByPlaceholderText(
    "search.hashCalculator.nameInputPlaceholder",
  ) as HTMLInputElement;
}

function dateInput(name: "birthYear" | "birthMonth" | "birthDay") {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function enterIdentity() {
  fireEvent.change(nameInput(), { target: { value: "Alice" } });
  fireEvent.change(dateInput("birthYear"), { target: { value: "2000" } });
  fireEvent.change(dateInput("birthMonth"), { target: { value: "2" } });
  fireEvent.change(dateInput("birthDay"), { target: { value: "3" } });
  enterPassphrase();
}

function enterPassphrase() {
  fireEvent.change(screen.getByLabelText("search.hashCalculator.passphrase"), {
    target: { value: "private-identity-passphrase" },
  });
}

async function unlockIdentity() {
  enterIdentity();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
  });
  await waitFor(() => expect(sessionState().identity?.handle).toBe(identity.handle));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

function applicationLock() {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(sessionState().identity).toBeNull();
  expect(nameInput().value).toBe("Alice");
  expect(dateInput("birthYear").value).toBe("2000");
  expect(dateInput("birthMonth").value).toBe("2");
  expect(dateInput("birthDay").value).toBe("3");
}

function expectEmptyIdentity() {
  expect(nameInput().value).toBe("");
  expect(dateInput("birthYear").value).toBe("");
  expect(dateInput("birthMonth").value).toBe("");
  expect(dateInput("birthDay").value).toBe("");
  expect(mocks.form?.getPublicFormData()).toMatchObject({
    fullName: "",
    birthYear: 0,
    birthMonth: 0,
    birthDay: 0,
    hasPassphrase: false,
  });
  expect(sessionState()).toEqual({ identity: null, identityDraft: null });
}

function deferUnlock() {
  let complete!: (state: ShieldedAssetSessionState) => void;
  mocks.call.mockImplementation((method: string) => {
    if (method === "unlockIdentity")
      return new Promise((resolve) => {
        complete = resolve;
      });
    if (method === "recover") return Promise.resolve(emptyWallet);
    throw new Error(`Unexpected Worker call: ${method}`);
  });
  return (state: ShieldedAssetSessionState) => complete(state);
}

describe("Shielded identity form privacy with a real session and form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supportedSuites = null;
    mocks.crypto.mockImplementation(() => new Promise(() => {}));
    mocks.generation = 0;
    mocks.form = null;
    mocks.listeners.clear();
    mocks.terminate.mockImplementation(() => {
      mocks.generation++;
      for (const listener of [...mocks.listeners]) listener();
    });
    mocks.call.mockImplementation(async (method: string) => {
      if (method === "unlockIdentity") return unlocked;
      if (method === "recover") return emptyWallet;
      throw new Error(`Unexpected Worker call: ${method}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows progress only in the unlock button without adding exit or cancellation controls", async () => {
    const complete = deferUnlock();
    render(panel());
    expect(screen.queryByRole("button", { name: /shielded\.identitySuite/ })).toBeNull();
    enterIdentity();
    const unlockButton = screen.getByRole("button", { name: "shielded.unlock" });
    const content = unlockButton.parentElement!;
    const children = Array.from(content.children);

    fireEvent.click(unlockButton);
    expect(Array.from(content.children)).toEqual(children);
    expect(unlockButton.getAttribute("aria-busy")).toBe("true");
    expect((unlockButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(unlockButton).getByRole("status").textContent).toBe(
      "shielded.walletKeys.unlocking",
    );
    expect(screen.queryByRole("button", { name: "common.cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.lock" })).toBeNull();
    expect(screen.getAllByText("shielded.walletKeys.unlocking")).toHaveLength(1);

    await act(async () => complete(unlocked));
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(screen.getByRole("button", { name: "shielded.lock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "common.cancel" })).toBeNull();
  });

  const suite1 = { identitySuiteId: 1, personHash: identity.personHash };
  const suite2 = { identitySuiteId: 2, personHash: "0x" + "23".repeat(32) };
  const pressUnlock = () => fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
  const unlockedCalls = () => mocks.call.mock.calls.filter(([method]) => method === "unlockIdentity");

  it.each([suite1, suite2])("opens only the chooser and unlocks the selected suite $identitySuiteId in one click", async (chosen) => {
    mocks.supportedSuites = [2, 1];
    render(panel());
    enterIdentity();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /findRegisteredIdentity|identitySuite|searchIdentities/ })).toBeNull();
    expect(screen.getAllByRole("textbox")).toEqual([nameInput()]);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.crypto).not.toHaveBeenCalled();

    mocks.call.mockResolvedValueOnce({ matches: [suite2, suite1] });
    pressUnlock();
    const dialog = await screen.findByRole("dialog", { name: "shielded.registeredIdentities" });
    expect(within(dialog).getByRole("button", { name: `Suite 2 ${suite2.personHash}` })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: `Suite 1 ${suite1.personHash}` })).toBeTruthy();
    expect(unlockedCalls()).toHaveLength(0);
    expect(sessionState().identity).toBeNull();
    mocks.call.mockResolvedValueOnce({ ...unlocked, identity: { ...identity, ...chosen } });
    fireEvent.click(within(dialog).getByRole("button", { name: `Suite ${chosen.identitySuiteId} ${chosen.personHash}` }));
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(chosen.personHash));
    expect(unlockedCalls()).toEqual([["unlockIdentity", expect.objectContaining({
      identitySuiteId: chosen.identitySuiteId, expectedPersonHash: chosen.personHash,
    })]]);
    expect(sessionState().identityDraft.identitySuiteId).toBe(chosen.identitySuiteId);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the only registered identity on the first unlock, even when a newer suite is supported", async () => {
    mocks.supportedSuites = [2, 1];
    render(panel());
    enterIdentity();
    mocks.call.mockResolvedValueOnce({ matches: [suite1] });
    pressUnlock();
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(suite1.personHash));
    expect(mocks.call).toHaveBeenCalledWith("findRegisteredIdentities", {
      context: expect.anything(),
      identity: expect.objectContaining({ fullName: "Alice" }), rawPassphrase: "private-identity-passphrase",
    });
    expect(unlockedCalls()).toEqual([["unlockIdentity", expect.objectContaining({
      identitySuiteId: 1, expectedPersonHash: suite1.personHash,
    })]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dialog on Escape, returns focus to Unlock, and discards the old matches", async () => {
    mocks.supportedSuites = [1, 2];
    render(panel());
    enterIdentity();
    const button = screen.getByRole("button", { name: "shielded.unlock" });
    button.focus();
    mocks.call.mockResolvedValueOnce({ matches: [suite1, suite2] });
    pressUnlock();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(unlockedCalls()).toHaveLength(0);
    mocks.call.mockResolvedValueOnce({ matches: [suite1] });
    pressUnlock();
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(suite1.personHash));
  });

  it("keeps local wallet access when lookup confirms there is no registered version", async () => {
    mocks.supportedSuites = [2, 1];
    render(panel());
    enterIdentity();
    mocks.call.mockResolvedValueOnce({ matches: [] });
    pressUnlock();
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(identity.personHash));
    expect(unlockedCalls()[0][1].identitySuiteId).toBe(1);
    expect(unlockedCalls()[0][1]).not.toHaveProperty("expectedPersonHash");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers both registrations on re-unlock even when the previous identity used suite 2", async () => {
    mocks.supportedSuites = [2, 1];
    render(panel());
    enterIdentity();
    mocks.call.mockResolvedValueOnce({ matches: [suite2] })
      .mockResolvedValueOnce({ ...unlocked, identity: { ...identity, ...suite2 } });
    pressUnlock();
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(suite2.personHash));
    applicationLock();
    expect(sessionState().identityDraft.identitySuiteId).toBe(2);

    enterPassphrase();
    mocks.call.mockResolvedValueOnce({ matches: [suite2, suite1] });
    pressUnlock();
    const dialog = await screen.findByRole("dialog");
    expect(unlockedCalls()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: `Suite 1 ${suite1.personHash}` }));
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(suite1.personHash));
    const attempts = unlockedCalls();
    expect(attempts).toHaveLength(2);
    expect(attempts[1][1]).toMatchObject({ identitySuiteId: 1, expectedPersonHash: suite1.personHash });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries a failed registration lookup from the same Unlock button", async () => {
    mocks.supportedSuites = [1, 2];
    render(panel());
    enterIdentity();
    mocks.call.mockRejectedValueOnce(new Error("RPC unavailable"));
    pressUnlock();
    expect((await screen.findByRole("alert")).textContent).toBe("shielded.identityLookupFailed");
    expect(unlockedCalls()).toHaveLength(0);
    mocks.call.mockResolvedValueOnce({ matches: [suite1] });
    pressUnlock();
    await waitFor(() => expect(sessionState().identity?.personHash).toBe(suite1.personHash));
  });

  it.each([[suite1], [suite1, suite2], []].map(matches => ({ matches })))(
    "discards an in-flight lookup after a passphrase edit", async (result) => {
      mocks.supportedSuites = [1, 2];
      render(panel());
      enterIdentity();
      let finish!: (value: unknown) => void;
      mocks.call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      pressUnlock();
      fireEvent.change(screen.getByLabelText("search.hashCalculator.passphrase"), { target: { value: "other-password" } });
      await act(async () => finish(result));
      expect(unlockedCalls()).toHaveLength(0);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("discards an open chooser when the wallet disconnects", async () => {
    mocks.supportedSuites = [1, 2];
    const mounted = render(panel());
    enterIdentity();
    mocks.call.mockResolvedValueOnce({ matches: [suite1, suite2] });
    pressUnlock();
    await screen.findByRole("dialog");
    mounted.rerender(panel(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.form?.hasPassphrase()).toBe(false);
    expect(unlockedCalls()).toHaveLength(0);
  });

  it("returns to the unlock action after failure without leaving progress or exit controls", async () => {
    mocks.call.mockRejectedValueOnce(new Error("Unlock failed"));
    render(panel());
    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));

    expect((await screen.findByRole("alert")).textContent).toBe("shielded.unknownError");
    expect(screen.getByText("Unlock failed").closest("details")?.open).toBe(false);
    expect(
      (screen.getByRole("button", { name: "shielded.unlock" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("shielded.walletKeys.unlocking")).toBeNull();
    expect(screen.queryByRole("button", { name: "common.cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.lock" })).toBeNull();
    expect(sessionState().identity).toBeNull();

    enterPassphrase();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(sessionState().identity?.handle).toBe(identity.handle));
  });

  it("clears the prefilled form when the wallet disconnects during re-unlocking and ignores the late result", async () => {
    const mounted = render(panel());
    await unlockIdentity();
    applicationLock();
    const complete = deferUnlock();
    enterPassphrase();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    mounted.rerender(panel(false));
    expectEmptyIdentity();

    await act(async () => complete(unlocked));
    expectEmptyIdentity();
    expect(screen.queryByRole("tab", { name: "shielded.groups.wallet" })).toBeNull();
  });

  it("ignores the first unlock result after the wallet disconnects", async () => {
    const mounted = render(panel());
    const complete = deferUnlock();
    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    mounted.rerender(panel(false));
    expect(sessionState()).toEqual({ identity: null, identityDraft: null });
    expect(
      (screen.getByLabelText("search.hashCalculator.passphrase") as HTMLInputElement).value,
    ).toBe("");

    await act(async () => complete(unlocked));
    expect(sessionState()).toEqual({ identity: null, identityDraft: null });
    expect(
      (screen.getByRole("button", { name: "shielded.unlock" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByRole("navigation", { name: "shielded.actionsTitle" })).toBeNull();
  });

  it("clears the identity form and retained draft when exiting an unlocked session", async () => {
    render(panel());
    await unlockIdentity();
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expectEmptyIdentity();
  });

  it("clears the mounted re-unlock form when the wallet disconnects", async () => {
    const mounted = render(panel());
    await unlockIdentity();
    applicationLock();
    mounted.rerender(panel(false));
    expectEmptyIdentity();
  });

  it("clears the mounted re-unlock form when its retained draft expires", async () => {
    vi.useFakeTimers();
    render(panel());
    enterIdentity();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sessionState().identity?.handle).toBe(identity.handle);
    applicationLock();
    await act(async () => vi.advanceTimersByTimeAsync(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expectEmptyIdentity();
  });
  it("offers only the four named gender options for unlocking", () => {
    render(panel());
    const genderTrigger = screen.getByRole("button", {
      name: "search.hashCalculator.genderOptions.unknown",
    });
    fireEvent.keyDown(genderTrigger, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      ["unknown", "male", "female", "other"].map(
        (gender) => `search.hashCalculator.genderOptions.${gender}`,
      ),
    );
  });
  it("shows the identity hash while entering unlock credentials", async () => {
    const previewHash = "0x" + "ab".repeat(32);
    mocks.crypto.mockResolvedValue({ identityHash: previewHash });
    render(panel());
    enterIdentity();

    await screen.findByText("search.hashCalculator.calculatedHash:");
    expect(mocks.crypto).toHaveBeenLastCalledWith(
      "computeIdentityHash",
      {
        input: expect.objectContaining({
          fullName: "Alice",
          passphrase: "private-identity-passphrase",
        }),
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(document.body.textContent).toContain(previewHash);
    expect(sessionState().identity).toBeNull();
  });

  it("cancels the hash preview before unlocking and ignores its late result", async () => {
    vi.useFakeTimers();
    let finishPreview!: (result: { identityHash: string }) => void;
    mocks.crypto.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    );
    const complete = deferUnlock();
    render(panel());
    enterIdentity();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    const options = mocks.crypto.mock.calls[mocks.crypto.mock.calls.length - 1][2] as {
      signal: AbortSignal;
    };
    expect(options.signal.aborted).toBe(false);
    const previewCalls = mocks.crypto.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    expect(options.signal.aborted).toBe(true);
    expect(screen.queryByText("search.hashCalculator.calculatingHash")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(mocks.crypto).toHaveBeenCalledTimes(previewCalls);

    const lateHash = "0x" + "cd".repeat(32);
    await act(async () => {
      finishPreview({ identityHash: lateHash });
      complete(unlocked);
    });
    expect(document.body.textContent).not.toContain(lateHash);
    expect(sessionState().identity?.personHash).toBe(identity.personHash);
  });

  it("uses shared trim-only preparation even when the identity hash preview is unavailable", async () => {
    mocks.crypto.mockResolvedValue({ identityHash: "" });
    render(panel());
    const rawName = "  Ａlice\u3000Example  ";
    const rawPassphrase = "  original\u00a0passphrase  ";
    fireEvent.change(nameInput(), { target: { value: rawName } });
    fireEvent.change(dateInput("birthYear"), { target: { value: "65535" } });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.passphrase"), {
      target: { value: rawPassphrase },
    });
    expect(dateInput("birthYear").max).toBe("65535");
    expect(mocks.form?.getRawIdentityFields().fullName).toBe(rawName);
    await waitFor(() =>
      expect(mocks.crypto).toHaveBeenCalledWith(
        "computeIdentityHash",
        {
          input: expect.objectContaining({
            fullName: "Ａlice\u3000Example",
            birthYear: 65535,
            passphrase: rawPassphrase,
          }),
        },
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith("unlockIdentity", {
        identity: expect.objectContaining({ fullName: rawName, birthYear: 65535 }),
        identitySuiteId: 1,
        rawPassphrase,
      }),
    );
  });

  it("preserves fullwidth names, combining sequences, middle dots and joiners throughout asset unlock", async () => {
    const rawName = "\u0085　Ａlice\u00a0  张·王e\u0301\u200d　";
    const preparedName = "Ａlice\u00a0  张·王e\u0301\u200d";
    const rawPassphrase = "\u0085　家训·e\u0301\u200d\u00a0密语　";
    const previewHash = "0x" + "ab".repeat(32);
    mocks.crypto.mockResolvedValue({ identityHash: previewHash });
    render(panel());
    fireEvent.change(nameInput(), { target: { value: rawName } });
    const passphraseInput = screen.getByLabelText(
      "search.hashCalculator.passphrase",
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, { target: { value: rawPassphrase } });
    expect(mocks.form?.getPublicFormData().fullName).toBe(preparedName);
    expect(mocks.form?.getRawIdentityFields().fullName).toBe(rawName);
    expect(passphraseInput.value).toBe(rawPassphrase);
    await waitFor(() =>
      expect(mocks.crypto).toHaveBeenCalledWith(
        "computeIdentityHash",
        {
          input: expect.objectContaining({ fullName: preparedName, passphrase: rawPassphrase }),
        },
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith("unlockIdentity", {
        identity: expect.objectContaining({ fullName: rawName }),
        identitySuiteId: 1,
        rawPassphrase,
      }),
    );
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(passphraseInput.value).toBe("");
  });

  it.each(["birthYear", "birthMonth", "birthDay"] as const)(
    "rejects a fractional %s without truncating the original independent-key credentials",
    async (field) => {
      render(panel());
      enterIdentity();
      fireEvent.change(dateInput(field), {
        target: { value: field === "birthYear" ? "2000.5" : "1.5" },
      });
      expect(mocks.form?.getRawIdentityFields()[field]).toBe(field === "birthYear" ? 2000.5 : 1.5);
      fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
      await screen.findByRole("alert");
      expect(mocks.call.mock.calls.some(([method]) => method === "unlockIdentity")).toBe(false);
    },
  );
});
