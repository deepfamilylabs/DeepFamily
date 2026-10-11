// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import type { ShieldFlowInput, ShieldedPoolFlowResult } from "../services/shieldedPoolFlows";
import type {
  ShieldedAssetSessionState,
  ShieldedPublicFunds,
  ShieldedPublicIdentity,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { ShieldedInheritancePanel, type ShieldedPanelNavigation } from "./ShieldedInheritancePanel";
import {
  ShieldedIdentitySessionProvider,
  useShieldedPageIdentitySession,
} from "./ShieldedIdentitySessionContext";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  cancel: vi.fn(async () => {}),
  terminate: vi.fn(),
  terminateZk: vi.fn(),
  submitShield: vi.fn(),
  preview: null as Record<string, unknown> | null,
  generation: 0,
  listeners: new Set<() => void>(),
  workerState: { identity: null, funds: null } as ShieldedAssetSessionState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "shielded.submit" ? `${key}:${options?.action}` : key,
  }),
}));
vi.mock("../../config", () => ({ useConfig: () => ({ rpcUrl: "https://rpc.example" }) }));
vi.mock("../../tree/context", () => ({ useTreeGraphData: () => ({ nodesData: {} }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => null }));
vi.mock("../../../shared/config/env", () => ({ getShieldedPoolFactoryDeploymentBlock: () => 10 }));
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
vi.mock("../../../shared/workers/zkWorkerClient", () => ({ terminateZkWorker: mocks.terminateZk }));
vi.mock("../services/shieldedReceiveCode", () => ({
  verifyShieldedReceiveCode: vi.fn(),
  createShieldedReceiveCodeForRecipient: vi.fn(),
  peekShieldedReceiveCodePersonHash: (code: string) => code ? "0x" + "01".repeat(32) : null,
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitShield: mocks.submitShield,
  submitFund: vi.fn(),
  submitClaim: vi.fn(),
  submitPrivateTransfer: vi.fn(),
  submitUnshield: vi.fn(),
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props, ref) => {
      const input = React.useRef<HTMLInputElement>(null);
      React.useImperativeHandle(ref, () => ({
        getPublicFormData: () => ({
          fullName: "Child",
          gender: 1,
          birthYear: 2000,
          birthMonth: 1,
          birthDay: 1,
          isBirthBC: false,
        }),
        getSecretInputs: () => ({ passphrase: input.current?.value ?? "" }),
        clearSecretInputs: () => {
          if (input.current) input.current.value = "";
        },
      }));
      return <input ref={input} aria-label="identity passphrase" type="password" />;
    }),
  };
});

const address = "0x00000000000000000000000000000000000000aa";
const identity: ShieldedPublicIdentity = {
  handle: "identity:1",
  identitySuiteId: 1,
  identityCommitment: "1",
  personHash: "0x" + "01".repeat(32),
  identity: { fullName: "Child" },
};
const verifiedFunds: ShieldedPublicFunds = {
  ownerCommitment: "2",
  viewingKey: "0x" + "02".repeat(32),
  fundsFingerprint: "0x" + "03".repeat(32),
  rootSource: "imported",
  recoveryVerified: true,
  recoveryPath: "mnemonic",
  backupRequired: false,
};
const modules = {
  chainId: 31337n,
  poolAddress: address,
  assetKind: "native",
  assetSymbol: "CFX",
  assetAddress: address,
  tokenDecimals: 18,
  poolDeploymentBlock: 20,
  pool: {},
  factory: { target: address },
  deepFamily: { target: address },
  lineageIndex: { target: address },
} as unknown as ShieldedPageModules;
const emptyWallet = {
  toBlock: 30,
  blockHash: "0xabc",
  notes: [],
  policies: [],
  templates: [],
  claims: [],
  parentVersions: [0],
  children: [],
};
const signer = {
  getAddress: vi.fn(async () => address),
  signMessage: vi.fn(async () => "signature"),
  provider: {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getTransactionCount: vi.fn(async () => 0),
    getBlockNumber: vi.fn(async () => 30),
  },
} as unknown as Signer;

const sentShieldTransaction = {
  transactionHash: "0xshield",
  receipt: { status: 1 },
  gasEstimate: 100_000n,
  gasLimit: 120_000n,
} as ShieldedPoolFlowResult;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Match the real flow's wallet guard lifetime, including release before receipts.
async function submitShieldThroughWalletRequest(
  input: ShieldFlowInput,
  request: () => Promise<void> = async () => {},
  confirm: () => Promise<ShieldedPoolFlowResult> = async () => sentShieldTransaction,
) {
  input.onStage?.("submitting");
  const endWalletRequest = input.onWalletRequest?.();
  try {
    input.onSubmitting?.({ nonce: 1, fromBlock: 30, signerAddress: address });
    await request();
  } finally {
    endWalletRequest?.();
  }
  input.onBroadcast?.(sentShieldTransaction.transactionHash);
  input.onStage?.("confirming");
  return confirm();
}

function tokenModules(initialAllowance = 0n) {
  let allowance = initialAllowance;
  const token = {
    allowance: vi.fn(async () => allowance),
    approve: vi.fn(async (_spender: string, value: bigint) => ({
      hash: "0xapproval",
      wait: vi.fn(async () => {
        allowance = value;
        return { status: 1 };
      }),
    })),
    connect: vi.fn(),
  };
  token.connect.mockReturnValue(token);
  return {
    token,
    modules: { ...modules, assetKind: "erc20", assetSymbol: "TOKEN", token } as unknown as ShieldedPageModules,
  };
}

