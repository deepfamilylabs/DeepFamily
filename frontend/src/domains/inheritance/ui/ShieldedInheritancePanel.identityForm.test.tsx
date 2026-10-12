// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { PersonHashCalculatorHandle } from "../../person/ui/PersonHashCalculator";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      key === "shielded.submit" && typeof options === "object" ? `${key}:${options.action}` : key,
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
vi.mock("../../tree/context", () => ({ useTreeGraphData: () => ({ nodesData: {} }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => null }));
vi.mock("../../../shared/config/env", () => ({ getShieldedPoolFactoryDeploymentBlock: () => 10 }));
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
  const { PersonHashCalculator } = await import("../../person/ui/PersonHashCalculator");
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
  funds: null,
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
        <ShieldedInheritancePanel
          modules={modules}
          signer={signer}
          account={address}
        />
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

  it("clears the prefilled form on explicit exit while re-unlocking and ignores the late result", async () => {
    render(panel());
    await unlockIdentity();
    applicationLock();
    const complete = deferUnlock();
    enterPassphrase();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expectEmptyIdentity();

    await act(async () => complete(unlocked));
    expectEmptyIdentity();
    expect(screen.queryByRole("tab", { name: "shielded.groups.wallet" })).toBeNull();
  });

  it("clears newly entered details when cancelling the first unlock", async () => {
    render(panel());
    const complete = deferUnlock();
    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expectEmptyIdentity();

    await act(async () => complete(unlocked));
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

  it("submits original credentials under fixed funds rules even when the identity hash preview is unavailable", async () => {
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
            fullName: rawName,
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
        rawPassphrase,
      }),
    );
  });

  it.each(["birthYear", "birthMonth", "birthDay"] as const)(
    "rejects a fractional %s without truncating the original funds credentials",
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
