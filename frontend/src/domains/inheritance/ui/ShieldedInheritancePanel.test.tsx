// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Signer } from "ethers";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { ShieldedInheritancePanel, type ShieldedPanelNavigation } from "./ShieldedInheritancePanel";
import type { PublicStateSyncProgress } from "../../../shared/workers/publicStateSyncProgress";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  cancel: vi.fn(async () => {}),
  lock: vi.fn(),
  update: vi.fn(),
  navigation: vi.fn(),
  verify: vi.fn(),
  submit: vi.fn(),
  submitLetter: vi.fn(),
  lettersAddress: "",
  incrementCounter: vi.fn(),
  identity: null as any,
  credentials: null as any,
  walletRequestPending: false,
  walletGeneration: 0,
  walletListeners: new Set<() => void>(),
  independentKey: null as any,
  identityDraft: null as any,
  rememberDraft: vi.fn(),
  generation: 0,
  receipt: vi.fn(),
  center: null as any,
  busy: vi.fn(),
  locked: null as (() => void) | null,
  lockListeners: new Set<() => void>(),
  revision: 0,
  listeners: new Set<() => void>(),
  stateReadMode: "rebuild" as "rebuild" | "chain",
  configUpdate: vi.fn(),
  createRecipientCode: vi.fn(),
  syncListeners: new Set<(event: PublicStateSyncProgress) => void>(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "shielded.claimPeriodOption" ? `${key}:${options?.period}` :
        key === "shielded.fundingVersionOption" ? `${key}:${options?.version}` :
        key === "shielded.periodDaysSummary" ? `${key}:${options?.days}` :
        key === "shielded.policyOption" ? `${key}:${options?.index}` :
        key === "shielded.submit" || key === "shielded.spendReview.preview" ? `${key}:${options?.action}` :
          key.startsWith("shielded.spendReview.") && options
            ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("../../config", () => ({
  useConfig: () => ({
    rpcUrl: "https://rpc.example",
    chainId: 31337,
    tokenAddress: "0x0000000000000000000000000000000000000003",
    stateReadMode: mocks.stateReadMode,
    update: mocks.configUpdate,
  }),
}));
vi.mock("../../tree/context", () => ({ useTreeGraphData: () => ({ nodesData: {} }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => mocks.center }));
vi.mock("../../wallet", () => ({
  getWalletConnectionGeneration: () => mocks.walletGeneration,
  subscribeWalletConnectionChange: (listener: () => void) => {
    mocks.walletListeners.add(listener);
    return () => { mocks.walletListeners.delete(listener); };
  },
}));
vi.mock("../../../shared/config/env", () => ({
  getShieldedPoolFactoryDeploymentBlock: () => 10,
  getPrivateLetterArchiveAddress: () => mocks.lettersAddress,
  getPrivateLetterArchiveDeploymentBlock: () => 0,
  getEventScanConfig: () => ({ blockChunk: 10_000 }),
}));
vi.mock("../../../shared/workers/shieldedAssetWorkerClient", () => ({
  shieldedAssetWorkerCall: mocks.call,
  cancelShieldedAssetPreview: mocks.cancel,
  getShieldedAssetWorkerGeneration: () => mocks.generation,
  subscribeShieldedAssetWorkerLock: (listener: () => void) => {
    mocks.lockListeners.add(listener);
    mocks.locked = () => { for (const current of mocks.lockListeners) current(); };
    return () => { mocks.lockListeners.delete(listener); };
  },
}));
vi.mock("../../../shared/workers/publicStateSyncProgress", () => ({
  subscribePublicStateSyncProgress: (listener: (event: PublicStateSyncProgress) => void) => {
    mocks.syncListeners.add(listener);
    return () => { mocks.syncListeners.delete(listener); };
  },
}));
vi.mock("./ShieldedIdentitySessionContext", async () => {
  const React = await import("react");
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => { mocks.listeners.delete(listener); };
  };
  return {
    useShieldedPageIdentitySession: () => {
      React.useSyncExternalStore(subscribe, () => mocks.revision);
      return {
        identity: mocks.identity,
        credentials: mocks.credentials ?? (mocks.identity ? credentials : null),
        independentKey: mocks.independentKey,
        identityDraft: mocks.identityDraft,
        rememberIdentityDraft: mocks.rememberDraft,
        lock: mocks.lock,
        update: mocks.update,
        touch: vi.fn(),
        setBusy: mocks.busy,
        beginWalletRequest: () => {
          mocks.walletRequestPending = true;
          const timer = setTimeout(() => {
            mocks.walletRequestPending = false;
            mocks.lock();
          }, 120_000);
          return () => {
            clearTimeout(timer);
            mocks.walletRequestPending = false;
            if (document.visibilityState === "hidden") mocks.lock();
          };
        },
        isWalletRequestPending: () => mocks.walletRequestPending,
      };
    },
  };
});
vi.mock("../services/shieldedReceiveCode", () => ({
  verifyShieldedReceiveCode: mocks.verify,
  createShieldedReceiveCodeForRecipient: mocks.createRecipientCode,
  peekShieldedReceiveCodePersonHash: (code: string) => code ? "0x" + "01".repeat(32) : null,
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitShield: mocks.submit,
  submitFund: mocks.submit,
  submitClaim: mocks.submit,
  submitPrivateTransfer: mocks.submit,
  submitUnshield: mocks.submit,
}));
vi.mock("../services/shieldedIdentityAuthorizationChain", () => ({
  createIdentityAuthorizationContract: () => ({ incrementCounter: mocks.incrementCounter }),
}));
vi.mock("../services/privateLetterChain", async original => ({
  ...await original<typeof import("../services/privateLetterChain")>(),
  submitPrivateLetter: mocks.submitLetter,
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((props: any, ref: any) => {
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
        getPublicFormData: () => ({ fullName: "Child", gender: 1, birthYear: 2000, birthMonth: 1, birthDay: 1, isBirthBC: false }),
        getSecretInputs: () => ({ passphrase: input.current?.value ?? "" }),
        clearSecretInputs: () => {
          if (input.current) input.current.value = "";
        },
      }));
      return (
        <input
          ref={input}
          aria-label="identity passphrase"
          type="password"
          data-prefill={props.initialValues?.fullName ?? ""}
        />
      );
    }),
  };
});
const address = "0x00000000000000000000000000000000000000aa";
const credentials = { handle: "credentials:1" };
const identity = {
  handle: "identity:1",
  identitySuiteId: 1,
  identityCommitment: "1",
  personHash: "0x" + "01".repeat(32),
  identity: { fullName: "Child" },
};
const independentKey = {
  ownerCommitment: "2",
  viewingKey: "0x" + "02".repeat(32),
  keyFingerprint: "0x" + "03".repeat(32),
  rootSource: "random",
  recoveryVerified: false,
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
// The refresh control also discovers every factory pool.
const emptyDiscovery = { complete: true, pools: [] };
const receivedIndependentWallet = {
  ...emptyWallet,
  notes: [{
    commitment: "100",
    ownerCommitment: independentKey.ownerCommitment,
    slot: "independent",
    kind: "value",
    amount: "2500000000000000000",
  }],
};
const signer = {
  getAddress: vi.fn(async () => address),
  signMessage: vi.fn(async () => "signature"),
  provider: {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 40),
    getTransactionCount: vi.fn(async () => 7),
    getTransactionReceipt: mocks.receipt,
  },
} as unknown as Signer;
const label = (key: string) => `shielded.walletKeys.${key}`;
const submitLabel = /^(?:shielded\.submit|shielded\.spendReview\.preview):shielded\.actions\./;
// Request-shape tests do not confirm spend previews; other actions stop before proving.
const stopAfterPreview = () => Promise.reject(new Error("stopped after preview"));
const sentTransaction = { transactionHash: `0x${"ab".repeat(32)}`, receipt: { status: 1 } };
const recoverCount = () => mocks.call.mock.calls.filter(([method]) => method === "recover").length;
async function confirmSpendPreview() {
  fireEvent.click(await screen.findByRole("button", { name: "shielded.spendReview.confirm" }));
}
async function startCandidateSpendReview(
  amount: "1000" | "2000",
  action: "privateTransfer" | "unshield" = "privateTransfer",
) {
  const candidateAmounts = [10000, 100, 10, 1, 20000, 200, 20, 2, 1000];
  const notes = candidateAmounts.map((value, index) => ({
    commitment: String(index + 11),
    ownerCommitment: "1",
    slot: "identity",
    kind: "value",
    amount: (BigInt(value) * 10n ** 18n).toString(),
  }));
  const input = notes[amount === "1000" ? 8 : 0];
  const value = (BigInt(amount) * 10n ** 18n).toString();
  const outputs = [value, (BigInt(input.amount) - BigInt(value)).toString()];
  mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 0, fingerprint: "recipient-fingerprint" });
  mocks.call.mockImplementation(async (method, params) => {
    if (method === "recover") return { ...emptyWallet, notes };
    if (method === "discover") return emptyDiscovery;
    if (method === "prove") return {
      action,
      amount: value,
      recipient: address,
      data: { outputCommitments: [31n, 32n] },
      proof: {},
    };
    return {
      handle: `spend:${action}:${amount}`,
      action,
      slot: params.slot,
      amount: value,
      inputs: [input.commitment],
      inputAmounts: [input.amount],
      outputAmounts: outputs,
      steps: [{ action, inputs: [input.commitment], outputAmounts: outputs }],
      recipient: address,
    };
  });
  mocks.submit.mockResolvedValue(sentTransaction);
  const selectedModules = { ...modules, assetSymbol: "DEEP" };
  const rendered = await renderUnlockedPanel(signer, selectedModules);
  chooseAction(action);
  const amountInput = screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount");
  fireEvent.change(amountInput, { target: { value: amount } });
  for (const note of notes) selectValue(note.commitment);
  if (action === "privateTransfer") {
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "recipient-code" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "shielded.recipientConfirm" }));
  } else {
    fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
  }
  fireEvent.click(screen.getByRole("button", { name: submitLabel }));
  const review = await screen.findByRole("region", { name: "shielded.spendReview.title" });
  return { rendered, review, amountInput, selectedModules };
}
async function waitUntilIdle() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
const renderPanel = async (signingWallet = signer, selectedModules = modules, navigation?: ShieldedPanelNavigation) => {
  const rendered = render(
    <ShieldedInheritancePanel
      modules={selectedModules}
      signer={signingWallet}
      account={address}
      navigation={navigation}
      onNavigationChange={mocks.navigation}
    />,
  );
  if (mocks.credentials || mocks.identity) {
    await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
  }
  return rendered;
};
function taskNavigation() {
  return screen.getByRole("navigation", { name: "shielded.actionsTitle" });
}
function navButton(action: string) {
  return within(taskNavigation()).getByRole("button", { name: `shielded.actions.${action}` });
}
function chooseAction(action: string) {
  if (action === "receiveCode") {
    openReceiveCode("identity");
    return;
  }
  fireEvent.click(navButton(action));
}
/** The form of the current task; its heading names the task. */
function taskPanel() {
  return screen.getByRole("region", { name: /^shielded\.(?:actionTitles|actions)\./ });
}
async function renderUnlockedPanel(signingWallet = signer, selectedModules = modules) {
  mocks.identity = identity;
  return await renderPanel(signingWallet, selectedModules);
}
function chooseIndependentBudget() {
  fireEvent.click(navButton("claim"));
  chooseBudgetKey("independent");
}
function chooseBudgetKey(mode: "identity" | "independent") {
  chooseActiveWallet(mode);
}
function chooseFundingEntry(entry: "privateConvenient" | "privateIndependent" | "public") {
  fireEvent.click(screen.getByRole("radio", {
    name: label(entry === "public" ? "publicEntry" : entry === "privateConvenient" ? "convenientEntry" : "independentEntry"),
  }));
}
function chooseRecoveryPath(path: "mnemonic" | "shieldedKey" | "signature") {
  fireEvent.click(screen.getByRole("radio", { name: label(`${path}Restore`) }));
}
function importRecovery() {
  fireEvent.click(screen.queryByRole("button", { name: label("verifySavedBackup") }) ??
    screen.getByRole("button", { name: label("importRecovery") }));
}
function heirChoice(personHash: string) {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${personHash}"]`);
  expect(input).toBeTruthy();
  return input!;
}
function chooseHeir(personHash: string) {
  fireEvent.click(heirChoice(personHash));
}
function heirOptions() {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"][name$="-heir"]'),
    (input) => input.value,
  );
}
function checkedHeir() {
  return document.querySelector<HTMLInputElement>('input[type="radio"][name$="-heir"]:checked');
}
function selectTrigger(label: string) {
  return screen.getByLabelText(label, { selector: "button" }) as HTMLButtonElement;
}
function chooseOption(label: string, option: string) {
  fireEvent.click(selectTrigger(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
function selectOptions(label: string) {
  const trigger = selectTrigger(label);
  fireEvent.click(trigger);
  const options = screen.getAllByRole("option").map((option) => option.textContent);
  fireEvent.keyDown(trigger, { key: "Escape" });
  return options;
}
function budgetChoice(handle: string) {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${handle}"]`);
  expect(input).toBeTruthy();
  return input!;
}
/** The exported backup, written into the DOM by the Worker response. */
function exportedMaterial() {
  return screen.getByLabelText(label("exportedRecoveryMaterial"));
}
function selectValue(commitment: string) {
  const input = document.querySelector<HTMLInputElement>(`input[value="${commitment}"]`);
  expect(input).toBeTruthy();
  if (!input!.checked) fireEvent.click(input!);
}
function openIndependentWallet() {
  openIndependentKeyManagement();
}
function openCreateWallet() {
  openIndependentWallet();
  fireEvent.click(screen.getByRole("button", { name: label("createTitle") }));
}
/** The wallet sheet over the workspace, for a receive code or a independent key. */
function walletSheet() {
  return screen.getByRole("dialog");
}
function closeWalletSheet() {
  fireEvent.click(within(walletSheet()).getByRole("button", { name: "common.close" }));
}
function openReceiveCode(slot: "identity" | "independent") {
  const button = screen.getByRole("button", { name: label(slot === "independent" ? "independentKeyReceiveCode" : "identityReceiveCode") });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
function openIndependentReceiving() {
  openReceiveCode("independent");
}
/** The card keeps its setup entries until the independent key is verified. */
function independentKeyButton(flow: "restore" | "create" = "restore") {
  return (flow === "restore" && screen.queryByRole("button", { name: label("keySettings") })) ||
    screen.getByRole("button", { name: label(flow === "create" ? "createTitle" : "restoreTitle") });
}
function openIndependentKeyManagement(flow: "restore" | "create" = "restore") {
  const button = independentKeyButton(flow);
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
async function createIndependentKeyForBackup(source: "random" | "signature" = "random") {
  openIndependentKeyManagement("create");
  fireEvent.click(screen.getByRole("radio", { name: label(`${source}Source`) }));
  await waitFor(() => expect(mocks.independentKey?.backupRequired).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: label("exportRecovery") }) as HTMLButtonElement).disabled).toBe(false));
}
async function waitForReceiveCode(slot: "identity" | "independent") {
  await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("receiveCode", expect.objectContaining({
    slot, disclosure: "anonymous", context: expect.objectContaining({ chainId: "31337" }), expiresAt: expect.stringMatching(/^\d+$/),
  }), expect.anything()));
  await waitUntilIdle();
}
function walletCard(slot: "identity" | "independent") {
  return screen.getByRole("group", { name: label(slot === "independent" ? "independentKey" : "identityCredentials") });
}
function expectIndependentKeySetup() {
  const card = within(walletCard("independent"));
  expect(card.getByRole("button", { name: label("restoreTitle") })).toBeTruthy();
  expect(card.getByRole("button", { name: label("createTitle") })).toBeTruthy();
  expect(card.queryByRole("button", { name: label("backupTitle") })).toBeNull();
  expect(card.queryByRole("button", { name: label("keySettings") })).toBeNull();
  expect(card.queryByText(label("keyFingerprint"))).toBeNull();
  expect(card.queryByRole("button", { name: label("independentKeyReceiveCode") })).toBeNull();
  expect(card.getByRole("status", { name: label("independentKeyReceiveCode") }).textContent).toContain(label("receiveCodeUnavailable"));
}
/**
 * The current wallet carries the current-wallet badge. Its radio stays unchecked
 * while a loaded independent key differs from the pinned one, until the user accepts it.
 */
function expectCurrentWallet(slot: "identity" | "independent") {
  expect(within(walletCard(slot)).getByText(label("currentWallet"))).toBeTruthy();
  expect(within(walletCard(slot === "independent" ? "identity" : "independent")).queryByText(label("currentWallet"))).toBeNull();
}
function cardBalance(slot: "identity" | "independent", kind: "balanceAmount" | "budgetAmount") {
  return within(walletCard(slot)).getByText(`shielded.${kind}`).closest("div")?.querySelector("dd")?.textContent;
}
function walletSelection() {
  return screen.getByRole("radiogroup", { name: label("walletBalances") });
}
function chooseActiveWallet(slot: "identity" | "independent") {
  fireEvent.click(within(walletSelection()).getByRole("radio", { name: label(slot === "independent" ? "independentKey" : "identityCredentials") }));
}
function walletTab(slot: "identity" | "independent") {
  return screen.getByRole("tab", {
    name: label(slot === "independent" ? "independentKey" : "identityCredentials"),
  }) as HTMLButtonElement;
}
async function openWalletManagement() {
  if (!screen.queryByLabelText(label("exportedRecoveryMaterial"))) openIndependentKeyManagement();
  // Restoring over a loaded candidate first clears only that root in the Worker.
  await waitFor(() => expect(
    screen.queryByRole("radio", { name: label("mnemonicRestore") }) ??
      screen.queryByText(label("recoveryCandidate")) ?? screen.getByLabelText(label("exportedRecoveryMaterial")),
  ).toBeTruthy());
}
function lockWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
}
function refreshAssets() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
}
function publishSession(state: { credentials?: any; identity: any; independentKey: any }) {
  mocks.credentials = "credentials" in state ? state.credentials : (state.identity ? credentials : mocks.credentials);
  mocks.identity = state.identity;
  mocks.independentKey = state.independentKey;
  mocks.revision++;
  Array.from(mocks.listeners).forEach((listener) => listener());
}
function restorePendingSubmission(kind: "action" | "approval" = "action", hash: string | null = "0xold") {
  const record = {
    id: `old-${kind}`,
    kind: "shielded",
    label: "CFX",
    phase: "busy",
    transactionHash: hash ?? undefined,
    shieldedSubmission: {
      chainId: "31337", poolAddress: address, kind,
      nonce: 7, fromBlock: 30, signerAddress: address,
      outputCommitments: kind === "action" ? ["100", "101"] : undefined,
    },
  };
  mocks.center = { records: [record], upsert: vi.fn((next: any) => Object.assign(record, next)) };
  return record;
}

