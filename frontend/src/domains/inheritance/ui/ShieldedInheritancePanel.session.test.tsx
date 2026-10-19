// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { SHIELDED_IDENTITY_IDLE_TIMEOUT_MS } from "./useShieldedIdentitySession";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  cancel: vi.fn(async () => {}),
  terminate: vi.fn(),
  terminateZk: vi.fn(),
  submitShield: vi.fn(),
  submitPrivateTransfer: vi.fn(),
  submitUnshield: vi.fn(),
  preview: null as Record<string, unknown> | null,
  generation: 0,
  listeners: new Set<() => void>(),
  workerState: { credentials: null, identity: null, funds: null } as ShieldedAssetSessionState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "shielded.submit" || key === "shielded.spendReview.preview"
        ? `${key}:${options?.action}`
        : key === "shielded.depositBalanceInsufficient"
          ? `${key}:${options?.balance}:${options?.amount}:${options?.symbol}`
          : key,
  }),
}));
vi.mock("../../config", () => ({ useConfig: () => ({ rpcUrl: "https://rpc.example" }) }));
vi.mock("../../tree/context", () => ({ useTreeGraphData: () => ({ nodesData: {} }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => null }));
vi.mock("../../../shared/config/env", () => ({
  getShieldedPoolFactoryDeploymentBlock: () => 10,
  getEventScanConfig: () => ({ blockChunk: 10_000 }),
}));
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
  submitPrivateTransfer: mocks.submitPrivateTransfer,
  submitUnshield: mocks.submitUnshield,
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props, ref) => {
      const input = React.useRef<HTMLInputElement>(null);
      React.useImperativeHandle(ref, () => ({
        getRawIdentityFields: () => ({
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

const credentials = { handle: "credentials:1" };
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

function tokenModules(initialAllowance = 0n, initialBalance = 1_000_000n * 10n ** 18n) {
  let allowance = initialAllowance;
  let balance = initialBalance;
  const token = {
    allowance: vi.fn(async () => allowance),
    balanceOf: vi.fn(async (_account: string) => balance),
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
    setBalance(value: bigint) {
      balance = value;
    },
    consumeDeposit(value: bigint) {
      if (allowance < value) throw new Error("ERC20 allowance is insufficient");
      if (balance < value) throw new Error("ERC20 balance is insufficient");
      allowance -= value;
      balance -= value;
    },
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
const submitLabel = /^shielded\.(?:submit|spendReview\.preview):shielded\.actions\./;
const click = (key: string) => fireEvent.click(
  key === "importRecovery" && screen.queryByRole("button", { name: label("verifySavedBackup") }) ||
  screen.getByRole("button", { name: label(key) }),
);
const taskNavigation = () => screen.getByRole("navigation", { name: "shielded.actionsTitle" });
const navButton = (action: string) =>
  within(taskNavigation()).getByRole("button", { name: `shielded.actions.${action}` });
const GROUP_ACTIONS = {
  wallet: ["shield", "privateTransfer", "unshield"],
  inheritance: ["fund"],
  receive: ["claim"],
} as const;
/** A group is current while one of its tasks is. */
const groupCurrent = (group: keyof typeof GROUP_ACTIONS) =>
  GROUP_ACTIONS[group].some((action) => navButton(action).getAttribute("aria-current") === "true");
const chooseTask = (group: "inheritance" | "receive") =>
  fireEvent.click(navButton(group === "inheritance" ? "fund" : "claim"));
const walletCard = (slot: "identity" | "asset") =>
  screen.getByRole("group", { name: label(slot === "asset" ? "budgetFunds" : "identityFunds") });
const walletSheet = () => screen.getByRole("dialog");
const closeWalletSheet = () =>
  fireEvent.click(within(walletSheet()).getByRole("button", { name: "common.close" }));
/** Returns to the workspace from any open wallet sheet. */
const closeSheetIfOpen = () => {
  if (screen.queryByRole("dialog")) closeWalletSheet();
};

// Observe the real provider's public state. No session hook or context is mocked.
function SessionObserver() {
  const { credentials: currentCredentials, identity: currentIdentity, funds } = useShieldedPageIdentitySession();
  return (
    <output data-testid="session-state">
      {JSON.stringify({ credentials: currentCredentials, identity: currentIdentity, funds })}
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
  await waitFor(() => expect(navButton("claim")).toBeTruthy());
  await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
}
function chooseIndependentBudget() {
  chooseTask("receive");
  chooseBudgetKey("asset");
}
function chooseBudgetKey(mode: "identity" | "asset") {
  chooseActiveWallet(mode);
}
function chooseRecoveryPath(path: "mnemonic" | "shieldedKey" | "signature") {
  fireEvent.click(screen.getByRole("radio", { name: label(`${path}Restore`) }));
}
function openReceiveCode(slot: "identity" | "asset") {
  const button = screen.getByRole("button", { name: label(slot === "asset" ? "fundsReceiveCode" : "identityReceiveCode") });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
function openIndependentReceiving() {
  openReceiveCode("asset");
}
/** A usable funds key opens its settings and a new one its backup; otherwise the card offers unlocking or creating. */
function fundsKeyButton(flow: "restore" | "create" = "restore") {
  return (flow === "restore" && (screen.queryByRole("button", { name: label("keySettings") }) ??
    screen.queryByRole("button", { name: label("backupTitle") }))) ||
    screen.getByRole("button", { name: label(flow === "create" ? "createTitle" : "restoreTitle") });
}
function openFundsManagement(flow: "restore" | "create" = "restore") {
  const button = fundsKeyButton(flow);
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
async function waitForReceiveCode(slot: "identity" | "asset") {
  await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("receiveCode", { slot }, expect.anything()));
  await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
}
async function cancelSpendReview() {
  fireEvent.click(await screen.findByRole("button", { name: "shielded.spendReview.cancel" }));
  await waitFor(() => expect((navButton("fund") as HTMLButtonElement).disabled).toBe(false));
}
function expectCurrentWallet(slot: "identity" | "asset") {
  expect(within(walletCard(slot)).getByText(label("currentWallet"))).toBeTruthy();
  expect(within(walletCard(slot === "asset" ? "identity" : "asset")).queryByText(label("currentWallet"))).toBeNull();
}
function chooseActiveWallet(slot: "identity" | "asset") {
  const selection = screen.getByRole("radiogroup", { name: label("walletBalances") });
  fireEvent.click(within(selection).getByRole("radio", { name: label(slot === "asset" ? "budgetFunds" : "identityFunds") }));
}
async function restoreFunds() {
  if (!sessionState().identity) await unlockIdentity();
  openFundsManagement();
  fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
    target: { value: "saved-independent-wallet-words" },
  });
  click("importRecovery");
  await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
  openReceiveCode("asset");
  expect(screen.getByRole("button", { name: label("fundsReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
  expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
}
function lockCurrentFlow() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
}
async function chooseDeposit(amount: string) {
  await restoreFunds();
  fireEvent.click(navButton("shield"));
  chooseActiveWallet("asset");
  fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: amount } });
}
function expectNoDepositPreparation() {
  expect(mocks.call.mock.calls.some(([method]) => method === "preview" || method === "prove")).toBe(false);
  expect(mocks.submitShield).not.toHaveBeenCalled();
}

describe("Shielded budget flow with a real identity session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generation = 0;
    mocks.listeners.clear();
    mocks.workerState = { credentials: null, identity: null, funds: null };
    mocks.preview = null;
    mocks.submitShield.mockReset();
    mocks.submitShield.mockImplementation(submitShieldThroughWalletRequest);
    mocks.terminate.mockImplementation(() => {
      mocks.generation++;
      mocks.workerState = { credentials: null, identity: null, funds: null };
      for (const listener of [...mocks.listeners]) listener();
    });
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "unlockIdentity") {
        mocks.workerState = { credentials, identity, funds: mocks.workerState.funds };
        return mocks.workerState;
      }
      if (method === "importRecoveryMaterial") {
        mocks.workerState = { credentials, identity: mocks.workerState.identity, funds: verifiedFunds };
        return mocks.workerState;
      }
      if (method === "restoreSignature") {
        mocks.workerState = { credentials, identity: mocks.workerState.identity, funds: verifiedFunds };
        return mocks.workerState;
      }
      if (method === "clearFunds") {
        mocks.workerState = { credentials, identity: mocks.workerState.identity, funds: null };
        return mocks.workerState;
      }
      if (method === "createFunds") {
        mocks.workerState = {
          credentials,
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
        const amount = String(params.amount ?? "1");
        const inputs = params.action === "privateTransfer" || params.action === "unshield"
          ? params.candidates as string[] : [];
        const inputAmounts = inputs.map(() => "2500000000000000000");
        const change = inputAmounts.reduce((sum, value) => sum + BigInt(value), 0n) - BigInt(amount);
        const outputAmounts = params.action === "unshield"
          ? [String(change), "0"]
          : [amount, inputs.length ? String(change) : "0"];
        return {
          handle: "preview:1",
          action: params.action,
          amount,
          slot: params.slot,
          steps: [{
            action: params.action,
            inputs,
            outputAmounts: inputs.length ? [amount, String(change)] : outputAmounts,
          }],
          inputs,
          inputAmounts,
          outputAmounts,
          ...(params.action === "unshield" ? { recipient: params.publicRecipient } : {}),
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["approval", "deposit"] as const)(
    "checks the ordinary DEEP balance before %s rather than treating allowance as a balance",
    async (kind) => {
      const amount = 10000n * 10n ** 18n;
      const fixture = tokenModules(kind === "deposit" ? amount : 0n, 0n);
      renderPanel({ selectedModules: { ...fixture.modules, assetSymbol: "DEEP" } });
      await chooseDeposit("10000");
      const requestButton = () => screen.getByRole("button", {
        name: kind === "approval" ? label("approve") : submitLabel,
      });
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));

      fireEvent.click(requestButton());

      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("shielded.depositBalanceInsufficient:0.0:10000.0:DEEP"));
      expect(fixture.token.balanceOf).toHaveBeenCalledWith(address);
      expect(fixture.token.approve).not.toHaveBeenCalled();
      expectNoDepositPreparation();
      expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    },
  );

  it("rechecks DEEP balance after approval and stops a deposit if the ordinary balance has been spent", async () => {
    const amount = 10000n * 10n ** 18n;
    const fixture = tokenModules(0n, amount);
    renderPanel({ selectedModules: { ...fixture.modules, assetSymbol: "DEEP" } });
    await chooseDeposit("10000");
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());
    click("approve");
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.token.approve).toHaveBeenCalledOnce();
    expect(await fixture.token.balanceOf(address)).toBe(amount);
    expectNoDepositPreparation();
    fixture.setBalance(0n);

    fireEvent.click(screen.getByRole("button", { name: submitLabel }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("shielded.depositBalanceInsufficient:0.0:10000.0:DEEP"));
    expect(fixture.token.approve).toHaveBeenCalledOnce();
    expectNoDepositPreparation();
    expect(await fixture.token.allowance()).toBe(amount);
    expect(screen.queryByText(/transaction.success/)).toBeNull();
  });

  it("permits a deposit after restoring sufficient DEEP balance without asking for another approval", async () => {
    const amount = 10000n * 10n ** 18n;
    const fixture = tokenModules(amount, 0n);
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, async () => {}, async () => {
        fixture.consumeDeposit(BigInt(input.amount));
        return sentShieldTransaction;
      }));
    renderPanel({ selectedModules: { ...fixture.modules, assetSymbol: "DEEP" } });
    await chooseDeposit("10000");
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("shielded.depositBalanceInsufficient:0.0:10000.0:DEEP"));
    expectNoDepositPreparation();
    fixture.setBalance(amount);

    fireEvent.click(screen.getByRole("button", { name: submitLabel }));

    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.token.approve).not.toHaveBeenCalled();
    expect(await fixture.token.balanceOf(address)).toBe(0n);
    expect(await fixture.token.allowance()).toBe(0n);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["approval", "deposit"] as const)(
    "discards an ordinary balance response after locking before %s",
    async (kind) => {
      const amount = 10000n * 10n ** 18n;
      const fixture = tokenModules(kind === "deposit" ? amount : 0n, amount);
      const balanceRequest = deferred<bigint>();
      fixture.token.balanceOf.mockImplementationOnce(() => balanceRequest.promise);
      renderPanel({ selectedModules: { ...fixture.modules, assetSymbol: "DEEP" } });
      await chooseDeposit("10000");
      const requestButton = () => screen.getByRole("button", {
        name: kind === "approval" ? label("approve") : submitLabel,
      });
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(requestButton());
      await waitFor(() => expect(fixture.token.balanceOf).toHaveBeenCalledOnce());

      await act(async () => lockCurrentFlow());
      await act(async () => balanceRequest.resolve(amount));

      expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
      expect(fixture.token.approve).not.toHaveBeenCalled();
      expectNoDepositPreparation();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

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
    fireEvent.click(navButton("shield"));
    chooseActiveWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const terminations = mocks.terminate.mock.calls.length;
    const scans = mocks.call.mock.calls.filter(([method]) => method === "recover").length;
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());
    click("approve");
    await waitFor(() => expect(fixture.token.approve).toHaveBeenCalledOnce());
    expect(fixture.token.approve).toHaveBeenCalledWith(address, 1_250_000_000_000_000_000n, { nonce: 0, chainId: 31337n });
    visibility("hidden");
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => approvalRequest.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: label("approve") })).toBeNull();
    expect(mocks.submitShield).not.toHaveBeenCalled();
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ credentials, identity, funds: verifiedFunds });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);

    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.call.mock.calls.filter(([method]) => method === "recover").length).toBeGreaterThan(scans));
    await waitFor(() => expect(within(walletCard("asset")).getByText("1.25")).toBeTruthy());
    expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({ action: "shield", slot: "asset", amount: "1250000000000000000" }), expect.anything());
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ credentials, identity, funds: verifiedFunds });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("accepts a repriced approval through the receipt helper and permits the deposit", async () => {
    const fixture = tokenModules();
    const repricedHash = `0x${"cd".repeat(32)}`;
    const wait = vi.fn(async () => {
      fixture.token.allowance.mockResolvedValue(1_250_000_000_000_000_000n);
      throw Object.assign(new Error("Approval transaction repriced"), {
        code: "TRANSACTION_REPLACED",
        reason: "repriced",
        cancelled: false,
        replacement: { hash: repricedHash },
        receipt: { status: 1 },
      });
    });
    fixture.token.approve.mockImplementationOnce(async () => ({ hash: "0xapproval", wait }));
    renderPanel({ selectedModules: fixture.modules });
    await restoreFunds();
    fireEvent.click(navButton("shield"));
    chooseActiveWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());

    click("approve");

    await waitFor(() => expect(screen.getByText(`TOKEN · ${label("approve")} · ${label("transactionHash")}: ${repricedHash} · transaction.success`)).toBeTruthy());
    expect(wait).toHaveBeenCalledOnce();
    expect(fixture.token.approve).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: label("approve") })).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false);
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "shield", slot: "asset", amount: "1250000000000000000",
    }), expect.anything());
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
  });

  it("requires a new approval for 1000 after a 10000 deposit consumes its exact ERC20 allowance", async () => {
    const fixture = tokenModules();
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, async () => {}, async () => {
        fixture.consumeDeposit(BigInt(input.amount));
        return sentShieldTransaction;
      }));
    renderPanel({ selectedModules: fixture.modules });
    await restoreFunds();
    fireEvent.click(navButton("shield"));
    chooseActiveWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "10000" } });
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());
    click("approve");
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1000" } });
    await waitFor(() => expect((screen.getByRole("button", { name: label("approve") }) as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.submitShield).toHaveBeenCalledOnce();
    expect(fixture.token.approve).toHaveBeenCalledOnce();
    click("approve");
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.token.approve).toHaveBeenLastCalledWith(address, 1000n * 10n ** 18n, { nonce: 0, chainId: 31337n });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
  });

  it("uses the remaining ERC20 allowance for 1000 after depositing 10000 from an allowance of 15000", async () => {
    const fixture = tokenModules(15000n * 10n ** 18n);
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, async () => {}, async () => {
        fixture.consumeDeposit(BigInt(input.amount));
        return sentShieldTransaction;
      }));
    renderPanel({ selectedModules: fixture.modules });
    await restoreFunds();
    fireEvent.click(navButton("shield"));
    chooseActiveWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "10000" } });
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1000" } });
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: label("approve") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.token.approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the unlocked deposit session when the transaction wallet hides and restores the page", async () => {
    const visibility = documentVisibility();
    const request = deferred();
    mocks.submitShield.mockImplementation((input: ShieldFlowInput) =>
      submitShieldThroughWalletRequest(input, () => request.promise));
    renderPanel();
    await restoreFunds();
    fireEvent.click(navButton("shield"));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const terminations = mocks.terminate.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    visibility("hidden");
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    expect(mocks.workerState).toEqual({ credentials, identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => request.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
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
      fireEvent.click(navButton("shield"));
      fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
      const requestButton = () => screen.getByRole("button", { name: kind === "approval" ? label("approve") : submitLabel });
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));
      const terminations = mocks.terminate.mock.calls.length;
      fireEvent.click(requestButton());
      await waitFor(() => expect(kind === "approval" ? fixture.token.approve : mocks.submitShield).toHaveBeenCalledOnce());
      visibility("hidden");
      visibility("visible");
      const transactionData = `0x${"ab".repeat(1_024)}`;
      const walletRejection = Object.assign(new Error(
        `user rejected action (action="sendTransaction", reason="rejected", transaction={ "data": "${transactionData}" }, code=ACTION_REJECTED)`,
      ), {
        action: "sendTransaction",
        code: "ACTION_REJECTED",
        reason: "rejected",
        info: {
          error: { code: 4001, message: "User rejected the request." },
          payload: { method: "eth_sendTransaction", params: [{ data: transactionData }] },
        },
      });
      await act(async () => request.reject(walletRejection));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("errors.contractError.USER_REJECTED"));
      await waitFor(() => expect((requestButton() as HTMLButtonElement).disabled).toBe(false));
      expect(document.body.textContent).not.toContain(transactionData);
      expect(document.body.textContent).not.toContain("ACTION_REJECTED");
      expect(kind === "approval" ? fixture.token.approve : mocks.submitShield).toHaveBeenCalledOnce();
      expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
      expect(mocks.workerState).toEqual({ credentials, identity, funds: verifiedFunds });

      fireEvent.click(requestButton());
      await waitFor(() => expect(kind === "approval" ? fixture.token.approve : mocks.submitShield).toHaveBeenCalledTimes(2));
      await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
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
    fireEvent.click(navButton("shield"));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.submitShield).toHaveBeenCalledOnce());
    visibility("hidden");
    expect(sessionState()).toEqual({ credentials, identity, funds: verifiedFunds });
    visibility("visible");
    await act(async () => request.resolve());
    await waitFor(() => expect(screen.getByText("shielded.stages.confirming")).toBeTruthy());
    visibility("hidden");
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(mocks.workerState).toEqual({ credentials: null, identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    visibility("visible");
    await act(async () => confirmation.resolve(sentShieldTransaction));
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();
    expect(screen.queryByText(/0xshield/)).toBeNull();
    await unlockIdentity();
    expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();
  });

  it("starts with one identity entry and no independent wallet or asset controls", () => {
    renderPanel();
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("openIndependentFunds") })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: label("walletBalances") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "shielded.actionsTitle" })).toBeNull();
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("keeps the independently selected deposit owner when changing pools", async () => {
    render(<PoolNavigationHarness />);
    await restoreFunds();
    fireEvent.click(navButton("shield"));
    chooseActiveWallet("asset");
    expectCurrentWallet("asset");
    fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
    }));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    expectCurrentWallet("asset");
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
        expect(groupCurrent("receive")).toBe(true);
        closeSheetIfOpen();
      } else {
        expect(navButton("privateTransfer").getAttribute("aria-current")).toBe("true");
      }
      fireEvent.click(navButton("shield"));
      fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
        context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
      }));
      await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
      expect(navButton("shield").getAttribute("aria-current")).toBe("true");
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
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "switch-pool" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ poolAddress: "0x00000000000000000000000000000000000000bb" }),
    }));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
  });

  it("keeps receiving setup separate from funding and claiming", async () => {
    renderPanel();
    await unlockIdentity();
    expect(groupCurrent("wallet")).toBe(true);
    expect(screen.getByRole("radiogroup", { name: label("walletBalances") })).toBeTruthy();
    expectCurrentWallet("identity");
    chooseTask("inheritance");
    expect((screen.getByRole("radio", { name: label("independentEntry") }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: label("publicEntry") })).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("convenientEntry") })).toBeTruthy();
    chooseTask("receive");
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("showBackupFunds") })).toBeNull();
    closeSheetIfOpen();
    openReceiveCode("identity");
    expectCurrentWallet("identity");
    await waitForReceiveCode("identity");
    expect(screen.queryByRole("button", { name: label("fundsReceiveCode") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    openFundsManagement();
    expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: label("createTitle") }));
    expect(screen.getByRole("radio", { name: label("randomSource") })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: label("restoreTitle") }));
    expect(screen.getByRole("radio", { name: label("signatureRestore") })).toBeTruthy();
    expect(mocks.call.mock.calls.map(([method]) => method)).toEqual(["unlockIdentity", "recover", "receiveCode"]);
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
    expect(screen.getByRole("button", { name: label("fundsReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    await waitForReceiveCode("asset");
    expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).readOnly).toBe(true);
    closeSheetIfOpen();
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    expect(sessionState().funds?.recoveryVerified).toBe(true);
  });

  it("clears the independent receive code when returning to identity receipt", async () => {
    renderPanel();
    await restoreFunds();
    const terminations = mocks.terminate.mock.calls.length;
    await waitForReceiveCode("asset");
    expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("budget-receive-code");
    openReceiveCode("identity");
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
    closeSheetIfOpen();
    fireEvent.click(navButton("shield"));
    expect(screen.getByRole("radiogroup", { name: label("walletBalances") })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    // Choosing the independent receive code does not change which funds pay.
    expectCurrentWallet("identity");
    chooseActiveWallet("asset");
    fireEvent.click(navButton("unshield"));
    expectCurrentWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(
      "preview", expect.objectContaining({ action: "unshield", slot: "asset", amount: "1000000000000000000", candidates: ["100"] }), expect.anything(),
    ));
    await cancelSpendReview();
    chooseTask("inheritance");
    expectCurrentWallet("asset");
    chooseIndependentBudget();
    expectCurrentWallet("asset");
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
  });

  it.each(["manual", "idle"] as const)("cancels an unconfirmed withdrawal preview on %s session lock", async (lockReason) => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [{
        commitment: "100",
        ownerCommitment: verifiedFunds.ownerCommitment,
        slot: "asset",
        kind: "value",
        amount: "2500000000000000000",
      }],
    } : defaultCall?.(method, params));
    renderPanel();
    await restoreFunds();
    closeSheetIfOpen();
    chooseActiveWallet("asset");
    fireEvent.click(navButton("unshield"));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("button", { name: "shielded.spendReview.confirm" })).toBeTruthy());
    expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
    expect(mocks.submitUnshield).not.toHaveBeenCalled();
    const cancellations = mocks.cancel.mock.calls.length;

    if (lockReason === "idle") {
      vi.useFakeTimers();
      fireEvent.pointerDown(window);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await act(async () => vi.advanceTimersByTimeAsync(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
      expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
      expect(screen.getByRole("button", { name: "shielded.spendReview.confirm" })).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(1));
    } else {
      await act(async () => lockCurrentFlow());
    }

    expect(mocks.cancel.mock.calls.length).toBeGreaterThan(cancellations);
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(screen.queryByRole("button", { name: "shielded.spendReview.confirm" })).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
    expect(mocks.submitUnshield).not.toHaveBeenCalled();
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
  });

  it.each(["manual", "worker", "hidden", "idle"] as const)(
    "dismisses completed transaction feedback on %s lock and keeps it dismissed after unlocking",
    async (reason) => {
      const visibility = documentVisibility();
      renderPanel();
      await chooseDeposit("1.25");
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(screen.getByText(/0xshield.*transaction\.success$/)).toBeTruthy());

      if (reason === "manual") lockCurrentFlow();
      else if (reason === "worker") act(() => mocks.terminate());
      else if (reason === "idle") {
        vi.useFakeTimers();
        try {
          fireEvent.pointerDown(window);
          await act(async () => vi.advanceTimersByTimeAsync(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS + 1));
        } finally {
          vi.useRealTimers();
        }
      } else {
        visibility("hidden");
        visibility("visible");
      }

      expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
      expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();
      expect(screen.queryByText(/0xshield/)).toBeNull();
      await unlockIdentity();
      expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();

      await chooseDeposit("2");
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(screen.getByText(/0xshield.*transaction\.success$/)).toBeTruthy());
      expect(mocks.submitShield).toHaveBeenCalledTimes(2);
    },
  );

  it("returns a real lock to identity entry and keeps the wallet sheet closed after unlocking", async () => {
    renderPanel();
    await restoreFunds();
    lockCurrentFlow();
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(mocks.workerState).toEqual({ credentials: null, identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    expect(groupCurrent("wallet")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expectCurrentWallet("identity");
    await restoreFunds();
    expect(sessionState().identity?.handle).toBe(identity.handle);
  });

  it("opens independent receipt alongside the deposit task without discarding either session", async () => {
    renderPanel();
    await restoreFunds();
    const terminations = mocks.terminate.mock.calls.length;
    openFundsManagement();
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    openReceiveCode("asset");
    expect(groupCurrent("wallet")).toBe(true);
    expect(screen.getByRole("button", { name: label("fundsReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    expectCurrentWallet("identity");
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.fundsFingerprint).toBe(verifiedFunds.fundsFingerprint);
  });

  it("clears the recovery form and returns to identity entry when the Worker locks externally", async () => {
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    const material = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(material, { target: { value: "unfinished-secret-recovery-material" } });
    act(() => mocks.terminate());
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(material.value).toBe("");
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    expect(groupCurrent("wallet")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(fundsKeyButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
  });

  it("returns locked key management to identity entry before allowing budget recovery", async () => {
    renderPanel();
    await restoreFunds();
    openFundsManagement();
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    lockCurrentFlow();
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await unlockIdentity();
    openFundsManagement();
    expect((screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: label("importRecovery") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a re-signed candidate in recovery until history confirms it, then automatically opens its balance", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    const candidate = { ...verifiedFunds, rootSource: "walletSignature" as const };
    let historyFound = false;
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "restoreSignature") {
        mocks.workerState = { credentials, identity: mocks.workerState.identity, funds: { ...candidate, recoveryVerified: false } };
        return mocks.workerState;
      }
      if (method === "recover") {
        if (!mocks.workerState.funds) return emptyWallet;
        if (!historyFound) return emptyWallet;
        mocks.workerState = { credentials, identity: mocks.workerState.identity, funds: { ...candidate, recoveryPath: "history" } };
        return {
          ...emptyWallet, sessionState: mocks.workerState,
          notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
        };
      }
      return defaultCall?.(method, params);
    });
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
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
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: label("walletBalances") })).getByText("2.5")).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expectCurrentWallet("identity");
  });

  it("creates funds and verifies the manually re-entered backup without dropping identity", async () => {
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    fireEvent.click(screen.getByRole("button", { name: label("createTitle") }));
    const terminations = mocks.terminate.mock.calls.length;
    fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(screen.getByRole("button", { name: submitLabel })).toBeTruthy();
    click("exportRecovery");
    const exported = await screen.findByLabelText(label("exportedRecoveryMaterial"));
    await waitFor(() => expect(exported.textContent).toContain("original-secret-words"));
    expect((screen.getByRole("button", { name: label("beginIndependentImport") }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    click("beginIndependentImport");
    await waitFor(() => expect(sessionState()).toEqual({ credentials, identity, funds: null }));
    expect(mocks.call).toHaveBeenCalledWith("clearFunds", {});
    expect(mocks.workerState).toEqual({ credentials, identity, funds: null });
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
    expect(exported.textContent).not.toContain("secret-words");
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
    await waitFor(() => expect(screen.getByRole("radio", { name: label("budgetFunds") })).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByText(label("fundsRestoredIdentityHint"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    openReceiveCode("asset");
    expect(screen.getByRole("button", { name: label("fundsReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    expectCurrentWallet("identity");
    expect(sessionState().identity?.handle).toBe(identity.handle);
    expect(sessionState().funds?.recoveryVerified).toBe(true);
    expect(mocks.call.mock.calls.filter(([method]) => method === "unlockIdentity")).toHaveLength(1);
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("keeps the backup gate when navigating away from a new root until saved material is manually verified", async () => {
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    fireEvent.click(screen.getByRole("button", { name: label("createTitle") }));
    fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(screen.queryByRole("radio", { name: label("signatureRestore") })).toBeNull();
    expectCurrentWallet("identity");
    // Receipt stays unavailable until backup verification is completed in key management.
    expect(screen.queryByRole("button", { name: label("fundsReceiveCode") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("restoreTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("createTitle") })).toBeNull();
    expect(screen.getByRole("button", { name: label("backupTitle") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
    expect(screen.queryByRole("button", { name: label("showBackupFunds") })).toBeNull();
    expect(sessionState().funds?.backupRequired).toBe(true);
    expect(sessionState().funds?.recoveryVerified).toBe(false);
    expect(mocks.call.mock.calls.some(([method]) => method === "receiveCode")).toBe(false);
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    openFundsManagement();
    expect(screen.getByText(label("backupSaveStep"))).toBeTruthy();
    click("exportRecovery");
    const exported = screen.getByLabelText(label("exportedRecoveryMaterial"));
    await waitFor(() => expect(exported.textContent).toContain("original-secret-words"));
    const beginVerification = screen.getByRole("button", { name: label("beginIndependentImport") }) as HTMLButtonElement;
    expect(beginVerification.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    click("beginIndependentImport");
    expect(exported.textContent).not.toContain("secret-words");
    await waitFor(() => expect(sessionState()).toEqual({ credentials, identity, funds: null }));
    expect(screen.queryByRole("radio", { name: label("signatureRestore") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("restoreSignature") })).toBeNull();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "manually-reentered-saved-backup" } });
    click("importRecovery");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
    expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({ expectedFingerprint: verifiedFunds.fundsFingerprint }));
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
    await waitFor(() => expect(screen.getByRole("radio", { name: label("budgetFunds") })).toBeTruthy());
    expect(screen.queryByText(label("fundsRecoveredTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    openReceiveCode("asset");
    await waitForReceiveCode("asset");
  });

  it("opens backup management when re-signing reports that independent verification is still required", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method !== "restoreSignature") return defaultCall?.(method, params);
      mocks.workerState = {
        credentials,
        identity: mocks.workerState.identity,
        funds: { ...verifiedFunds, recoveryVerified: false, backupRequired: true, rootSource: "walletSignature" },
      };
      return mocks.workerState;
    });
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    chooseRecoveryPath("signature");
    click("restoreSignature");
    await waitFor(() => expect(sessionState().funds?.backupRequired).toBe(true));
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(screen.getByLabelText(label("exportedRecoveryMaterial"))).toBeTruthy();
    expect((screen.getByRole("button", { name: label("exportRecovery") }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("retains credentials across a hidden signing request and installs only its matching result", async () => {
    const signature = deferred<string>();
    vi.mocked(signer.signMessage).mockReturnValueOnce(signature.promise);
    const visibility = documentVisibility();
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    chooseRecoveryPath("signature");
    const terminations = mocks.terminate.mock.calls.length;
    click("restoreSignature");
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    expect(mocks.call).toHaveBeenCalledWith("clearFunds", {});
    visibility("hidden");
    expect(sessionState()).toEqual({ credentials, identity, funds: null });
    visibility("visible");
    await act(async () => signature.resolve("valid-signature"));
    await waitFor(() => expect(sessionState().funds).toEqual(verifiedFunds));
    expect(mocks.call).toHaveBeenCalledWith("restoreSignature", expect.objectContaining({
      expectedCredentialsHandle: credentials.handle, signature: "valid-signature",
    }));
    expect(mocks.terminate).toHaveBeenCalledTimes(terminations);
  });

  it("locks when a signature returns while still hidden and discards that signature", async () => {
    const signature = deferred<string>();
    vi.mocked(signer.signMessage).mockReturnValueOnce(signature.promise);
    const visibility = documentVisibility();
    renderPanel();
    await unlockIdentity();
    openFundsManagement();
    chooseRecoveryPath("signature");
    click("restoreSignature");
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    visibility("hidden");
    await act(async () => signature.resolve("hidden-return"));
    expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
  });

  it.each(["clear", "derive"] as const)(
    "locks on hiding during %s rather than extending the signing window",
    async (phase) => {
      const pending = deferred<ShieldedAssetSessionState>();
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation((method, params) =>
        method === (phase === "clear" ? "clearFunds" : "restoreSignature")
          ? pending.promise : defaultCall?.(method, params));
      const visibility = documentVisibility();
      renderPanel();
      await unlockIdentity();
      openFundsManagement();
      chooseRecoveryPath("signature");
      click("restoreSignature");
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(
        phase === "clear" ? "clearFunds" : "restoreSignature", expect.anything(),
      ));
      visibility("hidden");
      expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
      visibility("visible");
      await act(async () => pending.resolve({ credentials, identity, funds: verifiedFunds }));
      expect(sessionState()).toEqual({ credentials: null, identity: null, funds: null });
      if (phase === "clear") expect(signer.signMessage).not.toHaveBeenCalled();
    },
  );

  it("recovers and spends VALUE with unlocked credentials when identity proofs are unavailable", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "unlockIdentity") {
        mocks.workerState = { credentials, identity: null, funds: null };
        return mocks.workerState;
      }
      if (method === "recover") return {
        ...emptyWallet, familyRecordsAvailable: false,
        notes: [{ commitment: "100", ownerCommitment: verifiedFunds.ownerCommitment, slot: "asset", kind: "value", amount: "2500000000000000000" }],
      };
      return defaultCall?.(method, params);
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "original-credentials" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(sessionState().credentials).toEqual(credentials));
    openFundsManagement();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "original-root" } });
    click("importRecovery");
    await waitFor(() => expect(sessionState().funds?.recoveryVerified).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sessionState().identity).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(navButton("unshield"));
    chooseActiveWallet("asset");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.valueOption" }));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({ action: "unshield", slot: "asset" }), expect.anything()));
    await cancelSpendReview();
    chooseTask("receive");
    expect(screen.getByText(label("fundsRestoredIdentityHint"))).toBeTruthy();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
  });

});