function documentVisibility() {
  let state: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  return (next: DocumentVisibilityState) => act(() => {
    state = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const label = (key: string) => `shielded.walletKeys.${key}`;
const submitLabel = /^shielded\.submit:shielded\.actions\./;
const click = (key: string) => fireEvent.click(
  key === "importRecovery" && screen.queryByRole("button", { name: label("verifySavedBackup") }) ||
  screen.getByRole("button", { name: label(key) }),
);
const task = (group: "wallet" | "inheritance" | "receive") =>
  screen.getByRole("tab", { name: `shielded.groups.${group}` });
const chooseTask = (group: "wallet" | "inheritance" | "receive") => fireEvent.click(task(group));

// Observe the real provider's public state. No session hook or context is mocked.
function SessionObserver() {
  const { identity: currentIdentity, funds } = useShieldedPageIdentitySession();
  return (
    <output data-testid="session-state">
      {JSON.stringify({ identity: currentIdentity, funds })}
    </output>
  );
}
function sessionState(): ShieldedAssetSessionState {
  return JSON.parse(screen.getByTestId("session-state").textContent ?? "null");
}
function renderPanel({
  navigation,
  assetControls,
  selectedModules = modules,
}: {
  navigation?: ShieldedPanelNavigation;
  assetControls?: ReactNode;
  selectedModules?: ShieldedPageModules;
} = {}) {
  return render(
    <ShieldedIdentitySessionProvider scope="31337:factory">
      <ShieldedInheritancePanel
        modules={selectedModules}
        signer={signer}
        account={address}
        publicActivityAddresses={new Set()}
        navigation={navigation}
        assetControls={assetControls}
      />
      <SessionObserver />
    </ShieldedIdentitySessionProvider>,
  );
}
function PoolNavigationHarness() {
  const [otherPool, setOtherPool] = useState(false);
  const [navigation, setNavigation] = useState<ShieldedPanelNavigation>({
    slot: "identity",
    action: "shield",
    walletAction: "shield",
    receiveSlot: "identity",
    taskChosen: false,
  });
  return (
    <ShieldedIdentitySessionProvider scope="31337:factory">
      <ShieldedInheritancePanel
        key={String(otherPool)}
        modules={otherPool ? {
          ...modules,
          poolAddress: "0x00000000000000000000000000000000000000bb",
        } : modules}
        signer={signer}
        account={address}
        publicActivityAddresses={new Set()}
        navigation={navigation}
        onNavigationChange={setNavigation}
      />
      <button type="button" onClick={() => setOtherPool(true)}>switch-pool</button>
      <SessionObserver />
    </ShieldedIdentitySessionProvider>
  );
}
async function unlockIdentity() {
  fireEvent.change(screen.getByLabelText("identity passphrase"), {
    target: { value: "private-identity-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
  await waitFor(() => expect(sessionState().identity?.handle).toBe(identity.handle));
  await waitFor(() => expect(screen.getByRole("tab", { name: "shielded.groups.receive" })).toBeTruthy());
  await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
}
function chooseIndependentBudget() {
  chooseTask("receive");
  chooseBudgetKey("asset");
}
function chooseBudgetKey(mode: "identity" | "asset") {
  const input = screen.getByLabelText(
    label(mode === "asset" ? "independentBudgets" : "identityBudgets"),
  ) as HTMLInputElement;
  fireEvent.click(input);
}
function chooseRecoveryPath(path: "mnemonic" | "shieldedKey" | "signature") {
  fireEvent.click(screen.getByRole("radio", { name: label(`${path}Restore`) }));
}
function openIndependentReceiving() {
  chooseTask("wallet");
  fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
  fireEvent.click(screen.getByRole("radio", { name: label("independentReceive") }));
}
async function restoreFunds() {
  if (!sessionState().identity) await unlockIdentity();
  openIndependentReceiving();
  click("showRestoreFunds");
  fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
    target: { value: "saved-independent-wallet-words" },
  });
  click("importRecovery");
  await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true"));
  await waitFor(() => expect(screen.getByRole("radio", { name: label("independentReceive") })).toBeTruthy());
  expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
  expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
}
function lockCurrentFlow() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
}

describe("Shielded budget flow with a real identity session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generation = 0;
    mocks.listeners.clear();
    mocks.workerState = { identity: null, funds: null };
    mocks.preview = null;
    mocks.submitShield.mockReset();
    mocks.submitShield.mockImplementation(submitShieldThroughWalletRequest);
    mocks.terminate.mockImplementation(() => {
      mocks.generation++;
      mocks.workerState = { identity: null, funds: null };
      for (const listener of [...mocks.listeners]) listener();
    });
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "unlockIdentity") {
        mocks.workerState = { identity, funds: mocks.workerState.funds };
        return mocks.workerState;
      }
      if (method === "importRecoveryMaterial") {
        mocks.workerState = { identity: mocks.workerState.identity, funds: verifiedFunds };
        return mocks.workerState;
      }
      if (method === "restoreSignature") {
        mocks.workerState = { identity: mocks.workerState.identity, funds: verifiedFunds };
        return mocks.workerState;
      }
      if (method === "clearFunds") {
        mocks.workerState = { identity: mocks.workerState.identity, funds: null };
        return mocks.workerState;
      }
      if (method === "createFunds") {
        mocks.workerState = {
          identity: mocks.workerState.identity,
          funds: {
            ...verifiedFunds,
            rootSource: "random",
            recoveryVerified: false,
            backupRequired: true,
          },
        };
        return mocks.workerState;
      }
      if (method === "exportRecoveryMaterial") {
        return {
          material: "original-secret-words",
          format: params.format,
          version: 1,
          fundsFingerprint: verifiedFunds.fundsFingerprint,
        };
      }
      if (method === "receiveCode") return { code: "budget-receive-code" };
      if (method === "recover") return emptyWallet;
      if (method === "discover") return { complete: true, pools: [] };
      if (method === "preview") {
        mocks.preview = params;
        return {
          handle: "preview:1",
          action: params.action,
          amount: params.amount ?? "1",
          slot: params.slot,
          steps: [],
          inputs: [],
          inputAmounts: [],
          outputAmounts: [String(params.amount ?? "1"), "0"],
        };
      }
      if (method === "prove") return {
        action: mocks.preview?.action,
        amount: mocks.preview?.amount,
        data: { outputCommitments: [31n, 32n] },
        proof: {},
      };
      throw new Error(`Unexpected Worker call: ${method}`);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps both unlocked credentials through ERC20 approval and refreshes the deposited balance", async () => {
    const fixture = tokenModules();
    const visibility = documentVisibility();
    const approvalRequest = deferred();
    const defaultApprove = fixture.token.approve.getMockImplementation()!;
    fixture.token.approve.mockImplementationOnce(async (...args) => {
      await approvalRequest.promise;
      return defaultApprove(...args);
    });
    let deposited = false;
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" && deposited ? {
      ...emptyWallet,
      notes: [{ commitment: "31", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "1250000000000000000" }],
    } : defaultCall?.(method, params));
    mocks.submitShield.mockImplementation(async (input: ShieldFlowInput) => {
      const submitted = await submitShieldThroughWalletRequest(input);
      deposited = true;
      return submitted;
    });
    renderPanel({ selectedModules: fixture.modules });
    await restoreFunds();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    fireEvent.change(screen.getByLabelText(label("assetSource")), { target: { value: "asset" } });
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const terminations = mocks.terminate.mock.calls.length;
    const scans = mocks.call.mock.calls.filter(([method]) => method === "recover").length;
    await waitFor(() => expect(screen.getByText(label("approveBeforeDeposit"))).toBeTruthy());
    click("approve");
    await waitFor(() => expect(fixture.token.approve).toHaveBeenCalledOnce());
    expect(fixture.token.approve).toHaveBeenCalledWith(address, 1_250_000_000_000_000_000n, { nonce: 0, chainId: 31337n });
    visibility("hidden");
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => approvalRequest.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(label("approveBeforeDeposit"))).toBeNull();
    expect(mocks.submitShield).not.toHaveBeenCalled();
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ identity, funds: verifiedFunds });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);

    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.call.mock.calls.filter(([method]) => method === "recover").length).toBeGreaterThan(scans));
    await waitFor(() => expect(screen.getByText("1.25")).toBeTruthy());
    expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({ action: "shield", slot: "asset", amount: "1250000000000000000" }), expect.anything());
    expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ identity, funds: verifiedFunds });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("keeps the unlocked deposit session when the transaction wallet hides and restores the page", async () => {
    const visibility = documentVisibility();
    const request = deferred();
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, () => request.promise));
    renderPanel();
    await restoreFunds();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const terminations = mocks.terminate.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    visibility("hidden");
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => request.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it.each(["approval", "deposit"] as const)(
    "keeps an unlocked session after wallet %s rejection and permits the next request",
    async (kind) => {
      const fixture = tokenModules(kind === "deposit" ? 1_250_000_000_000_000_000n : 0n);
      const visibility = documentVisibility();
      const request = deferred();
      if (kind === "approval") fixture.token.approve.mockImplementationOnce(async () => {
        await request.promise;
        throw new Error("Rejected request unexpectedly resolved");
      });
      else mocks.submitShield.mockImplementationOnce((input: ShieldFlowInput) =>
        submitShieldThroughWalletRequest(input, () => request.promise));
      renderPanel({ selectedModules: fixture.modules });
      await restoreFunds();
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
      fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
      const requestButton = () => screen.getByRole("button", { name: kind === "approval" ? label("approve") : submitLabel });
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));
      const terminations = mocks.terminate.mock.calls.length;
      fireEvent.click(requestButton());
      await waitFor(() => expect(kind === "approval" ? fixture.token.approve : mocks.submitShield).toHaveBeenCalledOnce());
      visibility("hidden");
      visibility("visible");
      await act(async () => request.reject(Object.assign(new Error("Wallet request rejected"), { code: "ACTION_REJECTED" })));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Wallet request rejected"));
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      expect(mocks.workerState).toEqual({ identity, funds: verifiedFunds });

      fireEvent.click(requestButton());
      await waitFor(() => expect(kind === "approval" ? fixture.token.approve : mocks.submitShield).toHaveBeenCalledTimes(2));
      await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    },
  );

  it("releases the wallet guard before receipt confirmation so a normal hidden page still locks", async () => {
    const visibility = documentVisibility();
    const request = deferred();
    const confirmation = deferred<ShieldedPoolFlowResult>();
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, () => request.promise, () => confirmation.promise));
    renderPanel();
    await restoreFunds();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    visibility("hidden");
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => request.resolve());
    await waitFor(() => expect(screen.getByText("shielded.stages.confirming")).toBeTruthy());
    visibility("hidden");
    expect(sessionState()).toEqual({ identity: null, funds: null });
    expect(mocks.workerState).toEqual({ identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    visibility("visible");
    await act(async () => confirmation.resolve(sentShieldTransaction));
    expect(sessionState()).toEqual({ identity: null, funds: null });
  });

  it("starts with one identity entry and no independent wallet or asset controls", () => {
    renderPanel();
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: label("openIndependentFunds") })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: label("manageIndependentFunds") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(sessionState()).toEqual({ identity: null, funds: null });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each(["shield", "privateTransfer"] as const)(
    "restores independent funds from %s and automatically returns to its existing amount and payment funds",
    async (action) => {
      renderPanel();
      await unlockIdentity();
      fireEvent.click(screen.getByRole("button", { name: `shielded.actions.${action}` }));
      const amountLabel = action === "shield" ? "shielded.fields.amount" : "shielded.fields.transferAmount";
      fireEvent.change(screen.getByLabelText(amountLabel), { target: { value: "1.25" } });
      const terminations = mocks.terminate.mock.calls.length;
      const calls = mocks.call.mock.calls.length;
      click("openIndependentFunds");
      expect(screen.getByRole("button", { name: label("openIndependentFunds") }).getAttribute("aria-pressed")).toBe("true");
      for (const walletAction of ["shield", "privateTransfer", "unshield", "receiveCode"]) {
        expect(screen.getByRole("button", { name: `shielded.actions.${walletAction}` }).getAttribute("aria-pressed")).toBe("false");
      }
      expect(screen.getByRole("radio", { name: label("mnemonicRestore") })).toBeTruthy();
      expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy();
      expect(sessionState().identity).toEqual(identity);
      expect(mocks.call).toHaveBeenCalledTimes(calls);
      expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
      fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
        target: { value: "saved-independent-funds-from-wallet-toolbar" },
      });
      click("importRecovery");
      await waitFor(() => expect(screen.getByLabelText(amountLabel)).toBeTruthy());
      await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
      expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
      expect(task("wallet").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("button", { name: `shielded.actions.${action}` }).getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByLabelText(amountLabel) as HTMLInputElement).value).toBe("1.25");
      expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("identity");
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
      expect(screen.getByRole("button", { name: label("manageIndependentFunds") }).getAttribute("aria-pressed")).toBe("false");
    },
  );

  it("keeps the asset controls, scans, funds entry and task navigation usable during funds management", async () => {
    const selectAsset = vi.fn();
    renderPanel({ assetControls: <button type="button" onClick={selectAsset}>select-asset</button> });
    await unlockIdentity();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const overview = screen.getByRole("region", { name: "shielded.balanceTitle" });
    const navigation = screen.getByRole("tablist");
    const panel = screen.getByRole("tabpanel");
    click("openIndependentFunds");
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    const recoveryInput = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(recoveryInput, { target: { value: "unfinished-secret-words" } });
    const assetControl = screen.getByRole("button", { name: "select-asset" });
    expect(assetControl.matches(":disabled")).toBe(false);
    fireEvent.click(assetControl);
    expect(selectAsset).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("tab").every((tab) => !(tab as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole("button", { name: label("openIndependentFunds") }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false);

    const defaultCall = mocks.call.getMockImplementation();
    let finishRecovery!: (value: typeof emptyWallet) => void;
    mocks.call.mockImplementation((method, params) => method === "recover"
      ? new Promise<typeof emptyWallet>((resolve) => { finishRecovery = resolve; })
      : defaultCall?.(method, params));
    const recoverCalls = mocks.call.mock.calls.filter(([method]) => method === "recover").length;
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    expect(assetControl.matches(":disabled")).toBe(true);
    expect(screen.getAllByRole("tab").every((tab) => (tab as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole("button", { name: label("openIndependentFunds") }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(recoverCalls + 1));
    await act(async () => { finishRecovery(emptyWallet); });
    mocks.call.mockImplementation(defaultCall!);
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy();
    click("openIndependentFunds");
    expect(recoveryInput.value).toBe("");

    chooseTask("inheritance");
    expect(task("inheritance").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("radio", { name: label("independentEntry") })).toBeTruthy();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBe(overview);
    expect(screen.getByRole("tablist")).toBe(navigation);
    expect(screen.getByRole("tabpanel")).toBe(panel);
    chooseTask("wallet");
    expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect(sessionState()).toEqual({ identity, funds: null });
  });

  it.each(["shield", "privateTransfer"] as const)(
    "keeps the %s amount and asset payment funds through cancelling management and verifying a saved backup",
    async (action) => {
      renderPanel();
      await restoreFunds();
      fireEvent.click(screen.getByRole("button", { name: `shielded.actions.${action}` }));
      const amountLabel = action === "shield" ? "shielded.fields.amount" : "shielded.fields.transferAmount";
      fireEvent.change(screen.getByLabelText(amountLabel), { target: { value: "1.5" } });
      fireEvent.change(screen.getByLabelText(label("assetSource")), { target: { value: "asset" } });
      const terminations = mocks.terminate.mock.calls.length;
      const calls = mocks.call.mock.calls.length;
      expect(screen.queryByRole("button", { name: label("openIndependentFunds") })).toBeNull();
      click("manageIndependentFunds");
      expect(screen.getByText(label("backupSaveStep"))).toBeTruthy();
      expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
      expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
      expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: `shielded.actions.${action}` }));
      expect(screen.getByRole("button", { name: `shielded.actions.${action}` }).getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByLabelText(amountLabel) as HTMLInputElement).value).toBe("1.5");
      expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
      expect(mocks.call).toHaveBeenCalledTimes(calls);
      expect(mocks.terminate).toHaveBeenCalledTimes(terminations);

      click("manageIndependentFunds");
      click("exportRecovery");
      await waitFor(() => expect(screen.getByRole("checkbox", { name: label("savedExternal") })).toBeTruthy());
      fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
      click("beginIndependentImport");
      await waitFor(() => expect(sessionState()).toEqual({ identity, funds: null }));
      expect(screen.getByText(label("reenterBackup"))).toBeTruthy();
      expect(screen.queryByLabelText(amountLabel)).toBeNull();
      fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "manually-verified-backup" } });
      click("importRecovery");
      await waitFor(() => expect(screen.getByLabelText(amountLabel)).toBeTruthy());
      expect(screen.getByRole("button", { name: `shielded.actions.${action}` }).getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByLabelText(amountLabel) as HTMLInputElement).value).toBe("1.5");
      expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
      expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
      expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    },
  );

  it("manages funds from identity receiving setup without changing the receive-code type or claim filter", async () => {
    renderPanel();
    await restoreFunds();
    chooseIndependentBudget();
    chooseTask("wallet");
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    fireEvent.click(screen.getByRole("radio", { name: label("identityReceive") }));
    click("manageIndependentFunds");
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("radio", { name: label("identityReceive") }) as HTMLInputElement).checked).toBe(true);
    chooseTask("receive");
    expect((screen.getByRole("radio", { name: label("independentBudgets") }) as HTMLInputElement).checked).toBe(true);
    expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
  });

  it("offers management for an unverified candidate and opens its recovery options without replacing it", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    const candidate = { ...verifiedFunds, rootSource: "walletSignature" as const, recoveryVerified: false };
    mocks.call.mockImplementation(async (method, params) => {
      if (method !== "restoreSignature") return defaultCall?.(method, params);
      mocks.workerState = { identity: mocks.workerState.identity, funds: candidate };
      return mocks.workerState;
    });
    renderPanel();
    click("openIndependentFunds");
    chooseRecoveryPath("signature");
    click("restoreSignature");
    await waitFor(() => expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy());
    click("continueIdentity");
    await unlockIdentity();
    const calls = mocks.call.mock.calls.length;
    const terminations = mocks.terminate.mock.calls.length;
    expect(screen.queryByRole("button", { name: label("openIndependentFunds") })).toBeNull();
    click("manageIndependentFunds");
    expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy();
    expect(screen.getByRole("button", { name: label("restoreAnotherMethod") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("exportRecovery") })).toBeNull();
    expect(sessionState()).toEqual({ identity, funds: candidate });
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    expect(screen.getByLabelText("shielded.fields.amount")).toBeTruthy();
    expect(screen.queryByText(label("recoveryCandidate"))).toBeNull();
    expect(sessionState()).toEqual({ identity, funds: candidate });
    expect(mocks.call).toHaveBeenCalledTimes(calls);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it.each([false, true])(
    "disables the independent funds toolbar entry during recovery, funds loaded=%s",
    async (fundsLoaded) => {
      renderPanel();
      if (fundsLoaded) await restoreFunds();
      else await unlockIdentity();
      const defaultCall = mocks.call.getMockImplementation();
      let finishRecovery!: (value: typeof emptyWallet) => void;
      mocks.call.mockImplementation((method, params) => method === "recover"
        ? new Promise<typeof emptyWallet>((resolve) => { finishRecovery = resolve; })
        : defaultCall?.(method, params));
      const entry = screen.getByRole("button", {
        name: label(fundsLoaded ? "manageIndependentFunds" : "openIndependentFunds"),
      }) as HTMLButtonElement;
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
      expect(entry.disabled).toBe(true);
      fireEvent.click(entry);
      expect(task("wallet")).toBeTruthy();
      expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
      expect(screen.queryByRole("button", { name: label("exportRecovery") })).toBeNull();
      await act(async () => { finishRecovery(emptyWallet); });
      await waitFor(() => expect(entry.disabled).toBe(false));
    },
  );

  it("returns root-only funds management to the existing withdrawal and selected notes", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
    } : defaultCall?.(method, params));
    renderPanel();
    click("openIndependentFunds");
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
      target: { value: "saved-independent-funds-without-identity" },
    });
    click("importRecovery");
    await waitFor(() => expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.unshield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    const calls = mocks.call.mock.calls.length;
    const terminations = mocks.terminate.mock.calls.length;
    click("manageIndependentFunds");
    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.unshield" }));
    expect(screen.getByRole("button", { name: "shielded.actions.unshield" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect((screen.getByLabelText("shielded.fields.exitRecipient") as HTMLInputElement).value).toBe(address);
    expect((screen.getByRole("checkbox", { name: "shielded.valueOption" }) as HTMLInputElement).checked).toBe(true);
    expect(sessionState()).toEqual({ identity: null, funds: verifiedFunds });
    expect(mocks.call).toHaveBeenCalledTimes(calls);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("returns from root-only funds management through the current wallet tab without clearing the withdrawal draft", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
    } : defaultCall?.(method, params));
    renderPanel();
    click("openIndependentFunds");
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
      target: { value: "saved-independent-funds-without-identity" },
    });
    click("importRecovery");
    await waitFor(() => expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.unshield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    const calls = mocks.call.mock.calls.length;
    const terminations = mocks.terminate.mock.calls.length;

    click("manageIndependentFunds");
    expect(screen.getByRole("button", { name: label("manageIndependentFunds") }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "shielded.actions.unshield" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    chooseTask("wallet");

    expect(task("wallet").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "shielded.actions.unshield" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: label("manageIndependentFunds") }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: label("exportRecovery") })).toBeNull();
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect((screen.getByLabelText("shielded.fields.exitRecipient") as HTMLInputElement).value).toBe(address);
    expect((screen.getByRole("checkbox", { name: "shielded.valueOption" }) as HTMLInputElement).checked).toBe(true);
    expect(sessionState()).toEqual({ identity: null, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ identity: null, funds: verifiedFunds });
    expect(mocks.call).toHaveBeenCalledTimes(calls);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("keeps the independently selected deposit owner when changing pools", async () => {
    render(<PoolNavigationHarness />);
    await restoreFunds();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
    fireEvent.change(screen.getByLabelText(label("assetSource")), { target: { value: "asset" } });
    expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
    fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
    }));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
    expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
  });

  it.each(["claim", "privateTransfer"] as const)(
    "keeps an explicitly selected deposit when the next pool suggests %s",
    async (suggested) => {
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
        ...emptyWallet,
        notes: [{
          commitment: "100",
          ownerCommitment: "1",
          slot: "identity",
          kind: suggested === "claim" ? "budget" : "value",
          amount: "1000000000000000000",
          ...(suggested === "claim" ? { amountPerPeriod: "1000000000000000000" } : {}),
        }],
      } : defaultCall?.(method, params));
      render(<PoolNavigationHarness />);
      await unlockIdentity();
      if (suggested === "claim") {
        expect(task("receive").getAttribute("aria-selected")).toBe("true");
        chooseTask("wallet");
      } else {
        expect(screen.getByRole("button", { name: "shielded.actions.privateTransfer" }).getAttribute("aria-pressed")).toBe("true");
      }
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.shield" }));
      fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
        context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
      }));
      await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("keeps a deposit chosen by the first empty scan when the next pool has funds", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) =>
      method === "recover" && params.context.poolAddress !== modules.poolAddress ? {
        ...emptyWallet,
        notes: [{ commitment: "100", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1" }],
      } : defaultCall?.(method, params),
    );
    render(<PoolNavigationHarness />);
    await unlockIdentity();
    expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
    }));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("restores VALUE from the initial recovery entry without requiring identity", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
    } : defaultCall?.(method, params));
    renderPanel();
    click("openIndependentFunds");
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-independent-funds-without-identity" } });
    click("importRecovery");
    await waitFor(() => expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy());
    expect(sessionState().identity).toBeNull();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "unlockIdentity")).toBe(false);
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy();
    expect(screen.getByText("2.5")).toBeTruthy();
    // A root-only session has one owner, so there is no funds choice to make.
    expect(screen.queryByLabelText(label("assetSource"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.unshield" }));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({ action: "unshield", slot: "asset", candidates: ["100"] }), expect.anything()));
    expect(sessionState().identity).toBeNull();
    chooseTask("receive");
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(sessionState().funds?.recoveryVerified).toBe(true);
    await unlockIdentity();
    expect(task("receive").getAttribute("aria-selected")).toBe("true");
    expect(sessionState().funds?.recoveryVerified).toBe(true);
  });

  it.each(["claim", "receiveCode"] as const)(
    "automatically returns recovered funds to identity unlock when the preserved %s task requires it",
    async (action) => {
      renderPanel({ navigation: { action, slot: "asset", walletAction: "receiveCode", receiveSlot: "asset", taskChosen: true } });
      click("openIndependentFunds");
      fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-root-before-identity" } });
      click("importRecovery");
      await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
      await waitFor(() => expect(screen.getByLabelText("identity passphrase")).toBeTruthy());
      expect(sessionState()).toEqual({ identity: null, funds: verifiedFunds });
      expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
      expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
      expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
      await unlockIdentity();
      expect(sessionState()).toEqual({ identity, funds: verifiedFunds });
      if (action === "claim") {
        expect(task("receive").getAttribute("aria-selected")).toBe("true");
        expect((screen.getByRole("radio", { name: label("independentBudgets") }) as HTMLInputElement).checked).toBe(true);
      } else {
        expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
      }
    },
  );

  it("keeps receiving setup separate from funding and claiming", async () => {
    renderPanel();
    await unlockIdentity();
    expect(task("wallet").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText(label("assetSource"))).toBeNull();
    chooseTask("inheritance");
    expect((screen.getByRole("radio", { name: label("independentEntry") }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: label("publicEntry") })).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("convenientEntry") })).toBeTruthy();
    chooseTask("receive");
    expect(screen.queryByRole("button", { name: label("createNew") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("showBackupFunds") })).toBeNull();
    chooseTask("wallet");
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    expect((screen.getByRole("radio", { name: label("identityReceive") }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: label("independentReceive") }));
    expect(screen.getByRole("button", { name: label("createNew") })).toBeTruthy();
    click("showRestoreFunds");
    expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    click("showCreateFunds");
    expect((screen.getByRole("radio", { name: label("randomSource") }) as HTMLInputElement).checked).toBe(true);
    click("showRestoreFunds");
    expect(screen.getByRole("radio", { name: label("signatureRestore") })).toBeTruthy();
    expect(mocks.call.mock.calls.map(([method]) => method)).toEqual(["unlockIdentity", "recover"]);
  });

  it("restores independent funds without terminating the already unlocked identity", async () => {
    renderPanel();
    await unlockIdentity();
    const terminations = mocks.terminate.mock.calls.length;
    await restoreFunds();
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
    expect(mocks.workerState.identity?.handle).toBe(identity.handle);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect((screen.getByRole("radio", { name: label("independentReceive") }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("receiveCode", { slot: "asset" }, expect.anything()));
    expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).readOnly).toBe(true);
    chooseTask("wallet");
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    expect(sessionState().funds?.recoveryVerified).toBe(true);
  });

  it("clears the independent receive code when returning to identity receipt", async () => {
    renderPanel();
    await restoreFunds();
    const terminations = mocks.terminate.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("receiveCode", { slot: "asset" }, expect.anything()));
    expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("budget-receive-code");
    fireEvent.click(screen.getByRole("radio", { name: label("identityReceive") }));
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("keeps both credentials while changing tasks and makes independent funds available after receiving", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) =>
      method === "recover" ? {
        ...emptyWallet,
        notes: [{
          commitment: "100",
          ownerCommitment: verifiedFunds.ownerCommitment,
          slot: "asset",
          kind: "value",
          amount: "2500000000000000000",
        }],
      } : defaultCall?.(method, params),
    );
    renderPanel();
    await restoreFunds();
    const terminations = mocks.terminate.mock.calls.length;
    chooseTask("wallet");
    expect(screen.getByLabelText(label("assetSource"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await waitFor(() => expect(screen.getByLabelText(label("assetSource"))).toBeTruthy());
    // Choosing the independent receive code does not change which funds pay.
    expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("identity");
    fireEvent.change(screen.getByLabelText(label("assetSource")), { target: { value: "asset" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.unshield" }));
    expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(
      "preview", expect.objectContaining({ action: "unshield", slot: "asset", amount: "1000000000000000000", candidates: ["100"] }), expect.anything(),
    ));
    chooseTask("inheritance");
    expect((screen.getByLabelText(label("assetSource")) as HTMLSelectElement).value).toBe("asset");
    chooseIndependentBudget();
    expect((screen.getByLabelText(label("independentBudgets")) as HTMLInputElement).checked).toBe(true);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
  });

  it("returns a real lock to identity entry and resumes the independent receiving task after unlocking", async () => {
    renderPanel();
    await restoreFunds();
    lockCurrentFlow();
    expect(sessionState()).toEqual({ identity: null, funds: null });
    expect(mocks.workerState).toEqual({ identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    expect(task("wallet").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(label("identityReceive")) as HTMLInputElement).checked).toBe(true);
    await restoreFunds();
    expect(sessionState().identity?.handle).toBe(identity.handle);
  });

  it("returns key management to the receiving task without discarding either session", async () => {
    renderPanel();
    await restoreFunds();
    const terminations = mocks.terminate.mock.calls.length;
    click("showBackupFunds");
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    expect(task("wallet").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(label("independentReceive")) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
  });

  it("clears the recovery form and returns to identity entry when the Worker locks externally", async () => {
    renderPanel();
    await unlockIdentity();
    openIndependentReceiving();
    click("showRestoreFunds");
    const material = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(material, { target: { value: "unfinished-secret-recovery-material" } });
    act(() => mocks.terminate());
    expect(sessionState()).toEqual({ identity: null, funds: null });
    expect(material.value).toBe("");
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    expect(task("wallet").getAttribute("aria-selected")).toBe("true");
  });

  it("returns locked key management to identity entry before allowing budget recovery", async () => {
    renderPanel();
    await restoreFunds();
    click("showBackupFunds");
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    lockCurrentFlow();
    expect(sessionState()).toEqual({ identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    openIndependentReceiving();
    click("showRestoreFunds");
    expect((screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: label("importRecovery") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a re-signed candidate in recovery until history confirms it, then automatically opens its balance", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    const candidate = { ...verifiedFunds, rootSource: "walletSignature" as const };
    let historyFound = false;
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "restoreSignature") {
        mocks.workerState = { identity: mocks.workerState.identity, funds: { ...candidate, recoveryVerified: false } };
        return mocks.workerState;
      }
      if (method === "recover") {
        if (!mocks.workerState.funds) return emptyWallet;
        if (!historyFound) return emptyWallet;
        mocks.workerState = { identity: mocks.workerState.identity, funds: { ...candidate, recoveryPath: "history" } };
        return {
          ...emptyWallet, sessionState: mocks.workerState,
          notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
        };
      }
      return defaultCall?.(method, params);
    });
    renderPanel();
    click("openIndependentFunds");
    chooseRecoveryPath("signature");
    click("restoreSignature");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(false));
    expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy();
    expect(screen.queryByLabelText("shielded.fields.transferAmount")).toBeNull();
    const terminations = mocks.terminate.mock.calls.length;
    click("recover");
    await waitFor(() => expect(screen.getByText(label("recoveryCandidateHistoryMissing"))).toBeTruthy());
    await waitFor(() => expect((screen.getByRole("button", { name: label("recover") }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState().funds?.recoveryVerified).toBe(false);
    expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy();
    expect(screen.queryByLabelText("shielded.fields.transferAmount")).toBeNull();
    historyFound = true;
    click("recover");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    await waitFor(() => expect(screen.getByText("2.5")).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.getByRole("button", { name: "shielded.actions.privateTransfer" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("creates funds and verifies the manually re-entered backup without dropping identity", async () => {
    renderPanel();
    await unlockIdentity();
    openIndependentReceiving();
    click("createNew");
    const terminations = mocks.terminate.mock.calls.length;
    click("createNew");
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    click("exportRecovery");
    const exported = await screen.findByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement;
    await waitFor(() => expect(exported.value).toBe("original-secret-words"));
    expect((screen.getByRole("button", { name: label("beginIndependentImport") }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    click("beginIndependentImport");
    await waitFor(() => expect(sessionState()).toEqual({ identity, funds: null }));
    expect(mocks.call).toHaveBeenCalledWith("clearFunds", {});
    expect(mocks.workerState).toEqual({ identity, funds: null });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(exported.value).toBe("");
    expect(screen.getByText(label("reenterBackup"))).toBeTruthy();
    const imported = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    expect(imported.value).toBe("");
    fireEvent.change(imported, { target: { value: "manually-entered-independent-backup" } });
    click("importRecovery");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
    expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({
      material: "manually-entered-independent-backup", expectedFingerprint: verifiedFunds.fundsFingerprint,
    }));
    expect(imported.value).toBe("");
    await waitFor(() => expect(screen.getByRole("radio", { name: label("independentReceive") })).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByText(label("fundsRestoredIdentityHint"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("radio", { name: label("independentReceive") }) as HTMLInputElement).checked).toBe(true);
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.recoveryVerified).toBe(true);
    expect(mocks.call.mock.calls.filter(([method]) => method === "unlockIdentity")).toHaveLength(1);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("keeps the backup gate when navigating away from a new root until saved material is manually verified", async () => {
    renderPanel();
    await unlockIdentity();
    openIndependentReceiving();
    click("createNew");
    click("createNew");
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(screen.queryByRole("radio", { name: label("signatureRestore") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    expect((screen.getByRole("radio", { name: label("independentReceive") }) as HTMLInputElement).checked).toBe(true);
    // The pending backup takes the place of the receive-code action until it is verified.
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(screen.getByText(label("budgetKeyBackupPending"))).toBeTruthy();
    expect(screen.getByRole("button", { name: label("showBackupFunds") })).toBeTruthy();
    expect(sessionState().funds?.backupRequired).toBe(true);
    expect(sessionState().funds?.recoveryVerified).toBe(false);
    expect(mocks.call.mock.calls.some(([method]) => method === "receiveCode")).toBe(false);
    await waitFor(() => expect((screen.getByRole("button", { name: label("manageIndependentFunds") }) as HTMLButtonElement).disabled).toBe(false));
    click("manageIndependentFunds");
    expect(screen.getByText(label("backupSaveStep"))).toBeTruthy();
    click("exportRecovery");
    const exported = screen.getByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement;
    await waitFor(() => expect(exported.value).toBe("original-secret-words"));
    const beginVerification = screen.getByRole("button", { name: label("beginIndependentImport") }) as HTMLButtonElement;
    expect(beginVerification.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    click("beginIndependentImport");
    expect(exported.value).toBe("");
    await waitFor(() => expect(sessionState()).toEqual({ identity, funds: null }));
    expect(screen.queryByRole("radio", { name: label("signatureRestore") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("restoreSignature") })).toBeNull();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "manually-reentered-saved-backup" } });
    click("importRecovery");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
    expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({ expectedFingerprint: verifiedFunds.fundsFingerprint }));
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
    await waitFor(() => expect(screen.getByRole("radio", { name: label("independentReceive") })).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(screen.getByRole("button", { name: "shielded.actions.receiveCode" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(label("budgetKeyBackupPending"))).toBeNull();
  });

  it("opens backup management when re-signing reports that independent verification is still required", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method !== "restoreSignature") return defaultCall?.(method, params);
      mocks.workerState = {
        identity: mocks.workerState.identity,
        funds: { ...verifiedFunds, recoveryVerified: false, backupRequired: true, rootSource: "walletSignature" },
      };
      return mocks.workerState;
    });
    renderPanel();
    await unlockIdentity();
    openIndependentReceiving();
    click("showRestoreFunds");
    chooseRecoveryPath("signature");
    click("restoreSignature");
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    expect((screen.getByRole("button", { name: label("exportRecovery") }) as HTMLButtonElement).disabled).toBe(false);
  });
});