describe("Worker-backed shielded wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateReadMode = "rebuild";
    mocks.createRecipientCode.mockResolvedValue("recipient-code");
    mocks.identity = null;
    mocks.credentials = null;
    mocks.lettersAddress = "";
    mocks.submitLetter.mockReset().mockResolvedValue({ transactionHash: "0xletter" });
    mocks.walletRequestPending = false;
    mocks.walletGeneration = 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    mocks.independentKey = null;
    mocks.identityDraft = null;
    mocks.generation = 0;
    mocks.center = null;
    mocks.locked = null;
    mocks.call.mockImplementation(async (method: string) => {
      if (method === "recover") return emptyWallet;
      if (method === "discover") return emptyDiscovery;
      if (method === "unlockIdentity") return { credentials, identity, independentKey: mocks.independentKey };
      if (method === "clearIndependentKey" || method === "clearPendingIndependentKey") return { credentials: mocks.credentials ?? credentials, identity: mocks.identity, independentKey: null };
      if (method === "createIndependentKey") return { credentials: mocks.credentials ?? credentials,
        identity: mocks.identity,
        independentKey: { ...independentKey, backupRequired: true },
      };
      if (method === "importRecoveryMaterial") return { credentials: mocks.credentials ?? credentials,
        identity: mocks.identity,
        independentKey: { ...independentKey, rootSource: "imported", recoveryVerified: true },
      };
      return { credentials, identity, independentKey };
    });
    mocks.lock.mockImplementation(() => {
      mocks.generation++;
      mocks.walletRequestPending = false;
      publishSession({ credentials: null, identity: null, independentKey: null });
    });
    mocks.update.mockImplementation(publishSession);
    mocks.receipt.mockReset().mockResolvedValue(null);
    mocks.incrementCounter.mockReset().mockResolvedValue({ hash: "0xrevocation", wait: async () => ({ status: 1 }) });
    (signer.signMessage as any).mockResolvedValue("signature");
    (signer.getAddress as any).mockResolvedValue(address);
    (signer.provider!.getTransactionCount as any).mockResolvedValue(7);
  });
  afterEach(cleanup);
  it("starts with one identity unlock and keeps independent budget keys out of the page entry", async () => {
    await renderPanel();
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(screen.queryByLabelText(label("action"))).toBeNull();
    expect(screen.queryByRole("navigation", { name: "shielded.actionsTitle" })).toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /stateReadMode/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "shielded.privateLetters.title" })).toBeNull();
  });
  it.each(["rebuild", "chain"] as const)("unlocks with the configured %s read mode without a switch control", async (stateReadMode) => {
    mocks.stateReadMode = stateReadMode;
    await renderPanel();
    expect(screen.queryByRole("group", { name: /stateReadMode/ })).toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ stateReadMode }),
    }));
    expect(screen.queryByRole("group", { name: /stateReadMode/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /stateReadMode/ })).toBeNull();
    expect(mocks.configUpdate).not.toHaveBeenCalled();
  });
  it("forwards the configured read mode to the recipient code generator", async () => {
    mocks.stateReadMode = "chain";
    mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 0, fingerprint: "recipient-fingerprint" });
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseFundingEntry("privateConvenient");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.recipientMethods.credentials" }));
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "recipient-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
    await waitFor(() => expect(mocks.createRecipientCode).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ stateReadMode: "chain" }), disclosure: "fund",
    })));
  });
  it("keeps the read-mode control absent while recovering or tracking a submission", async () => {
    let resolve!: (wallet: typeof emptyWallet) => void;
    const pending = new Promise<typeof emptyWallet>((finish) => { resolve = finish; });
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method) => method === "recover" ? pending : emptyDiscovery);
    render(<ShieldedInheritancePanel modules={modules} signer={signer} account={address} />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", expect.anything()));
    expect(screen.queryByRole("group", { name: /stateReadMode/ })).toBeNull();
    await act(async () => resolve(emptyWallet));
    await waitUntilIdle();

    cleanup();
    restorePendingSubmission();
    await renderUnlockedPanel();
    expect(screen.queryByRole("group", { name: /stateReadMode/ })).toBeNull();
    expect(mocks.configUpdate).not.toHaveBeenCalled();
  });
  it("does not offer synchronization pause as a way to cancel an already pending transaction", async () => {
    restorePendingSubmission();
    mocks.identity = identity;
    let finish!: (wallet: typeof emptyWallet) => void;
    const recovering = new Promise<typeof emptyWallet>((resolve) => { finish = resolve; });
    mocks.call.mockImplementation(async () => recovering);
    render(<ShieldedInheritancePanel modules={modules} signer={signer} account={address} />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", expect.anything()));
    act(() => {
      for (const listener of mocks.syncListeners) listener({ domain: "authorization", phase: "catchup", completed: 1, total: 2 });
    });
    const pause = screen.getByRole("button", { name: "shielded.publicStateSync.pause" }) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    fireEvent.click(pause);
    expect(mocks.lock).not.toHaveBeenCalled();
    await act(async () => finish(emptyWallet));
  });
  it.each(["rebuild", "chain"] as const)("shows actual %s sync inside the overview and preserves verified balances during refresh", async (stateReadMode) => {
    mocks.stateReadMode = stateReadMode;
    mocks.identity = identity;
    const initialWallet = {
      ...emptyWallet,
      notes: [{ commitment: "21", ownerCommitment: "1", slot: "identity", kind: "value", amount: "3000000000000000000" }],
    };
    let finish!: (wallet: typeof initialWallet) => void;
    let recovering = new Promise<typeof initialWallet>((resolve) => { finish = resolve; });
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) => method === "recover"
      ? recovering
      : originalCall(method, params));
    render(<ShieldedInheritancePanel modules={modules} signer={signer} account={address} />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", {
      context: expect.objectContaining({ stateReadMode }),
    }));
    const overview = walletSelection().closest("section")!;
    const initialCard = walletCard("identity");
    const task = taskPanel();
    expect(cardBalance("identity", "balanceAmount")).toBe("—");
    expect(within(initialCard).getByText("shielded.publicStateSync.balanceLoading")).toBeTruthy();
    expect(within(walletCard("independent")).queryByText("shielded.publicStateSync.balanceLoading")).toBeNull();
    expect(screen.queryByRole("region", { name: "shielded.publicStateSync.title" })).toBeNull();

    act(() => {
      for (const listener of mocks.syncListeners) listener({ domain: "authorization", phase: "verify", completed: 1, total: 3 });
    });
    const syncStatus = screen.getByRole("region", { name: "shielded.publicStateSync.title" });
    expect(overview.contains(syncStatus)).toBe(true);
    expect(screen.getAllByRole("region", { name: "shielded.publicStateSync.title" })).toHaveLength(1);
    expect(within(syncStatus).queryByRole("progressbar")).toBeNull();
    expect(walletCard("identity")).toBe(initialCard);
    expect(taskPanel()).toBe(task);

    act(() => {
      for (const listener of mocks.syncListeners) listener({ domain: "authorization", phase: "complete", completed: 3, total: 3 });
    });
    expect(screen.queryByRole("region", { name: "shielded.publicStateSync.title" })).toBeNull();
    expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(initialWallet));
    await waitUntilIdle();
    expect(cardBalance("identity", "balanceAmount")).toBe("3CFX");
    expect(within(initialCard).queryByText("shielded.publicStateSync.balanceLoading")).toBeNull();

    recovering = new Promise<typeof initialWallet>((resolve) => { finish = resolve; });
    refreshAssets();
    expect(cardBalance("identity", "balanceAmount")).toBe("3CFX");
    expect(within(initialCard).getByText("shielded.publicStateSync.balanceUpdating")).toBeTruthy();
    expect(within(initialCard).queryByText("shielded.publicStateSync.balanceLoading")).toBeNull();
    expect(taskPanel()).toBe(task);
    await act(async () => finish({
      ...initialWallet,
      notes: [{ ...initialWallet.notes[0], amount: "2000000000000000000" }],
    }));
    await waitUntilIdle();
    expect(cardBalance("identity", "balanceAmount")).toBe("2CFX");
    expect(within(initialCard).queryByText("shielded.publicStateSync.balanceUpdating")).toBeNull();
    expect(walletCard("identity")).toBe(initialCard);
    expect(taskPanel()).toBe(task);
  });
  it.each([
    ["native", "CFX"], ["erc20", "DEEP"], ["erc20", "TEST"],
  ] as const)("sends a standalone letter from the unlocked workspace in the %s %s context", async (assetKind, assetSymbol) => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    const preparedLetter = { delivery: { messageId: "7", checkpointId: "1", asOf: "900", deadline: "1200", recipientBinding: "9" }, ciphertext: "0x010203", proof: "0x1234" };
    await renderUnlockedPanel(signer, { ...modules, assetKind, assetSymbol });
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method: string) => {
      if (method === "prepareLetter") return preparedLetter;
      return originalCall(method);
    });
    expect((screen.getByRole("button", { name: "shielded.privateLetters.inbox" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.write" }));
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.recipientCode"), { target: { value: "valid-anonymous-code" } });
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.body"), { target: { value: "Letter without a deposit" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.send" }));
    await screen.findByText("shielded.privateLetters.sent: 0xletter");
    expect(mocks.call).toHaveBeenCalledWith("prepareLetter", {
      context: expect.objectContaining({ chainId: "31337", assetKind, lettersAddress: mocks.lettersAddress }),
      code: "valid-anonymous-code", body: "Letter without a deposit", budgetCommitment: undefined,
    }, expect.anything());
    expect(mocks.submitLetter).toHaveBeenCalledWith(expect.objectContaining({ signer, letter: preparedLetter, address: mocks.lettersAddress }));
    expect(mocks.identity).toEqual(identity);
    expect(screen.queryByRole("button", { name: "shielded.unlock" })).toBeNull();
  });
  it("lists every task in its three groups and shows both wallets with the current one marked", async () => {
    await renderUnlockedPanel();
    expect(within(taskNavigation()).getAllByRole("group").map((group) =>
      group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent,
    )).toEqual(["shielded.groups.wallet", "shielded.groups.inheritance", "shielded.privateLetters.title"]);
    expect(within(taskNavigation()).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "shielded.actions.shield",
      "shielded.actions.privateTransfer",
      "shielded.actions.unshield",
      "shielded.actions.fund",
      "shielded.actions.claim",
      "shielded.privateLetters.write",
      "shielded.privateLetters.inbox",
    ]);
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(within(walletSelection()).getAllByRole("radio")).toHaveLength(2);
    expectCurrentWallet("identity");
    expect(within(walletCard("independent")).queryByText(label("currentWallet"))).toBeNull();
    expect(screen.queryByRole("button", { name: label("changeWallet") })).toBeNull();
    expect(screen.queryByLabelText(label("action"))).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.receiveCode" })).toBeNull();
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "shielded.submit:shielded.actions.shield" })).toBeTruthy();
    expect(screen.getByLabelText("shielded.fields.amount")).toBeTruthy();
    chooseAction("fund");
    expect(navButton("fund").getAttribute("aria-current")).toBe("true");
    expect(navButton("shield").getAttribute("aria-current")).toBeNull();
    chooseAction("claim");
    expect(screen.queryByLabelText(label("action"))).toBeNull();
    expectCurrentWallet("identity");
    chooseAction("shield");
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.identity).toEqual(identity);
  });
  it.each(["success", "failure"] as const)("releases inbox loading after %s when entering directly under StrictMode", async (outcome) => {
    mocks.identity = identity;
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    let finish!: (value: { letters: []; unavailable: number }) => void;
    let fail!: (reason: Error) => void;
    const pending = new Promise<{ letters: []; unavailable: number }>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, ...args) => method === "recoverLetters"
      ? pending
      : originalCall(method, ...args));
    render(<StrictMode><ShieldedInheritancePanel modules={modules} signer={signer} account={address} /></StrictMode>);
    await waitUntilIdle();
    fireEvent.click(within(taskNavigation()).getByRole("button", { name: "shielded.privateLetters.inbox" }));
    expect((navButton("shield") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.call.mock.calls.filter(([method]) => method === "recoverLetters")).toHaveLength(1);
    await act(async () => {
      if (outcome === "success") finish({ letters: [], unavailable: 0 });
      else fail(new Error("Archive RPC unavailable"));
    });
    await waitUntilIdle();
    expect(screen.queryByText("shielded.privateLetters.working")).toBeNull();
    expect(screen.getByText(`shielded.privateLetters.${outcome === "success" ? "emptyInbox" : "recoverFailed"}`)).toBeTruthy();
    expect((navButton("shield") as HTMLButtonElement).disabled).toBe(false);
    chooseAction("shield");
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("opens letters in the task area and reads the inbox only after selecting its navigation entry", async () => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    await renderUnlockedPanel();
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method, ...args) => method === "recoverLetters"
      ? { letters: [{ messageId: "7", body: "A private family letter", registeredAt: "1000", attachment: null }], unavailable: 0 }
      : originalCall(method, ...args));
    const letters = within(taskNavigation()).getByRole("group", { name: "shielded.privateLetters.title" });
    expect(screen.queryByLabelText("shielded.privateLetters.body")).toBeNull();
    fireEvent.click(within(letters).getByRole("button", { name: "shielded.privateLetters.write" }));
    expect(screen.getByRole("region", { name: "shielded.privateLetters.write" }).contains(screen.getByLabelText("shielded.privateLetters.body"))).toBe(true);
    expect(within(letters).getByRole("button", { name: "shielded.privateLetters.write" }).getAttribute("aria-current")).toBe("true");
    expect(navButton("shield").getAttribute("aria-current")).toBeNull();
    expect(mocks.call.mock.calls.filter(([method]) => method === "recoverLetters")).toHaveLength(0);

    fireEvent.click(within(letters).getByRole("button", { name: "shielded.privateLetters.inbox" }));
    await screen.findByText("A private family letter");
    expect(screen.getByRole("region", { name: "shielded.privateLetters.inbox" })).toBeTruthy();
    expect(mocks.call.mock.calls.filter(([method]) => method === "recoverLetters")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.refresh" }));
    await waitUntilIdle();
    expect(mocks.call.mock.calls.filter(([method]) => method === "recoverLetters")).toHaveLength(2);
    chooseAction("shield");
    expect(screen.queryByText("A private family letter")).toBeNull();
    expect(navButton("shield").getAttribute("aria-current")).toBe("true");
  });
  it("selects the wallet and its claim task with one phone tab tap while keeping repeated taps harmless", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "recover") return {
        ...emptyWallet,
        notes: [
          { commitment: "201", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" },
          { commitment: "202", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000" },
        ],
        claims: [
          { handle: "claim:identity", budgets: ["201"], slot: "identity", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["0"] },
          { handle: "claim:independent", budgets: ["202"], slot: "independent", status: "claimable", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["1", "2"] },
        ],
      };
      if (method === "prove") return stopAfterPreview();
      return { handle: "preview:phone-tab", action: params.action, slot: params.slot, amount: "1000000000000000000", steps: [], inputs: [], inputAmounts: [], outputAmounts: [] };
    });
    await renderUnlockedPanel();
    chooseAction("claim");
    fireEvent.click(walletTab("independent"));
    expectCurrentWallet("independent");
    expect(walletTab("independent").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:2" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(walletTab("identity"));
    expectCurrentWallet("identity");
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(walletTab("independent"));
    const lastPeriod = screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:3" }) as HTMLInputElement;
    fireEvent.click(lastPeriod);
    expect(lastPeriod.checked).toBe(false);
    fireEvent.click(walletTab("independent"));
    expect(lastPeriod.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "claim", slot: "independent", claimHandle: "claim:independent", periodIndices: ["1"],
    }), expect.anything()));
  });
  it("keeps phone tabs on the current wallet while an asset scan is busy", async () => {
    await renderUnlockedPanel();
    const defaultCall = mocks.call.getMockImplementation();
    let finishScan: (wallet: typeof emptyWallet) => void = () => {};
    mocks.call.mockImplementation((method, params, options) => method === "recover"
      ? new Promise((resolve) => { finishScan = resolve; })
      : defaultCall?.(method, params, options));
    refreshAssets();
    expect(walletTab("identity").disabled).toBe(true);
    expect(walletTab("independent").disabled).toBe(true);
    fireEvent.click(walletTab("independent"));
    fireEvent.keyDown(walletTab("identity"), { key: "ArrowRight" });
    expectCurrentWallet("identity");
    expect(walletTab("identity").getAttribute("aria-selected")).toBe("true");
    await act(async () => finishScan(emptyWallet));
    await waitUntilIdle();
    expect(walletTab("independent").disabled).toBe(false);
  });
  it("requires original credentials before offering independent key recovery and asset controls", async () => {
    render(
      <ShieldedInheritancePanel modules={modules} signer={signer} account={address}
        assetControls={<span>asset-selector</span>} />,
    );
    expect(screen.queryByText("asset-selector")).toBeNull();
    expect(screen.queryByRole("button", { name: label("openIndependentKey") })).toBeNull();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "original-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitUntilIdle();
    expect(screen.getByText("asset-selector")).toBeTruthy();
    openIndependentWallet();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-words" } });
    importRecovery();
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial",
      expect.objectContaining({ material: "saved-words", expectedCredentialsHandle: credentials.handle })));
    expect(mocks.credentials).toEqual(credentials);
  });
  it("checks a learned fingerprint only until the session locks", async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "child-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitUntilIdle();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    await waitFor(() => expect(screen.getByText(label("backupSaveStep"))).toBeTruthy());
    lockWorkspace();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "child-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitUntilIdle();
    openIndependentWallet();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "another-key" } });
    importRecovery();
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "importRecoveryMaterial",
        expect.objectContaining({ material: "another-key", expectedFingerprint: undefined }),
      ),
    );
  });
  it("finishes the automatic scan when a remount reuses an unlocked session", async () => {
    // A pool change remounts the panel with the session still open; StrictMode
    // (and Fast Refresh) also cleans up and re-runs effects on the same instance.
    mocks.identity = identity;
    render(
      <StrictMode>
        <ShieldedInheritancePanel
          modules={modules}
          signer={signer}
          account={address}
        />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      screen.getByRole("button", { name: submitLabel }).getAttribute("aria-busy"),
    ).toBeNull();
    expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(1);
  });
  it("offers asset selection in the overview once identity is unlocked", async () => {
    mocks.identity = identity;
    render(
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account={address}
        assetControls={<span>asset-selector</span>}
      />,
    );
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" }).textContent).toContain(
      "asset-selector",
    );
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("recover", expect.anything()));
  });
  it("refreshes balances and discovers every factory pool without showing technical success details", async () => {
    await renderUnlockedPanel();
    expect(mocks.call.mock.calls.some(([method]) => method === "discover")).toBe(false);
    expect(cardBalance("identity", "balanceAmount")).toBe("0CFX");
    mocks.call.mockImplementation(async (method: string) => method === "discover" ? {
      complete: true,
      pools: [{
        assetAddress: "0x0000000000000000000000000000000000000000",
        poolAddress: address,
        status: "recovered",
        rawValueBalance: "2500000000000000000",
        rawBudgetBalance: "0",
      }],
    } : {
      ...emptyWallet,
      notes: [{ commitment: "100", ownerCommitment: "1", slot: "identity", kind: "value", amount: "2500000000000000000" }],
    });
    const before = mocks.call.mock.calls.length;
    refreshAssets();
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("discover", expect.anything(), expect.anything()));
    await waitUntilIdle();
    expect(mocks.call.mock.calls.slice(before).map(([method]) => method)).toEqual([
      "recover",
      "discover",
    ]);
    expect(cardBalance("identity", "balanceAmount")).toBe("2.5CFX");
    expect(screen.queryByText(label("discoveryComplete"))).toBeNull();
    expect(screen.queryByText(label("discoveryPartial"))).toBeNull();
    expect(screen.queryByText(/rawValue|rawBudget|2500000000000000000/)).toBeNull();
  });
  it("shows only a brief warning for an incomplete refresh and clears it on the next complete refresh", async () => {
    await renderUnlockedPanel();
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "discover" ? {
      complete: false,
      pools: [{
        assetAddress: "0x0000000000000000000000000000000000000000",
        poolAddress: address,
        status: "failed",
        rawValueBalance: "987654321",
        rawBudgetBalance: "123456789",
        error: "Pool-specific verification detail",
      }],
    } : defaultCall?.(method, params));

    refreshAssets();

    await waitFor(() => expect(screen.getByText(label("discoveryPartial"))).toBeTruthy());
    await waitUntilIdle();
    expect(screen.queryByText(label("discoveryComplete"))).toBeNull();
    expect(screen.queryByText(/rawValue|rawBudget|987654321|123456789/)).toBeNull();
    expect(screen.queryByText("Pool-specific verification detail")).toBeNull();
    mocks.call.mockImplementation(defaultCall!);

    refreshAssets();

    await waitUntilIdle();
    expect(mocks.call.mock.calls.filter(([method]) => method === "discover")).toHaveLength(2);
    expect(screen.queryByText(label("discoveryPartial"))).toBeNull();
    expect(screen.queryByText(label("discoveryComplete"))).toBeNull();
  });
  it("keeps scan failures visible after an overview refresh", async () => {
    await renderUnlockedPanel();
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "discover") throw new Error("Pool discovery failed");
      return defaultCall?.(method, params);
    });

    refreshAssets();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Pool discovery failed"));
    await waitUntilIdle();
    expect(screen.queryByText(label("discoveryComplete"))).toBeNull();
    expect(screen.queryByText(label("discoveryPartial"))).toBeNull();
  });
  it("prefills public identity fields after an application lock and forgets them on exit", async () => {
    const draft = { fullName: "Child", isBirthBC: false, birthYear: 2000, birthMonth: 1, birthDay: 1, gender: 1 };
    mocks.identityDraft = draft;
    await renderPanel();
    expect(screen.getByLabelText("identity passphrase").getAttribute("data-prefill")).toBe("Child");
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "private-pass" } });
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "child-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(mocks.rememberDraft).toHaveBeenCalledWith(draft));
    expect(JSON.stringify(mocks.rememberDraft.mock.calls)).not.toContain("private-pass");
    await waitFor(() => expect(screen.getByRole("button", { name: "shielded.lock" })).toBeTruthy());
    lockWorkspace();
    expect(mocks.rememberDraft).toHaveBeenLastCalledWith(null);
    expect(mocks.lock).toHaveBeenCalled();
  });
  it("opens only the two wallet balances until a receive code or key is requested", async () => {
    await renderUnlockedPanel();
    const amount = screen.getByLabelText("shielded.fields.amount") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "1.25" } });
    const mainSubmit = screen.getByRole("button", { name: submitLabel });
    expect(walletSelection()).toBeTruthy();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
    expect(screen.queryByRole("button", { name: label("returnToAction") })).toBeNull();
    expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
    expect(screen.getByRole("button", { name: submitLabel })).toBe(mainSubmit);
    // Without a independent key, its card offers unlocking or creating one instead of receiving.
    expect(screen.queryByRole("button", { name: label("independentKeyReceiveCode") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("keySettings") })).toBeNull();
    for (const flow of ["restoreTitle", "createTitle"]) {
      expect(screen.getByRole("button", { name: label(flow) }).getAttribute("aria-expanded")).toBe("false");
    }
    expect(amount.value).toBe("1.25");
    expect(screen.queryByRole("group", { name: label("walletBalances") })).toBeNull();
    expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
    expect(amount.value).toBe("1.25");
  });
  it("keeps a loaded candidate until a concrete recovery method is submitted, then clears only its root", async () => {
    mocks.independentKey = { ...independentKey, rootSource: "walletSignature", recoveryVerified: false };
    await renderUnlockedPanel();
    expect(screen.queryByRole("button", { name: label("independentKeyReceiveCode") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    openIndependentKeyManagement();
    expect(screen.queryByText(label("recoveryCandidate"))).toBeNull();
    expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "clearIndependentKey")).toBe(false);
    chooseRecoveryPath("shieldedKey");
    expect(mocks.independentKey?.rootSource).toBe("walletSignature");
    expect(mocks.call.mock.calls.some(([method]) => method === "clearIndependentKey")).toBe(false);
    fireEvent.change(screen.getByLabelText(label("shieldedKeyInput")), { target: { value: "previously-saved-key" } });
    importRecovery();
    await waitFor(() => expect(mocks.independentKey?.recoveryVerified).toBe(true));
    expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {});
    expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({ material: "previously-saved-key" }));
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.identity).toEqual(identity);
  });
  it("confirms a re-signed candidate when its scan discovers every factory pool", async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method === "restoreSignature")
        return { credentials: mocks.credentials ?? credentials, identity: null, independentKey: { ...independentKey, rootSource: "walletSignature", recoveryVerified: false } };
      if (method === "discover")
        return {
          complete: true,
          pools: [{
            assetAddress: "0x0000000000000000000000000000000000000000",
            poolAddress: address,
            status: "recovered",
            rawValueBalance: "250",
            rawBudgetBalance: "0",
          }],
          sessionState: { credentials: mocks.credentials ?? credentials,
            identity: null,
            independentKey: { ...independentKey, rootSource: "walletSignature", recoveryVerified: true, recoveryPath: "history" },
          },
        };
      return method === "recover" ? emptyWallet : { credentials: mocks.credentials ?? credentials, identity: mocks.identity, independentKey: mocks.independentKey };
    });
    mocks.credentials = credentials;
    await renderPanel();
    openIndependentWallet();
    chooseRecoveryPath("signature");
    fireEvent.click(screen.getByText(label("restoreSignature")));
    await waitFor(() => expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: label("recover") }));
    await waitFor(() => expect(within(walletSelection()).getByRole("radio", { name: label("independentKey") })).toBeTruthy());
    expect(screen.queryByText(label("independentKeyRecoveredTitle"))).toBeNull();
    // The selected pool and factory confirm the candidate; the workspace then scans the verified slot.
    expect(mocks.call.mock.calls.map(([method]) => method).filter((method) =>
      method === "recover" || method === "discover")).toEqual(["recover", "discover", "recover"]);
    expect(mocks.call).toHaveBeenCalledWith(
      "discover",
      { context: expect.objectContaining({ poolAddress: address }) },
      expect.anything(),
    );
    expect(mocks.independentKey).toMatchObject({ recoveryVerified: true, recoveryPath: "history" });
    await waitUntilIdle();
    expect(screen.queryByText(label("discoveryComplete"))).toBeNull();
    expect(screen.queryByText(/rawValue|rawBudget/)).toBeNull();
  });
  it("labels the required ERC20 approval before offering deposit confirmation", async () => {
    const erc20 = {
      ...modules,
      assetKind: "erc20",
      token: { allowance: vi.fn(async () => 0n), balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n) },
    } as unknown as ShieldedPageModules;
    await renderUnlockedPanel(signer, erc20);
    await waitFor(() => expect(screen.queryByRole("button", { name: label("approve") })).toBeNull());
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
  });
  it("keeps receive-code settings independent from the selected claim task", async () => {
    await renderUnlockedPanel();
    chooseAction("claim");
    const mainSubmit = screen.getByRole("button", { name: submitLabel });
    openReceiveCode("identity");
    expect(navButton("claim").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: submitLabel })).toBe(mainSubmit);
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(within(screen.getByRole("group", { name: label("receiveKeyLabel") })).queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: label("independentKeyReceiveCode") })).toBeNull();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each([
    ["create", "radio", "randomSource"],
    ["restore", "radio", "mnemonicRestore"],
  ] as const)("opens %s directly from the independent key card", async (flow, role, field) => {
    await renderUnlockedPanel();
    openIndependentKeyManagement(flow);
    expect(screen.getByRole(role, { name: label(field) })).toBeTruthy();
    expect(independentKeyButton(flow).getAttribute("aria-expanded")).toBe("true");
    expect(independentKeyButton(flow === "create" ? "restore" : "create").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: label("createTitle") })).toBeNull();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    expect(within(walletSheet()).getByRole("heading", { name: label(flow === "create" ? "createTitle" : "restoreTitle") })).toBeTruthy();
    closeWalletSheet();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole(role, { name: label(field) })).toBeNull();
    expect((within(walletSelection()).getByRole("radio", { name: label("identityCredentials") }) as HTMLInputElement).checked).toBe(true);
  });
  it("opens standalone key backup without discarding either credential", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderUnlockedPanel();
    openIndependentKeyManagement();
    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("keeps each action's amount draft and starts withdrawals with an empty address", async () => {
    await renderUnlockedPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "100" } });
    chooseAction("privateTransfer");
    expect((screen.getByLabelText("shielded.fields.transferAmount") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("shielded.fields.transferAmount"), { target: { value: "5" } });
    chooseAction("unshield");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("shielded.fields.exitRecipient") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "2" } });
    chooseAction("fund");
    expect((screen.getByLabelText("shielded.fields.rate") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "9" } });
    chooseAction("shield");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("100");
    chooseAction("privateTransfer");
    expect((screen.getByLabelText("shielded.fields.transferAmount") as HTMLInputElement).value).toBe("5");
    chooseAction("unshield");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("2");
    chooseAction("fund");
    expect((screen.getByLabelText("shielded.fields.rate") as HTMLInputElement).value).toBe("9");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("keeps the original budget period presets and allows a custom period", async () => {
    await renderUnlockedPanel();
    chooseAction("fund");
    expect(selectOptions("shielded.fields.periodDays")).toEqual([
      ...["1", "7", "14", "21", "30", "90", "180", "365"].map((days) => `shielded.periodDaysSummary:${days}`),
      "shielded.customPeriodDays",
    ]);
    expect((screen.getByLabelText("shielded.fields.periods") as HTMLInputElement).value).toBe("1");
    chooseOption("shielded.fields.periodDays", "shielded.customPeriodDays");
    const custom = screen.getByLabelText("shielded.fields.customPeriodDays") as HTMLInputElement;
    fireEvent.change(custom, { target: { value: "45" } });
    expect(custom.value).toBe("45");
    expect(mocks.call.mock.calls.filter(([method]) => method === "preview")).toHaveLength(0);
  });
  it("clears the receive code when the wallet asset source changes in either direction", async () => {
    mocks.credentials = credentials;
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) =>
      method === "receiveCode"
        ? { code: `${params.slot}-receive-code`, fingerprint: `${params.slot}-fingerprint` }
        : method === "recover" ? receivedIndependentWallet : defaultCall?.(method, params),
    );
    await renderUnlockedPanel();
    refreshAssets();
    await waitUntilIdle();
    chooseAction("receiveCode");
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("identity-receive-code"));
    await waitForReceiveCode("identity");
    openReceiveCode("independent");
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("independent-receive-code"));
    expect(mocks.call).toHaveBeenLastCalledWith("receiveCode", expect.objectContaining({ slot: "independent", disclosure: "anonymous", expiresAt: expect.stringMatching(/^\d+$/) }), expect.anything());
    openReceiveCode("identity");
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("submits batch revocation in the signing wallet request scope and regenerates current material", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    let codeNumber = 0;
    const args = ["1", "2", "0", "1", "0xproof"];
    mocks.call.mockImplementation(async (method, params) => method === "receiveCode" ? { code: `code-${++codeNumber}` }
      : method === "authorizeIdentityCounter" ? { address, args } : defaultCall?.(method, params));
    mocks.incrementCounter.mockImplementation(async () => {
      expect(mocks.walletRequestPending).toBe(true);
      return { hash: "0xrevocation", wait: async () => ({ status: 1 }) };
    });
    await renderUnlockedPanel();
    openReceiveCode("identity");
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("code-1"));
    await waitUntilIdle();
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.revokeAll" }));
    await waitFor(() => expect(mocks.incrementCounter).toHaveBeenCalledWith(...args, { chainId: 31337n }));
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("code-2"));
    expect(mocks.walletRequestPending).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects batch revocation when the transaction wallet changed networks", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "receiveCode" ? { code: "old-code" }
      : method === "authorizeIdentityCounter" ? { address, args: [] } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    openReceiveCode("identity");
    await waitUntilIdle();
    vi.mocked(signer.provider!.getNetwork).mockResolvedValueOnce({ chainId: 1n } as never);
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.revokeAll" }));
    await screen.findByText("shielded.walletChanged");
    expect(mocks.incrementCounter).not.toHaveBeenCalled();
  });
  it("generates and closes a receive code without losing a transfer draft or selected balance", async () => {
    mocks.verify.mockRejectedValue(new Error("unfinished recipient code"));
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [{ commitment: "100", ownerCommitment: "1", slot: "identity", kind: "value", amount: "2500000000000000000" }],
    } : method === "receiveCode" ? { code: "my-identity-receive-code" } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("privateTransfer");
    const amount = screen.getByLabelText("shielded.fields.transferAmount") as HTMLInputElement;
    const recipient = screen.getByLabelText("shielded.receiveCodeInputLabel") as HTMLTextAreaElement;
    fireEvent.change(amount, { target: { value: "1.25" } });
    fireEvent.change(recipient, { target: { value: "unfinished-recipient-code" } });
    await waitFor(() => expect(document.querySelector('input[value="100"]')).toBeTruthy());
    selectValue("100");
    const selected = document.querySelector<HTMLInputElement>('input[value="100"]')!;
    const submit = screen.getByRole("button", { name: submitLabel });
    openReceiveCode("identity");
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("my-identity-receive-code"));
    await waitForReceiveCode("identity");
    expect(screen.getByLabelText("shielded.fields.transferAmount")).toBe(amount);
    expect(screen.getByLabelText("shielded.receiveCodeInputLabel")).toBe(recipient);
    expect(screen.getByRole("button", { name: submitLabel })).toBe(submit);
    expect(document.querySelector('input[value="100"]')).toBe(selected);
    expect(selected.checked).toBe(true);
    closeWalletSheet();
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    expect(amount.value).toBe("1.25");
    expect(recipient.value).toBe("unfinished-recipient-code");
    expect(selected.checked).toBe(true);
    expect(navButton("privateTransfer").getAttribute("aria-current")).toBe("true");
    expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
  });
  it("generates a receive code on opening once and leaves a retry after a failure", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    let attempts = 0;
    let failFirst: (cause: Error) => void = () => {};
    mocks.call.mockImplementation(async (method, params) => {
      if (method !== "receiveCode") return defaultCall?.(method, params);
      if (++attempts === 1) return new Promise((_, reject) => { failFirst = reject; });
      return { code: "retried-receive-code" };
    });
    await renderUnlockedPanel();
    openReceiveCode("identity");
    const receiving = screen.getByRole("group", { name: label("receiveKeyLabel") });
    expect(within(receiving).getByText("shielded.stages.receiveCode")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
    await act(async () => failFirst(new Error("receive code failed")));
    await waitFor(() => expect(within(receiving).getByText("receive code failed")).toBeTruthy());
    const retry = screen.getByRole("button", { name: "shielded.generateReceiveCode" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(attempts).toBe(1);
    fireEvent.click(retry);
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("retried-receive-code"));
    expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
    expect(attempts).toBe(2);
  });
  it("regenerates a receive code when switching back from a locked independent key", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: false };
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) =>
      method === "receiveCode" ? { code: `${params.slot}-receive-code` } : defaultCall?.(method, params));
    const receiveCodeCalls = () => mocks.call.mock.calls.filter(([method]) => method === "receiveCode");
    await renderUnlockedPanel();
    openReceiveCode("identity");
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("identity-receive-code"));
    await waitForReceiveCode("identity");
    const selection = walletSelection();
    fireEvent.click(within(selection).getByRole("radio", { name: label("independentKey") }));
    expect(within(screen.getByRole("group", { name: label("receiveKeyLabel") })).getByText(label("walletLocked"))).toBeTruthy();
    expect(screen.queryByLabelText("shielded.receiveCodeLabel")).toBeNull();
    fireEvent.click(within(selection).getByRole("radio", { name: label("identityCredentials") }));
    await waitFor(() => expect((screen.getByLabelText("shielded.receiveCodeLabel") as HTMLTextAreaElement).value).toBe("identity-receive-code"));
    expect(receiveCodeCalls()).toHaveLength(2);
    expect(receiveCodeCalls().every(([, params]) => params.slot === "identity")).toBe(true);
  });
  it("selects the matching claim and periods when changing budget key modes", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    const recoveredWallet = {
      ...emptyWallet,
      notes: [
        { commitment: "101", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "500000000000000000", periodDays: "30", eligibleFrom: "0" },
        { commitment: "102", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "2000000000000000000", amountPerPeriod: "2000000000000000000", periodDays: "30", eligibleFrom: "0" },
      ],
      claims: [
        { handle: "claim:identity", budgets: ["101"], slot: "identity", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "500000000000000000", periodIndices: ["0", "1"] },
        { handle: "claim:independent", budgets: ["102"], slot: "independent", status: "claimable", amount: "2000000000000000000", amountPerPeriod: "2000000000000000000", periodIndices: ["2"] },
      ],
    };
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? recoveredWallet : method === "discover" ? emptyDiscovery : method === "prove" ? stopAfterPreview() : {
      handle: "claim-preview", action: "claim", slot: params.slot,
      amount: "1000000000000000000", inputs: [], inputAmounts: [], steps: [], outputAmounts: [],
    });
    await renderUnlockedPanel();
    chooseAction("claim");
    refreshAssets();
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:2" }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole("group", { name: "shielded.fields.budgetNote" })).getAllByRole("radio")).toHaveLength(1);
    chooseBudgetKey("independent");
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:3" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "claim", slot: "independent", claimHandle: "claim:independent", periodIndices: ["2"],
    }), expect.anything()));
    chooseBudgetKey("identity");
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:3" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "claim", slot: "identity", claimHandle: "claim:identity", periodIndices: ["0", "1"],
    }), expect.anything()));
    chooseBudgetKey("independent");
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:3" }) as HTMLInputElement).checked).toBe(true);
    expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(2);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(([
    "shield", "privateTransfer", "unshield", "fund", "claim",
  ] as const).flatMap((action) => (["identity", "independent"] as const).map((slot) => [action, slot] as const)))(
    "prepares %s with the globally selected %s wallet in its worker request", async (action, selectedSlot) => {
      mocks.independentKey = { ...independentKey, recoveryVerified: true };
      mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 1, fingerprint: "recipient-key" });
      mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
        ...emptyWallet,
        children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
        notes: [
          { commitment: "101", ownerCommitment: "1", slot: "identity", kind: "value", amount: "10000000000000000000" },
          { commitment: "102", ownerCommitment: "2", slot: "independent", kind: "value", amount: "20000000000000000000" },
          { commitment: "201", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" },
          { commitment: "202", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000" },
        ],
        claims: [
          { handle: "claim:identity", budgets: ["201"], slot: "identity", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["0"] },
          { handle: "claim:independent", budgets: ["202"], slot: "independent", status: "claimable", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["1"] },
        ],
      } : method === "discover" ? emptyDiscovery : method === "prove" ? stopAfterPreview() : {
        handle: "preview:active-wallet", action: params.action, slot: params.slot,
        amount: params.amount ?? "1000000000000000000", steps: [], inputs: params.candidates ?? [],
        inputAmounts: [], outputAmounts: [],
      });
      await renderUnlockedPanel();
      chooseActiveWallet(selectedSlot);
      chooseAction(action);
      expectCurrentWallet(selectedSlot);
      expect(screen.queryByRole("group", { name: label("depositDestination") })).toBeNull();
      expect(screen.queryByRole("group", { name: label("assetSource") })).toBeNull();
      expect(screen.queryByRole("button", { name: label("changeWallet") })).toBeNull();
      // The wallet is chosen once, on its card; no task form repeats the choice.
      expect(within(taskPanel()).queryByRole("radio", { name: label("identityCredentials") })).toBeNull();
      expect(within(taskPanel()).queryByRole("radio", { name: label("independentKey") })).toBeNull();
      if (action === "claim") {
        await waitFor(() => expect(screen.getByRole("checkbox", {
          name: `shielded.claimPeriodOption:${selectedSlot === "independent" ? "2" : "1"}`,
        })).toBeTruthy());
      } else if (action === "fund") {
        chooseFundingEntry("privateIndependent");
        chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
        chooseHeir(identity.personHash);
        fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
        fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "recipient-code" } });
      } else {
        fireEvent.change(screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount"), { target: { value: "1" } });
        if (action === "privateTransfer") {
          fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "recipient-code" } });
          fireEvent.click(await screen.findByRole("checkbox", { name: "shielded.recipientConfirm" }));
        }
        if (action !== "shield") selectValue(selectedSlot === "independent" ? "102" : "101");
      }
      await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
        action, slot: selectedSlot,
        ...(action === "claim" ? { claimHandle: `claim:${selectedSlot}` } : {}),
      }), expect.anything()));
      expect(mocks.call.mock.calls.filter(([method]) => method === "preview").every(([, request]) => request.slot === selectedSlot)).toBe(true);
    },
  );
  it("uses the saved active wallet for claiming", async () => {
    mocks.identity = identity;
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockImplementation(async () => ({
      ...emptyWallet,
      claims: [
        { handle: "claim:identity", budgets: ["201"], slot: "identity", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["0"] },
        { handle: "claim:independent", budgets: ["202"], slot: "independent", status: "claimable", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["1"] },
      ],
    }));
    await renderPanel(signer, modules, {
      slot: "independent", keyFingerprint: independentKey.keyFingerprint,
      action: "claim", taskChosen: true,
    });
    expectCurrentWallet("independent");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:2" })).toBeTruthy());
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeNull();
    expect(within(taskPanel()).queryByRole("radio", { name: label("independentKey") })).toBeNull();
  });
  it("shows unavailable balances for the selected unopened wallet without falling back to identity funds", async () => {
    mocks.call.mockImplementation(async (method: string) => method === "discover" ? emptyDiscovery : {
      ...emptyWallet,
      notes: [
        { commitment: "10", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" },
        { commitment: "11", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "3000000000000000000" },
      ],
    });
    const balance = (kind: "balanceAmount" | "budgetAmount", slot: "identity" | "independent" = "identity") =>
      within(walletCard(slot)).getByText(`shielded.${kind}`).closest("div")?.querySelector("dd")?.textContent;
    await renderUnlockedPanel();
    refreshAssets();
    await waitFor(() => expect(balance("balanceAmount")).toBe("1CFX"));
    expect(balance("budgetAmount")).toBe("3CFX");
    chooseIndependentBudget();
    expect(balance("balanceAmount", "independent")).toBe("—");
    expect(balance("budgetAmount", "independent")).toBe("—");
    expectCurrentWallet("independent");
    expect(screen.getByText(label("claimIndependentKeyRequired"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(screen.queryByText(label("claimViewHint"))).toBeNull();

    chooseBudgetKey("identity");
    expect(screen.queryByText(label("claimIndependentKeyRequired"))).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    expect(balance("balanceAmount")).toBe("1CFX");
    expect(balance("budgetAmount")).toBe("3CFX");
    expect(mocks.identity).toEqual(identity);
    expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(2);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("defaults to a claimable budget when an earlier budget is not due", async () => {
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      notes: [
        { commitment: "101", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" },
        { commitment: "102", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" },
      ],
      claims: [
        { handle: "claim:later", budgets: ["101"], slot: "identity", status: "notDue", amount: "0", amountPerPeriod: "1000000000000000000", periodIndices: [] },
        { handle: "claim:ready", budgets: ["102"], slot: "identity", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["0"] },
      ],
    } : method === "prove" ? stopAfterPreview() : {
      handle: "claim-preview", action: "claim", slot: params.slot,
      amount: "1000000000000000000", steps: [], inputs: [], inputAmounts: [], outputAmounts: [],
    });
    await renderUnlockedPanel();
    expect(navButton("claim").getAttribute("aria-current")).toBe("true");
    expect(budgetChoice("claim:ready").checked).toBe(true);
    expect(budgetChoice("claim:later").checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "claim", claimHandle: "claim:ready", periodIndices: ["0"],
    }), expect.anything()));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("locking the independent key returns to identity entry and restores the same receiving task", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      ...(mocks.independentKey?.recoveryVerified ? {
        notes: [
          { commitment: "101", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" },
          { commitment: "102", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "3000000000000000000", amountPerPeriod: "1000000000000000000" },
        ],
        claims: [
          { handle: "claim:later", budgets: ["101"], slot: "independent", status: "notDue", amount: "0", amountPerPeriod: "1000000000000000000", periodIndices: [] },
          { handle: "claim:ready", budgets: ["102"], slot: "independent", status: "claimable", amount: "2000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: ["0", "1"] },
        ],
      } : {}),
    } : defaultCall?.(method, params));
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderUnlockedPanel();
    chooseIndependentBudget();
    lockWorkspace();
    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey).toBeNull();
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "child-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(navButton("claim").getAttribute("aria-current")).toBe("true"));
    expectCurrentWallet("independent");
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(screen.getByText(label("claimIndependentKeyRequired"))).toBeTruthy();
    openIndependentKeyManagement();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), {
      target: { value: "previously-saved-backup" },
    });
    importRecovery();
    await waitFor(() => expect(mocks.independentKey?.recoveryVerified).toBe(true));
    expect(mocks.identity).toEqual(identity);
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    expect(navButton("claim").getAttribute("aria-current")).toBe("true");
    expectCurrentWallet("independent");
    expect(screen.queryByText(label("claimIndependentKeyRequired"))).toBeNull();
    expect(budgetChoice("claim:ready").checked).toBe(true);
    const firstPeriod = screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" });
    const secondPeriod = screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:2" });
    expect((firstPeriod as HTMLInputElement).checked).toBe(true);
    expect((secondPeriod as HTMLInputElement).checked).toBe(true);
    fireEvent.click(firstPeriod);
    fireEvent.click(secondPeriod);
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(firstPeriod);
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(budgetChoice("claim:later"));
    expect(screen.getByText("shielded.claimOverview.notDue")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("allows verified VALUE with unlocked credentials when identity proofs are unavailable", async () => {
    mocks.credentials = credentials;
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderPanel();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy();
    openIndependentReceiving();
    expect(screen.getAllByText(label("independentKeyRestoredIdentityHint")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: label("showIndependentKeyBackup") })).toBeNull();
    expect((screen.getByRole("button", { name: label("independentKeyReceiveCode") }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
    chooseAction("claim");
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.identity).toBeNull();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("opens receipt alongside the selected claim task without clearing its credentials", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderUnlockedPanel();
    chooseIndependentBudget();
    await openWalletManagement();
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    openReceiveCode("independent");
    expect(screen.getByRole("button", { name: label("independentKeyReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    expectCurrentWallet("independent");
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each(["restore", "create"] as const)(
    "keeps the deposit form mounted while the %s key form is toggled", async (flow) => {
      await renderUnlockedPanel();
      const amount = screen.getByLabelText("shielded.fields.amount") as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "3.75" } });
      const task = taskPanel();
      const submit = screen.getByRole("button", { name: submitLabel });
      openIndependentKeyManagement(flow);
      expect(screen.getByRole("radio", { name: label(flow === "restore" ? "mnemonicRestore" : "randomSource") })).toBeTruthy();
      expect(taskPanel()).toBe(task);
      expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
      expect(screen.getByRole("button", { name: submitLabel })).toBe(submit);
      expect(amount.value).toBe("3.75");
      expect(screen.queryByRole("button", { name: label("returnToAction") })).toBeNull();
      closeWalletSheet();
      expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
      expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
      expect(walletSelection()).toBeTruthy();
      expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
      expect(amount.value).toBe("3.75");
      expect(mocks.call.mock.calls.filter(([method]) => method !== "recover")).toHaveLength(0);
      expect(mocks.lock).not.toHaveBeenCalled();
    },
  );
  it("clears recovery secrets when the key sheet closes and reopens it empty", async () => {
    await renderUnlockedPanel();
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const overview = screen.getByRole("region", { name: "shielded.balanceTitle" });
    const navigation = taskNavigation();
    const task = taskPanel();
    openIndependentWallet();
    const input = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "private-recovery-words" } });

    closeWalletSheet();

    expect(input.value).toBe("");
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBe(overview);
    expect(taskNavigation()).toBe(navigation);
    expect(taskPanel()).toBe(task);
    fireEvent.click(navButton("privateTransfer"));
    expect(screen.getByLabelText("shielded.fields.transferAmount")).toBeTruthy();
    openIndependentWallet();
    expect((screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement).value).toBe("");
    closeWalletSheet();
    fireEvent.click(navButton("fund"));
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(screen.getByLabelText("shielded.fields.rate")).toBeTruthy();
    chooseAction("unshield");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect(mocks.call.mock.calls.some(([method]) => method === "importRecoveryMaterial")).toBe(false);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("returns from receive-code recovery while preserving an earlier withdrawal amount", async () => {
    await renderUnlockedPanel();
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const task = taskPanel();
    openIndependentWallet();
    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-words" } });
    importRecovery();

    await waitFor(() => expect(within(walletSelection()).getByRole("radio", { name: label("independentKey") })).toBeTruthy());
    chooseAction("unshield");
    expect(taskPanel()).toBe(task);
    expect(navButton("unshield").getAttribute("aria-current")).toBe("true");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect(screen.queryByText(label("independentKeyRecoveredTitle"))).toBeNull();
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.identity).toEqual(identity);
  });
  it.each(["random", "signature"] as const)("opens recovery choices after an unfinished %s key without binding an older backup to its fingerprint", async (source) => {
    const defaultCall = mocks.call.getMockImplementation();
    const draftFingerprint = "0x" + "09".repeat(32);
    mocks.call.mockImplementation(async (method, params) => method === "createIndependentKey"
      ? { credentials, identity, independentKey: { ...independentKey, keyFingerprint: draftFingerprint, backupRequired: true } }
      : method === "exportRecoveryMaterial"
        ? { material: "new-key-secret-words", format: "mnemonic", version: 1, keyFingerprint: draftFingerprint }
        : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const task = taskPanel();
    expectIndependentKeySetup();
    openIndependentKeyManagement("create");
    fireEvent.click(screen.getByRole("radio", { name: label(`${source}Source`) }));
    await waitFor(() => expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy());
    expectIndependentKeySetup();
    fireEvent.click(screen.getByRole("button", { name: label("exportRecovery") }));
    await waitFor(() => expect(exportedMaterial().textContent).toContain("new-key-secret-words"));
    const exported = exportedMaterial();
    closeWalletSheet();
    expect(exported.textContent).not.toContain("new-key-secret-words");
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(mocks.independentKey).toMatchObject({ recoveryVerified: false, backupRequired: true });
    expectIndependentKeySetup();
    await waitUntilIdle();
    const signatureRequests = vi.mocked(signer.signMessage).mock.calls.length;

    openIndependentKeyManagement("restore");

    await waitFor(() => expect(screen.getByRole("radio", { name: label("mnemonicRestore") })).toBeTruthy());
    expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
    expect((screen.getByRole("radio", { name: label("mnemonicRestore") }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: label("shieldedKeyRestore") })).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("signatureRestore") })).toBeTruthy();
    expect(screen.queryByText(label("backupSaveStep"))).toBeNull();
    expect(screen.queryByText(label("reenterBackup"))).toBeNull();
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(mocks.call).toHaveBeenCalledWith("clearPendingIndependentKey", {
      expectedCredentialsHandle: credentials.handle, expectedFingerprint: draftFingerprint,
    });
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call.mock.calls.filter(([method]) => method === "createIndependentKey")).toHaveLength(1);
    expect(signer.signMessage).toHaveBeenCalledTimes(signatureRequests);
    expect(mocks.call.mock.calls.some(([method]) => method === "importRecoveryMaterial" || method === "receiveCode" || method === "restoreSignature")).toBe(false);
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.identity).toEqual(identity);
    expect(taskPanel()).toBe(task);
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expectCurrentWallet("identity");
    expectIndependentKeySetup();

    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "previously-saved-backup" } });
    importRecovery();

    await waitFor(() => expect(mocks.independentKey?.recoveryVerified).toBe(true));
    expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({
      material: "previously-saved-backup", expectedFingerprint: undefined,
    }));
    expect(mocks.independentKey?.keyFingerprint).toBe(independentKey.keyFingerprint);
    expect(mocks.identity).toEqual(identity);
    expect(taskPanel()).toBe(task);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each(["random", "signature"] as const)("starts again at source selection when creating after an unfinished %s key", async (source) => {
    const defaultCall = mocks.call.getMockImplementation();
    const replacementFingerprint = "0x" + "09".repeat(32);
    let creations = 0;
    mocks.call.mockImplementation(async (method, params) => method === "createIndependentKey"
      ? {
          credentials, identity,
          independentKey: {
            ...independentKey,
            keyFingerprint: creations++ === 0 ? independentKey.keyFingerprint : replacementFingerprint,
            backupRequired: true,
          },
        }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const task = taskPanel();
    openIndependentKeyManagement("create");
    fireEvent.click(screen.getByRole("radio", { name: label(`${source}Source`) }));
    await waitFor(() => expect(mocks.independentKey?.backupRequired).toBe(true));
    await waitUntilIdle();
    closeWalletSheet();
    chooseActiveWallet("independent");
    chooseActiveWallet("identity");
    const latestNavigation = () => mocks.navigation.mock.calls[mocks.navigation.mock.calls.length - 1]?.[0];
    const pinnedNavigation = latestNavigation();
    const signatureRequests = vi.mocked(signer.signMessage).mock.calls.length;
    await waitFor(() => expect((independentKeyButton("create") as HTMLButtonElement).disabled).toBe(false));

    openIndependentKeyManagement("create");

    await waitFor(() => expect(screen.getByRole("radio", { name: label("randomSource") })).toBeTruthy());
    expect((screen.getByRole("radio", { name: label("randomSource") }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: label("signatureSource") }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(label("backupSaveStep"))).toBeNull();
    expect(screen.queryByText(label("backupVerifyStep"))).toBeNull();
    expect(mocks.call).toHaveBeenCalledWith("clearPendingIndependentKey", {
      expectedCredentialsHandle: credentials.handle,
      expectedFingerprint: independentKey.keyFingerprint,
    });
    expect(mocks.independentKey).toBeNull();
    expect(creations).toBe(1);
    expect(signer.signMessage).toHaveBeenCalledTimes(signatureRequests);
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.identity).toEqual(identity);
    expect(latestNavigation()).toEqual(pinnedNavigation);
    expectCurrentWallet("identity");
    expect(taskPanel()).toBe(task);
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expectIndependentKeySetup();

    fireEvent.click(screen.getByRole("radio", { name: label(source === "random" ? "signatureSource" : "randomSource") }));

    await waitFor(() => expect(creations).toBe(2));
    await waitFor(() => expect(mocks.independentKey?.keyFingerprint).toBe(replacementFingerprint));
    expect(screen.getByText(label("backupSaveStep"))).toBeTruthy();
    expect(latestNavigation()).toEqual(pinnedNavigation);
    expectIndependentKeySetup();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each(["create", "restore"] as const)("honors the %s card entry after closing an unverified recovery candidate", async (flow) => {
    const defaultCall = mocks.call.getMockImplementation();
    const candidate = { ...independentKey, rootSource: "walletSignature", recoveryVerified: false, backupRequired: false };
    mocks.call.mockImplementation(async (method, params) => method === "restoreSignature"
      ? { credentials, identity, independentKey: candidate }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "3.75" } });
    const amount = screen.getByLabelText("shielded.fields.amount") as HTMLInputElement;
    const task = taskPanel();
    openIndependentKeyManagement("restore");
    chooseRecoveryPath("signature");
    fireEvent.click(screen.getByRole("button", { name: label("restoreSignature") }));
    await waitFor(() => expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy());
    await waitUntilIdle();
    closeWalletSheet();
    await waitUntilIdle();
    const calls = mocks.call.mock.calls.length;
    const signatures = vi.mocked(signer.signMessage).mock.calls.length;

    openIndependentKeyManagement(flow);

    expect(screen.queryByText(label("recoveryCandidate"))).toBeNull();
    expect(screen.queryByText(label("backupSaveStep"))).toBeNull();
    if (flow === "create") {
      for (const source of ["randomSource", "signatureSource"]) {
        expect((screen.getByRole("radio", { name: label(source) }) as HTMLInputElement).checked).toBe(false);
      }
      expect(screen.queryByRole("group", { name: label("restorePath") })).toBeNull();
    } else {
      expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
      expect(screen.getByRole("radio", { name: label("mnemonicRestore") })).toBeTruthy();
      expect(screen.getByRole("radio", { name: label("shieldedKeyRestore") })).toBeTruthy();
      expect(screen.getByRole("radio", { name: label("signatureRestore") })).toBeTruthy();
    }
    expect(mocks.independentKey).toEqual(candidate);
    expect(mocks.call).toHaveBeenCalledTimes(calls);
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    expect(signer.signMessage).toHaveBeenCalledTimes(signatures);
    expect(taskPanel()).toBe(task);
    expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
    expect(amount.value).toBe("3.75");
    expect(mocks.identity).toEqual(identity);
    expectIndependentKeySetup();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each(["create", "restore"] as const)("retries the %s entry after its pending-key cleanup fails", async (flow) => {
    const defaultCall = mocks.call.getMockImplementation();
    let fail = true;
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "clearPendingIndependentKey" && fail) {
        fail = false;
        throw new Error("Could not clear the unfinished key");
      }
      return defaultCall?.(method, params);
    });
    await renderUnlockedPanel();
    await createIndependentKeyForBackup();
    closeWalletSheet();
    await waitUntilIdle();

    openIndependentKeyManagement(flow);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not clear the unfinished key"));
    await waitUntilIdle();
    expect(mocks.independentKey?.backupRequired).toBe(true);
    expect(mocks.independentKey?.recoveryVerified).toBe(false);
    expectIndependentKeySetup();
    expect(screen.queryByRole("dialog")).toBeNull();

    openIndependentKeyManagement(flow);

    await waitFor(() => expect(screen.getByRole("radio", { name: label(flow === "create" ? "randomSource" : "mnemonicRestore") })).toBeTruthy());
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call.mock.calls.filter(([method]) => method === "clearPendingIndependentKey")).toHaveLength(2);
    expect(mocks.call.mock.calls.filter(([method]) => method === "createIndependentKey")).toHaveLength(1);
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(
    (["random", "signature"] as const).flatMap((source) =>
      (["mnemonic", "shieldedKey"] as const).flatMap((format) =>
        (["create", "mnemonic", "shieldedKey", "signature"] as const).map((destination) => ({ source, format, destination })),
      ),
    ),
  )("opens $destination after a failed $format verification of a $source key", async ({ source, format, destination }) => {
    const defaultCall = mocks.call.getMockImplementation();
    const previousFingerprint = "0x" + "08".repeat(32);
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "exportRecoveryMaterial") return {
        material: "saved-new-key-backup", format: params.format, version: 1, keyFingerprint: independentKey.keyFingerprint,
      };
      if (method === "importRecoveryMaterial") {
        if (params.material === "incorrect-backup") throw new Error("Backup does not match");
        return { credentials, identity, independentKey: {
          ...independentKey, keyFingerprint: previousFingerprint, rootSource: "imported", recoveryVerified: true, backupRequired: false,
        } };
      }
      if (method === "restoreSignature") return { credentials, identity, independentKey: {
        ...independentKey, keyFingerprint: previousFingerprint, rootSource: "walletSignature", recoveryVerified: true, backupRequired: false,
      } };
      return defaultCall?.(method, params);
    });
    await renderUnlockedPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "3.75" } });
    const amount = screen.getByLabelText("shielded.fields.amount") as HTMLInputElement;
    const task = taskPanel();
    await createIndependentKeyForBackup(source);
    if (format === "shieldedKey") fireEvent.click(screen.getByRole("radio", { name: label("shieldedKeyFormat") }));
    fireEvent.click(screen.getByRole("button", { name: label("exportRecovery") }));
    await waitFor(() => expect(exportedMaterial().textContent).toContain("saved-new-key-backup"));
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    fireEvent.click(screen.getByRole("button", { name: label("beginIndependentImport") }));
    await waitFor(() => expect(mocks.independentKey).toBeNull());
    const verificationInput = screen.getByLabelText(label(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")) as HTMLTextAreaElement;
    fireEvent.change(verificationInput, { target: { value: "incorrect-backup" } });
    importRecovery();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Backup does not match"));
    await waitUntilIdle();
    expect(verificationInput.value).toBe("");
    expect(mocks.independentKey).toBeNull();
    expectIndependentKeySetup();
    closeWalletSheet();
    await waitUntilIdle();

    openIndependentKeyManagement(destination === "create" ? "create" : "restore");

    await waitFor(() => expect(screen.getByRole("radio", { name: label(destination === "create" ? "randomSource" : "mnemonicRestore") })).toBeTruthy());
    expect(screen.queryByText(label("reenterBackup"))).toBeNull();
    expect(screen.queryByText(label("backupSaveStep"))).toBeNull();
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.call.mock.calls.filter(([method]) => method === "createIndependentKey")).toHaveLength(1);
    expect(mocks.call.mock.calls.filter(([method]) => method === "importRecoveryMaterial")).toHaveLength(1);
    expect(mocks.call.mock.calls.some(([method]) => method === "clearPendingIndependentKey")).toBe(false);
    expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
    expect(amount.value).toBe("3.75");
    expect(taskPanel()).toBe(task);
    expectCurrentWallet("identity");
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.identity).toEqual(identity);

    if (destination === "create") {
      for (const generationSource of ["randomSource", "signatureSource"]) {
        expect((screen.getByRole("radio", { name: label(generationSource) }) as HTMLInputElement).checked).toBe(false);
      }
      fireEvent.click(screen.getByRole("radio", { name: label(source === "random" ? "signatureSource" : "randomSource") }));
      await waitFor(() => expect(mocks.independentKey?.backupRequired).toBe(true));
      expect(mocks.call.mock.calls.filter(([method]) => method === "createIndependentKey")).toHaveLength(2);
      expect(screen.getByText(label("backupSaveStep"))).toBeTruthy();
      expect((screen.getByRole("checkbox", { name: label("savedExternal") }) as HTMLInputElement).checked).toBe(false);
      expectIndependentKeySetup();
    } else {
      expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
      chooseRecoveryPath(destination);
      if (destination === "signature") {
        fireEvent.click(screen.getByRole("button", { name: label("restoreSignature") }));
        await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("restoreSignature", expect.objectContaining({ expectedFingerprint: undefined })));
      } else {
        const input = screen.getByLabelText(label(destination === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")) as HTMLTextAreaElement;
        expect(input.value).toBe("");
        fireEvent.change(input, { target: { value: "previously-saved-key" } });
        importRecovery();
        await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({
          material: "previously-saved-key", format: destination, expectedFingerprint: undefined,
        })));
      }
      await waitFor(() => expect(mocks.independentKey?.keyFingerprint).toBe(previousFingerprint));
      expect(mocks.independentKey?.recoveryVerified).toBe(true);
      expect(mocks.independentKey?.backupRequired).toBe(false);
    }
    expect(screen.getByLabelText("shielded.fields.amount")).toBe(amount);
    expect(amount.value).toBe("3.75");
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("keeps a verified key out of the new-key entry and leaves its root loaded when opening settings", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true, backupRequired: false };
    await renderUnlockedPanel();
    expect(within(walletCard("independent")).queryByRole("button", { name: label("createTitle") })).toBeNull();

    openIndependentKeyManagement();

    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    expect(mocks.independentKey).toEqual({ ...independentKey, recoveryVerified: true, backupRequired: false });
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover")).toHaveLength(0);
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each([
    ["credentials", "create"], ["fingerprint", "create"], ["verification", "create"],
    ["credentials", "restore"], ["fingerprint", "restore"], ["verification", "restore"],
  ] as const)("ignores an old %s context's %s reset after its session changes", async (change, flow) => {
    mocks.credentials = credentials;
    mocks.independentKey = { ...independentKey, backupRequired: true };
    const defaultCall = mocks.call.getMockImplementation();
    let finish!: (state: any) => void;
    mocks.call.mockImplementation((method, params) => method === "clearPendingIndependentKey"
      ? new Promise((resolve) => { finish = resolve; })
      : defaultCall?.(method, params));
    await renderUnlockedPanel();

    openIndependentKeyManagement(flow);

    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("clearPendingIndependentKey", {
      expectedCredentialsHandle: credentials.handle,
      expectedFingerprint: independentKey.keyFingerprint,
    }));
    const replacement = {
      credentials: change === "credentials" ? { handle: "credentials:replacement" } : credentials,
      identity: change === "credentials" ? { ...identity, handle: "identity:replacement" } : identity,
      independentKey: change === "verification"
        ? { ...independentKey, recoveryVerified: true, backupRequired: false }
        : { ...independentKey, keyFingerprint: "0x" + "08".repeat(32), backupRequired: true },
    };
    act(() => publishSession(replacement));

    await act(async () => finish({ credentials, identity, independentKey: null }));

    expect(mocks.credentials).toEqual(replacement.credentials);
    expect(mocks.identity).toEqual(replacement.identity);
    expect(mocks.independentKey).toEqual(replacement.independentKey);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("keeps an unverified candidate's manager open after an overview refresh", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "restoreSignature"
      ? { credentials, identity, independentKey: { ...independentKey, rootSource: "walletSignature", recoveryVerified: false } }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    await openWalletManagement();
    chooseRecoveryPath("signature");
    fireEvent.click(screen.getByRole("button", { name: label("restoreSignature") }));
    await waitFor(() => expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy());
    await waitUntilIdle();
    const task = taskPanel();

    refreshAssets();

    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("discover", expect.anything(), expect.anything()));
    await waitUntilIdle();
    expect(taskPanel()).toBe(task);
    expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy();
    expect(mocks.independentKey?.recoveryVerified).toBe(false);
    expect(mocks.call.mock.calls.filter(([method]) => method === "discover")).toHaveLength(1);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("offers each generation method unselected and generates nothing on render", async () => {
    await renderUnlockedPanel();
    openCreateWallet();
    expect((screen.getByRole("radio", { name: label("randomSource") }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: label("signatureSource") }) as HTMLInputElement).checked).toBe(false);
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
  });
  it("offers three budget funding entries and defaults to independent funding", async () => {
    mocks.identity = identity;
    await renderPanel();
    chooseAction("fund");
    expect((screen.getByRole("radio", { name: label("independentEntry") }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: label("convenientEntry") })).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("publicEntry") })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("selects recovered parent versions and filters children while clearing version-dependent inputs", async () => {
    const earlierChild = "0x" + "04".repeat(32);
    const ineligibleChild = "0x" + "05".repeat(32);
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable: true,
      parentVersions: [2, 1],
      children: [
        { personHash: identity.personHash, rootVersionIndex: 2, eligible: true },
        { personHash: earlierChild, rootVersionIndex: 1, eligible: true },
        { personHash: ineligibleChild, rootVersionIndex: 2, eligible: false },
      ],
    } : defaultCall?.(method, params));
    mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 1, fingerprint: "child-fingerprint" });
    await renderUnlockedPanel();
    chooseAction("fund");
    const version = selectTrigger("shielded.fields.familyVersion");
    const amount = screen.getByLabelText("shielded.fields.rate") as HTMLInputElement;
    const code = screen.getByLabelText("shielded.receiveCodeInputLabel") as HTMLTextAreaElement;
    expect(version.disabled).toBe(false);
    expect(selectOptions("shielded.fields.familyVersion")).toEqual([
      "shielded.fundingVersionOption:2",
      "shielded.fundingVersionOption:1",
    ]);
    expect(screen.queryByText("shielded.familyRecordsUnavailable")).toBeNull();
    expect(screen.queryByText("search.storyRecordsQuery.noMatches")).toBeNull();
    // Children appear only once a parent version is chosen.
    expect(heirOptions()).toEqual([]);
    expect(screen.getByText("shielded.fundingVersionRequired")).toBeTruthy();
    fireEvent.change(amount, { target: { value: "2.5" } });
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:2");
    expect(version.textContent).toBe("shielded.fundingVersionOption:2");
    expect(heirOptions()).toEqual([identity.personHash]);
    chooseHeir(identity.personHash);
    fireEvent.change(code, { target: { value: "version-two-receive-code" } });
    expect(heirChoice(identity.personHash).checked).toBe(true);
    expect(code.value).toBe("version-two-receive-code");

    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:1");
    expect(version.textContent).toBe("shielded.fundingVersionOption:1");
    expect(heirOptions()).toEqual([earlierChild]);
    expect(checkedHeir()).toBeNull();
    expect(code.value).toBe("");
    expect(amount.value).toBe("2.5");
    chooseHeir(earlierChild);
    fireEvent.change(code, { target: { value: "version-one-receive-code" } });
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:2");
    expect(checkedHeir()).toBeNull();
    expect(code.value).toBe("");
    expect(amount.value).toBe("2.5");
  });
  it("explains unavailable family records and enables recovered parent versions after refreshing", async () => {
    let familyRecordsAvailable = false;
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable,
      parentVersions: familyRecordsAvailable ? [2, 1] : [],
    } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("fund");
    const version = selectTrigger("shielded.fields.familyVersion");
    expect(version.disabled).toBe(true);
    expect(version.textContent).toBe("shielded.fundingVersionPlaceholder");
    expect(screen.getByText("shielded.familyRecordsUnavailable")).toBeTruthy();
    expect(screen.queryByText("search.storyRecordsQuery.noMatches")).toBeNull();
    expect(screen.queryByText("shielded.fundingVersionRequired")).toBeNull();
    expect(screen.queryByText("shielded.recipientPicker.emptyChildren")).toBeNull();

    familyRecordsAvailable = true;
    refreshAssets();
    await waitUntilIdle();
    expect(selectTrigger("shielded.fields.familyVersion")).toBe(version);
    expect(version.disabled).toBe(false);
    expect(screen.queryByText("shielded.familyRecordsUnavailable")).toBeNull();
    expect(selectOptions("shielded.fields.familyVersion")).toEqual([
      "shielded.fundingVersionOption:2",
      "shielded.fundingVersionOption:1",
    ]);
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:2");
    expect(version.textContent).toBe("shielded.fundingVersionOption:2");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:1");
    expect(version.textContent).toBe("shielded.fundingVersionOption:1");
  });
  it("explains incompatible family services even when an existing budget supplies the parent version", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable: false,
      familyRecordsError: "incompatible",
      parentVersions: [],
      policies: [{ handle: "policy:existing", rootVersionIndex: "1", amountPerPeriod: "1000000000000000000", periodDays: "30" }],
    } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:1");
    expect(screen.getByText("shielded.familyRecordsIncompatible")).toBeTruthy();
    expect(screen.queryByText("shielded.familyRecordsUnavailable")).toBeNull();
    expect(screen.queryByText("shielded.fundingVersionRequired")).toBeNull();
    expect(screen.queryByText("shielded.recipientPicker.emptyChildren")).toBeNull();
    expect(heirOptions()).toEqual([]);
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("blocks new funding after family records become unavailable with a previously selected version", async () => {
    let familyRecordsAvailable = true;
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable,
      familyRecordsError: familyRecordsAvailable ? undefined : "incompatible",
      parentVersions: familyRecordsAvailable ? [1] : [],
      children: familyRecordsAvailable
        ? [{ personHash: identity.personHash, rootVersionIndex: 1, eligible: true }]
        : [],
      notes: [{ commitment: "11", ownerCommitment: "1", slot: "identity", kind: "value", amount: "100000000000000000000" }],
    } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseFundingEntry("public");
    const version = selectTrigger("shielded.fields.familyVersion");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:1");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    const submit = screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    familyRecordsAvailable = false;
    refreshAssets();
    await waitUntilIdle();
    expect(version.textContent).toBe("shielded.fundingVersionOption:1");
    expect(version.disabled).toBe(true);
    expect(screen.getByText("shielded.familyRecordsIncompatible")).toBeTruthy();
    expect(screen.queryByText("shielded.recipientPicker.emptyChildren")).toBeNull();
    expect(submit.disabled).toBe(true);
  });
  it("reports no matching loaded family records when parent versions are empty", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable: true,
      parentVersions: [],
    } : defaultCall?.(method, params));
    await renderUnlockedPanel();
    chooseAction("fund");
    const version = selectTrigger("shielded.fields.familyVersion");
    expect(version.disabled).toBe(true);
    expect(version.textContent).toBe("shielded.fundingVersionPlaceholder");
    expect(screen.getByText("shielded.fundingParentMissing")).toBeTruthy();
    expect(screen.queryByText("shielded.fundingVersionRequired")).toBeNull();
    expect(screen.queryByText("shielded.recipientPicker.emptyChildren")).toBeNull();
    expect(screen.queryByText("familyTree.config.versionNone")).toBeNull();
    expect(screen.queryByText("shielded.familyRecordsUnavailable")).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps the payer's independent key while selecting the child's independent budget key", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockImplementation(async (method: string) =>
      method === "discover" ? emptyDiscovery : receivedIndependentWallet);
    await renderUnlockedPanel();
    expectCurrentWallet("identity");
    refreshAssets();
    await waitUntilIdle();
    chooseActiveWallet("independent");
    chooseAction("fund");
    chooseFundingEntry("privateIndependent");
    expect(mocks.navigation).toHaveBeenLastCalledWith(expect.objectContaining({ action: "fund", slot: "independent" }));
    expect(screen.queryByRole("radio", { name: label("mnemonicRestore") })).toBeNull();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(2);
    expect(mocks.call).toHaveBeenCalledWith("recover", expect.anything());
  });
  it("public funding does not ask for child code or child credentials", async () => {
    mocks.identity = identity;
    await renderPanel();
    chooseAction("fund");
    chooseFundingEntry("public");
    expect(screen.getByText(label("publicHint"))).toBeTruthy();
    expect(screen.queryByLabelText("shielded.receiveCodeInputLabel")).toBeNull();
  });
  it("confines payer credential generation to the convenient entry", async () => {
    mocks.identity = identity;
    await renderPanel();
    chooseAction("fund");
    chooseFundingEntry("privateConvenient");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.recipientMethods.credentials" }));
    expect(screen.getByText("shielded.generateReceiveCode")).toBeTruthy();
  });
  it("keeps the child, version and amount when switching funding entries", async () => {
    mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 1, fingerprint: "child-fingerprint" });
    mocks.call.mockResolvedValue({
      ...emptyWallet,
      children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
    });
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "independent-code" } });
    chooseFundingEntry("privateConvenient");
    // Only the receiving material belongs to an entry.
    expect((screen.getByLabelText("shielded.receiveCodeInputLabel") as HTMLTextAreaElement).value).toBe("");
    chooseFundingEntry("public");
    expect(selectTrigger("shielded.fields.familyVersion").textContent).toBe("shielded.fundingVersionOption:0");
    expect(heirChoice(identity.personHash).checked).toBe(true);
    expect((screen.getByLabelText("shielded.fields.rate") as HTMLInputElement).value).toBe("2");
  });
  it("offers new keys from the independent key card and keeps the active wallet choice", async () => {
    await renderUnlockedPanel();
    chooseIndependentBudget();
    expect(screen.getByText(label("claimIndependentKeyRequired"))).toBeTruthy();
    openIndependentKeyManagement();
    expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy();
    expect(independentKeyButton().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
    chooseAction("shield");
    openIndependentKeyManagement("create");
    expect(screen.getByRole("radio", { name: label("randomSource") })).toBeTruthy();
    expect(within(walletSheet()).getByRole("heading", { name: label("createTitle") })).toBeTruthy();
    closeWalletSheet();
    fireEvent.click(navButton("shield"));
    expectCurrentWallet("independent");
    chooseAction("receiveCode");
    expectCurrentWallet("independent");
  });
  it("opens backup for a verified key in standalone management", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderUnlockedPanel();
    openIndependentKeyManagement();
    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: label("restoreTitle") })).toBeNull();
    expect(screen.queryByRole("radio", { name: label("randomSource") })).toBeNull();
  });
  it("keeps funding letters inline and selects existing budgets only in the write task", async () => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method, ...args) => method === "recover" ? {
      ...emptyWallet,
      templates: [
        { handle: "73", policyHandle: "policy:existing", personHash: identity.personHash, bindingKind: 0, keyMode: 1 },
        { handle: "74", policyHandle: "policy:public", personHash: identity.personHash, bindingKind: 1, keyMode: 0 },
      ],
    } : originalCall(method, ...args));
    await renderUnlockedPanel();
    chooseAction("fund");
    const entry = screen.getByRole("region", { name: "shielded.privateLetters.budgetLetterTitle" });
    expect(within(entry).getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" })).toBeTruthy();
    expect(within(entry).queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("shielded.privateLetters.budget")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.write" }));
    const budget = screen.getByLabelText("shielded.privateLetters.budget") as HTMLSelectElement;
    expect(Array.from(budget.options).map(option => option.value)).toEqual(["", "73"]);
    fireEvent.change(budget, { target: { value: "73" } });
    expect((screen.getByLabelText("shielded.privateLetters.budget") as HTMLSelectElement).value).toBe("73");
    expect(screen.getByLabelText("shielded.privateLetters.body")).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("keeps the attached-letter section visible and explains why public funding cannot attach letters", async () => {
    await renderUnlockedPanel();
    chooseAction("fund");
    expect(screen.getByRole("region", { name: "shielded.privateLetters.budgetLetterTitle" })).toBeTruthy();
    chooseFundingEntry("public");
    expect(screen.getByRole("region", { name: "shielded.privateLetters.budgetLetterTitle" })).toBeTruthy();
    expect(screen.getByText("shielded.privateLetters.publicBudgetUnavailable")).toBeTruthy();
    expect(screen.queryByLabelText("shielded.privateLetters.budget")).toBeNull();
  });

  it.each([0, 1])("stays in funding after a deposit without a letter in key mode %s", async keyMode => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    mocks.verify.mockResolvedValue({ disclosure: "fund", personHash: identity.personHash, keyMode, fingerprint: "child-fingerprint" });
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "recover") return {
        ...emptyWallet,
        children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
        notes: [{ commitment: "11", ownerCommitment: identity.identityCommitment, slot: "identity", kind: "value", amount: "100000000000000000000" }],
      };
      if (method === "prove") return { action: "fund", data: { budgetKind: 0, outputCommitments: [31n, 32n] }, proof: {} };
      return {
        handle: "fund:1", action: "fund", amount: params.amount, slot: params.slot,
        steps: [], inputs: [], inputAmounts: [], outputAmounts: [params.amount, "0"],
      };
    });
    mocks.submit.mockResolvedValue(sentTransaction);
    await renderUnlockedPanel(signer);
    chooseAction("fund");
    chooseFundingEntry(keyMode === 0 ? "privateConvenient" : "privateIndependent");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "child-receive-code" } });
    const submit = screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await waitUntilIdle();
    expect(navButton("fund").getAttribute("aria-current")).toBe("true");
    expect(screen.queryByLabelText("shielded.privateLetters.body")).toBeNull();
    expect(screen.queryByLabelText("shielded.privateLetters.budget")).toBeNull();
    const letterSection = screen.getByRole("region", { name: "shielded.privateLetters.budgetLetterTitle" });
    expect(within(letterSection).queryByRole("button")).toBeNull();
    expect(mocks.submitLetter).not.toHaveBeenCalled();
  });
  it("preserves the child, code and letter across budget arrangements and restores custom amounts", async () => {
    mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 1, fingerprint: "child-fingerprint" });
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method, ...args) => method === "recover" ? {
      ...emptyWallet,
      parentVersions: [0, 1],
      children: [0, 1].map(rootVersionIndex => ({ personHash: identity.personHash, rootVersionIndex, eligible: true })),
      policies: [0, 1].map((version, index) => ({ handle: `policy:${index}`, rootVersionIndex: String(version), amountPerPeriod: "1000000000000000000", periodDays: "30" })),
    } : originalCall(method, ...args));
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "2" } });
    chooseOption("shielded.fields.periodDays", "shielded.periodDaysSummary:14");
    fireEvent.change(screen.getByLabelText("shielded.fields.periods"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "budget-code" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.body"), { target: { value: "Keep this letter while choosing an arrangement" } });
    const expectDraft = () => {
      expect(heirChoice(identity.personHash).checked).toBe(true);
      expect((screen.getByLabelText("shielded.receiveCodeInputLabel") as HTMLTextAreaElement).value).toBe("budget-code");
      expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("Keep this letter while choosing an arrangement");
      expect((screen.getByLabelText("shielded.fields.periods") as HTMLInputElement).value).toBe("3");
    };
    chooseOption("shielded.fields.fundingRule", "shielded.newFundingRule");
    expectDraft();
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    expectDraft();
    chooseHeir(identity.personHash);
    expectDraft();
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:1");
    expectDraft();
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    expectDraft();
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:1");
    expectDraft();
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:2");
    expectDraft();
    chooseOption("shielded.fields.fundingRule", "shielded.newFundingRule");
    expectDraft();
    expect((screen.getByLabelText("shielded.fields.rate") as HTMLInputElement).value).toBe("2");
    expect(selectTrigger("shielded.fields.periodDays").textContent).toBe("shielded.periodDaysSummary:14");
    expect(selectTrigger("shielded.fields.familyVersion").textContent).toBe("shielded.fundingVersionOption:0");
    chooseFundingEntry("privateConvenient");
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("Keep this letter while choosing an arrangement");
    chooseFundingEntry("public");
    expect(screen.queryByLabelText("shielded.privateLetters.body")).toBeNull();
    chooseFundingEntry("privateIndependent");
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("Keep this letter while choosing an arrangement");
  });

  it("keeps the letter through an arrangement without the selected child until a different child is chosen", async () => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    const otherChild = "0x" + "02".repeat(32);
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method, ...args) => method === "recover" ? {
      ...emptyWallet,
      parentVersions: [0, 1],
      children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }, { personHash: otherChild, rootVersionIndex: 1, eligible: true }],
      policies: [{ handle: "policy:other", rootVersionIndex: "1", amountPerPeriod: "1000000000000000000", periodDays: "30" }],
    } : originalCall(method, ...args));
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.body"), { target: { value: "For the original child" } });
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:1");
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("For the original child");
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    chooseOption("shielded.fields.fundingRule", "shielded.newFundingRule");
    chooseHeir(identity.personHash);
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("For the original child");
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:1");
    chooseHeir(otherChild);
    expect(screen.queryByLabelText("shielded.privateLetters.body")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("");
  });

  it("clears an inline letter when switching to another child", async () => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    const otherChild = "0x" + "02".repeat(32);
    const originalCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (method, ...args) => method === "recover" ? {
      ...emptyWallet,
      children: [identity.personHash, otherChild].map(personHash => ({ personHash, rootVersionIndex: 0, eligible: true })),
    } : originalCall(method, ...args));
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.body"), { target: { value: "For the first child only" } });
    chooseHeir(otherChild);
    expect((screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    expect((screen.getByLabelText("shielded.privateLetters.body") as HTMLTextAreaElement).value).toBe("");
  });

  it.each([
    [0, "sent"], [1, "sent"], [1, "letterFailed"], [0, "depositFailed"], [1, "preflightFailed"], [1, "depositUncertain"],
  ] as const)("handles inline budget letters in mode %s with outcome %s", async (keyMode, outcome) => {
    mocks.lettersAddress = "0x1111111111111111111111111111111111111111";
    mocks.verify.mockResolvedValue({ disclosure: "fund", personHash: identity.personHash, keyMode, fingerprint: "child-fingerprint" });
    const preparedLetter = { delivery: { messageId: "7", checkpointId: "1", asOf: "900", deadline: "1200", recipientBinding: "9" }, ciphertext: "0x010203", proof: "0x1234" };
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "recover") return {
        ...emptyWallet,
        children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
        notes: [{ commitment: "11", ownerCommitment: identity.identityCommitment, slot: "identity", kind: "value", amount: "100000000000000000000" }],
      };
      if (method === "validateLetter") {
        if (outcome === "preflightFailed") throw new Error("invalid letter credential");
        return { ok: true };
      }
      if (method === "prepareLetter") return preparedLetter;
      if (method === "prove") return { action: "fund", data: { budgetKind: 0, outputCommitments: [31n, 32n] }, proof: {} };
      return { handle: "fund:1", action: "fund", amount: params.amount, slot: params.slot, steps: [], inputs: [], inputAmounts: [], outputAmounts: [params.amount, "0"] };
    });
    let confirmDeposit!: (result: typeof sentTransaction) => void;
    mocks.submit.mockReturnValue(new Promise(resolve => { confirmDeposit = resolve; }));
    let confirmPublicReceipt!: (result: { status: number }) => void;
    if (outcome === "depositUncertain") {
      mocks.receipt.mockReturnValueOnce(new Promise(resolve => { confirmPublicReceipt = resolve; }));
      mocks.submit.mockImplementation(async params => {
        params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
        params.onBroadcast("0xuncertain-fund");
        throw new Error("Deposit receipt unavailable");
      });
    }
    if (outcome === "letterFailed") mocks.submitLetter.mockRejectedValueOnce(new Error("receipt unavailable")).mockResolvedValue({ transactionHash: "0xletter" });
    await renderUnlockedPanel(signer);
    chooseAction("fund");
    chooseFundingEntry(keyMode === 0 ? "privateConvenient" : "privateIndependent");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "budget-combined-code" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateLetters.includeLetter" }));
    fireEvent.change(screen.getByLabelText("shielded.privateLetters.body"), { target: { value: "A letter written before the deposit" } });
    const submit = screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    if (outcome === "preflightFailed") {
      await screen.findByText("shielded.privateLetters.preflightFailed");
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.submitLetter).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.call).toHaveBeenCalledWith("validateLetter", expect.objectContaining({ code: "budget-combined-code", body: "A letter written before the deposit", keyMode }), expect.anything());
    expect(mocks.call.mock.calls.filter(([method]) => method === "prepareLetter")).toHaveLength(0);
    if (outcome === "depositUncertain") {
      await screen.findByText("shielded.privateLetters.delivery.awaitingDeposit");
      expect(submit.disabled).toBe(true);
      await waitFor(() => expect(mocks.receipt).toHaveBeenCalled());
      await act(async () => confirmPublicReceipt({ status: 1 }));
    } else {
      await act(async () => confirmDeposit({ ...sentTransaction, receipt: { status: outcome === "depositFailed" ? 0 : 1 } }));
    }
    if (outcome === "depositFailed") {
      await waitUntilIdle();
      expect(mocks.submitLetter).not.toHaveBeenCalled();
      expect(mocks.call.mock.calls.filter(([method]) => method === "prepareLetter")).toHaveLength(0);
      return;
    }
    if (outcome === "letterFailed") {
      await screen.findByText("shielded.privateLetters.delivery.failed");
      await waitUntilIdle();
      expect(submit.disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.retryLetter" }));
    }
    await screen.findByText("shielded.privateLetters.delivery.sent");
    await waitUntilIdle();
    expect(navButton("fund").getAttribute("aria-current")).toBe("true");
    expect(mocks.call).toHaveBeenCalledWith("prepareLetter", expect.objectContaining({ code: "budget-combined-code", body: "A letter written before the deposit", budgetCommitment: "31" }), expect.anything());
    expect(mocks.call.mock.calls.filter(([method]) => method === "prepareLetter")).toHaveLength(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submitLetter).toHaveBeenCalledTimes(outcome === "letterFailed" ? 2 : 1);
    expect(submit.disabled).toBe(true);
  });

  it.each([
    ["privateConvenient", 0, "identity"],
    ["privateIndependent", 1, "identity"],
    ["privateConvenient", 0, "independent"],
    ["privateIndependent", 1, "independent"],
  ] as const)("prepares %s funding with recipient key mode %s using the explicit %s payer key", async (entry, keyMode, source) => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode, fingerprint: "child-fingerprint" });
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
      notes: [{ commitment: "11", ownerCommitment: source === "independent" ? independentKey.ownerCommitment : identity.identityCommitment, slot: source, kind: "value", amount: "100000000000000000000" }],
    } : method === "prove" ? stopAfterPreview() : {
      handle: "fund:1", action: "fund", amount: params.amount, slot: params.slot,
      steps: [], inputs: [], inputAmounts: [], outputAmounts: [params.amount, "0"],
    });
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseFundingEntry(entry);
    chooseActiveWallet(source);
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "child-receive-code" } });
    const submit = screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "fund", slot: source, fundingEntry: entry, recipientCode: "child-receive-code",
    }), expect.anything()));
    const request = mocks.call.mock.calls.find(([method]) => method === "preview")?.[1];
    expect(request).not.toHaveProperty("autoSelectIndependentKey");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([
    ["public", 1, 0, "publicEntry"],
    ["privateConvenient", 0, 0, "convenientEntry"],
    ["privateIndependent", 0, 1, "independentEntry"],
  ] as const)("keeps an existing %s template fixed for further funding", async (entry, bindingKind, keyMode, entryLabel) => {
    mocks.verify.mockResolvedValue({ disclosure: "fund", personHash: identity.personHash, keyMode, fingerprint: "child-fingerprint" });
    mocks.call.mockImplementation(async (method, params) => method === "recover" ? {
      ...emptyWallet,
      familyRecordsAvailable: false,
      familyRecordsError: "unavailable",
      parentVersions: [],
      policies: [{ handle: "policy:existing", rootVersionIndex: "0", amountPerPeriod: "1000000000000000000", periodDays: "30" }],
      templates: [{ handle: "template:existing", policyHandle: "policy:existing", personHash: identity.personHash, bindingKind, keyMode }],
      notes: [{ commitment: "11", ownerCommitment: "1", slot: "identity", kind: "value", amount: "100000000000000000000" }],
    } : method === "prove" ? stopAfterPreview() : {
      handle: "fund:existing", action: "fund", amount: "1000000000000000000", slot: params.slot,
      steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1000000000000000000", "0"],
    });
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseOption("shielded.fields.fundingRule", "shielded.policyOption:1");
    chooseHeir(identity.personHash);
    expect((screen.getByRole("radio", { name: label(entryLabel) }) as HTMLInputElement).checked).toBe(true);
    for (const key of ["publicEntry", "convenientEntry", "independentEntry"]) {
      expect(screen.getByRole("radio", { name: label(key) }).matches(":disabled")).toBe(true);
    }
    expect(screen.getByText(label("fundingEntryFixed"))).toBeTruthy();
    if (entry === "public") expect(screen.queryByLabelText("shielded.receiveCodeInputLabel")).toBeNull();
    else {
      expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "current-fund-material" } });
      await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    }
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "fund", policyHandle: "policy:existing", fundingEntry: entry,
      recipientCode: entry === "public" ? undefined : "current-fund-material",
    }), expect.anything()));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("random creation is explicit and passes no wallet signature", async () => {
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.call).toHaveBeenCalledWith(
      "createIndependentKey",
      expect.objectContaining({ intent: "create", rootSource: "random", expectedCredentialsHandle: credentials.handle }),
    );
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey?.backupRequired).toBe(true);
    expect(screen.getByText(label("exportRecovery"))).toBeTruthy();
    expect(screen.queryByLabelText(label("action"))).toBeNull();
  });
  it("signature rejection leaves both choices available and permits retrying the same method", async () => {
    vi.mocked(signer.signMessage).mockRejectedValueOnce(new Error("rejected"));
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("rejected"));
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
    await waitUntilIdle();
    expect((screen.getByRole("radio", { name: label("signatureSource") }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: label("randomSource") }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));

    await waitFor(() => expect(mocks.independentKey?.backupRequired).toBe(true));
    expect(signer.signMessage).toHaveBeenCalledTimes(2);
    expect(mocks.call).toHaveBeenCalledWith("createIndependentKey", expect.objectContaining({ rootSource: "walletSignature" }));
    expect(mocks.call.mock.calls.some(([method, params]) => method === "createIndependentKey" && params.rootSource === "random")).toBe(false);
    expect(mocks.identity).toEqual(identity);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each([
    ["createIndependentKey", "signer"],
    ["createIndependentKey", "account"],
    ["createIndependentKey", "connection event"],
    ["importRecoveryMaterial", "signer"],
    ["importRecoveryMaterial", "account"],
    ["importRecoveryMaterial", "connection event"],
  ] as const)("keeps a pending local %s coherent after the gas %s changes", async (method, change) => {
    let finish!: (state: any) => void;
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation((calledMethod, params) => calledMethod === method
      ? new Promise((resolve) => { finish = resolve; })
      : defaultCall?.(calledMethod, params));
    const rendered = await renderUnlockedPanel();
    if (method === "createIndependentKey") {
      openCreateWallet();
      fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    } else {
      openIndependentWallet();
      fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-backup" } });
      importRecovery();
    }
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(method,
      expect.objectContaining({ expectedCredentialsHandle: credentials.handle })));
    if (change === "connection event") {
      act(() => {
        mocks.walletGeneration++;
        mocks.walletListeners.forEach((listener) => listener());
      });
    } else {
      rendered.rerender(<ShieldedInheritancePanel modules={modules}
        signer={change === "signer" ? { ...signer } as Signer : signer}
        account={change === "account" ? "0x00000000000000000000000000000000000000bb" : address} />);
    }
    expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(true);
    const state = {
      credentials, identity,
      independentKey: { ...independentKey, recoveryVerified: method === "importRecoveryMaterial", backupRequired: method === "createIndependentKey" },
    };
    await act(async () => finish(state));
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey).toEqual(state.independentKey);
    expect(mocks.lock).not.toHaveBeenCalled();
    if (method === "createIndependentKey") {
      expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    } else {
      expect(screen.getByRole("button", { name: label("keySettings") })).toBeTruthy();
      expect(screen.getByRole("button", { name: label("independentKeyReceiveCode") })).toBeTruthy();
    }
    await waitUntilIdle();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("a cancelled late signature cannot reopen the session", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    await act(async () => resolve("late-secret"));
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
    expect(mocks.update.mock.calls.some(([state]) => state.independentKey !== null)).toBe(false);
  });
  it.each(["createIndependentKey", "importRecoveryMaterial"] as const)(
    "rejects a late %s DTO after credentials change without replacing the Worker",
    async (method) => {
      let finish!: (state: any) => void;
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation((calledMethod, params) => calledMethod === method
        ? new Promise((resolve) => { finish = resolve; })
        : defaultCall?.(calledMethod, params));
      await renderUnlockedPanel();
      if (method === "createIndependentKey") {
        openCreateWallet();
        fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
      } else {
        openIndependentWallet();
        fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "original-backup" } });
        importRecovery();
      }
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith(method,
        expect.objectContaining({ expectedCredentialsHandle: credentials.handle })));
      const generation = mocks.generation;
      const nextCredentials = { handle: "credentials:replacement" };
      const nextIdentity = { ...identity, handle: "identity:replacement" };
      act(() => publishSession({ credentials: nextCredentials, identity: nextIdentity, independentKey: null }));
      await act(async () => finish({
        credentials, identity,
        independentKey: { ...independentKey, recoveryVerified: true, backupRequired: method === "createIndependentKey" },
      }));
      expect(mocks.generation).toBe(generation);
      expect(mocks.credentials).toEqual(nextCredentials);
      expect(mocks.identity).toEqual(nextIdentity);
      expect(mocks.independentKey).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.lock).not.toHaveBeenCalled();
    },
  );
  it("cancelling while resolving the signer address prevents the wallet signature request", async () => {
    let resolve!: (value: string) => void;
    (signer.getAddress as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(signer.getAddress).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    await act(async () => resolve(address));
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
  });
  it("does not open receiving or spending from a verified root without credentials", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    await renderPanel();
    expect(screen.getByLabelText("identity passphrase")).toBeTruthy();
    expect(screen.queryByText(submitLabel)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
  it("changes the active wallet and its overview balances without losing task drafts", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockResolvedValue({
      ...receivedIndependentWallet,
      notes: [
        ...receivedIndependentWallet.notes,
        { commitment: "101", ownerCommitment: "1", slot: "identity", kind: "budget", amount: "3000000000000000000" },
        { commitment: "102", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "4500000000000000000" },
        { commitment: "103", ownerCommitment: "2", slot: "independent", kind: "budget", amount: "9000000000000000000", pendingIdentity: true },
        { commitment: "104", ownerCommitment: "3", slot: "independent", kind: "value", amount: "99000000000000000000" },
      ],
    });
    await renderUnlockedPanel();
    const source = walletCard("identity");
    expectCurrentWallet("identity");
    expect(within(taskPanel()).queryByText(label("currentWallet"))).toBeNull();
    // The current wallet's card precedes the amount field and submit button.
    expect(
      source.compareDocumentPosition(screen.getByLabelText("shielded.fields.amount")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(cardBalance("identity", "budgetAmount")).toBe("3CFX"));
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const selection = walletSelection();
    const identityRow = walletCard("identity");
    const independentKeyRow = walletCard("independent");
    expect(within(identityRow).getByText("0")).toBeTruthy();
    expect(within(identityRow).getByText("3")).toBeTruthy();
    expect(within(independentKeyRow).getByText("2.5")).toBeTruthy();
    expect(within(independentKeyRow).getByText("4.5")).toBeTruthy();
    expect(within(selection).queryByText("99")).toBeNull();
    expect(within(screen.getByRole("region", { name: "shielded.balanceTitle" })).getByRole("button", {
      name: label("identityReceiveCode"),
    })).toBeTruthy();
    const identitySource = within(selection).getByRole("radio", { name: label("identityCredentials") }) as HTMLInputElement;
    const assetSource = within(selection).getByRole("radio", { name: label("independentKey") }) as HTMLInputElement;
    expect(identitySource.checked).toBe(true);
    expect(assetSource.checked).toBe(false);
    fireEvent.click(assetSource);
    expect(assetSource.checked).toBe(true);
    expect(identitySource.checked).toBe(false);
    expectCurrentWallet("independent");
    expect(cardBalance("independent", "balanceAmount")).toBe("2.5CFX");
    expect(cardBalance("independent", "budgetAmount")).toBe("4.5CFX");
    expect(within(walletCard("independent")).getByTitle(independentKey.keyFingerprint)).toBeTruthy();
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    // Viewing another wallet's code keeps the globally selected wallet for every task.
    openReceiveCode("independent");
    expect(screen.getByRole("button", { name: label("independentKeyReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    openReceiveCode("identity");
    chooseAction("claim");
    expectCurrentWallet("independent");
    chooseAction("fund");
    expect(screen.queryByRole("group", { name: label("assetSource") })).toBeNull();
    expectCurrentWallet("independent");
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.identity).toEqual(identity);
  });
  it.each([
    ["not restored", null],
    ["not verified", { ...independentKey, recoveryVerified: false }],
    ["backup pending", { ...independentKey, recoveryVerified: true, backupRequired: true }],
  ])(
    "allows the same key choices across tasks but blocks submission when the independent key is %s",
    async (_state, candidate) => {
      mocks.independentKey = candidate;
      await renderUnlockedPanel();
      expectCurrentWallet("identity");
      for (const action of ["shield", "privateTransfer", "unshield", "fund", "receiveCode", "claim"] as const) {
        if (action !== "receiveCode") chooseAction(action);
        if (action === "shield") {
          const selection = walletSelection();
          const independentKeyRow = walletCard("independent");
          expect(within(independentKeyRow).getAllByText("—")).toHaveLength(2);
          fireEvent.click(within(selection).getByRole("radio", { name: label("independentKey") }));
          expectCurrentWallet("independent");
          expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
        } else if (action === "receiveCode") {
          // Only a usable independent key offers a receive code; its card offers key setup instead.
          expect(screen.queryByRole("button", { name: label("independentKeyReceiveCode") })).toBeNull();
          expect(independentKeyButton()).toBeTruthy();
          expect(screen.queryByRole("button", { name: "shielded.generateReceiveCode" })).toBeNull();
        } else {
          chooseActiveWallet("independent");
          expectCurrentWallet("independent");
          expect(within(taskPanel()).queryByRole("radio", { name: label("independentKey") })).toBeNull();
        }
        if (action === "claim") {
          expect(screen.getByText(label("claimIndependentKeyRequired"))).toBeTruthy();
          expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
        } else {
          expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
        }
      }
      expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
      expect(mocks.call.mock.calls.some(([method]) => method === "receiveCode")).toBe(false);
    },
  );
  it("keeps a saved independent deposit choice but blocks submission until its key is restored", async () => {
    mocks.credentials = credentials;
    mocks.identity = identity;
    await renderPanel(signer, modules, {
      slot: "independent",
      action: "shield",
      taskChosen: true,
    });
    expectCurrentWallet("independent");
    expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
  });
  it.each([undefined, "previous-key-fingerprint"])(
    "requires explicit acceptance when a saved independent destination has fingerprint %s",
    async (keyFingerprint) => {
      mocks.credentials = credentials;
      mocks.identity = identity;
      mocks.independentKey = { ...independentKey, recoveryVerified: true };
      await renderPanel(signer, modules, {
        slot: "independent",
        keyFingerprint,
        action: "shield",
        taskChosen: true,
      });
      expectCurrentWallet("independent");
      expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
      fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
      expect(
        (screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
      const selection = walletSelection();
      const source = within(selection).getByRole("radio", { name: label("independentKey") }) as HTMLInputElement;
      expect(source.checked).toBe(false);
      expect((within(selection).getByRole("radio", { name: label("identityCredentials") }) as HTMLInputElement).checked).toBe(false);
      fireEvent.click(source);
      expect(source.checked).toBe(true);
      expect(
        (screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(mocks.navigation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slot: "independent",
          keyFingerprint: independentKey.keyFingerprint,
        }),
      );
    },
  );
  it.each(["shield", "unshield"] as const)(
    "requires a new explicit key selection before preparing %s after a verified independent key root changes",
    async (action) => {
      const replacementIndependentKey = {
        ...independentKey,
        ownerCommitment: "3",
        viewingKey: "0x" + "04".repeat(32),
        keyFingerprint: "0x" + "05".repeat(32),
        recoveryVerified: true,
      };
      mocks.independentKey = { ...independentKey, recoveryVerified: true };
      mocks.call.mockImplementation(async (method, params) =>
        method === "recover"
          ? {
              ...emptyWallet,
              notes: [
                {
                  commitment:
                    mocks.independentKey?.keyFingerprint === replacementIndependentKey.keyFingerprint
                      ? "200"
                      : "100",
                  ownerCommitment: mocks.independentKey?.ownerCommitment,
                  slot: "independent",
                  kind: "value",
                  amount: "2500000000000000000",
                },
              ],
            }
          : method === "prove"
            ? stopAfterPreview()
            : {
                handle: "action:selected",
                action: params.action,
                slot: params.slot,
                amount: params.amount,
                steps: [],
                inputs: params.candidates ?? [],
                inputAmounts: [],
                outputAmounts: [params.amount, "0"],
              },
      );
      await renderUnlockedPanel();
      chooseAction(action);
      if (action === "shield") chooseActiveWallet("independent");
      else chooseActiveWallet("independent");
      fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
      if (action === "unshield") selectValue("100");
      expect(mocks.navigation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slot: "independent",
          keyFingerprint: independentKey.keyFingerprint,
        }),
      );
      await act(async () => publishSession({ credentials, identity, independentKey: replacementIndependentKey }));
      await waitUntilIdle();
      if (action === "shield") {
        expectCurrentWallet("independent");
        expect(within(walletCard("independent")).getByTitle(independentKey.keyFingerprint)).toBeTruthy();
        expect(within(walletCard("independent")).queryByTitle(replacementIndependentKey.keyFingerprint)).toBeNull();
        expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
      }
      expect(
        (screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(document.querySelector('input[value="100"]')).toBeNull();
      expect(document.querySelector('input[value="200"]')).toBeNull();
      expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
      const selection = walletSelection();
      const source = within(selection).getByRole("radio", { name: label("independentKey") }) as HTMLInputElement;
      expect(source.checked).toBe(false);
      expect(source.disabled).toBe(false);
      expect((screen.getByRole("radio", { name: label("identityCredentials") }) as HTMLInputElement).checked).toBe(false);
      fireEvent.click(source);
      expect(source.checked).toBe(true);
      expect(mocks.navigation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slot: "independent",
          keyFingerprint: replacementIndependentKey.keyFingerprint,
        }),
      );
      if (action === "unshield") {
        const replacementNote = document.querySelector('input[value="200"]') as HTMLInputElement;
        expect(replacementNote.checked).toBe(false);
        selectValue("200");
      }
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith(
          "preview",
          expect.objectContaining({
            action,
            slot: "independent",
            amount: "1000000000000000000",
            ...(action === "unshield" ? { candidates: ["200"] } : {}),
          }),
          expect.anything(),
        ),
      );
    },
  );
  it.each(["card", "phone tab"] as const)("requires accepting a replacement independent key through its %s before claiming", async (control) => {
    const acceptIndependentKey = () => control === "phone tab"
      ? fireEvent.click(walletTab("independent"))
      : chooseActiveWallet("independent");
    const originalIndependentKey = { ...independentKey, recoveryVerified: true };
    const replacementIndependentKey = { ...originalIndependentKey, ownerCommitment: "3", keyFingerprint: "replacement-key-fingerprint" };
    mocks.independentKey = originalIndependentKey;
    mocks.call.mockImplementation(async (method, params) => {
      const replacement = mocks.independentKey?.keyFingerprint === replacementIndependentKey.keyFingerprint;
      if (method === "recover") return {
        ...emptyWallet,
        notes: [{ commitment: replacement ? "202" : "201", ownerCommitment: mocks.independentKey?.ownerCommitment, slot: "independent", kind: "budget", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000" }],
        claims: [{ handle: replacement ? "claim:replacement" : "claim:original", budgets: [replacement ? "202" : "201"], slot: "independent", status: "claimable", amount: "1000000000000000000", amountPerPeriod: "1000000000000000000", periodIndices: [replacement ? "1" : "0"] }],
      };
      if (method === "prove") return stopAfterPreview();
      return { handle: "preview:claim", action: params.action, slot: params.slot, amount: "1000000000000000000", steps: [], inputs: [], inputAmounts: [], outputAmounts: [] };
    });
    await renderUnlockedPanel();
    acceptIndependentKey();
    chooseAction("claim");
    expect(screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeTruthy();
    await act(async () => publishSession({ credentials, identity, independentKey: replacementIndependentKey }));
    await waitUntilIdle();
    expectCurrentWallet("independent");
    expect(within(walletCard("independent")).getByTitle(independentKey.keyFingerprint)).toBeTruthy();
    expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "shielded.claimPeriodOption:1" })).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
    acceptIndependentKey();
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "shielded.claimPeriodOption:2" }) as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({ action: "claim", slot: "independent", claimHandle: "claim:replacement", periodIndices: ["1"] }), expect.anything()));
  });
  it("keeps an accepted deposit key through a temporary root loss and restoration of the same fingerprint", async () => {
    const selectedIndependentKey = { ...independentKey, recoveryVerified: true };
    mocks.independentKey = selectedIndependentKey;
    mocks.call.mockImplementation(async (method, params) =>
      method === "recover"
        ? emptyWallet
        : method === "prove"
          ? stopAfterPreview()
          : {
              handle: "shield:restored",
              action: params.action,
              slot: params.slot,
              amount: params.amount,
              steps: [],
              inputs: [],
              inputAmounts: [],
              outputAmounts: [params.amount, "0"],
            },
    );
    await renderUnlockedPanel();
    chooseActiveWallet("independent");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    await act(async () => publishSession({ credentials, identity, independentKey: null }));
    expectCurrentWallet("independent");
    expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => publishSession({ credentials, identity, independentKey: selectedIndependentKey }));
    await waitUntilIdle();
    expectCurrentWallet("independent");
    expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "preview",
        expect.objectContaining({
          action: "shield",
          slot: "independent",
          amount: "1000000000000000000",
        }),
        expect.anything(),
      ),
    );
  });
  it("does not replace an explicitly selected deposit key when its root is cleared", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockImplementation(async (method, params) =>
      method === "recover"
        ? emptyWallet
        : method === "prove"
          ? stopAfterPreview()
          : {
              handle: "shield:selected",
              action: params.action,
              slot: params.slot,
              amount: params.amount,
              steps: [],
              inputs: [],
              inputAmounts: [],
              outputAmounts: [params.amount, "0"],
            },
    );
    await renderUnlockedPanel();
    chooseActiveWallet("independent");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), {
      target: { value: "1.25" },
    });
    await act(async () => publishSession({ credentials, identity, independentKey: null }));
    expectCurrentWallet("independent");
    expect(screen.queryByText(label("depositWalletUnavailable"))).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
    chooseActiveWallet("identity");
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "preview",
        expect.objectContaining({
          action: "shield",
          slot: "identity",
          amount: "1250000000000000000",
        }),
        expect.anything(),
      ),
    );
  });
  it("keeps the active wallet for claiming and depositing while other receive codes are viewed", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.call.mockImplementation(async (method, params) =>
      method === "recover"
        ? emptyWallet
        : method === "prove"
          ? stopAfterPreview()
          : {
              handle: "shield:independent",
              action: params.action,
              slot: params.slot,
              amount: params.amount,
              steps: [],
              inputs: [],
              inputAmounts: [],
              outputAmounts: [params.amount, "0"],
            },
    );
    await renderUnlockedPanel();
    chooseActiveWallet("independent");
    openReceiveCode("independent");
    expect(screen.getByRole("button", { name: label("independentKeyReceiveCode") }).getAttribute("aria-expanded")).toBe("true");
    await waitForReceiveCode("independent");
    openReceiveCode("identity");
    await waitForReceiveCode("identity");
    chooseAction("claim");
    expectCurrentWallet("independent");
    chooseAction("shield");
    expectCurrentWallet("independent");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "preview",
        expect.objectContaining({
          action: "shield",
          slot: "independent",
          amount: "1250000000000000000",
        }),
        expect.anything(),
      ),
    );
    const request = mocks.call.mock.calls.find(([method]) => method === "preview")?.[1];
    expect(request).not.toHaveProperty("autoSelectIndependentKey");
  });
  it.each(["privateTransfer", "unshield"] as const)(
    "restricts %s candidates to the selected key and clears selection when changing the source",
    async (action) => {
      mocks.independentKey = { ...independentKey, recoveryVerified: true };
      mocks.verify.mockRejectedValue(new Error("unfinished recipient code"));
      mocks.call.mockResolvedValue({
        ...receivedIndependentWallet,
        notes: [
          ...receivedIndependentWallet.notes,
          {
            commitment: "101",
            ownerCommitment: identity.identityCommitment,
            slot: "identity",
            kind: "value",
            amount: "1000000000000000000",
          },
        ],
      });
      await renderUnlockedPanel();
      chooseAction(action);
      const amount = screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount") as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "0.75" } });
      const recipient = screen.getByLabelText(action === "privateTransfer" ? "shielded.receiveCodeInputLabel" : "shielded.fields.exitRecipient") as HTMLInputElement | HTMLTextAreaElement;
      const recipientDraft = action === "privateTransfer" ? "unfinished-recipient-code" : address;
      fireEvent.change(recipient, { target: { value: recipientDraft } });
      expect(document.querySelector('input[value="101"]')).toBeTruthy();
      expect(document.querySelector('input[value="100"]')).toBeNull();
      selectValue("101");
      chooseActiveWallet("independent");
      expect(screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount")).toBe(amount);
      expect(screen.getByLabelText(action === "privateTransfer" ? "shielded.receiveCodeInputLabel" : "shielded.fields.exitRecipient")).toBe(recipient);
      expect(amount.value).toBe("0.75");
      expect(recipient.value).toBe(recipientDraft);
      expect(document.querySelector('input[value="101"]')).toBeNull();
      expect((document.querySelector('input[value="100"]') as HTMLInputElement).checked).toBe(
        false,
      );
      selectValue("100");
      chooseActiveWallet("identity");
      expect(document.querySelector('input[value="100"]')).toBeNull();
      expect((document.querySelector('input[value="101"]') as HTMLInputElement).checked).toBe(
        false,
      );
      expect(amount.value).toBe("0.75");
      expect(recipient.value).toBe(recipientDraft);
      expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
    },
  );
  it.each(["privateTransfer", "unshield"] as const)(
    "prepares %s from the independent value found by scanning",
    async (action) => {
      mocks.independentKey = { ...independentKey, recoveryVerified: true };
      mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 0, fingerprint: "recipient-fingerprint" });
      mocks.call.mockImplementation(async (method, params) =>
        method === "recover" ? receivedIndependentWallet : method === "discover" ? emptyDiscovery : method === "prove" ? stopAfterPreview() : {
          handle: "action:independent",
          action: params.action,
          slot: params.slot,
          amount: params.amount,
          inputs: ["100"],
          inputAmounts: ["2500000000000000000"],
          outputAmounts: [params.amount, "1500000000000000000"],
          steps: [],
        },
      );
      await renderUnlockedPanel();
      expectCurrentWallet("identity");
      refreshAssets();
      await waitUntilIdle();
      chooseActiveWallet("independent");
      chooseAction(action);
      expectCurrentWallet("independent");
      fireEvent.change(screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount"), { target: { value: "1" } });
      selectValue("100");
      if (action === "privateTransfer") {
        fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "verified-recipient-code" } });
        const confirmation = await screen.findByRole("checkbox", { name: "shielded.recipientConfirm" });
        fireEvent.click(confirmation);
      }
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
        action, slot: "independent", amount: "1000000000000000000", candidates: ["100"],
      }), expect.anything()));
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it("transfers identity credentials directly to Worker and clears the input", async () => {
    await renderPanel();
    const password = screen.getByLabelText("identity passphrase") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "private-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "unlockIdentity",
        expect.objectContaining({ rawPassphrase: "private-passphrase" }),
      ),
    );
    expect(password.value).toBe("");
  });
  it("requires only the recipient confirmation before preparing an independent transfer", async () => {
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    mocks.verify.mockResolvedValue({
      personHash: identity.personHash,
      keyMode: 1,
      fingerprint: "independent-recipient-fingerprint",
    });
    mocks.call.mockImplementation(async (method, params) => method === "recover"
      ? receivedIndependentWallet
      : method === "prove" ? stopAfterPreview() : {
          handle: "transfer:1", action: "privateTransfer", slot: params.slot,
          amount: params.amount, steps: [], inputs: ["100"],
          inputAmounts: ["2500000000000000000"], outputAmounts: [params.amount, "0"],
        });
    await renderUnlockedPanel();
    chooseActiveWallet("independent");
    chooseAction("privateTransfer");
    fireEvent.change(screen.getByLabelText("shielded.fields.transferAmount"), { target: { value: "1" } });
    selectValue("100");
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "independent-recipient-code" } });
    const submit = screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("preview", expect.objectContaining({
      action: "privateTransfer", slot: "independent", candidates: ["100"],
      recipientCode: "independent-recipient-code",
    }), expect.anything()));
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "changed-recipient-code" } });
    expect((screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }) as HTMLInputElement).checked).toBe(false);
  });
  it("failed Shielded Key import clears its secret without creating a replacement root", async () => {
    mocks.call.mockImplementation(async (method) => {
      if (method === "recover") return emptyWallet;
      throw new Error("Invalid independent key");
    });
    await renderUnlockedPanel();
    openIndependentWallet();
    chooseRecoveryPath("shieldedKey");
    const input = screen.getByLabelText(label("shieldedKeyInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "invalid-private-independent-key" } });
    importRecovery();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid independent key"));
    expect(mocks.call).toHaveBeenCalledWith(
      "importRecoveryMaterial",
      expect.objectContaining({
        format: "shieldedKey",
        material: "invalid-private-independent-key",
      }),
    );
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    expect(input.value).toBe("");
  });
  it("offers only words, Shielded Key and signature as normal recovery paths", async () => {
    await renderUnlockedPanel();
    openIndependentWallet();
    expect((screen.getByRole("radio", { name: label("mnemonicRestore") }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: label("shieldedKeyRestore") })).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("signatureRestore") })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: label("exportRecovery") })).toBeNull();
  });
  it.each(["mnemonic", "shieldedKey"] as const)(
    "transfers %s directly to the Worker and clears the input before completion",
    async (format) => {
      let complete!: (value: any) => void;
      mocks.call.mockImplementation(
        (method) => method === "recover" ? Promise.resolve(emptyWallet) :
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      await renderUnlockedPanel();
      openIndependentWallet();
      chooseRecoveryPath(format);
      const input = screen.getByLabelText(
        label(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput"),
      ) as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: "private-recovery-material" } });
      importRecovery();
      await waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith(
          "importRecoveryMaterial",
          expect.objectContaining({ format, material: "private-recovery-material" }),
        ),
      );
      expect(input.value).toBe("");
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(mocks.identity).toEqual(identity);
      await act(async () => complete({ credentials, identity, independentKey }));
      expect(mocks.update).toHaveBeenCalled();
      expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    },
  );
  it("requires an off-device save and a manually re-entered backup after clearing the root", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "exportRecoveryMaterial"
      ? {
          material: "original-secret-words", format: "mnemonic", version: 1,
          keyFingerprint: independentKey.keyFingerprint,
        }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    await createIndependentKeyForBackup();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "exportRecoveryMaterial",
        expect.objectContaining({ format: "mnemonic" }),
      ),
    );
    await waitFor(() => expect(exportedMaterial().textContent).toContain("original-secret-words"));
    const exported = exportedMaterial();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect((screen.getByText(label("beginIndependentImport")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText(label("importRecovery"))).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    fireEvent.click(screen.getByText(label("beginIndependentImport")));
    expect(exported.textContent).not.toContain("original-secret-words");
    await waitFor(() => expect(mocks.independentKey).toBeNull());
    expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {});
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.identity).toEqual(identity);
    expect(screen.getByText(label("reenterBackup"))).toBeTruthy();
    const verificationInput = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    expect(verificationInput.value).toBe("");
    fireEvent.change(verificationInput, { target: { value: "manually-entered-backup" } });
    importRecovery();
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "importRecoveryMaterial",
        expect.objectContaining({
          format: "mnemonic",
          material: "manually-entered-backup",
          expectedFingerprint: independentKey.keyFingerprint,
        }),
      ),
    );
    expect(verificationInput.value).toBe("");
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
    await waitFor(() => expect(within(walletSelection()).getByRole("radio", { name: label("independentKey") })).toBeTruthy());
    expect(screen.getByRole("button", { name: label("independentKeyReceiveCode") }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: label("keySettings") }).getAttribute("aria-expanded")).toBe("false");
    expectCurrentWallet("identity");
    expect(screen.queryByRole("button", { name: label("backToWorkspace") })).toBeNull();
  });
  it("keeps the credentials-only workspace mounted during a independent key backup drill", async () => {
    mocks.credentials = credentials;
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "exportRecoveryMaterial"
      ? {
          material: "root-only-secret-words",
          format: "mnemonic",
          version: 1,
          keyFingerprint: independentKey.keyFingerprint,
        }
      : defaultCall?.(method, params));
    await renderPanel();
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1.25" } });
    const overview = screen.getByRole("region", { name: "shielded.balanceTitle" });
    const navigation = taskNavigation();
    const task = taskPanel();

    await openWalletManagement();
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBe(overview);
    expect(taskNavigation()).toBe(navigation);
    expect(taskPanel()).toBe(task);
    fireEvent.click(screen.getByRole("button", { name: label("exportRecovery") }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: label("savedExternal") })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    fireEvent.click(screen.getByRole("button", { name: label("beginIndependentImport") }));
    await waitFor(() => expect(screen.getByText(label("reenterBackup"))).toBeTruthy());

    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {});
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBe(overview);
    expect(taskNavigation()).toBe(navigation);
    expect(taskPanel()).toBe(task);
    expect(mocks.credentials).toEqual(credentials);
    expect(screen.queryByLabelText("identity passphrase")).toBeNull();
    expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(taskNavigation()).getAllByRole("button").every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole("button", { name: "shielded.lock" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "root-only-secret-words" } });
    importRecovery();
    await waitFor(() => expect(within(walletSelection()).getByRole("radio", { name: label("independentKey") })).toBeTruthy());
    chooseAction("unshield");

    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBe(overview);
    expect(taskNavigation()).toBe(navigation);
    expect(taskPanel()).toBe(task);
    expect(navButton("unshield").getAttribute("aria-current")).toBe("true");
    expect((screen.getByLabelText("shielded.fields.amount") as HTMLInputElement).value).toBe("1.25");
    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each(["signer", "account", "connection event"] as const)(
    "finishes clearing the backup root after the gas %s changes and accepts the saved backup",
    async (change) => {
      let finishClear!: (state: any) => void;
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation((method, params) => method === "clearIndependentKey"
        ? new Promise((resolve) => { finishClear = resolve; })
        : method === "exportRecoveryMaterial"
          ? Promise.resolve({ material: "saved-backup", format: "mnemonic", version: 1,
              keyFingerprint: independentKey.keyFingerprint })
          : defaultCall?.(method, params));
      const rendered = await renderUnlockedPanel();
      await createIndependentKeyForBackup();
      fireEvent.click(screen.getByRole("button", { name: label("exportRecovery") }));
      fireEvent.click(await screen.findByRole("checkbox", { name: label("savedExternal") }));
      fireEvent.click(screen.getByRole("button", { name: label("beginIndependentImport") }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {}));
      if (change === "connection event") {
        act(() => {
          mocks.walletGeneration++;
          mocks.walletListeners.forEach((listener) => listener());
        });
      } else {
        rendered.rerender(<ShieldedInheritancePanel modules={modules}
          signer={change === "signer" ? { ...signer } as Signer : signer}
          account={change === "account" ? "0x00000000000000000000000000000000000000bb" : address} />);
      }
      expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => finishClear({ credentials, identity, independentKey: null }));
      expect(mocks.credentials).toEqual(credentials);
      expect(mocks.identity).toEqual(identity);
      expect(mocks.independentKey).toBeNull();
      expect(screen.getByText(label("reenterBackup"))).toBeTruthy();
      fireEvent.change(screen.getByLabelText(label("mnemonicInput")), { target: { value: "saved-backup" } });
      importRecovery();
      await waitFor(() => expect(mocks.independentKey?.recoveryVerified).toBe(true));
      expect(mocks.call).toHaveBeenCalledWith("importRecoveryMaterial", expect.objectContaining({
        expectedCredentialsHandle: credentials.handle, expectedFingerprint: independentKey.keyFingerprint,
        material: "saved-backup",
      }));
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
  it("does not let a newly created signature root replace backup verification by re-signing", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "createIndependentKey"
      ? { credentials, identity, independentKey: { ...independentKey, rootSource: "walletSignature", backupRequired: true } }
      : method === "exportRecoveryMaterial" ? {
          material: "saved-signature-wallet-words", format: "mnemonic", version: 1,
          keyFingerprint: independentKey.keyFingerprint,
        }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    await createIndependentKeyForBackup("signature");
    expect(screen.queryByText(label("restoreSignature"))).toBeNull();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: label("savedExternal") })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    fireEvent.click(screen.getByText(label("beginIndependentImport")));
    await waitFor(() => expect(screen.getByLabelText(label("mnemonicInput"))).toBeTruthy());
    expect(screen.queryByRole("radio", { name: label("signatureRestore") })).toBeNull();
    expect(screen.queryByText(label("restoreSignature"))).toBeNull();
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
  });
  it("does not promote a new signature candidate into a trusted original fingerprint", async () => {
    mocks.call.mockImplementation(async (method) => method === "recover" ? emptyWallet
      : method === "clearIndependentKey" ? { credentials, identity: mocks.identity, independentKey: null }
      : { credentials, identity: null, independentKey: { ...independentKey, rootSource: "walletSignature" } });
    await renderUnlockedPanel();
    openIndependentWallet();
    chooseRecoveryPath("signature");
    fireEvent.click(screen.getByText(label("restoreSignature")));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("restoreSignature", expect.anything()));
    await waitFor(() => expect(screen.getByText(label("recoveryCandidate"))).toBeTruthy());
    expect(screen.queryByRole("button", { name: label("exportRecovery") })).toBeNull();
    expect(mocks.call).toHaveBeenCalledWith(
      "restoreSignature",
      expect.objectContaining({
        expectedFingerprint: undefined,
      }),
    );
  });
  it("does not export a independent key backup for an unverified candidate root", async () => {
    mocks.independentKey = { ...independentKey, rootSource: "walletSignature", backupRequired: false };
    await renderUnlockedPanel();
    expect(screen.queryByRole("button", { name: label("showIndependentKeyBackup") })).toBeNull();
    openIndependentKeyManagement();
    expect(within(screen.getByRole("group", { name: label("restorePath") })).getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByText(label("exportRecovery"))).toBeNull();
    expect(mocks.independentKey?.recoveryVerified).toBe(false);
    expect(mocks.call.mock.calls.some(([method]) => method === "exportRecoveryMaterial" || method === "clearIndependentKey")).toBe(false);
  });
  it("clears recovery inputs on path changes and ignores an import cancelled by locking", async () => {
    await renderUnlockedPanel();
    openIndependentWallet();
    const input = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "secret-input" } });
    chooseRecoveryPath("shieldedKey");
    expect(input.value).toBe("");
    const keyInput = screen.getByLabelText(label("shieldedKeyInput")) as HTMLTextAreaElement;
    fireEvent.change(keyInput, { target: { value: "private-independent-key" } });
    // An operation makes the cancellation / lock control available before it settles.
    let finish!: (value: any) => void;
    mocks.call.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    importRecovery();
    expect(keyInput.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey).toBeNull();
    await act(async () => finish({ credentials: mocks.credentials ?? credentials, identity: null, independentKey }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.independentKey).toBeNull();
  });
  it("manual locking clears displayed recovery secrets and destroys the session", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "exportRecoveryMaterial"
      ? {
          material: "secret-root", format: "mnemonic", version: 1,
          keyFingerprint: independentKey.keyFingerprint,
        }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    await createIndependentKeyForBackup();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() => expect(exportedMaterial().textContent).toContain("secret-root"));
    const exported = exportedMaterial();
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(exported.textContent).not.toContain("secret-root");
    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey).toBeNull();
  });
  it("clears displayed secrets when the Worker is terminated outside this panel", async () => {
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation(async (method, params) => method === "exportRecoveryMaterial"
      ? {
          material: "secret-root", format: "mnemonic", version: 1,
          keyFingerprint: independentKey.keyFingerprint,
        }
      : defaultCall?.(method, params));
    await renderUnlockedPanel();
    await createIndependentKeyForBackup();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() => expect(exportedMaterial().textContent).toContain("secret-root"));
    const exported = exportedMaterial();
    act(() => {
      mocks.walletRequestPending = false;
      publishSession({ credentials: null, identity: null, independentKey: null });
      mocks.locked?.();
    });
    expect(exported.textContent).not.toContain("secret-root");
    expect(mocks.identity).toBeNull();
    expect(mocks.independentKey).toBeNull();
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "original-credentials" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitUntilIdle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(label("exportedRecoveryMaterial"))).toBeNull();
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
    expect(screen.getByLabelText("shielded.fields.amount")).toBeTruthy();
    expect(independentKeyButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(label("mnemonicInput"))).toBeNull();
  });
  it("locks and clears recovery inputs when the selected pool changes", async () => {
    const rendered = await renderUnlockedPanel();
    openIndependentWallet();
    const input = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "secret-recovery-input" } });
    rendered.rerender(
      <ShieldedInheritancePanel
        modules={{ ...modules, poolAddress: "0x00000000000000000000000000000000000000bb" }}
        signer={signer}
        account={address}
      />,
    );
    expect(mocks.lock).toHaveBeenCalled();
    expect(input.value).toBe("");
  });
  it.each([
    ["privateTransfer", "1000", "1,000", "0"],
    ["privateTransfer", "2000", "10,000", "8,000"],
    ["unshield", "1000", "1,000", "0"],
    ["unshield", "2000", "10,000", "8,000"],
  ] as const)(
    "reviews the actual inputs and change for %s of %s from nine candidates before proving",
    async (action, amount, inputAmount, change) => {
      const { review } = await startCandidateSpendReview(amount, action);
      const preview = mocks.call.mock.calls.find(([method]) => method === "preview")?.[1];
      expect(preview.candidates).toHaveLength(9);
      expect(within(review).getByText('shielded.spendReview.candidates:{"count":9,"amount":"31,333","symbol":"DEEP"}')).toBeTruthy();
      expect(within(review).getByText(`shielded.spendReview.used:{"count":1,"amount":"${inputAmount}","symbol":"DEEP"}`)).toBeTruthy();
      expect(within(review).getByText(`shielded.spendReview.inputs:{"count":1,"amount":"${inputAmount}","symbol":"DEEP"}`)).toBeTruthy();
      expect(within(review).getAllByText("shielded.valueOption")).toHaveLength(1);
      const changeField = within(review).getByText("shielded.spendReview.change").parentElement!;
      expect(within(changeField).getByText(`${change} DEEP`)).toBeTruthy();
      expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
      expect(mocks.submit).not.toHaveBeenCalled();
      await confirmSpendPreview();
      await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
      expect(mocks.call).toHaveBeenCalledWith("prove", expect.objectContaining({ handle: `spend:${action}:${amount}` }), expect.anything());
      await waitUntilIdle();
    },
  );
  it.each(["privateTransfer", "unshield"] as const)(
    "cancels a %s spend preview without proving or submitting",
    async (action) => {
      await startCandidateSpendReview("1000", action);
      fireEvent.click(screen.getByRole("button", { name: "shielded.spendReview.cancel" }));
      await waitUntilIdle();
      expect(screen.queryByRole("region", { name: "shielded.spendReview.title" })).toBeNull();
      expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.cancel).toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
  it.each([
    ["privateTransfer", "lock"], ["unshield", "lock"],
    ["privateTransfer", "wallet"], ["unshield", "wallet"],
    ["privateTransfer", "pool"], ["unshield", "pool"],
    ["privateTransfer", "amount"], ["unshield", "amount"],
    ["privateTransfer", "unmount"], ["unshield", "unmount"],
  ] as const)(
    "invalidates a waiting %s confirmation when %s changes",
    async (action, invalidation) => {
      const { rendered, amountInput, selectedModules } = await startCandidateSpendReview("1000", action);
      const oldConfirm = screen.getByRole("button", { name: "shielded.spendReview.confirm" });
      if (invalidation === "lock") {
        lockWorkspace();
      } else if (invalidation === "wallet") {
        act(() => {
          mocks.walletGeneration++;
          mocks.walletListeners.forEach((listener) => listener());
        });
      } else if (invalidation === "pool") {
        rendered.rerender(<ShieldedInheritancePanel
          modules={{ ...selectedModules, poolAddress: "0x00000000000000000000000000000000000000bb" }}
          signer={signer} account={address}
        />);
      } else if (invalidation === "amount") {
        // A queued form update must invalidate the approval even though the form is disabled.
        fireEvent.change(amountInput, { target: { value: "2000" } });
      } else {
        rendered.unmount();
      }
      await waitFor(() => expect(screen.queryByRole("region", { name: "shielded.spendReview.title" })).toBeNull());
      fireEvent.click(oldConfirm);
      await act(async () => {});
      expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.cancel).toHaveBeenCalled();
    },
  );
  it("sends the selected candidates only after their spend preview is confirmed", async () => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover"
        ? {
            ...emptyWallet,
            notes: [
              {
                commitment: "11",
                ownerCommitment: "2",
                slot: "identity",
                kind: "value",
                amount: "1000000000000000000",
              },
            ],
          }
        : method === "discover" ? emptyDiscovery : method === "prove"
          ? {
              action: "unshield",
              amount: "500000000000000000",
              recipient: address,
              data: { outputCommitments: [31n, 32n] },
              proof: {},
            }
          : {
              handle: "action:1",
              action: "unshield",
              amount: "500000000000000000",
              slot: "identity",
              inputs: ["11"],
              inputAmounts: ["1000000000000000000"],
              steps: [
                { action: "unshield", inputs: ["11"], outputAmounts: ["500000000000000000", "0"] },
              ],
              outputAmounts: ["500000000000000000", "0"],
              recipient: address,
            },
    );
    mocks.submit.mockResolvedValue(sentTransaction);
    await renderPanel();
    refreshAssets();
    await waitFor(() => expect(cardBalance("identity", "balanceAmount")).toBe("1CFX"));
    expect(navButton("privateTransfer").getAttribute("aria-current")).toBe("true");
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "0.5" } });
    selectValue("11");
    const scans = recoverCount();
    fireEvent.click(screen.getByText(submitLabel));
    await confirmSpendPreview();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.call).toHaveBeenCalledWith(
      "preview",
      expect.objectContaining({ candidates: ["11"], amount: "500000000000000000" }),
      expect.anything(),
    );
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "500000000000000000", recipient: address }),
    );
    // The wallet shows its own fee after the spend preview is confirmed.
    expect(mocks.submit.mock.calls[0][0].onGasEstimate).toBeUndefined();
    await waitFor(() => expect(recoverCount()).toBeGreaterThan(scans));
    await waitUntilIdle();
    chooseAction("claim");
    chooseAction("privateTransfer");
    expect(navButton("privateTransfer").getAttribute("aria-current")).toBe("true");
  });
  it.each([
    ["privateTransfer", "no session change"],
    ["unshield", "no session change"],
    ["privateTransfer", "lock and new session"],
    ["unshield", "lock and new session"],
    ["privateTransfer", "panel unmount"],
    ["unshield", "panel unmount"],
  ] as const)(
    "handles %s consolidation when the receipt completes after %s",
    async (action, sessionChange) => {
      const commitments = Array.from({ length: 9 }, (_, index) => String(index + 11));
      mocks.verify.mockResolvedValue({ personHash: identity.personHash, keyMode: 0, fingerprint: "recipient-fingerprint" });
      let previews = 0;
      mocks.call.mockImplementation(async (method, params) => {
        if (method === "recover") return {
          ...emptyWallet,
          notes: commitments.map((commitment) => ({
            commitment, ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000",
          })),
        };
        if (method === "prove") return previews === 1
          ? { action: "privateTransfer", data: { outputCommitments: [200n, 201n] }, proof: {} }
          : { action, amount: "8500000000000000000", recipient: address, data: { outputCommitments: [300n, 301n] }, proof: {} };
        previews++;
        const payment = { action, inputs: [previews === 1 ? "planned:0:0" : "200", commitments[8]], outputAmounts: ["8500000000000000000", "500000000000000000"] };
        return previews === 1 ? {
          handle: "plan:merge", action: "privateTransfer", amount: params.amount, slot: params.slot,
          inputs: commitments.slice(0, 8),
          inputAmounts: commitments.slice(0, 8).map(() => "1000000000000000000"),
          outputAmounts: ["8000000000000000000", "0"],
          steps: [
            { action: "privateTransfer", inputs: commitments.slice(0, 8), outputAmounts: ["8000000000000000000", "0"] },
            payment,
          ],
        } : {
          handle: "plan:payment", action, amount: params.amount, slot: params.slot,
          inputs: payment.inputs,
          inputAmounts: ["8000000000000000000", "1000000000000000000"],
          outputAmounts: payment.outputAmounts,
          steps: [payment],
        };
      });
      let releaseFirst!: () => void;
      mocks.submit
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return sentTransaction;
        })
        .mockResolvedValue(sentTransaction);
      const rendered = await renderUnlockedPanel();
      chooseAction(action);
      fireEvent.change(screen.getByLabelText(action === "privateTransfer" ? "shielded.fields.transferAmount" : "shielded.fields.amount"), { target: { value: "8.5" } });
      for (const commitment of commitments) selectValue(commitment);
      expect(screen.getAllByRole("checkbox", { name: "shielded.valueOption" })).toHaveLength(9);
      expect(screen.getAllByRole("checkbox", { name: "shielded.valueOption" }).every((input) => (input as HTMLInputElement).checked)).toBe(true);
      expect(screen.getByText(label("valueCandidatesHint"))).toBeTruthy();
      if (action === "privateTransfer") {
        fireEvent.change(screen.getByLabelText("shielded.receiveCodeInputLabel"), { target: { value: "recipient-code" } });
        await waitFor(() => expect(mocks.verify).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
      } else {
        fireEvent.change(screen.getByLabelText("shielded.fields.exitRecipient"), { target: { value: address } });
      }
      expect(mocks.call.mock.calls.some(([method]) => method === "preview")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      const mergeReview = await screen.findByRole("region", { name: "shielded.spendReview.title" });
      expect(within(mergeReview).getByText('shielded.spendReview.inputs:{"count":8,"amount":"8","symbol":"CFX"}')).toBeTruthy();
      expect(within(mergeReview).getByText('shielded.spendReview.transactions:{"count":2}')).toBeTruthy();
      await confirmSpendPreview();
      await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
      // The transaction count remains visible while the first step runs.
      expect(screen.getByText(label("planTransactions"))).toBeTruthy();
      if (sessionChange === "lock and new session") {
        lockWorkspace();
        await act(async () => {
          publishSession({ credentials: mocks.credentials ?? credentials, identity: { ...identity, handle: "identity:2" }, independentKey: null });
        });
      } else if (sessionChange === "panel unmount") {
        rendered.unmount();
      }
      await act(async () => releaseFirst());
      if (sessionChange !== "no session change") {
        // A late receipt must not dispatch into the current shared Worker.
        expect(mocks.call.mock.calls.filter(([method]) => method === "preview")).toHaveLength(1);
        expect(mocks.call.mock.calls.filter(([method]) => method === "prove")).toHaveLength(1);
        expect(mocks.submit).toHaveBeenCalledTimes(1);
        return;
      }
      await screen.findByRole("button", { name: "shielded.spendReview.confirm" });
      const paymentReview = screen.getByRole("region", { name: "shielded.spendReview.title" });
      expect(within(paymentReview).getByText('shielded.spendReview.candidates:{"count":2,"amount":"9","symbol":"CFX"}')).toBeTruthy();
      expect(within(paymentReview).getByText('shielded.spendReview.inputs:{"count":2,"amount":"9","symbol":"CFX"}')).toBeTruthy();
      // The confirmed merge stays listed, with its hash, above the rebuilt remainder of the plan.
      expect(within(paymentReview).getByText('shielded.spendReview.transactions:{"count":2}')).toBeTruthy();
      expect(within(paymentReview).getByText('shielded.spendReview.inputs:{"count":8,"amount":"8","symbol":"CFX"}')).toBeTruthy();
      expect(within(paymentReview).getByText("transaction.success")).toBeTruthy();
      expect(within(paymentReview).getByTitle(sentTransaction.transactionHash)).toBeTruthy();
      expect(mocks.submit).toHaveBeenCalledTimes(1);
      expect(mocks.call.mock.calls.filter(([method]) => method === "prove")).toHaveLength(1);
      const previews_ = mocks.call.mock.calls.filter(([method]) => method === "preview");
      expect(previews_).toHaveLength(2);
      expect(previews_[0][1]).toMatchObject({ action, amount: "8500000000000000000", candidates: commitments });
      // The consolidated output replaces its inputs; its zero-value change is not a candidate.
      expect(previews_[1][1]).toMatchObject({ action, candidates: [commitments[8], "200"] });
      await confirmSpendPreview();
      await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
      await waitUntilIdle();
      expect(screen.queryByText(label("planTransactions"))).toBeNull();
    },
  );
  it("synchronizes a signature candidate verified by recovered history", async () => {
    mocks.independentKey = { ...independentKey, rootSource: "walletSignature" };
    const recovered = { credentials, identity, independentKey: { ...mocks.independentKey, recoveryVerified: true } };
    mocks.call.mockResolvedValue({ ...emptyWallet, sessionState: recovered });
    await renderUnlockedPanel();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(recovered));
    expect(mocks.independentKey?.recoveryVerified).toBe(true);
  });
  it("retains the same new funding policy through a preparatory merge", async () => {
    mocks.identity = identity;
    let previews = 0;
    mocks.call.mockImplementation(async (method) => {
      if (method === "recover") return {
        ...emptyWallet,
        parentVersions: [0],
        children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
        notes: [
          { commitment: "11", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" },
          { commitment: "12", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" },
        ],
      };
      if (method === "prove") return {
        action: previews === 1 ? "privateTransfer" : "fund",
        data: { outputCommitments: [21n, 22n] },
        proof: {},
      };
      previews++;
      const fund = { action: "fund", inputs: ["21"], outputAmounts: ["1000000000000000000", "1000000000000000000"] };
      return {
        handle: `fund:${previews}`,
        policyHandle: "policy:1",
        action: previews === 1 ? "privateTransfer" : "fund",
        amount: "1000000000000000000",
        slot: "identity",
        inputs: previews === 1 ? ["11", "12"] : fund.inputs,
        inputAmounts: [],
        outputAmounts: previews === 1 ? ["2000000000000000000", "0"] : fund.outputAmounts,
        steps: previews === 1
          ? [{ action: "privateTransfer", inputs: ["11", "12"], outputAmounts: ["2000000000000000000", "0"] }, fund]
          : [fund],
      };
    });
    mocks.submit.mockResolvedValue(sentTransaction);
    await renderPanel();
    chooseAction("fund");
    chooseFundingEntry("public");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    const scans = recoverCount();
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    const sentPreviews = mocks.call.mock.calls.filter(([method]) => method === "preview");
    expect(sentPreviews[0][1]).toMatchObject({ policyHandle: undefined, candidates: ["11", "12"] });
    expect(sentPreviews[1][1]).toMatchObject({ policyHandle: "policy:1", candidates: ["21"] });
    await waitFor(() => expect(recoverCount()).toBeGreaterThan(scans));
    await waitUntilIdle();
    // Leaving the task discards the draft policy.
    chooseAction("shield");
    chooseAction("fund");
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() =>
      expect(mocks.call.mock.calls.filter(([method]) => method === "preview")).toHaveLength(3),
    );
    expect(mocks.call.mock.calls.filter(([method]) => method === "preview")[2][1]).toMatchObject({
      policyHandle: undefined,
    });
  });
  it.each(["create", "restore"] as const)("drops the Worker's cleared funding policy after cancelling a %s signature", async (flow) => {
    const defaultCall = mocks.call.getMockImplementation();
    const fundStep = { action: "fund", inputs: ["11"], outputAmounts: ["1000000000000000000", "0"] };
    mocks.call.mockImplementation(async (method, params) => {
      if (method === "recover") return {
        ...emptyWallet,
        parentVersions: [0],
        children: [{ personHash: identity.personHash, rootVersionIndex: 0, eligible: true }],
        notes: [{ commitment: "11", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" }],
      };
      if (method === "preview") return {
        handle: "fund:preview", policyHandle: "policy:cleared-by-key-lock", action: "fund", slot: "identity",
        amount: "1000000000000000000", inputs: fundStep.inputs, inputAmounts: ["1000000000000000000"],
        outputAmounts: fundStep.outputAmounts, steps: [fundStep],
      };
      if (method === "prove") throw new Error("Proof failed before submission");
      return defaultCall?.(method, params);
    });
    await renderUnlockedPanel();
    chooseAction("fund");
    chooseFundingEntry("public");
    chooseOption("shielded.fields.familyVersion", "shielded.fundingVersionOption:0");
    chooseHeir(identity.personHash);
    fireEvent.change(screen.getByLabelText("shielded.fields.rate"), { target: { value: "1" } });
    const task = taskPanel();
    const rate = screen.getByLabelText("shielded.fields.rate") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Proof failed before submission"));
    await waitUntilIdle();
    expect(mocks.call.mock.calls.filter(([method]) => method === "preview")).toHaveLength(1);
    expect(mocks.independentKey).toBeNull();
    vi.mocked(signer.signMessage).mockRejectedValueOnce(new Error("Signature cancelled"));

    openIndependentKeyManagement(flow);
    if (flow === "create") fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    else {
      chooseRecoveryPath("signature");
      fireEvent.click(screen.getByRole("button", { name: label("restoreSignature") }));
    }
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Signature cancelled"));
    await waitUntilIdle();
    expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {});
    expect(mocks.independentKey).toBeNull();
    closeWalletSheet();
    await waitUntilIdle();
    expect(taskPanel()).toBe(task);
    expect(screen.getByLabelText("shielded.fields.rate")).toBe(rate);
    expect(rate.value).toBe("1");
    expect(selectTrigger("shielded.fields.familyVersion").textContent).toBe("shielded.fundingVersionOption:0");
    expect(heirChoice(identity.personHash).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: submitLabel }));

    await waitFor(() => expect(mocks.call.mock.calls.filter(([method]) => method === "preview")).toHaveLength(2));
    const previews = mocks.call.mock.calls.filter(([method]) => method === "preview");
    expect(previews[0][1]).toMatchObject({ action: "fund", policyHandle: undefined });
    expect(previews[1][1]).toMatchObject({ action: "fund", policyHandle: undefined });
    expect(mocks.identity).toEqual(identity);
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey" || method === "restoreSignature")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("preserves the credentials during a wallet jump and accepts a current visible return", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => resolve("late-secret"));
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.credentials).toEqual(credentials);
    expect(mocks.call).toHaveBeenCalledWith(
      "createIndependentKey",
      expect.objectContaining({
        rootSource: "walletSignature",
        signerAddress: getAddress(address),
        signature: "late-secret",
      }),
    );
    expect(mocks.update).toHaveBeenCalled();
  });
  it("discards a wallet signature delivered while the page is still hidden", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => resolve("hidden-secret"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
    expect(mocks.update.mock.calls.some(([state]) => state.independentKey !== null)).toBe(false);
  });
  it.each(["clearing", "signing", "deriving"] as const)(
    "rejects an old same-address connection result during %s",
    async (stage) => {
      let finishClear!: (state: any) => void;
      let finishSignature!: (signature: string) => void;
      let finishDerivation!: (state: any) => void;
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation((method, params) => {
        if (stage === "clearing" && method === "clearIndependentKey")
          return new Promise((resolve) => { finishClear = resolve; });
        if (stage === "deriving" && method === "createIndependentKey")
          return new Promise((resolve) => { finishDerivation = resolve; });
        return defaultCall?.(method, params);
      });
      (signer.signMessage as any).mockImplementation(() => new Promise((resolve) => { finishSignature = resolve; }));
      const rendered = await renderUnlockedPanel();
      openCreateWallet();
      fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
      if (stage === "clearing") {
        await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("clearIndependentKey", {}));
      } else {
        await waitFor(() => expect(signer.signMessage).toHaveBeenCalledOnce());
        if (stage === "deriving") {
          await act(async () => finishSignature("old-connection-signature"));
          await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("createIndependentKey",
            expect.objectContaining({ expectedCredentialsHandle: credentials.handle })));
        }
      }
      const replacementSigner = { ...signer } as unknown as Signer;
      rendered.rerender(<ShieldedInheritancePanel modules={modules} signer={replacementSigner}
        account={address} />);
      expect(mocks.lock).toHaveBeenCalledOnce();
      await act(async () => {
        if (stage === "clearing") finishClear({ credentials, identity, independentKey: null });
        else if (stage === "signing") finishSignature("old-connection-signature");
        else finishDerivation({ credentials, identity, independentKey: { ...independentKey, backupRequired: true } });
      });
      expect(mocks.credentials).toBeNull();
      expect(mocks.independentKey).toBeNull();
      expect(mocks.update.mock.calls.some(([state]) => state.independentKey !== null)).toBe(false);
      if (stage === "clearing") expect(signer.signMessage).not.toHaveBeenCalled();
      if (stage === "signing") expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    },
  );
  it.each(["account", "chain", "factory", "family", "lineage", "pool"] as const)(
    "discards a pending signature after the %s context changes",
    async (change) => {
      let finish!: (signature: string) => void;
      (signer.signMessage as any).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const rendered = await renderUnlockedPanel();
      openCreateWallet();
      fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
      await waitFor(() => expect(signer.signMessage).toHaveBeenCalledOnce());
      const otherAddress = "0x00000000000000000000000000000000000000bb";
      const changedModules = {
        ...modules,
        ...(change === "chain" ? { chainId: 1n } : {}),
        ...(change === "factory" ? { factory: { target: otherAddress } } : {}),
        ...(change === "family" ? { deepFamily: { target: otherAddress } } : {}),
        ...(change === "lineage" ? { lineageIndex: { target: otherAddress } } : {}),
        ...(change === "pool" ? { poolAddress: otherAddress } : {}),
      } as ShieldedPageModules;
      rendered.rerender(<ShieldedInheritancePanel modules={changedModules} signer={signer}
        account={change === "account" ? otherAddress : address} />);
      await act(async () => finish("obsolete-context-signature"));
      expect(mocks.lock).toHaveBeenCalled();
      expect(mocks.credentials).toBeNull();
      expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
      expect(mocks.update.mock.calls.some(([state]) => state.independentKey !== null)).toBe(false);
    },
  );
  it.each(["accountsChanged", "chainChanged", "disconnect"] as const)(
    "invalidates a pending signature on %s before React receives a new signer",
    async () => {
      let finish!: (signature: string) => void;
      (signer.signMessage as any).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      await renderUnlockedPanel();
      openCreateWallet();
      fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
      await waitFor(() => expect(signer.signMessage).toHaveBeenCalledOnce());
      act(() => {
        mocks.walletGeneration++;
        mocks.walletListeners.forEach((listener) => listener());
      });
      expect(mocks.lock).toHaveBeenCalledOnce();
      await act(async () => finish("provider-event-obsolete-signature"));
      expect(mocks.credentials).toBeNull();
      expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    },
  );
  it("discards an old signature after locking and unlocking a new credentials session", async () => {
    let finish!: (signature: string) => void;
    (signer.signMessage as any).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await renderUnlockedPanel();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalledOnce());
    lockWorkspace();
    const newCredentials = { handle: "credentials:2" };
    mocks.call.mockImplementation(async (method) => method === "unlockIdentity"
      ? { credentials: newCredentials, identity: { ...identity, handle: "identity:2" }, independentKey: null }
      : method === "recover" ? emptyWallet : emptyDiscovery);
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "new-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitUntilIdle();
    await act(async () => finish("old-credentials-signature"));
    expect(mocks.credentials).toEqual(newCredentials);
    expect(mocks.independentKey).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
  });
  it("expires the wallet request and rejects a signature after a later unlock", async () => {
    let finish!: (signature: string) => void;
    (signer.signMessage as any).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await renderUnlockedPanel();
    openCreateWallet();
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: label("signatureSource") }));
      });
      expect(signer.signMessage).toHaveBeenCalledOnce();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
      expect(mocks.lock).toHaveBeenCalled();
      expect(mocks.walletRequestPending).toBe(false);
      const newCredentials = { handle: "credentials:after-timeout" };
      await act(async () => publishSession({ credentials: newCredentials, identity, independentKey: null }));
      await act(async () => finish("expired-signature"));
      expect(mocks.credentials).toEqual(newCredentials);
      expect(mocks.independentKey).toBeNull();
      expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    {},
    { code: "INSUFFICIENT_FUNDS" },
    { code: "CALL_EXCEPTION", action: "estimateGas" },
  ])("follows a broadcast transaction after locking even when its response fails: %j", async (failure) => {
    mocks.identity = identity;
    const upsert = vi.fn();
    mocks.center = { records: [], upsert };
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover" ? emptyWallet : method === "prove"
        ? { action: "shield", amount: "1", data: {}, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    let feeReview: unknown = "unset";
    mocks.submit.mockImplementation(async (params: any) => {
      feeReview = params.onGasEstimate;
      params.onBroadcast("0xpending");
      throw Object.assign(new Error("connection lost after broadcast"), failure);
    });
    let finishReceipt!: (receipt: unknown) => void;
    mocks.receipt.mockImplementation(() => new Promise((resolve) => { finishReceipt = resolve; }));
    await renderPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xpending"));
    expect(feeReview).toBeUndefined();
    expect(screen.getByText(/transaction\.pending$/)).toBeTruthy();
    await act(async () => lockWorkspace());
    const scansAfterLock = recoverCount();
    await act(async () => finishReceipt({ status: 1 }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      phase: "done", transactionHash: "0xpending",
    })));
    expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();
    expect(screen.queryByText(/0xpending/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(recoverCount()).toBe(scansAfterLock);
    expect(mocks.identity).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "unlockIdentity")).toBe(false);
  });
  it("refreshes balances automatically after a successful transaction", async () => {
    mocks.identity = identity;
    let received = false;
    mocks.call.mockImplementation(async (method: string) => {
      if (method === "recover") return {
        ...emptyWallet,
        notes: received ? [{ commitment: "100", ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" }] : [],
      };
      if (method === "prove") return {
        action: "shield", amount: "1000000000000000000",
        data: { outputCommitments: [100n, 101n] }, proof: {},
      };
      return {
        handle: "shield-preview", action: "shield", amount: "1000000000000000000", slot: "identity",
        steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1000000000000000000", "0"],
      };
    });
    mocks.submit.mockImplementation(async (params: any) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      params.onBroadcast("0xsuccess");
      received = true;
      return { transactionHash: "0xsuccess", receipt: { status: 1 } };
    });
    await renderPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(cardBalance("identity", "balanceAmount")).toBe("1CFX"));
    expect(mocks.call.mock.calls.filter(([method]) => method === "recover")).toHaveLength(2);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.identity).toEqual(identity);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("changing the gas wallet stops an unsent submission without replacing the independent key root", async () => {
    mocks.identity = identity;
    mocks.independentKey = { ...independentKey, recoveryVerified: true };
    let finish!: (value: unknown) => void;
    mocks.call.mockImplementation(async (method) => {
      if (method === "recover") return emptyWallet;
      if (method === "prove") return await new Promise((resolve) => { finish = resolve; });
      return {
        handle: "action:1",
        action: "shield",
        amount: "1",
        slot: "identity",
        steps: [],
        inputs: [],
        inputAmounts: [],
        outputAmounts: ["1", "0"],
      };
    });
    const rendered = await renderPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() => expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(true));
    rendered.rerender(
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account="0x00000000000000000000000000000000000000bb"
      />,
    );
    await act(async () =>
      finish({ action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.some(([method]) => method === "createIndependentKey")).toBe(false);
  });
  it.each(["preview", "prove"] as const)(
    "cancels %s on a connection event and preserves a newer local key operation",
    async (method) => {
      let finishOld!: (value: unknown) => void;
      let finishIndependentKey!: (value: unknown) => void;
      const preview = { handle: "action:1", action: "shield", amount: "1", slot: "identity",
        steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1", "0"] };
      const proof = { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} };
      const defaultCall = mocks.call.getMockImplementation();
      mocks.call.mockImplementation((calledMethod, params) => {
        if (calledMethod === method) return new Promise((resolve) => { finishOld = resolve; });
        if (calledMethod === "createIndependentKey") return new Promise((resolve) => { finishIndependentKey = resolve; });
        if (calledMethod === "preview") return Promise.resolve(preview);
        return defaultCall?.(calledMethod, params);
      });
      await renderUnlockedPanel();
      fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(mocks.call.mock.calls.some(([calledMethod]) => calledMethod === method)).toBe(true));
      act(() => {
        mocks.walletGeneration++;
        mocks.walletListeners.forEach((listener) => listener());
      });
      await waitUntilIdle();
      openCreateWallet();
      fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
      await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("createIndependentKey", expect.anything()));
      await act(async () => finishOld(method === "preview" ? preview : proof));
      expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.submit).not.toHaveBeenCalled();
      await act(async () => finishIndependentKey({ credentials, identity, independentKey: { ...independentKey, backupRequired: true } }));
      expect(mocks.independentKey?.backupRequired).toBe(true);
      expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
  it.each(["preview", "prove"] as const)(
    "discards an outdated %s result when the amount changes before completion",
    async (phase) => {
      mocks.identity = identity;
      let finish!: (value: any) => void;
      const prepared = {
        handle: "shield-preview", action: "shield", amount: "1000000000000000000", slot: "identity",
        steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1000000000000000000", "0"],
      };
      const proven = {
        action: "shield", amount: "1000000000000000000",
        data: { outputCommitments: [100n, 101n] }, proof: {},
      };
      mocks.call.mockImplementation(async (method: string) => {
        if (method === "recover") return emptyWallet;
        if (method === phase) return await new Promise((resolve) => { finish = resolve; });
        return method === "preview" ? prepared : proven;
      });
      await renderPanel();
      const amount = screen.getByLabelText("shielded.fields.amount") as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(mocks.call.mock.calls.some(([method]) => method === phase)).toBe(true));
      expect(amount.disabled).toBe(true);
      // Simulate a queued form update while the Worker result is still in flight.
      fireEvent.change(amount, { target: { value: "2" } });
      await act(async () => finish(phase === "preview" ? prepared : proven));
      await waitFor(() => expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(false));
      expect(mocks.submit).not.toHaveBeenCalled();
      if (phase === "preview") {
        expect(mocks.call.mock.calls.some(([method]) => method === "prove")).toBe(false);
      }
    },
  );
  it.each([1, 0])("reconciles an unknown submission after locking with receipt status %i without showing feedback", async (status) => {
    mocks.identity = identity;
    const upsert = vi.fn();
    mocks.center = { records: [], upsert };
    const queryFilter = vi.fn(async () => [
      { args: { commitment: 100n }, transactionHash: "0xfound" },
      { args: { commitment: 101n }, transactionHash: "0xfound" },
    ]);
    const noteFilter = vi.fn(() => "unfiltered-notes");
    const selectedModules = {
      ...modules,
      pool: { queryFilter, filters: { NoteAppended: noteFilter } },
    } as unknown as ShieldedPageModules;
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover" ? emptyWallet : method === "prove"
        ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    mocks.submit.mockImplementation(async (params: any) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      throw new Error("submission response lost");
    });
    let finishReceipt!: (receipt: unknown) => void;
    mocks.receipt.mockImplementation(() => new Promise((resolve) => { finishReceipt = resolve; }));
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xfound"));
    expect(screen.getByText(/transaction\.pending$/)).toBeTruthy();
    expect((screen.getByText(submitLabel) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => lockWorkspace());
    await act(async () => finishReceipt({ status }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      phase: status === 1 ? "done" : "failed", transactionHash: "0xfound",
    })));
    expect(screen.queryByText(/transaction\.(pending|success|failed)$/)).toBeNull();
    expect(screen.queryByText(/0xfound/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(queryFilter).toHaveBeenCalledWith("unfiltered-notes", 30, 40);
    expect(noteFilter).toHaveBeenCalledWith();
    expect(mocks.receipt).toHaveBeenCalledWith("0xfound");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ code: "ACTION_REJECTED" }, "USER_REJECTED"],
    [{ code: 4001 }, "USER_REJECTED"],
    [{ code: "INSUFFICIENT_FUNDS" }, "INSUFFICIENT_FUNDS"],
    [{ code: "CALL_EXCEPTION", action: "estimateGas" }, "CALL_EXCEPTION"],
    [{
      code: "ACTION_REJECTED",
      action: "sendTransaction",
      reason: "rejected",
      info: { error: { code: 4001 }, payload: { method: "eth_sendTransaction" } },
    }, "USER_REJECTED"],
  ] as const)("releases the pending guard for a definite unsubmitted failure: %j", async (failure, expectedReason) => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover" ? emptyWallet : method === "prove"
        ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    mocks.submit.mockImplementation(async (params: any) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      throw Object.assign(new Error("wallet request failed"), failure);
    });
    await renderPanel();
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByText(submitLabel));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(
      `errors.contractError.${expectedReason}`,
    ));
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect((screen.getByText(submitLabel) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it.each([
    [{ code: "INSUFFICIENT_FUNDS" }, "INSUFFICIENT_FUNDS"],
    [{ code: "CALL_EXCEPTION", action: "estimateGas" }, "CALL_EXCEPTION"],
    [{
      code: "ACTION_REJECTED",
      action: "sendTransaction",
      reason: "rejected",
      info: { error: { code: 4001 }, payload: { method: "eth_sendTransaction" } },
    }, "USER_REJECTED"],
  ] as const)("allows an ERC20 approval to retry after a pre-broadcast failure: %j", async (failure, expectedReason) => {
    mocks.identity = identity;
    let approved = false;
    const approve = vi.fn(async () => ({
      hash: "0xapproval",
      wait: async () => {
        approved = true;
        return { status: 1 };
      },
    })).mockRejectedValueOnce(Object.assign(new Error("approval failed before broadcast"), failure));
    const records: Array<{ id: string; phase: string }> = [];
    mocks.center = {
      records,
      upsert: vi.fn((next) => {
        const existing = records.find((record) => record.id === next.id);
        if (existing) Object.assign(existing, next);
        else records.push(next);
      }),
    };
    const selectedModules = {
      ...modules,
      assetKind: "erc20",
      token: {
        allowance: vi.fn(async () => approved ? 1000000000000000000n : 0n),
        balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n),
        connect: vi.fn(() => ({ approve })),
      },
      pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(await screen.findByRole("button", { name: label("approve") }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(
      `errors.contractError.${expectedReason}`,
    ));
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect(records.every((record) => record.phase === "failed")).toBe(true);
    expect((screen.getByRole("button", { name: label("approve") }) as HTMLButtonElement).disabled).toBe(false);
    expect(approve).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: label("approve") }));
    await waitFor(() => expect(screen.getByRole("button", { name: submitLabel })).toBeTruthy());
    expect(approve).toHaveBeenCalledTimes(2);
    expect(records.some((record) => record.phase === "busy")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("cancels an approval nonce lookup on a connection event and keeps a newer local key operation busy", async () => {
    let finishNonce!: (nonce: number) => void;
    let finishIndependentKey!: (state: any) => void;
    const provider = {
      ...signer.provider!,
      getTransactionCount: vi.fn(() => new Promise<number>((resolve) => { finishNonce = resolve; })),
    };
    const signingWallet = { ...signer, provider } as unknown as Signer;
    const approve = vi.fn();
    const selectedModules = {
      ...modules, assetKind: "erc20",
      token: {
        allowance: vi.fn(async () => 0n),
        balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n),
        connect: vi.fn(() => ({ approve })),
      },
      pool: { runner: { provider } },
    } as unknown as ShieldedPageModules;
    const defaultCall = mocks.call.getMockImplementation();
    mocks.call.mockImplementation((method, params) => method === "createIndependentKey"
      ? new Promise((resolve) => { finishIndependentKey = resolve; })
      : defaultCall?.(method, params));
    await renderUnlockedPanel(signingWallet, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(await screen.findByRole("button", { name: label("approve") }));
    await waitFor(() => expect(provider.getTransactionCount).toHaveBeenCalled());
    act(() => {
      mocks.walletGeneration++;
      mocks.walletListeners.forEach((listener) => listener());
    });
    await waitUntilIdle();
    openCreateWallet();
    fireEvent.click(screen.getByRole("radio", { name: label("randomSource") }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("createIndependentKey", expect.anything()));
    await act(async () => finishNonce(7));
    expect(approve).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishIndependentKey({ credentials, identity, independentKey: { ...independentKey, backupRequired: true } }));
    expect(mocks.independentKey?.backupRequired).toBe(true);
    expect(screen.getByRole("button", { name: label("exportRecovery") })).toBeTruthy();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps the new account's approval requirement when the old account's receipt readback finishes late", async () => {
    mocks.identity = identity;
    let approved = false;
    let finishAllowance!: (value: bigint) => void;
    const allowance = vi.fn((owner: string) => owner.toLowerCase() === address && approved
      ? new Promise<bigint>((resolve) => { finishAllowance = resolve; })
      : Promise.resolve(0n));
    const approve = vi.fn(async () => ({
      hash: "0xapproval",
      wait: async () => {
        approved = true;
        return { status: 1 };
      },
    }));
    const selectedModules = {
      ...modules, assetKind: "erc20",
      token: { allowance, balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n), connect: vi.fn(() => ({ approve })) },
      pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    const rendered = await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(await screen.findByRole("button", { name: label("approve") }));
    await waitFor(() => expect(finishAllowance).toBeTypeOf("function"));
    const nextAddress = "0x00000000000000000000000000000000000000bb";
    const nextSigner = { ...signer, getAddress: vi.fn(async () => nextAddress) } as unknown as Signer;
    rendered.rerender(<ShieldedInheritancePanel modules={selectedModules}
      signer={nextSigner} account={nextAddress} />);
    await waitFor(() => expect(allowance).toHaveBeenCalledWith(nextAddress, modules.poolAddress));
    await waitFor(() => expect((screen.getByRole("button", { name: label("approve") }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => finishAllowance(1000000000000000000n));
    expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it.each([
    [{ code: "NETWORK_ERROR" }, "errors.contractError.NETWORK_ERROR"],
    [{ code: "UNKNOWN_ERROR" }, "broadcast status unresolved"],
    [{ code: "CALL_EXCEPTION", action: "sendTransaction" }, "errors.contractError.CALL_EXCEPTION"],
    [{ code: "INSUFFICIENT_FUNDS", info: { sendTransactionHash: "0xbroadcast" } }, "errors.contractError.INSUFFICIENT_FUNDS"],
    [{ code: "CALL_EXCEPTION", action: "estimateGas", receipt: { hash: "0xbroadcast" } }, "errors.contractError.CALL_EXCEPTION"],
    [{ code: "ACTION_REJECTED", reason: "rejected", info: { sendTransactionHash: "0xbroadcast" } }, "errors.contractError.USER_REJECTED"],
    [{ code: "ACTION_REJECTED", reason: "rejected", receipt: { hash: "0xbroadcast" } }, "errors.contractError.USER_REJECTED"],
  ] as const)("keeps tracking a request with uncertain or known broadcast status: %j", async (failure, expectedMessage) => {
    mocks.identity = identity;
    const selectedModules = {
      ...modules,
      pool: { queryFilter: vi.fn(async () => []), filters: { NoteAppended: () => "all-notes" } },
    } as unknown as ShieldedPageModules;
    mocks.call.mockImplementation(async (method: string) => method === "recover" ? emptyWallet : method === "prove"
      ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
      : { handle: "action:1", steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1", "0"] });
    mocks.submit.mockImplementation(async (params) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      throw Object.assign(new Error("broadcast status unresolved"), failure);
    });
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(expectedMessage));
    expect(screen.getByText(/transaction\.pending$/)).toBeTruthy();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("automatically resumes public submission tracking after navigating back to the pool", async () => {
    mocks.identity = identity;
    const record = {
      id: "old-action",
      kind: "shielded",
      label: "CFX",
      phase: "busy",
      transactionHash: "0xold",
      shieldedSubmission: {
        chainId: "31337",
        poolAddress: address,
        kind: "action",
        nonce: 7,
        fromBlock: 30,
        signerAddress: address,
        outputCommitments: ["100", "101"],
      },
    };
    mocks.center = { records: [record], upsert: vi.fn((next: any) => Object.assign(record, next)) };
    let finishReceipt!: (receipt: unknown) => void;
    mocks.receipt.mockImplementation(() => new Promise((resolve) => { finishReceipt = resolve; }));
    const selectedModules = {
      ...modules,
      pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xold"));
    expect((screen.getByText(submitLabel) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishReceipt({ status: 1 }));
    await waitFor(() => expect(screen.getByText(/transaction\.success$/)).toBeTruthy());
    expect(mocks.call.mock.calls.filter(([method]) => method !== "recover" && method !== "clearIndependentKey")).toHaveLength(0);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(record.phase).toBe("done");
  });
  it("recovers a known hash's successful replacement and releases the pool's pending guard", async () => {
    mocks.identity = identity;
    const record = restorePendingSubmission();
    const queryFilter = vi.fn(async () => [
      { args: { commitment: 100n }, transactionHash: "0xreplacement" },
      { args: { commitment: 101n }, transactionHash: "0xreplacement" },
    ]);
    const noteFilter = vi.fn(() => "unfiltered-notes");
    let finishReceipt!: (receipt: unknown) => void;
    mocks.receipt.mockImplementation(async (hash: string) => hash === "0xold"
      ? null
      : new Promise((resolve) => { finishReceipt = resolve; }));
    const selectedModules = {
      ...modules,
      pool: { runner: { provider: signer.provider }, queryFilter, filters: { NoteAppended: noteFilter } },
    } as unknown as ShieldedPageModules;

    await renderPanel(signer, selectedModules);
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xreplacement"));
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishReceipt({ status: 1 }));

    await waitFor(() => expect(screen.getByText(/0xreplacement.*transaction\.success$/)).toBeTruthy());
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false);
    expect(record.phase).toBe("done");
    expect(record.transactionHash).toBe("0xreplacement");
    expect(noteFilter).toHaveBeenCalledWith();
    expect(queryFilter).toHaveBeenCalledWith("unfiltered-notes", 30, 40);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("releases a known cancelled transaction's pending guard after its nonce is consumed", async () => {
    mocks.identity = identity;
    const record = restorePendingSubmission();
    const queryFilter = vi.fn(async () => []);
    const noteFilter = vi.fn(() => "unfiltered-notes");
    let finishNonce!: (nonce: number) => void;
    (signer.provider!.getTransactionCount as any).mockImplementation(
      () => new Promise((resolve) => { finishNonce = resolve; }),
    );
    const selectedModules = {
      ...modules,
      pool: { runner: { provider: signer.provider }, queryFilter, filters: { NoteAppended: noteFilter } },
    } as unknown as ShieldedPageModules;

    await renderPanel(signer, selectedModules);
    await waitFor(() => expect(signer.provider!.getTransactionCount).toHaveBeenCalledWith(address, 40));
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishNonce(8));

    await waitFor(() => expect(screen.getByText(/transaction\.failed$/)).toBeTruthy());
    expect(screen.getByText(label("nonceConsumed"))).toBeTruthy();
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false);
    expect(record.phase).toBe("failed");
    expect(queryFilter).toHaveBeenCalledWith("unfiltered-notes", 30, 40);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("retries a missing receipt and an RPC error every five seconds", async () => {
    const record = restorePendingSubmission();
    mocks.receipt.mockResolvedValue(null);
    const selectedModules = {
      ...modules, pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    vi.useFakeTimers();
    try {
      await act(async () => {
        render(<ShieldedInheritancePanel modules={selectedModules} signer={signer}
          account={address} />);
      });
      const initialReads = mocks.receipt.mock.calls.length;
      expect(initialReads).toBeGreaterThan(0);
      mocks.receipt.mockRejectedValueOnce(new Error("RPC temporarily unavailable"))
        .mockResolvedValueOnce({ status: 1 });
      expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
      expect(record.phase).toBe("busy");
      await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
      expect(mocks.receipt).toHaveBeenCalledTimes(initialReads);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(mocks.receipt).toHaveBeenCalledTimes(initialReads + 1);
      expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(record.phase).toBe("busy");
      await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
      expect(mocks.receipt).toHaveBeenCalledTimes(initialReads + 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(mocks.receipt).toHaveBeenCalledTimes(initialReads + 2);
      expect(screen.queryByText(/transaction\.success$/)).toBeNull();
      expect(record.phase).toBe("done");
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.call).not.toHaveBeenCalled();
      expect(mocks.busy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("marks a failed public receipt as failed and releases its pending guard", async () => {
    mocks.identity = identity;
    const record = restorePendingSubmission();
    mocks.receipt.mockResolvedValue({ status: 0 });
    const selectedModules = {
      ...modules, pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    await waitFor(() => expect(screen.getByText(/transaction\.failed$/)).toBeTruthy());
    expect(screen.queryByText(/transaction\.success$/)).toBeNull();
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(false);
    expect(record.phase).toBe("failed");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("ignores an earlier session's receipt response after a new session selects funds", async () => {
    mocks.identity = identity;
    const record = restorePendingSubmission();
    const finishReceipts: Array<(receipt: unknown) => void> = [];
    mocks.receipt.mockImplementation(() => new Promise((resolve) => { finishReceipts.push(resolve); }));
    mocks.call.mockImplementation(async (method: string) => method === "recover" ? {
      ...emptyWallet,
      notes: [{ commitment: mocks.identity?.handle === "identity:2" ? "200" : "100",
        ownerCommitment: "1", slot: "identity", kind: "value", amount: "1000000000000000000" }],
    } : emptyDiscovery);
    const selectedModules = {
      ...modules, pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xold"));
    lockWorkspace();
    await act(async () => {
      publishSession({ credentials: mocks.credentials ?? credentials, identity: { ...identity, handle: "identity:2" }, independentKey: null });
    });
    refreshAssets();
    await waitUntilIdle();
    chooseAction("unshield");
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('input[value="200"]')).toBeTruthy());
    selectValue("200");
    const scansBeforeReceipt = recoverCount();
    await act(async () => finishReceipts[0]({ status: 1 }));
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect(record.phase).toBe("busy");
    expect((screen.getByRole("button", { name: submitLabel }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="200"]')?.checked).toBe(true);
    expect(recoverCount()).toBe(scansBeforeReceipt);
    expect(mocks.identity.handle).toBe("identity:2");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([
    ["approval", "confirmed"], ["approval", "replaced"],
    ["action", "confirmed"], ["action", "replaced"],
  ] as const)("rereads the current ERC20 allowance when a tracked %s is %s", async (kind, outcome) => {
    mocks.identity = identity;
    const record = restorePendingSubmission(kind, outcome === "confirmed" ? "0xold" : null);
    let finishReceipt!: (receipt: unknown) => void;
    let finishNonce!: (nonce: number) => void;
    if (outcome === "confirmed") {
      mocks.receipt.mockImplementation(() => new Promise((resolve) => { finishReceipt = resolve; }));
    } else {
      (signer.provider!.getTransactionCount as any).mockImplementation(
        () => new Promise((resolve) => { finishNonce = resolve; }),
      );
    }
    const allowance = vi.fn(async () => kind === "approval" ? 0n : 1000000000000000000n);
    const selectedModules = {
      ...modules, assetKind: "erc20", token: { allowance, balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n) },
      pool: {
        runner: { provider: signer.provider },
        filters: { NoteAppended: () => "unfiltered-notes" },
        queryFilter: vi.fn(async () => []),
      },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("button", {
      name: kind === "approval" ? label("approve") : submitLabel,
    })).toBeTruthy());
    const allowanceReads = allowance.mock.calls.length;
    allowance.mockResolvedValue(kind === "approval" ? 1000000000000000000n : 0n);
    await act(async () => outcome === "confirmed" ? finishReceipt({ status: 1 }) : finishNonce(8));
    await waitFor(() => expect(screen.getByRole("button", {
      name: kind === "approval" ? submitLabel : label("approve"),
    })).toBeTruthy());
    expect(allowance.mock.calls.length).toBeGreaterThan(allowanceReads);
    expect(allowance).toHaveBeenLastCalledWith(address, address);
    expect(record.phase).toBe(outcome === "confirmed" ? "done" : "failed");
    if (kind === "approval" && outcome === "replaced") {
      expect(screen.getByText(/transaction\.unknown$/)).toBeTruthy();
      expect(screen.queryByText(/transaction\.failed$/)).toBeNull();
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([
    ["0xe450d38c", "errors.contractError.ERC20InsufficientBalance"],
    ["0xdeadbeef", "errors.contractError.CALL_EXCEPTION"],
  ])("explains a deposit estimation failure %s without calldata or an unnecessary approval", async (selector, message) => {
    mocks.identity = identity;
    const value = 10000n * 10n ** 18n;
    const approve = vi.fn();
    const token = {
      allowance: vi.fn(async () => value),
      balanceOf: vi.fn(async () => value),
      connect: vi.fn(() => ({ approve })),
    };
    const selectedModules = {
      ...modules, assetKind: "erc20", assetSymbol: "DEEP", token,
    } as unknown as ShieldedPageModules;
    mocks.call.mockImplementation(async (method: string) => method === "recover" ? emptyWallet : method === "prove"
      ? { action: "shield", amount: value.toString(), data: { outputCommitments: [100n, 101n] }, proof: {} }
      : { handle: "action:1", steps: [], inputs: [], inputAmounts: [], outputAmounts: [value.toString(), "0"] });
    const calldata = `0xf89a687a${"ab".repeat(1000)}`;
    mocks.submit.mockRejectedValueOnce(Object.assign(new Error(`execution reverted (unknown custom error), transaction data=${calldata}`), {
      code: "CALL_EXCEPTION",
      action: "estimateGas",
      data: `${selector}${address.slice(2).padStart(64, "0")}${"0".repeat(64)}${value.toString(16).padStart(64, "0")}`,
    }));
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "10000" } });
    fireEvent.click(await screen.findByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    expect(token.balanceOf).toHaveBeenCalledWith(address);
    expect(approve).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: label("approve") })).toBeNull();
    expect(screen.queryByText(/unknown custom error|0xf89a687a/)).toBeNull();
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect(screen.queryByText(/transaction\.success$/)).toBeNull();
  });
  it("clears the previous approval hash and success when the following deposit has no token balance", async () => {
    mocks.identity = identity;
    let balance = 10000n * 10n ** 18n;
    let approved = false;
    const hash = `0x${"73".repeat(32)}`;
    const approve = vi.fn(async () => ({
      hash,
      wait: vi.fn(async () => {
        approved = true;
        return { status: 1 };
      }),
    }));
    const token = {
      allowance: vi.fn(async () => approved ? 10000n * 10n ** 18n : 0n),
      balanceOf: vi.fn(async () => balance),
      connect: vi.fn(() => ({ approve })),
    };
    const selectedModules = {
      ...modules, assetKind: "erc20", assetSymbol: "DEEP", token,
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "10000" } });
    fireEvent.click(await screen.findByRole("button", { name: label("approve") }));
    await waitFor(() => expect(screen.getByText(/transaction\.success$/).textContent).toContain(hash));
    expect(screen.getByText(/transaction\.success$/).textContent).toContain(label("approve"));
    const submit = await screen.findByRole("button", { name: submitLabel });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    balance = 0n;
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("shielded.depositBalanceInsufficient"));
    expect(screen.queryByText(/transaction\.success$/)).toBeNull();
    expect(screen.queryByText(new RegExp(hash))).toBeNull();
    expect(mocks.call.mock.calls.some(([method]) => method === "preview" || method === "prove")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledOnce();
  });
  it.each(["approval", "deposit"] as const)("does not continue %s after the account changes during a token balance read", async (kind) => {
    let finishBalance!: (balance: bigint) => void;
    const balanceOf = vi.fn(() => new Promise<bigint>((resolve) => { finishBalance = resolve; }));
    const approve = vi.fn();
    const token = {
      allowance: vi.fn(async () => kind === "approval" ? 0n : 10000n * 10n ** 18n),
      balanceOf,
      connect: vi.fn(() => ({ approve })),
    };
    const selectedModules = {
      ...modules, assetKind: "erc20", token,
    } as unknown as ShieldedPageModules;
    const rendered = await renderUnlockedPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "10000" } });
    fireEvent.click(await screen.findByRole("button", { name: kind === "approval" ? label("approve") : submitLabel }));
    await waitFor(() => expect(balanceOf).toHaveBeenCalledWith(address));
    const nextAddress = "0x00000000000000000000000000000000000000bb";
    const nextSigner = { ...signer, getAddress: vi.fn(async () => nextAddress) } as unknown as Signer;
    rendered.rerender(<ShieldedInheritancePanel modules={selectedModules} signer={nextSigner} account={nextAddress} />);
    await waitUntilIdle();
    await act(async () => finishBalance(10000n * 10n ** 18n));
    expect(approve).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.some(([method]) => method === "preview" || method === "prove")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("refreshes an externally consumed allowance and explains the token's custom error", async () => {
    mocks.identity = identity;
    const allowance = vi.fn(async () => 1000000000000000000000n);
    const selectedModules = {
      ...modules, assetKind: "erc20", token: { allowance, balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n) },
    } as unknown as ShieldedPageModules;
    mocks.call.mockImplementation(async (method: string) => method === "recover" ? emptyWallet : method === "prove"
      ? { action: "shield", amount: "1000000000000000000000", data: { outputCommitments: [100n, 101n] }, proof: {} }
      : { handle: "action:1", steps: [], inputs: [], inputAmounts: [], outputAmounts: ["1000000000000000000000", "0"] });
    mocks.submit.mockImplementationOnce(async () => {
      allowance.mockResolvedValue(0n);
      // ERC20InsufficientAllowance(pool, 0, 1000 DEEP), as returned by estimateGas.
      throw Object.assign(new Error("execution reverted (unknown custom error) with transaction data"), {
        code: "CALL_EXCEPTION",
        action: "estimateGas",
        data: `0xfb8f41b2${address.slice(2).padStart(64, "0")}${"0".repeat(64)}${(1000n * 10n ** 18n).toString(16).padStart(64, "0")}`,
      });
    });
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1000" } });
    fireEvent.click(await screen.findByRole("button", { name: submitLabel }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("errors.contractError.ERC20InsufficientAllowance"));
    await waitFor(() => expect((screen.getByRole("button", { name: label("approve") }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/transaction\.pending$/)).toBeNull();
    expect(screen.queryByText(/unknown custom error/)).toBeNull();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("resumes the destination pool's pending submission when the selected pool changes", async () => {
    mocks.identity = identity;
    const destination = "0x00000000000000000000000000000000000000bb";
    const record = restorePendingSubmission();
    record.shieldedSubmission.poolAddress = destination;
    record.transactionHash = "0xdestination";
    mocks.receipt.mockResolvedValue({ status: 1 });
    const rendered = await renderPanel();
    expect(mocks.receipt).not.toHaveBeenCalled();
    const selectedModules = {
      ...modules, poolAddress: destination, pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    rendered.rerender(<ShieldedInheritancePanel modules={selectedModules} signer={signer}
      account={address} />);
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledWith("0xdestination"));
    await waitFor(() => expect(record.phase).toBe("done"));
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryByText(/transaction\.success$/)).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("updates the ERC20 allowance when an approval's wallet wait succeeds after locking", async () => {
    mocks.identity = identity;
    let finishApproval!: (receipt: unknown) => void;
    const wait = vi.fn(() => new Promise((resolve) => { finishApproval = resolve; }));
    const approve = vi.fn(async () => ({ hash: "0xapproval", wait }));
    const allowance = vi.fn(async () => 0n);
    const selectedModules = {
      ...modules, assetKind: "erc20",
      token: { allowance, balanceOf: vi.fn(async () => 1_000_000n * 10n ** 18n), connect: vi.fn(() => ({ approve })) },
      pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    await renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText("shielded.fields.amount"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: label("approve") })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: label("approve") }));
    await waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    expect(mocks.receipt).not.toHaveBeenCalled();
    lockWorkspace();
    const allowanceReads = allowance.mock.calls.length;
    allowance.mockResolvedValue(1000000000000000000n);
    await act(async () => finishApproval({ status: 1 }));
    await waitFor(() => expect(allowance.mock.calls.length).toBeGreaterThan(allowanceReads));
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("identity passphrase"), { target: { value: "child-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(screen.getByRole("button", { name: submitLabel })).toBeTruthy());
    expect(screen.queryByRole("button", { name: label("approve") })).toBeNull();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
