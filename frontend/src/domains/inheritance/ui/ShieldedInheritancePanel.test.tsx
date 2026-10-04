// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  getShieldedBudgetCommitments,
  deriveShieldedHeirKeyMaterial,
  encodeShieldedReceiveCode,
  DEFAULT_SHIELDED_PERIOD_DAYS,
  SECONDS_PER_DAY,
  wrapIdentityCommitmentAsPersonHash,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { Interface, type Signer } from "ethers";
import enLocale from "../../../locales/en/index.json";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import {
  ShieldedReceiveCodeError,
  type VerifiedShieldedRecipient,
} from "../services/shieldedReceiveCode";
import type { OwnedShieldedNote } from "../services/shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "../services/shieldedWalletRecovery";
import type { IndexedVersion, LineageSnapshot } from "../services/inheritanceChain";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";
import { ShieldedIdentitySessionProvider } from "./ShieldedIdentitySessionContext";

const mocks = vi.hoisted(() => ({
  deriveIdentityFromForm: vi.fn(),
  verifyShieldedReceiveCode: vi.fn(),
  createOwnShieldedReceiveCode: vi.fn(),
  createShieldedReceiveCodeForRecipient: vi.fn(),
  clearSecretInputs: vi.fn(),
  recoverLocalShieldedWallet: vi.fn(),
  listUnspentRecoveredShieldedNotes: vi.fn(),
  listRecoveredFundingTemplates: vi.fn(),
  prepareShieldedShield: vi.fn(),
  submitShield: vi.fn(),
  tokenAllowance: vi.fn(),
  tokenBalanceOf: vi.fn(),
  tokenConnect: vi.fn(),
  tokenApprove: vi.fn(),
  prepareShieldedPrivateTransfer: vi.fn(),
  prepareShieldedUnshield: vi.fn(),
  submitPrivateTransfer: vi.fn(),
  submitUnshield: vi.fn(),
  listRecoveredShieldedPolicies: vi.fn(),
  createShieldedPolicyDescriptor: vi.fn(),
  prepareShieldedFund: vi.fn(),
  submitFundWithFreshLineage: vi.fn(),
  submitFund: vi.fn(),
  prepareShieldedValueConsolidation: vi.fn(),
  prepareShieldedClaim: vi.fn(),
  submitClaimWithFreshLineage: vi.fn(),
  loadLineageSnapshot: vi.fn(),
  findHeirLegitimacy: vi.fn(),
  getBlock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  walletChangedMessage: null as string | null,
  translationRevision: 0,
}));

vi.mock("react-i18next", () => {
  const t = (
    key: string,
    options?: {
      detail?: string;
      identity?: string;
      parent?: string;
      relation?: string;
      version?: number;
      amount?: string;
      symbol?: string;
      balance?: string;
      index?: number;
      count?: number;
      hash?: string;
      period?: number;
      periods?: number;
      days?: number | string;
      date?: string;
    },
  ) => {
    if (key === "shielded.walletChanged" && mocks.walletChangedMessage) {
      return mocks.walletChangedMessage;
    }
    if (key === "shielded.confirmedRefreshFailed") {
      return `Transaction confirmed; balances refresh failed: ${options?.detail}`;
    }
    if (key === "shielded.refreshFailed") {
      return `Balances refresh failed; account still unlocked: ${options?.detail}`;
    }
    if (key === "shielded.recipientTarget") {
      return `Recipient: ${options?.identity}`;
    }
    if (key === "shielded.fundingFamilySummary") {
      return `Funding family: ${options?.relation} ${options?.parent}, version ${options?.version}`;
    }
    if (key === "shielded.fundingVersionOption") {
      return `Parent version ${options?.version}`;
    }
    if (key === "shielded.fundingBalanceInsufficient") {
      return `Missing private balance: ${options?.amount}`;
    }
    if (key === "shielded.depositBalanceInsufficient") {
      return `Deposit requires ${options?.amount} ${options?.symbol}; wallet balance is ${options?.balance} ${options?.symbol}`;
    }
    if (key === "shielded.valueOption") {
      return `Balance ${options?.index}: ${options?.amount} DEEP`;
    }
    if (key === "shielded.valueSelectionHint") {
      return `Balance limit: ${options?.count}`;
    }
    if (key === "shielded.transactionFailed") {
      return `shielded.transactionFailed: ${options?.hash}`;
    }
    if (key === "shielded.claimPeriodOption") {
      return `Period ${options?.period}: ${options?.amount} DEEP`;
    }
    if (key === "shielded.claimOverview.claimable") {
      return `Claimable: ${options?.amount} DEEP / ${options?.periods} periods`;
    }
    if (key === "shielded.periodDaysSummary") {
      return `Every ${options?.days} days`;
    }
    if (key === "shielded.claimPeriodDue") {
      return `Due: ${options?.date}`;
    }
    if (key === "shielded.claimOverview.nextDue") {
      return `Next due: ${options?.date}`;
    }
    if (key === "shielded.budgetOption") {
      return `Budget ${options?.index}: ${options?.amount} DEEP / Every ${options?.days} days`;
    }
    return key;
  };
  let revision = -1;
  let translated = t;
  return {
    useTranslation: () => {
      if (revision !== mocks.translationRevision) {
        revision = mocks.translationRevision;
        translated = (...args: Parameters<typeof t>) => t(...args);
      }
      return { t: translated };
    },
  };
});
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props, ref) => {
      const id = React.useId();
      const fullName = React.useRef<HTMLInputElement>(null);
      const gender = React.useRef<HTMLSelectElement>(null);
      const era = React.useRef<HTMLSelectElement>(null);
      const year = React.useRef<HTMLInputElement>(null);
      const month = React.useRef<HTMLInputElement>(null);
      const day = React.useRef<HTMLInputElement>(null);
      const passphrase = React.useRef<HTMLInputElement>(null);
      React.useImperativeHandle(ref, () => ({
        getPublicFormData: () => ({
          fullName: fullName.current?.value ?? "",
          gender: Number(gender.current?.value ?? "0"),
          isBirthBC: era.current?.value === "bc",
          birthYear: Number(year.current?.value || "0"),
          birthMonth: Number(month.current?.value || "0"),
          birthDay: Number(day.current?.value || "0"),
          hasPassphrase: Boolean(passphrase.current?.value),
        }),
        getSecretInputs: () => ({ passphrase: passphrase.current?.value ?? "" }),
        clearSecretInputs: () => {
          mocks.clearSecretInputs();
          if (passphrase.current) passphrase.current.value = "";
        },
      }));
      return (
        <div>
          <label>
            search.hashCalculator.name
            <input ref={fullName} />
          </label>
          <label>
            search.hashCalculator.gender
            <select ref={gender} defaultValue="0">
              <option value="0">Unknown</option>
              <option value="1">Male</option>
              <option value="2">Female</option>
              <option value="3">Other</option>
            </select>
          </label>
          <label>
            search.hashCalculator.isBirthBC
            <select ref={era} defaultValue="ad">
              <option value="ad">AD</option>
              <option value="bc">BC</option>
            </select>
          </label>
          <label>
            search.hashCalculator.birthYearLabel
            <input ref={year} />
          </label>
          <label>
            search.hashCalculator.birthMonthLabel
            <input ref={month} />
          </label>
          <label>
            search.hashCalculator.birthDayLabel
            <input ref={day} />
          </label>
          <label htmlFor={`${id}-passphrase`}>search.hashCalculator.passphrase</label>
          <input
            id={`${id}-passphrase`}
            ref={passphrase}
            aria-label="Identity passphrase"
            defaultValue="Tr0ub4dor&3-xkcd-horse"
          />
        </div>
      );
    }),
  };
});
vi.mock("../../tree/context", () => ({
  useTreeGraphData: () => ({ nodesData: {} }),
}));
vi.mock("../services/inheritanceIdentity", () => ({
  deriveIdentityFromForm: mocks.deriveIdentityFromForm,
}));
vi.mock("../services/shieldedReceiveCode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/shieldedReceiveCode")>()),
  verifyShieldedReceiveCode: mocks.verifyShieldedReceiveCode,
  createOwnShieldedReceiveCode: mocks.createOwnShieldedReceiveCode,
  createShieldedReceiveCodeForRecipient: mocks.createShieldedReceiveCodeForRecipient,
}));
vi.mock("../services/shieldedWalletRecovery", () => ({
  recoverLocalShieldedWallet: mocks.recoverLocalShieldedWallet,
  listUnspentRecoveredShieldedNotes: mocks.listUnspentRecoveredShieldedNotes,
  listRecoveredFundingTemplates: mocks.listRecoveredFundingTemplates,
  listRecoveredShieldedPolicies: mocks.listRecoveredShieldedPolicies,
}));
vi.mock("../services/shieldedTransferExitPreparation", () => ({
  prepareShieldedPrivateTransfer: mocks.prepareShieldedPrivateTransfer,
  prepareShieldedUnshield: mocks.prepareShieldedUnshield,
  prepareShieldedValueConsolidation: mocks.prepareShieldedValueConsolidation,
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitPrivateTransfer: mocks.submitPrivateTransfer,
  submitUnshield: mocks.submitUnshield,
  submitShield: mocks.submitShield,
  submitFund: mocks.submitFund,
}));
vi.mock("../services/shieldedNotePreparation", () => ({
  prepareShieldedShield: mocks.prepareShieldedShield,
}));
vi.mock("../services/shieldedFundingPreparation", () => ({
  createShieldedPolicyDescriptor: mocks.createShieldedPolicyDescriptor,
  prepareShieldedFund: mocks.prepareShieldedFund,
}));
vi.mock("../services/shieldedClaimPreparation", () => ({
  prepareShieldedClaim: mocks.prepareShieldedClaim,
}));
vi.mock("../services/shieldedFreshLineageSubmit", () => ({
  submitClaimWithFreshLineage: mocks.submitClaimWithFreshLineage,
  submitFundWithFreshLineage: mocks.submitFundWithFreshLineage,
}));
vi.mock("../services/inheritanceChain", () => ({
  loadLineageSnapshot: mocks.loadLineageSnapshot,
  findHeirLegitimacy: mocks.findHeirLegitimacy,
}));
vi.mock("../../../shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui")>()),
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget"; binding?: "owner" }>;
const account = "0x00000000000000000000000000000000000000aa";
const poolAddress = "0x00000000000000000000000000000000000000bb";
const scope = { chainId: 31337n, poolAddress };
const transactionHash = `0x${"ab".repeat(32)}`;
const identity: IdentityMaterialV1Result = {
  identitySuiteId: 1,
  identity: {
    fullName: "Test Person",
    gender: 1,
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 1,
    isBirthBC: false,
  },
  derivedSecretField: "123",
  nameField: "456",
  packedBirthGenderField: "789",
  suiteCommitment: "12",
  nameSecretCommitment: "34",
  identityCommitment: "777",
  personHash: wrapIdentityCommitmentAsPersonHash(777n),
};

function publicNote(commitment: bigint) {
  return {
    commitment,
    shardId: 0n,
    leafIndex: commitment,
    root: 999n,
    ciphertext: new Uint8Array(),
    ciphertextHashField: 123n,
    blockNumber: 1,
    logIndex: Number(commitment),
  };
}

function valueNote(commitment: bigint, amount: bigint): Note {
  return {
    ...publicNote(commitment),
    note: {
      kind: "value",
      ownerCommitment: deriveShieldedHeirKeyMaterial(identity.derivedSecretField).ownerCommitment,
      amount,
      nonce: commitment,
    },
  };
}

function familySnapshot({
  father = 777n,
  mother = 333n,
  fatherVersions = [7, 3],
  motherVersions = [4],
  extraChildren = [],
}: {
  father?: bigint;
  mother?: bigint;
  fatherVersions?: number[];
  motherVersions?: number[];
  extraChildren?: {
    identityCommitment: bigint;
    fatherIdentityCommitment: bigint;
    motherIdentityCommitment?: bigint;
  }[];
} = {}): LineageSnapshot {
  const version = (
    identityCommitment: bigint,
    versionIndex: number,
    fatherIdentityCommitment = 0n,
    motherIdentityCommitment = 0n,
  ): IndexedVersion => ({
    personHash: wrapIdentityCommitmentAsPersonHash(identityCommitment).toLowerCase(),
    identityCommitment,
    versionIndex,
    fatherIdentityCommitment,
    motherIdentityCommitment,
  });
  const children = [
    version(99n, 1, father, mother),
    ...extraChildren.map((child) =>
      version(
        child.identityCommitment,
        1,
        child.fatherIdentityCommitment,
        child.motherIdentityCommitment ?? 0n,
      ),
    ),
  ];
  const parentVersions = [
    ...fatherVersions.map((index) => version(father, index)),
    ...(mother === 0n ? [] : motherVersions.map((index) => version(mother, index))),
  ];
  for (const child of children) {
    for (const parent of [child.fatherIdentityCommitment, child.motherIdentityCommitment]) {
      if (parent !== 0n && !parentVersions.some((item) => item.identityCommitment === parent)) {
        parentVersions.push(
          children.find((item) => item.identityCommitment === parent) ?? version(parent, 1),
        );
      }
    }
  }
  const versions = new Map<string, IndexedVersion[]>();
  for (const item of [...parentVersions, ...children]) {
    const existing = versions.get(item.personHash) ?? [];
    if (!existing.some((candidate) => candidate.versionIndex === item.versionIndex)) {
      versions.set(item.personHash, [...existing, item]);
    }
  }
  return {
    blockNumber: 1,
    versions,
    endorsements: new Map(
      children.map((child) => [
        child.personHash,
        new Map([[account, { versionIndex: child.versionIndex, timestamp: 0n }]]),
      ]),
    ),
    trustedEndorsers: new Map(
      parentVersions.map((parent) => [
        `${parent.personHash}:${parent.versionIndex}`,
        new Set([account]),
      ]),
    ),
    endorsementTree: createLineageTree(
      children.map((child) =>
        computeLineageEndorsementLeaf({
          identityCommitment: child.identityCommitment,
          parentsDigest: computeLineageParentsDigest({
            fatherIdentityCommitment: child.fatherIdentityCommitment,
            motherIdentityCommitment: child.motherIdentityCommitment,
          }),
          versionIndex: child.versionIndex,
          endorser: account,
          writtenAt: 0n,
        }),
      ),
    ),
    trustedTree: createLineageTree(
      parentVersions.map((parent) =>
        computeLineageTrustedLeaf({
          rootIdentityCommitment: parent.identityCommitment,
          rootVersionIndex: parent.versionIndex,
          account,
        }),
      ),
    ),
  };
}

function budgetNote(commitment: bigint, overrides: Partial<BudgetPayload> = {}): Note {
  return {
    ...publicNote(commitment),
    note: {
      kind: "budget",
      rootIdentityCommitment: 111n,
      rootVersionIndex: 3n,
      policySalt: 222n,
      allocationKeyCommitment: 333n,
      heirIdentityCommitment: BigInt(identity.identityCommitment),
      eligibleFrom: 1_000n,
      enrollmentSalt: 555n,
      heirOwnerCommitment: deriveShieldedHeirKeyMaterial(identity.derivedSecretField)
        .ownerCommitment,
      amountPerPeriod: 10n,
      periodDays: 30n,
      remaining: 20n,
      nonce: commitment,
      ...overrides,
    },
  };
}

function policyDescriptor() {
  return {
    rootIdentityCommitment: 777n,
    rootVersionIndex: 3n,
    policySalt: 222n,
    allocationKey: 444n,
    amountPerPeriod: 10n,
    periodDays: 30n,
  };
}

function walletSnapshot(notes: Note[] = [], material = identity): LocalShieldedWalletSnapshot {
  return {
    poolAddress,
    chainId: 31337n,
    toBlock: 1,
    blockHash: `0x${"cd".repeat(32)}`,
    shards: new Map(),
    ownedNotes: new Map(notes.map((note) => [note.commitment, note])),
    spentNullifiers: new Set(),
    walletOwnerCommitment: deriveShieldedHeirKeyMaterial(material.derivedSecretField)
      .ownerCommitment,
    walletIdentityCommitment: BigInt(material.identityCommitment),
    fundingTemplates: new Map(),
  };
}

const receiveCodeProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};

/** Decodable, so the page can show whom it names; the mocked worker decides if it verifies. */
function receiveCodeFor(identityCommitment: bigint) {
  return encodeShieldedReceiveCode({
    identityCommitment,
    ownerCommitment: 98n,
    viewingKey: `0x${"77".repeat(32)}`,
    proof: receiveCodeProof,
  });
}

function verifiedRecipient(identityCommitment: bigint, ownerCommitment = 98n) {
  return {
    identityCommitment,
    ownerCommitment,
    viewingKey: `0x${"77".repeat(32)}`,
    personHash: wrapIdentityCommitmentAsPersonHash(identityCommitment),
  } as VerifiedShieldedRecipient;
}

/** Fill a private transfer to an unnamed recipient, confirming the identity as required. */
function fillTransfer(
  code: string,
  amount: string,
  choice: { index: number; amount: number } | null = { index: 1, amount: 10 },
) {
  chooseAction("privateTransfer");
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
    target: { value: amount },
  });
  if (choice) fireEvent.click(balanceChoice(choice.index, choice.amount));
}

function renderPanel(overrides: Partial<ShieldedPageModules> = {}) {
  let modules = {
    chainId: 31337n,
    poolAddress,
    pool: {},
    factory: {},
    assetKind: "erc20",
    assetSymbol: "DEEP",
    assetAddress: "0x00000000000000000000000000000000000000cc",
    poolDeploymentBlock: 0,
    token: {
      allowance: mocks.tokenAllowance,
      balanceOf: mocks.tokenBalanceOf,
      connect: mocks.tokenConnect,
    },
    tokenDecimals: 0,
    provider: { getBlock: mocks.getBlock },
    lineageIndex: {},
    deepFamily: {},
    ...overrides,
  } as unknown as ShieldedPageModules;
  let panelKey = "initial";
  const signer = {
    provider: { getNetwork: async () => ({ chainId: 31337n }) },
    getAddress: async () => account,
  } as unknown as Signer;
  const publicActivityAddresses = new Set<string>();
  const view = (transactionAccount: string, transactionSigner: Signer | null = signer) => (
    <ShieldedIdentitySessionProvider scope={`${modules.chainId}:factory:protocol-v2`}>
      <ShieldedInheritancePanel
        key={panelKey}
        modules={modules}
        signer={transactionSigner}
        account={transactionAccount}
        publicActivityAddresses={publicActivityAddresses}
      />
    </ShieldedIdentitySessionProvider>
  );
  const rendered = render(view(account));
  return {
    ...rendered,
    rerenderAccount: (transactionAccount: string, transactionSigner: Signer | null = signer) =>
      rendered.rerender(view(transactionAccount, transactionSigner)),
    rerenderModules: (overrides: Partial<ShieldedPageModules>, remount = false) => {
      modules = { ...modules, ...overrides };
      if (remount) panelKey = `${modules.chainId}:${modules.poolAddress}`;
      rendered.rerender(view(account));
    },
  };
}

async function unlock() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
  await waitFor(() => {
    const refresh = screen.getByRole("button", { name: "shielded.actions.recover" });
    expect((refresh as HTMLButtonElement).disabled).toBe(false);
  });
}

function chooseAction(action: string) {
  if (action === "fund") {
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    return;
  }
  if (action === "claim") {
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: `shielded.actions.${action}` }));
}

function openOptions(key: string) {
  fireEvent.click(screen.getByText(key, { selector: "summary" }));
}

function balanceChoice(index: number, amount: number): HTMLInputElement {
  const name = `Balance ${index}: ${amount} DEEP`;
  return (screen.queryByRole("radio", { name }) ??
    screen.getByRole("checkbox", { name })) as HTMLInputElement;
}

function claimPeriodChoice(period: number, amount = 10): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: `Period ${period}: ${amount} DEEP`,
  }) as HTMLInputElement;
}

function spendClaimPeriod(snapshot: LocalShieldedWalletSnapshot, note: Note, index: bigint) {
  if (note.note.kind !== "budget") throw new Error("Expected budget");
  snapshot.spentNullifiers.add(
    computeShieldedPeriodNullifier(
      {
        derivedSecretField: identity.derivedSecretField,
        policyCommitment: getShieldedBudgetCommitments(note.note, scope).policyCommitment,
        periodIndex: index,
      },
      scope,
    ),
  );
}

async function selectFundingParentVersion(version?: number) {
  const picker = screen.queryByRole("combobox", {
    name: "shielded.fields.familyVersion",
  }) as HTMLSelectElement | null;
  if (!picker) return;
  await waitFor(() => expect(picker.options.length).toBeGreaterThan(1));
  if (version !== undefined || !picker.value) {
    const selectedVersion =
      version ?? Math.max(...Array.from(picker.options, (option) => Number(option.value)));
    fireEvent.change(picker, { target: { value: selectedVersion.toString() } });
  }
}

async function selectFundingChild(commitment: bigint, parentVersion?: number) {
  await selectFundingParentVersion(parentVersion);
  const hash = wrapIdentityCommitmentAsPersonHash(commitment);
  await waitFor(() =>
    expect(
      screen
        .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
        .querySelector(`option[value="${hash}"]`),
    ).toBeTruthy(),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" }), {
    target: { value: hash },
  });
}

async function fillFundingRecipient(commitment: bigint, parentVersion?: number) {
  await selectFundingChild(commitment, parentVersion);
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
    target: { value: receiveCodeFor(commitment) },
  });
}

function useRecoveredRule() {
  mocks.listRecoveredShieldedPolicies.mockReturnValue([policyDescriptor()]);
  mocks.loadLineageSnapshot.mockResolvedValue(familySnapshot({ fatherVersions: [3], mother: 0n }));
}

function enterRecipientCredentials(passphrase = "child identity passphrase") {
  fireEvent.click(screen.getByRole("radio", { name: "shielded.recipientMethods.credentials" }));
  fireEvent.change(screen.getByLabelText("search.hashCalculator.name"), {
    target: { value: "Child Recipient" },
  });
  fireEvent.change(screen.getByLabelText("search.hashCalculator.gender"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("search.hashCalculator.birthYearLabel"), {
    target: { value: "2004" },
  });
  fireEvent.change(screen.getByLabelText("search.hashCalculator.birthMonthLabel"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("search.hashCalculator.birthDayLabel"), {
    target: { value: "6" },
  });
  const password = screen.getByLabelText("search.hashCalculator.passphrase") as HTMLInputElement;
  fireEvent.change(password, { target: { value: passphrase } });
  return password;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("ShieldedInheritancePanel unlocked account", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.walletChangedMessage = null;
    mocks.translationRevision = 0;
    mocks.deriveIdentityFromForm.mockResolvedValue(identity);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot());
    mocks.verifyShieldedReceiveCode.mockRejectedValue(new ShieldedReceiveCodeError("malformed"));
    mocks.createOwnShieldedReceiveCode.mockResolvedValue("dfrecv1ownreceivecode");
    mocks.listUnspentRecoveredShieldedNotes.mockImplementation(
      (snapshot: LocalShieldedWalletSnapshot) => [...snapshot.ownedNotes.values()],
    );
    mocks.listRecoveredFundingTemplates.mockImplementation(
      (snapshot: LocalShieldedWalletSnapshot) => [...(snapshot.fundingTemplates?.values() ?? [])],
    );
    mocks.prepareShieldedPrivateTransfer.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitPrivateTransfer.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.prepareShieldedShield.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitShield.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.tokenAllowance.mockResolvedValue(1_000n);
    mocks.tokenBalanceOf.mockResolvedValue(1_000_000_000n);
    mocks.tokenConnect.mockReturnValue({ approve: mocks.tokenApprove });
    mocks.tokenApprove.mockResolvedValue({
      hash: transactionHash,
      wait: async () => ({ status: 1 }),
    });
    mocks.prepareShieldedClaim.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitClaimWithFreshLineage.mockImplementation(
      async ({ prepare }: { prepare: () => Promise<unknown> }) => {
        await prepare();
        return { receipt: { status: 1 }, transactionHash };
      },
    );
    const lineage = familySnapshot();
    mocks.loadLineageSnapshot.mockResolvedValue(lineage);
    mocks.listRecoveredShieldedPolicies.mockReturnValue([]);
    mocks.createShieldedPolicyDescriptor.mockImplementation((fields) => ({
      ...fields,
      policySalt: 222n,
      allocationKey: 444n,
    }));
    mocks.prepareShieldedFund.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitFund.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.submitFundWithFreshLineage.mockImplementation(
      async ({ prepare }: { prepare: () => Promise<unknown> }) => {
        await prepare();
        return { receipt: { status: 1 }, transactionHash };
      },
    );
    mocks.prepareShieldedValueConsolidation.mockResolvedValue(undefined);
    mocks.prepareShieldedUnshield.mockResolvedValue({
      data: {},
      witness: {},
      amount: 10n,
      recipient: account,
    });
    mocks.submitUnshield.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.findHeirLegitimacy.mockReturnValue([{ writtenAt: 0n }]);
    mocks.getBlock.mockResolvedValue({
      timestamp: Number(1_000n + 2n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY)),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalExecCommandDescriptor) {
      Object.defineProperty(document, "execCommand", originalExecCommandDescriptor);
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("hides action controls and decrypted balances until the identity is unlocked", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Identity passphrase" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("shielded.balanceAmount")).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.recover" })).toBeNull();
    expect(screen.queryByText("shielded.guide.title")).toBeNull();
    expect(screen.queryByText(identity.personHash)).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.copyIdentityHash" })).toBeNull();
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
  });

  it.each(["invalid", "0"])(
    "localizes invalid deposit amount %s before preparing a transaction",
    async (amount) => {
      renderPanel();
      await unlock();
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
        target: { value: amount },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain("inheritance.errors.amountInvalid"),
      );
      expect(mocks.prepareShieldedShield).not.toHaveBeenCalled();
      expect(mocks.tokenBalanceOf).not.toHaveBeenCalled();
      expect(mocks.tokenAllowance).not.toHaveBeenCalled();
      expect(mocks.submitShield).not.toHaveBeenCalled();
      expect(screen.queryByText("shielded.done")).toBeNull();
    },
  );

  it("does not use private VALUE notes to cover an ordinary-wallet deposit", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10_000n)]));
    mocks.tokenBalanceOf.mockResolvedValue(0n);
    mocks.tokenAllowance.mockResolvedValue(0n);
    renderPanel();
    await unlock();
    chooseAction("shield");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Deposit requires 1000 DEEP; wallet balance is 0 DEEP",
      ),
    );
    expect(mocks.tokenBalanceOf).toHaveBeenCalledWith(account);
    expect(mocks.tokenBalanceOf).not.toHaveBeenCalledWith(identity.personHash);
    expect(mocks.prepareShieldedShield).not.toHaveBeenCalled();
    expect(mocks.tokenAllowance).not.toHaveBeenCalled();
    expect(mocks.tokenConnect).not.toHaveBeenCalled();
    expect(mocks.tokenApprove).not.toHaveBeenCalled();
    expect(mocks.submitShield).not.toHaveBeenCalled();
    expect(screen.getByText("shielded.balanceAmount").closest("div")?.textContent).toContain(
      "10000",
    );
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("reports a nonzero ordinary-wallet balance that cannot cover the deposit", async () => {
    mocks.tokenBalanceOf.mockResolvedValue(999n);
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Deposit requires 1000 DEEP; wallet balance is 999 DEEP",
      ),
    );
    expect(mocks.prepareShieldedShield).not.toHaveBeenCalled();
    expect(mocks.tokenApprove).not.toHaveBeenCalled();
    expect(mocks.submitShield).not.toHaveBeenCalled();
  });

  it("allows a deposit equal to the fresh ordinary-wallet balance", async () => {
    mocks.tokenBalanceOf.mockResolvedValue(1000n);
    mocks.tokenAllowance.mockResolvedValue(0n);
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");

    expect(mocks.tokenBalanceOf).toHaveBeenCalledWith(account);
    expect(mocks.prepareShieldedShield).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000n }),
    );
    expect(mocks.tokenApprove).toHaveBeenCalledWith(poolAddress, 1000n);
    expect(mocks.submitShield).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the wallet balance again after the preceding deposit spends it", async () => {
    mocks.tokenBalanceOf.mockResolvedValueOnce(1000n).mockResolvedValue(0n);
    mocks.tokenAllowance.mockResolvedValue(0n);
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Deposit requires 1000 DEEP; wallet balance is 0 DEEP",
      ),
    );
    expect(mocks.tokenBalanceOf).toHaveBeenCalledTimes(2);
    expect(mocks.tokenBalanceOf.mock.calls.map(([address]) => address)).toEqual([account, account]);
    expect(mocks.prepareShieldedShield).toHaveBeenCalledOnce();
    expect(mocks.tokenAllowance).toHaveBeenCalledOnce();
    expect(mocks.tokenApprove).toHaveBeenCalledOnce();
    expect(mocks.submitShield).toHaveBeenCalledOnce();
  });

  it("resets an insufficient nonzero allowance before approving the selected ERC-20 amount", async () => {
    mocks.tokenAllowance.mockResolvedValue(500n);
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.tokenApprove.mock.calls).toEqual([
      [poolAddress, 0n],
      [poolAddress, 1000n],
    ]);
    expect(mocks.submitShield).toHaveBeenCalledWith(
      expect.objectContaining({ assetKind: "erc20", amount: 1000n }),
    );
  });

  it("deposits native assets using the wallet's native balance and skips ERC-20 approval", async () => {
    const getBalance = vi.fn(async () => 10n ** 19n);
    renderPanel({
      assetKind: "native",
      assetSymbol: "CFX",
      assetAddress: "0x0000000000000000000000000000000000000000",
      token: null,
      tokenDecimals: 18,
      provider: {
        getBlock: mocks.getBlock,
        getBalance,
      } as unknown as ShieldedPageModules["provider"],
    });
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(getBalance).toHaveBeenCalledWith(account);
    expect(mocks.tokenBalanceOf).not.toHaveBeenCalled();
    expect(mocks.tokenAllowance).not.toHaveBeenCalled();
    expect(mocks.tokenApprove).not.toHaveBeenCalled();
    expect(mocks.submitShield).toHaveBeenCalledWith(
      expect.objectContaining({ assetKind: "native", amount: 10n ** 18n }),
    );
  });

  it("checks the selected transaction wallet instead of the unlocked identity's hash", async () => {
    const otherAccount = "0x00000000000000000000000000000000000000dd";
    const otherSigner = {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      getAddress: async () => otherAccount,
    } as unknown as Signer;
    mocks.tokenBalanceOf.mockImplementation(async (address: string) =>
      address === otherAccount ? 1000n : 0n,
    );
    const panel = renderPanel();
    await unlock();
    panel.rerenderAccount(otherAccount, otherSigner);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");

    expect(mocks.tokenBalanceOf).toHaveBeenCalledOnce();
    expect(mocks.tokenBalanceOf).toHaveBeenCalledWith(otherAccount);
    expect(mocks.tokenAllowance).toHaveBeenCalledWith(otherAccount, poolAddress);
    expect(mocks.submitShield).toHaveBeenCalledWith(
      expect.objectContaining({ signer: otherSigner }),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledOnce();
    expect(screen.getByText(identity.personHash)).toBeTruthy();
  });

  it.each([
    { change: "account", english: false, name: "account" },
    { change: "network", english: false, name: "network" },
    { change: "account", english: true, name: "account with real English guidance" },
  ] as const)(
    "stops a deposit if the transaction wallet's $name changes during its balance read",
    async ({ change, english }) => {
      if (english) mocks.walletChangedMessage = enLocale.shielded.walletChanged;
      const balanceRead = deferred<bigint>();
      mocks.tokenBalanceOf.mockReturnValueOnce(balanceRead.promise);
      const panel = renderPanel();
      await unlock();
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
        target: { value: "1000" },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() => expect(mocks.tokenBalanceOf).toHaveBeenCalledWith(account));
      const otherAccount =
        change === "account" ? "0x00000000000000000000000000000000000000dd" : account;
      panel.rerenderAccount(otherAccount, {
        provider: { getNetwork: async () => ({ chainId: change === "network" ? 71n : 31337n }) },
        getAddress: async () => otherAccount,
      } as unknown as Signer);
      await act(async () => {
        balanceRead.resolve(1000n);
      });

      expect(screen.getByRole("alert").textContent).toBe(
        english ? enLocale.shielded.walletChanged : "shielded.walletChanged",
      );
      expect(screen.getByRole("alert").textContent).not.toContain(
        "errors.contractError.NETWORK_ERROR",
      );
      expect(mocks.prepareShieldedShield).not.toHaveBeenCalled();
      expect(mocks.tokenAllowance).not.toHaveBeenCalled();
      expect(mocks.tokenApprove).not.toHaveBeenCalled();
      expect(mocks.submitShield).not.toHaveBeenCalled();
    },
  );

  it("localizes an ERC20 balance revert after a successful deposit preflight", async () => {
    const tokenInterface = new Interface([
      "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
    ]);
    const data = tokenInterface.encodeErrorResult("ERC20InsufficientBalance", [account, 0n, 1000n]);
    const rawMessage = `execution reverted (unknown custom error), raw-rpc-deposit-error ${data}`;
    mocks.tokenBalanceOf.mockResolvedValue(1000n);
    mocks.submitShield.mockRejectedValue(
      Object.assign(new Error(rawMessage), {
        code: "CALL_EXCEPTION",
        action: "estimateGas",
        info: { error: { code: -32603, data } },
      }),
    );
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "errors.contractError.ERC20InsufficientBalance",
      ),
    );
    expect(mocks.tokenBalanceOf).toHaveBeenCalledWith(account);
    expect(mocks.prepareShieldedShield).toHaveBeenCalledOnce();
    expect(mocks.submitShield).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).not.toContain("0xe450d38c");
    expect(screen.getByRole("alert").textContent).not.toContain("raw-rpc-deposit-error");
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("localizes an invalid funding period count before preparing a transaction", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    renderPanel();
    await unlock();
    chooseAction("fund");
    await selectFundingParentVersion(7);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("inheritance.errors.periodsInvalid"),
    );
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    expect(mocks.submitFund).not.toHaveBeenCalled();
    expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("derives once on unlock and reuses that identity for the receive code and refresh", async () => {
    renderPanel();
    await unlock();

    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(1);
    expect(mocks.recoverLocalShieldedWallet.mock.calls[0][1]).toEqual({
      derivedSecretField: identity.derivedSecretField,
      identityCommitment: identity.identityCommitment,
    });

    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.wallet" }));
    chooseAction("receiveCode");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    const code = (await screen.findByRole("textbox", {
      name: "shielded.receiveCodeLabel",
    })) as HTMLTextAreaElement;
    expect(code.value).toBe("dfrecv1ownreceivecode");
    expect(mocks.createOwnShieldedReceiveCode).toHaveBeenCalledWith(identity);

    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("shows the unlocked name and both balances without the former large balance panel", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 7n), valueNote(2n, 19n), budgetNote(3n, { remaining: 20n })]),
    );
    renderPanel();
    await unlock();
    expect(screen.getByText(identity.identity.fullName)).toBeTruthy();
    expect(screen.getByText("shielded.identityHash")).toBeTruthy();
    const identityHash = screen.getByText(identity.personHash);
    expect(identityHash.textContent).toBe(identity.personHash);
    expect(identityHash.closest('section[aria-label="shielded.balanceTitle"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.copyIdentityHash" })).toBeTruthy();
    const availableBalance = screen.getByText("shielded.balanceAmount").closest("div");
    const pendingBalance = screen.getByText("shielded.budgetAmount").closest("div");
    expect(availableBalance).toBeTruthy();
    expect(pendingBalance).toBeTruthy();
    expect(within(availableBalance!).getByText("26")).toBeTruthy();
    expect(within(pendingBalance!).getByText("20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.actions.recover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.lock" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "shielded.balanceTitle" })).toBeNull();
    expect(screen.queryByText("shielded.sessionHint")).toBeNull();
    expect(screen.queryByText("shielded.unlocked")).toBeNull();
    expect(screen.queryByText("shielded.balanceHint")).toBeNull();
    expect(screen.queryByText("shielded.budgetHint")).toBeNull();
    expect(screen.queryByText("shielded.identityHashLabel", { selector: "summary" })).toBeNull();
    expect(screen.queryByText("shielded.transactionWalletLabel")).toBeNull();
  });

  it("copies the complete unlocked identity hash through the Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("button", { name: "shielded.copyIdentityHash" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(identity.personHash));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("search.copied"));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
    expect(mocks.createOwnShieldedReceiveCode).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "rejected"])(
    "copies the full identity hash with a temporary field when the Clipboard API is %s",
    async (state) => {
      const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
      vi.stubGlobal("navigator", {
        clipboard: state === "unavailable" ? undefined : { writeText },
      });
      let copiedValue: string | undefined;
      const execCommand = vi.fn().mockImplementation(() => {
        copiedValue = document.querySelector("textarea")?.value;
        return true;
      });
      Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("button", { name: "shielded.copyIdentityHash" }));

      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("search.copied"));
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(copiedValue).toBe(identity.personHash);
      expect(document.querySelector("textarea")).toBeNull();
      expect(mocks.toastError).not.toHaveBeenCalled();
      if (state === "rejected") expect(writeText).toHaveBeenCalledWith(identity.personHash);
    },
  );

  it.each(["returns false", "throws"])(
    "removes the temporary copy field and reports failure when the fallback %s",
    async (failure) => {
      vi.stubGlobal("navigator", { clipboard: undefined });
      const execCommand = vi.fn().mockImplementation(() => {
        if (failure === "throws") throw new Error("Copy unavailable");
        return false;
      });
      Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("button", { name: "shielded.copyIdentityHash" }));

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("search.copyFailed"));
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(document.querySelector("textarea")).toBeNull();
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(screen.getByText(identity.personHash)).toBeTruthy();
    },
  );

  it("generates the receive code without a transaction wallet or fee-wallet confirmation", async () => {
    const panel = renderPanel();
    await unlock();
    panel.rerenderAccount(account, null);
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.wallet" }));
    chooseAction("receiveCode");

    expect(screen.queryByText("shielded.walletNotReady")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    expect(await screen.findByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeTruthy();
    // Generating a code changes no balance and sends no transaction.
    expect(screen.queryByText("shielded.done")).toBeNull();
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(1);
  });

  it("keeps the generated receive code only while the identity stays unlocked", async () => {
    renderPanel();
    await unlock();
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.wallet" }));
    chooseAction("receiveCode");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    const code = (await screen.findByRole("textbox", {
      name: "shielded.receiveCodeLabel",
    })) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeNull();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.wallet" }));
    chooseAction("receiveCode");
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeNull();
  });

  it("clears the raw passphrase as soon as derivation completes, before recovery finishes", async () => {
    const recovery = deferred<LocalShieldedWalletSnapshot>();
    mocks.recoverLocalShieldedWallet.mockReturnValueOnce(recovery.promise);
    renderPanel();
    const input = screen.getByRole("textbox", { name: "Identity passphrase" }) as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(1));
    expect(mocks.clearSecretInputs).toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(screen.queryByRole("textbox", { name: "Identity passphrase" })).toBeNull();

    await act(async () => recovery.resolve(walletSnapshot()));
    expect(screen.getByRole("button", { name: "shielded.lock" })).toBeTruthy();
  });

  it("locks away decrypted balances and starts a new recovery cache for another identity", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const otherIdentity = {
      ...identity,
      derivedSecretField: "987",
      identityCommitment: "654",
      personHash: `0x${"34".repeat(32)}`,
    };
    const first = walletSnapshot([valueNote(1n, 7n)]);
    const second = walletSnapshot([valueNote(2n, 19n)], otherIdentity);
    mocks.deriveIdentityFromForm
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(otherIdentity);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    renderPanel();
    await unlock();

    expect(screen.getByText("shielded.balanceAmount")).toBeTruthy();
    expect(screen.getByText(identity.personHash)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(mocks.recoverLocalShieldedWallet.mock.calls[1][2].previous).toBe(first);

    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("shielded.balanceAmount")).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.recover" })).toBeNull();
    expect(screen.queryByText(identity.personHash)).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.copyIdentityHash" })).toBeNull();
    await unlock();

    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(2);
    expect(mocks.recoverLocalShieldedWallet.mock.calls[2][1].identityCommitment).toBe(
      otherIdentity.identityCommitment,
    );
    expect(mocks.recoverLocalShieldedWallet.mock.calls[2][2].previous).toBeUndefined();
    expect(screen.queryByText(identity.personHash)).toBeNull();
    expect(screen.getByText(otherIdentity.personHash)).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.copyIdentityHash" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.copyIdentityHash" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(otherIdentity.personHash));
    expect(writeText).not.toHaveBeenCalledWith(identity.personHash);
  });

  it("keeps a successfully unlocked identity when recovery fails and retries without another passphrase", async () => {
    mocks.recoverLocalShieldedWallet.mockRejectedValueOnce(new Error("RPC unavailable"));
    renderPanel();
    await unlock();

    expect(screen.getByRole("alert").textContent).toContain("account still unlocked");
    expect(screen.getByRole("alert").textContent).toContain("RPC unavailable");
    expect(screen.getByRole("button", { name: "shielded.lock" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await screen.findByText("shielded.done");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("preserves the confirmed transaction hash if the later balance refresh fails", async () => {
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    mocks.recoverLocalShieldedWallet
      .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 10n)]))
      .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 10n)]))
      .mockRejectedValueOnce(new Error("RPC unavailable"));
    renderPanel();
    await unlock();
    fillTransfer(receiveCodeFor(99n), "6");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Transaction confirmed"),
    );
    expect(screen.getByRole("alert").textContent).toContain("RPC unavailable");
    expect(screen.getByRole("alert").textContent).toContain(transactionHash);
    expect(mocks.submitPrivateTransfer).toHaveBeenCalledTimes(1);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("shows local wallet nonce recovery guidance instead of the raw RPC error", async () => {
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    mocks.submitPrivateTransfer.mockRejectedValueOnce(
      new Error("RPC 0x7a69: Nonce too high. Expected nonce 1344 but got 1353"),
    );
    renderPanel();
    await unlock();
    fillTransfer(receiveCodeFor(99n), "6");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "errors.contractError.LOCAL_NONCE_TOO_HIGH",
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toContain("could not coalesce error");
  });

  it("shows translated identity validation errors before unlocking or recovering balances", async () => {
    mocks.deriveIdentityFromForm.mockRejectedValueOnce(new InheritanceError("nameRequired"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("inheritance.errors.nameRequired"),
    );
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
    expect(mocks.createOwnShieldedReceiveCode).not.toHaveBeenCalled();
  });

  it("keeps the wallet locked and clears an empty passphrase", async () => {
    mocks.deriveIdentityFromForm.mockRejectedValueOnce(new InheritanceError("passphraseRequired"));
    renderPanel();
    const input = screen.getByRole("textbox", {
      name: "Identity passphrase",
    }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: " " },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "inheritance.errors.passphraseRequired",
      ),
    );
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.lock" })).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("shielded.balanceAmount")).toBeNull();
    expect(input.value).toBe("");
    expect(mocks.clearSecretInputs).toHaveBeenCalled();
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
    expect(mocks.createOwnShieldedReceiveCode).not.toHaveBeenCalled();
  });

  it("separates wallet, giving, and receiving tasks with the required money choices directly visible", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]),
    );
    renderPanel();
    await unlock();

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "shielded.groups.wallet" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "shielded.groups.inheritance" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "shielded.groups.receive" })).toBeTruthy();
    chooseAction("privateTransfer");
    expect(screen.queryByText("shielded.advancedOptions", { selector: "summary" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Balance 1: 3 DEEP" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Balance 2: 7 DEEP" })).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "shielded.fields.useSecondValueNote" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.valueNote" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.secondValueNote", hidden: true }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    expect(screen.getByRole("heading", { name: "shielded.actions.fund" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.actions.fund" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.shield" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.privateTransfer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.unshield" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.receiveCode" })).toBeNull();
    expect(screen.queryByText("shielded.guide.title")).toBeNull();
  });

  it("keeps the same-wallet privacy warning advisory after a successful deposit", async () => {
    const code = receiveCodeFor(99n);
    const recipient = verifiedRecipient(99n);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(recipient);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]))
      .mockResolvedValueOnce(walletSnapshot());
    renderPanel();
    await unlock();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.submitShield).toHaveBeenCalledTimes(1);
    expect(mocks.tokenAllowance).toHaveBeenCalledWith(account, poolAddress);

    chooseAction("privateTransfer");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: code },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    fireEvent.click(balanceChoice(1, 10));
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(screen.getByText("shielded.switchWalletPrompt")).toBeTruthy();
    expect(submit.disabled).toBe(false);
    expect(screen.queryByRole("checkbox", { name: "shielded.switchWalletPrompt" })).toBeNull();
    fireEvent.click(submit);
    await screen.findByText("shielded.done");
    expect(mocks.verifyShieldedReceiveCode).toHaveBeenCalledWith(code);
    expect(mocks.submitPrivateTransfer).toHaveBeenCalledTimes(1);
  });

  it("allows a private transfer without a default wallet reminder", async () => {
    const code = receiveCodeFor(99n);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    renderPanel();
    await unlock();
    fillTransfer(code, "6");

    expect(screen.queryByText("shielded.switchWalletPrompt")).toBeNull();
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await screen.findByText("shielded.done");
    expect(mocks.verifyShieldedReceiveCode).toHaveBeenCalledWith(code);
    expect(mocks.submitPrivateTransfer).toHaveBeenCalledTimes(1);
  });

  it("uses a manually selected sufficient balance and pays only a verified receive code", async () => {
    const recipient = verifiedRecipient(99n);
    const code = receiveCodeFor(99n);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    fireEvent.click(balanceChoice(2, 7));
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "shielded.receiveCodeErrors.malformed",
      ),
    );
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: code },
    });
    expect(screen.getByText(`Recipient: ${recipient.personHash}`)).toBeTruthy();
    // The page cannot name this recipient, so the payer must confirm the identity first.
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
    expect(submit.disabled).toBe(false);

    mocks.verifyShieldedReceiveCode.mockRejectedValueOnce(new ShieldedReceiveCodeError("invalid"));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.receiveCodeErrors.invalid"),
    );
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();

    mocks.verifyShieldedReceiveCode.mockResolvedValueOnce(recipient);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledTimes(1));
    expect(mocks.verifyShieldedReceiveCode).toHaveBeenLastCalledWith(code);
    expect(mocks.prepareShieldedPrivateTransfer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        inputs: [expect.objectContaining({ commitment: 2n })],
        destinations: [
          { kind: "recipient", recipient, amount: 6n },
          expect.objectContaining({ kind: "inputOwner", amount: 1n }),
        ],
      }),
    );
    await screen.findByText("shielded.done");
    expect(
      (
        screen.getByRole("textbox", {
          name: "shielded.receiveCodeInputLabel",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it.each(["privateTransfer", "unshield"])(
    "requires an explicit money choice before %s can submit",
    async (action) => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(
        walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]),
      );
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      if (action === "privateTransfer") {
        fillTransfer(receiveCodeFor(99n), "6", null);
      } else {
        chooseAction("unshield");
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
          target: { value: "6" },
        });
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
          target: { value: account },
        });
      }
      expect(screen.getByText("shielded.fields.valueNote", { selector: "legend" })).toBeTruthy();
      const role = action === "unshield" ? "radio" : "checkbox";
      const otherRole = action === "unshield" ? "checkbox" : "radio";
      expect(screen.getAllByRole(role, { name: /^Balance / })).toHaveLength(3);
      expect(screen.queryAllByRole(otherRole, { name: /^Balance / })).toHaveLength(0);
      expect(
        screen
          .getAllByRole(role, { name: /^Balance / })
          .every((choice) => !(choice as HTMLInputElement).checked),
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
      expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
      expect(mocks.submitUnshield).not.toHaveBeenCalled();
    },
  );

  it("uses exactly the two checked balances for a private payment", async () => {
    const recipient = verifiedRecipient(99n);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(recipient);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]),
    );
    renderPanel();
    await unlock();
    fillTransfer(receiveCodeFor(99n), "9", null);
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(balanceChoice(2, 7));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [
          expect.objectContaining({ commitment: 1n }),
          expect.objectContaining({ commitment: 2n }),
        ],
        destinations: [
          { kind: "recipient", recipient, amount: 9n },
          { kind: "inputOwner", inputIndex: 0, amount: 1n },
        ],
      }),
    );
  });

  it("rejects insufficient selected money and requires a new explicit choice after everything is unchecked", async () => {
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]),
    );
    renderPanel();
    await unlock();
    fillTransfer(receiveCodeFor(99n), "6", null);
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();

    fireEvent.click(balanceChoice(1, 3));
    expect(balanceChoice(1, 3).checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
    fireEvent.click(balanceChoice(2, 7));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: [expect.objectContaining({ commitment: 2n })] }),
    );
  });

  it("disables a third transfer balance at the two-input limit while allowing checked balances to be unchecked", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    expect(screen.getByText("Balance limit: 2")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const first = balanceChoice(1, 3);
    const second = balanceChoice(2, 7);
    const third = balanceChoice(3, 50);
    expect(third.disabled).toBe(false);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);
    expect(first.disabled).toBe(false);
    expect(second.disabled).toBe(false);
    expect(third.checked).toBe(false);
    expect(third.disabled).toBe(true);

    fireEvent.click(first);
    expect(first.checked).toBe(false);
    expect(second.checked).toBe(true);
    expect(third.disabled).toBe(false);
    fireEvent.click(third);
    expect(second.checked).toBe(true);
    expect(third.checked).toBe(true);
    expect(first.disabled).toBe(true);
  });

  it("shows only positive balances as selectable money", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 0n), valueNote(2n, 3n), valueNote(3n, 7n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    expect(screen.getAllByRole("checkbox", { name: /^Balance / })).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /: 0 DEEP$/ })).toBeNull();
    expect(balanceChoice(1, 3)).toBeTruthy();
    expect(balanceChoice(2, 7)).toBeTruthy();
  });

  it("uses native radios to switch withdrawal balances directly without combining insufficient money", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    expect(screen.getByText("shielded.singleValueSelectionHint")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox", { name: /^Balance / })).toHaveLength(0);
    const group = screen.getByRole("radiogroup", { name: "shielded.fields.valueNote" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    const first = screen.getByRole("radio", { name: "Balance 1: 3 DEEP" }) as HTMLInputElement;
    const second = screen.getByRole("radio", { name: "Balance 2: 7 DEEP" }) as HTMLInputElement;
    expect(first.type).toBe("radio");
    expect(second.type).toBe("radio");
    expect(first.name).not.toBe("");
    expect(second.name).toBe(first.name);
    expect(first.checked).toBe(false);
    expect(second.checked).toBe(false);
    fireEvent.click(balanceChoice(1, 3));
    expect(balanceChoice(1, 3).disabled).toBe(false);
    expect(balanceChoice(2, 7).disabled).toBe(false);
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(false);
    expect(screen.getByText("shielded.singleValueSelectionSummary")).toBeTruthy();
    expect(screen.queryByText("shielded.valueSelectionSummary")).toBeNull();
    fireEvent.click(first);
    expect(first.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();

    fireEvent.click(balanceChoice(2, 7));
    expect(first.checked).toBe(false);
    expect(second.checked).toBe(true);
    expect(first.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedUnshield).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ commitment: 2n }) }),
    );
  });

  it("rejects a withdrawal when its selected balance disappears instead of replacing it with other money", async () => {
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(walletSnapshot([valueNote(2n, 50n)]))
      .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 3n), valueNote(2n, 50n)]));
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "shielded.singleSelectedValueUnavailable",
      ),
    );
    expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
    expect(mocks.submitUnshield).not.toHaveBeenCalled();
  });

  it("requires an explicit withdrawal choice even when only one balance is available", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    renderPanel();
    await unlock();
    chooseAction("unshield");
    const choice = screen.getByRole("radio", {
      name: "Balance 1: 10 DEEP",
    }) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(choice.checked).toBe(false);
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
    fireEvent.click(choice);
    expect(choice.checked).toBe(true);
    expect(submit.disabled).toBe(false);
  });

  it("disables the native withdrawal radio group while the selected transaction is being prepared", async () => {
    const preparation = deferred<{
      data: object;
      witness: object;
      amount: bigint;
      recipient: string;
    }>();
    mocks.prepareShieldedUnshield.mockReturnValue(preparation.promise);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.prepareShieldedUnshield).toHaveBeenCalledTimes(1));

    const choices = screen.getAllByRole("radio", { name: /^Balance / }) as HTMLInputElement[];
    expect(choices).toHaveLength(2);
    expect(choices.every((choice) => choice.matches(":disabled"))).toBe(true);
    expect(choices[0].checked).toBe(true);
    expect(choices[1].checked).toBe(false);
    await act(async () =>
      preparation.resolve({ data: {}, witness: {}, amount: 2n, recipient: account }),
    );
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedUnshield).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ commitment: 1n }) }),
    );
  });

  it.each(["missing", "spent"])(
    "can directly select another withdrawal radio after its selected balance becomes %s",
    async (change) => {
      const initial = walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]);
      const refreshed = walletSnapshot(
        change === "missing" ? [valueNote(2n, 7n)] : [valueNote(1n, 3n), valueNote(2n, 7n)],
      );
      if (change === "spent") {
        const keys = deriveShieldedHeirKeyMaterial(identity.derivedSecretField);
        refreshed.spentNullifiers.add(
          computeShieldedSpendNullifier(
            { ownerSecret: keys.ownerSecret, noteCommitment: 1n },
            scope,
          ),
        );
        const recovery = await vi.importActual<typeof import("../services/shieldedWalletRecovery")>(
          "../services/shieldedWalletRecovery",
        );
        mocks.listUnspentRecoveredShieldedNotes.mockImplementation(
          recovery.listUnspentRecoveredShieldedNotes,
        );
      }
      mocks.recoverLocalShieldedWallet.mockResolvedValue(refreshed).mockResolvedValueOnce(initial);
      renderPanel();
      await unlock();
      chooseAction("unshield");
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
        target: { value: "2" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
        target: { value: account },
      });
      fireEvent.click(balanceChoice(1, 3));
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
      await screen.findByText("shielded.done");
      const unavailable = screen.getByRole("radio", {
        name: "shielded.singleSelectedValueUnavailable",
      }) as HTMLInputElement;
      const replacement = screen.getByRole("radio", {
        name: "Balance 1: 7 DEEP",
      }) as HTMLInputElement;
      expect(unavailable.checked).toBe(true);
      expect(unavailable.disabled).toBe(true);
      expect(replacement.checked).toBe(false);
      expect(replacement.disabled).toBe(false);
      expect(replacement.name).toBe(unavailable.name);
      expect(screen.queryAllByRole("checkbox", { name: /^Balance / })).toHaveLength(0);
      expect(
        (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      fireEvent.click(replacement);
      expect(replacement.checked).toBe(true);
      expect(
        screen.queryByRole("radio", { name: "shielded.singleSelectedValueUnavailable" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "shielded.clearValueSelection" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() => expect(mocks.prepareShieldedUnshield).toHaveBeenCalledTimes(1));
      expect(mocks.prepareShieldedUnshield).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ commitment: 2n }) }),
      );
      expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
    },
  );

  it("can clear a stale withdrawal radio after its only available balance disappears", async () => {
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(walletSnapshot())
      .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 3n)]));
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await screen.findByText("shielded.done");
    const unavailable = screen.getByRole("radio", {
      name: "shielded.singleSelectedValueUnavailable",
    }) as HTMLInputElement;
    expect(unavailable.checked).toBe(true);
    expect(unavailable.disabled).toBe(true);
    expect(screen.queryAllByRole("radio", { name: /^Balance / })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "shielded.clearValueSelection" }));

    expect(
      screen.queryByRole("radio", { name: "shielded.singleSelectedValueUnavailable" }),
    ).toBeNull();
    expect(screen.getByText("shielded.noRecoveredNote")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.clearValueSelection" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
  });

  it("keeps explicit money choices when balances are refreshed and lets the user uncheck an unavailable choice", async () => {
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(walletSnapshot([valueNote(2n, 7n), valueNote(3n, 50n)]))
      .mockResolvedValueOnce(
        walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]),
      );
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fillTransfer(receiveCodeFor(99n), "9", null);
    fireEvent.click(balanceChoice(1, 3));
    fireEvent.click(balanceChoice(2, 7));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await screen.findByText("shielded.done");
    const unavailable = screen.getByRole("checkbox", {
      name: "shielded.selectedValueUnavailable",
    }) as HTMLInputElement;
    expect(unavailable.checked).toBe(true);
    expect(balanceChoice(1, 7).checked).toBe(true);
    expect(balanceChoice(2, 50).checked).toBe(false);
    expect(balanceChoice(2, 50).disabled).toBe(true);
    fireEvent.click(unavailable);
    expect(
      screen.queryByRole("checkbox", { name: "shielded.selectedValueUnavailable" }),
    ).toBeNull();
    expect(balanceChoice(1, 7).checked).toBe(true);
    expect(balanceChoice(2, 50).disabled).toBe(false);
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
  });

  it.each(["missing", "spent"])(
    "refuses to replace checked money automatically when a selected balance becomes %s during refresh",
    async (change) => {
      const initial = walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)]);
      const refreshed = walletSnapshot(
        change === "missing"
          ? [valueNote(2n, 7n), valueNote(3n, 50n)]
          : [valueNote(1n, 3n), valueNote(2n, 7n), valueNote(3n, 50n)],
      );
      if (change === "spent") {
        const keys = deriveShieldedHeirKeyMaterial(identity.derivedSecretField);
        refreshed.spentNullifiers.add(
          computeShieldedSpendNullifier(
            { ownerSecret: keys.ownerSecret, noteCommitment: 1n },
            scope,
          ),
        );
        const recovery = await vi.importActual<typeof import("../services/shieldedWalletRecovery")>(
          "../services/shieldedWalletRecovery",
        );
        mocks.listUnspentRecoveredShieldedNotes.mockImplementation(
          recovery.listUnspentRecoveredShieldedNotes,
        );
      }
      mocks.recoverLocalShieldedWallet.mockResolvedValue(refreshed).mockResolvedValueOnce(initial);
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      fillTransfer(receiveCodeFor(99n), "9", null);
      fireEvent.click(balanceChoice(1, 3));
      fireEvent.click(balanceChoice(2, 7));
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "shielded.selectedValueUnavailable",
        ),
      );
      expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
      expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
      const unavailable = screen.getByRole("checkbox", {
        name: "shielded.selectedValueUnavailable",
      }) as HTMLInputElement;
      expect(unavailable.checked).toBe(true);
      expect(balanceChoice(1, 7).checked).toBe(true);
      fireEvent.click(unavailable);
      fireEvent.click(balanceChoice(1, 7));
      expect(
        (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      fireEvent.click(balanceChoice(2, 50));
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await screen.findByText("shielded.done");
      expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ inputs: [expect.objectContaining({ commitment: 3n })] }),
      );
    },
  );

  it("creates a recipient's code from their credentials, clears the passphrase, then pays that code", async () => {
    const code = receiveCodeFor(99n);
    const recipient = verifiedRecipient(99n);
    const generation = deferred<string>();
    mocks.createShieldedReceiveCodeForRecipient.mockReturnValue(generation.promise);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(recipient);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));

    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    fireEvent.click(balanceChoice(1, 10));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    enterRecipientCredentials();
    // A payment never reads credentials; they only create a receive code.
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.generateReceiveCodeFirst"),
    );
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();

    const password = enterRecipientCredentials("child-passphrase-sentinel");
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
    await waitFor(() =>
      expect(mocks.createShieldedReceiveCodeForRecipient).toHaveBeenCalledTimes(1),
    );
    expect(password.value).toBe("");
    expect(mocks.createShieldedReceiveCodeForRecipient).toHaveBeenCalledWith({
      identity: {
        fullName: "Child Recipient",
        gender: 2,
        isBirthBC: false,
        birthYear: 2004,
        birthMonth: 5,
        birthDay: 6,
      },
      rawPassphrase: "child-passphrase-sentinel",
    });

    await act(async () => generation.resolve(code));
    const codeInput = screen.getByRole("textbox", {
      name: "shielded.receiveCodeInputLabel",
    }) as HTMLTextAreaElement;
    expect(codeInput.value).toBe(code);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.verifyShieldedReceiveCode).toHaveBeenCalledWith(code);
    expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destinations: [
          { kind: "recipient", recipient, amount: 6n },
          { kind: "inputOwner", inputIndex: 0, amount: 4n },
        ],
      }),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("shows a translated empty recipient passphrase error without creating a code or submitting a payment", async () => {
    mocks.createShieldedReceiveCodeForRecipient.mockRejectedValueOnce(
      new InheritanceError("passphraseRequired"),
    );
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    const password = enterRecipientCredentials(" ");
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "inheritance.errors.passphraseRequired",
      ),
    );
    expect(password.value).toBe("");
    expect(
      screen.getByRole("radio", { name: "shielded.recipientMethods.credentials" }),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeInputLabel" })).toBeNull();
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(1);
  });

  it("does not block credentials with a hidden receive-code confirmation and reconfirms a new code", async () => {
    const oldCode = receiveCodeFor(99n);
    const newCode = receiveCodeFor(100n);
    const generation = deferred<string>();
    mocks.createShieldedReceiveCodeForRecipient.mockReturnValue(generation.promise);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    fireEvent.click(balanceChoice(1, 10));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: oldCode },
    });
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    enterRecipientCredentials();
    expect(screen.queryByRole("checkbox", { name: "shielded.recipientConfirm" })).toBeNull();
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.generateReceiveCodeFirst"),
    );
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();

    // Confirm the old code before generating another recipient's code. That
    // confirmation must not carry over to the newly generated identity.
    fireEvent.click(screen.getByRole("radio", { name: "shielded.recipientMethods.receiveCode" }));
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
    expect(submit.disabled).toBe(false);
    enterRecipientCredentials();
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
    await waitFor(() =>
      expect(mocks.createShieldedReceiveCodeForRecipient).toHaveBeenCalledTimes(1),
    );
    await act(async () => generation.resolve(newCode));

    expect(
      (
        screen.getByRole("textbox", {
          name: "shielded.receiveCodeInputLabel",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(newCode);
    const confirmation = screen.getByRole("checkbox", {
      name: "shielded.recipientConfirm",
    }) as HTMLInputElement;
    expect(confirmation.checked).toBe(false);
    expect(submit.disabled).toBe(true);
    fireEvent.click(confirmation);
    expect(submit.disabled).toBe(false);
  });

  it("automatically skips immature, underfunded, and revoked budgets when claiming inheritance", async () => {
    const timestamp = Number(1_000n + 2n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY));
    const recovered = walletSnapshot([
      budgetNote(1n, { eligibleFrom: BigInt(timestamp) }),
      budgetNote(2n, { remaining: 9n }),
      budgetNote(3n, { rootIdentityCommitment: 999n, eligibleFrom: 999n }),
      budgetNote(4n),
    ]);
    mocks.findHeirLegitimacy.mockImplementation(
      ({ root }: { root: { identityCommitment: bigint } }) =>
        root.identityCommitment === 999n ? [] : [{ writtenAt: 0n }],
    );
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
    chooseAction("claim");
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() => expect(mocks.prepareShieldedClaim).toHaveBeenCalledTimes(1));
    expect(mocks.prepareShieldedClaim.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        identity,
        budgetCommitment: 4n,
        periodIndices: [0n, 1n],
        asOf: timestamp,
      }),
    );
    await screen.findByText("shielded.done");
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it.each([1, 7, 14, 21, 30, 90, 180, 365])(
    "creates a first budget using the %s-day shortcut",
    async (days) => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
      await fillFundingRecipient(99n);
      const interval = screen.getByRole("combobox", {
        name: "shielded.fields.periodDays",
      }) as HTMLSelectElement;
      expect(interval.value).toBe("30");
      expect(Array.from(interval.options, (option) => option.value)).toEqual([
        "1",
        "7",
        "14",
        "21",
        "30",
        "90",
        "180",
        "365",
        "custom",
      ]);
      fireEvent.change(interval, { target: { value: days.toString() } });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await screen.findByText("shielded.done");
      expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
        expect.objectContaining({ periodDays: BigInt(days), amountPerPeriod: 10n }),
        expect.objectContaining(scope),
      );
      expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
        expect.objectContaining({ policy: expect.objectContaining({ periodDays: BigInt(days) }) }),
      );
    },
  );

  it.each(["366", "4294967295"])(
    "creates a budget with custom %s days without a one-year limit",
    async (days) => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
      await fillFundingRecipient(99n);
      fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.periodDays" }), {
        target: { value: "custom" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.customPeriodDays" }), {
        target: { value: days },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await screen.findByText("shielded.done");
      expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
        expect.objectContaining({ periodDays: BigInt(days) }),
        expect.objectContaining(scope),
      );
    },
  );

  it.each(["", "0", "-1", "1.5", "4294967296", "9007199254740993"])(
    "rejects unsupported custom days %s before budget preparation",
    async (days) => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
      await fillFundingRecipient(99n);
      fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.periodDays" }), {
        target: { value: "custom" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.customPeriodDays" }), {
        target: { value: days },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "inheritance.errors.periodDaysInvalid",
        ),
      );
      expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
      expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
    },
  );

  it.each([
    { draft: "shortcut", choice: "7", input: undefined, switchIdentity: false },
    { draft: "custom", choice: "custom", input: "7", switchIdentity: true },
    { draft: "invalid custom", choice: "custom", input: "0", switchIdentity: true },
  ])("restores the default period after locking a $draft cycle draft", async (scenario) => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.periodDays" }), {
      target: { value: scenario.choice },
    });
    if (scenario.input !== undefined) {
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.customPeriodDays" }), {
        target: { value: scenario.input },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(screen.queryByRole("combobox", { name: "shielded.fields.periodDays" })).toBeNull();

    const nextIdentity = scenario.switchIdentity
      ? {
          ...identity,
          derivedSecretField: "987",
          identityCommitment: "654",
          personHash: wrapIdentityCommitmentAsPersonHash(654n),
        }
      : identity;
    const nextValue = valueNote(2n, 30n);
    if (nextValue.note.kind !== "value") throw new Error("Value missing");
    nextValue.note.ownerCommitment = deriveShieldedHeirKeyMaterial(
      nextIdentity.derivedSecretField,
    ).ownerCommitment;
    mocks.deriveIdentityFromForm.mockResolvedValue(nextIdentity);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([nextValue], nextIdentity));
    mocks.loadLineageSnapshot.mockResolvedValue(
      familySnapshot({ father: BigInt(nextIdentity.identityCommitment) }),
    );
    await unlock();
    chooseAction("fund");
    expect(
      (screen.getByRole("combobox", { name: "shielded.fields.periodDays" }) as HTMLSelectElement)
        .value,
    ).toBe("30");
    expect(screen.queryByRole("textbox", { name: "shielded.fields.customPeriodDays" })).toBeNull();
    await fillFundingRecipient(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
      expect.objectContaining({
        rootIdentityCommitment: BigInt(nextIdentity.identityCommitment),
        periodDays: 30n,
      }),
      expect.objectContaining(scope),
    );
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({ policy: expect.objectContaining({ periodDays: 30n }) }),
    );
  });

  it("shows the recovered arrangement's cycle as fixed during additional funding", async () => {
    const policy = { ...policyDescriptor(), periodDays: 7n };
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.listRecoveredShieldedPolicies.mockReturnValue([policy]);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policy,
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(
              policy.allocationKey,
              scope,
            ),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    expect(screen.getByText("Every 7 days")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.periodDays" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "shielded.fields.customPeriodDays" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({ policy: expect.objectContaining({ periodDays: 7n }) }),
    );
  });

  it.each([1n, 7n, 365n])(
    "shows due periods using a %s-day budget instead of a fixed 30-day period",
    async (periodDays) => {
      const start = 1_000n;
      const dueAt = start + periodDays * SECONDS_PER_DAY;
      mocks.getBlock.mockResolvedValue({ timestamp: Number(dueAt) });
      mocks.recoverLocalShieldedWallet.mockResolvedValue(
        walletSnapshot([budgetNote(1n, { periodDays, remaining: 30n })]),
      );
      renderPanel();
      await unlock();
      const first = await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
      expect(screen.queryByRole("checkbox", { name: "Period 2: 10 DEEP" })).toBeNull();
      expect(first.closest("label")?.textContent).toContain(
        new Date(Number(dueAt * 1000n)).toLocaleDateString(),
      );
      expect(
        screen.getByText(
          `Next due: ${new Date(Number((start + 2n * periodDays * SECONDS_PER_DAY) * 1000n)).toLocaleString()}`,
        ),
      ).toBeTruthy();
    },
  );

  it("lists different claim intervals as distinct budgets with their own period choices", async () => {
    mocks.getBlock.mockResolvedValue({ timestamp: Number(1_000n + 7n * SECONDS_PER_DAY) });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([
        budgetNote(1n, { periodDays: 1n, remaining: 30n }),
        budgetNote(2n, { periodDays: 7n, remaining: 20n }),
      ]),
    );
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 3: 10 DEEP" });
    const budgets = screen.getByRole("combobox", {
      name: "shielded.fields.budgetNote",
    }) as HTMLSelectElement;
    expect(Array.from(budgets.options, (option) => option.text)).toEqual([
      "Budget 1: 30 DEEP / Every 1 days",
      "Budget 2: 20 DEEP / Every 7 days",
    ]);
    fireEvent.change(budgets, { target: { value: budgets.options[1].value } });
    expect(screen.getByRole("checkbox", { name: "Period 1: 10 DEEP" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Period 2: 10 DEEP" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 2n, periodIndices: [0n] }),
    );
  });

  it("renders an unavailable date label for long valid claim cycles", async () => {
    mocks.getBlock.mockResolvedValue({ timestamp: 1_000 });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([budgetNote(1n, { periodDays: 4_294_967_295n })]),
    );
    renderPanel();
    await unlock();
    await screen.findByText("Next due: shielded.dateOutOfRange");
    expect(document.body.textContent).not.toContain("Invalid Date");
    expect(screen.queryByRole("checkbox", { name: "Period 1: 10 DEEP" })).toBeNull();
  });

  it.each([
    { mode: "private", versions: [7, 3] },
    { mode: "public", versions: [7, 3] },
    { mode: "private", versions: [3] },
    { mode: "public", versions: [3] },
  ])(
    "requires choosing a parent version for a new $mode budget with $versions",
    async ({ mode, versions }) => {
      mocks.loadLineageSnapshot.mockResolvedValue(
        familySnapshot({ fatherVersions: versions, mother: 0n }),
      );
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      renderPanel();
      await unlock();
      chooseAction("fund");
      if (mode === "public") {
        fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
      }
      const version = screen.getByRole("combobox", {
        name: "shielded.fields.familyVersion",
      }) as HTMLSelectElement;
      await waitFor(() => expect(version.options.length).toBe(versions.length + 1));
      expect(version.value).toBe("");
      expect(Array.from(version.options, (option) => option.value)).toEqual([
        "",
        ...versions.map(String),
      ]);
      expect(version.options[0].text).toBe("shielded.fundingVersionPlaceholder");
      const child = screen.getByRole("combobox", {
        name: "shielded.fields.heirPersonHash",
      }) as HTMLSelectElement;
      expect(Array.from(child.options, (option) => option.value)).toEqual([""]);
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      fireEvent.click(submit);
      expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
      expect(screen.queryByText(/Funding family:/)).toBeNull();
    },
  );

  it.each(["private", "public"])(
    "filters children by the chosen parent version and clears the recipient when it changes during %s funding",
    async (mode) => {
      mocks.loadLineageSnapshot.mockResolvedValue(
        familySnapshot({
          fatherVersions: [2, 1],
          mother: 0n,
          extraChildren: [{ identityCommitment: 100n, fatherIdentityCommitment: 777n }],
        }),
      );
      mocks.findHeirLegitimacy.mockImplementation(
        ({
          heir,
          rootVersionIndex,
        }: {
          heir: { identityCommitment: bigint };
          rootVersionIndex: number;
        }) =>
          (rootVersionIndex === 1 && heir.identityCommitment === 99n) ||
          (rootVersionIndex === 2 && heir.identityCommitment === 100n)
            ? [{ writtenAt: 0n }]
            : [],
      );
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(100n));
      renderPanel();
      await unlock();
      chooseAction("fund");
      if (mode === "public") {
        fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
      }
      await selectFundingChild(99n, 1);
      const child = screen.getByRole("combobox", {
        name: "shielded.fields.heirPersonHash",
      }) as HTMLSelectElement;
      expect(Array.from(child.options, (option) => option.value)).toEqual([
        "",
        wrapIdentityCommitmentAsPersonHash(99n),
      ]);
      if (mode === "private") {
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
          target: { value: receiveCodeFor(99n) },
        });
      }
      await selectFundingParentVersion(2);
      expect(child.value).toBe("");
      expect(Array.from(child.options, (option) => option.value)).toEqual([
        "",
        wrapIdentityCommitmentAsPersonHash(100n),
      ]);
      if (mode === "private") {
        expect(
          (
            screen.getByRole("textbox", {
              name: "shielded.receiveCodeInputLabel",
            }) as HTMLTextAreaElement
          ).value,
        ).toBe("");
        await fillFundingRecipient(100n, 2);
      } else {
        await selectFundingChild(100n, 2);
      }
      expect(
        (
          screen.getByRole("combobox", {
            name: "shielded.fields.familyVersion",
          }) as HTMLSelectElement
        ).value,
      ).toBe("2");
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await screen.findByText("shielded.done");
      expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
        {
          rootIdentityCommitment: 777n,
          rootVersionIndex: 2n,
          amountPerPeriod: 10n,
          periodDays: 30n,
        },
        expect.objectContaining(scope),
      );
      expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
        expect.objectContaining({ policy: expect.objectContaining({ rootVersionIndex: 2n }) }),
      );
    },
  );

  it("requires selecting a parent version again if the selected version disappears after refresh", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    renderPanel();
    await unlock();
    chooseAction("fund");
    await fillFundingRecipient(99n, 3);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    mocks.loadLineageSnapshot.mockResolvedValue(familySnapshot({ fatherVersions: [7] }));
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    const version = screen.getByRole("combobox", {
      name: "shielded.fields.familyVersion",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect((version.querySelector('option[value="3"]') as HTMLOptionElement).disabled).toBe(true),
    );
    expect(version.value).toBe("3");
    expect(
      (
        screen.getByRole("combobox", {
          name: "shielded.fields.heirPersonHash",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/Funding family:.*version 7/)).toBeNull();
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    await selectFundingChild(99n, 7);
    expect(screen.getByText(/Funding family:.*version 7/)).toBeTruthy();
  });

  it("creates consecutive private arrangements using each explicitly selected parent version", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    await fillFundingRecipient(99n, 7);
    expect(screen.queryByRole("combobox", { name: "shielded.fields.fundingRule" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenLastCalledWith(
      {
        rootVersionIndex: 7n,
        rootIdentityCommitment: 777n,
        amountPerPeriod: 10n,
        periodDays: 30n,
      },
      expect.objectContaining(scope),
    );
    expect(mocks.prepareShieldedFund).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fundMode: 0,
        donorCommitment: 1n,
        budgetPeriods: 1n,
        policy: expect.objectContaining({ rootVersionIndex: 7n, rootIdentityCommitment: 777n }),
      }),
    );
    expect(mocks.submitFundWithFreshLineage).toHaveBeenCalledTimes(1);
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.fundingRule" })).toBeNull();
    await fillFundingRecipient(99n, 3);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.prepareShieldedFund).toHaveBeenCalledTimes(2));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenLastCalledWith(
      {
        rootVersionIndex: 3n,
        rootIdentityCommitment: 777n,
        amountPerPeriod: 10n,
        periodDays: 30n,
      },
      expect.objectContaining(scope),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("lists only the unlocked parent's direct children without another-family or parent selector", async () => {
    mocks.loadLineageSnapshot.mockResolvedValue(
      familySnapshot({
        extraChildren: [
          { identityCommitment: 777n, fatherIdentityCommitment: 444n },
          { identityCommitment: 444n, fatherIdentityCommitment: 888n },
          { identityCommitment: 222n, fatherIdentityCommitment: 444n },
        ],
      }),
    );
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    await selectFundingChild(99n);
    const picker = screen.getByRole("combobox", {
      name: "shielded.fields.heirPersonHash",
    }) as HTMLSelectElement;
    expect(Array.from(picker.options, (option) => option.value)).toEqual([
      "",
      wrapIdentityCommitmentAsPersonHash(99n),
    ]);
    expect(screen.queryByRole("checkbox", { name: "shielded.fundingOtherChildren" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
  });

  it.each(["private", "public"])(
    "rejects a selected child whose eligibility is lost after refreshing during %s funding",
    async (mode) => {
      mocks.loadLineageSnapshot.mockResolvedValue(
        familySnapshot({
          extraChildren: [{ identityCommitment: 222n, fatherIdentityCommitment: 444n }],
        }),
      );
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
      chooseAction("fund");
      if (mode === "public") {
        fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
      }
      await selectFundingChild(99n);
      if (mode === "private") {
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
          target: { value: receiveCodeFor(99n) },
        });
      }
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
        target: { value: "10" },
      });
      mocks.findHeirLegitimacy.mockImplementation(
        ({ root }: { root: { identityCommitment: bigint } }) =>
          root.identityCommitment === 777n ? [] : [{ writtenAt: 0n }],
      );
      mocks.loadLineageSnapshot.mockResolvedValue(familySnapshot());
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
      await waitFor(() =>
        expect(
          screen
            .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
            .querySelector(`option[value="${wrapIdentityCommitmentAsPersonHash(99n)}"]`),
        ).toBeNull(),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "shielded.actions.recover" }).hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "shielded.recipientPicker.errors.notEligibleChild",
        ),
      );
      expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
      expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    },
  );

  it("keeps funding tied to the unlocked parent when another wallet pays the transaction gas", async () => {
    const gasAccount = "0x00000000000000000000000000000000000000cc";
    const gasSigner = {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      getAddress: async () => gasAccount,
    } as unknown as Signer;
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.listRecoveredShieldedPolicies.mockReturnValue([policyDescriptor()]);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    const panel = renderPanel();
    await unlock();
    panel.rerenderAccount(gasAccount, gasSigner);
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    await fillFundingRecipient(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    expect(screen.queryByRole("checkbox", { name: "shielded.fundingOtherChildren" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
      {
        rootIdentityCommitment: 777n,
        rootVersionIndex: 7n,
        amountPerPeriod: 10n,
        periodDays: 30n,
      },
      expect.objectContaining(scope),
    );
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({ donorDerivedSecretField: identity.derivedSecretField }),
    );
    expect(mocks.submitFundWithFreshLineage).toHaveBeenCalledWith(
      expect.objectContaining({ signer: gasSigner }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policyDescriptor(),
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.prepareShieldedFund).toHaveBeenCalledTimes(2));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedFund).toHaveBeenLastCalledWith(
      expect.objectContaining({ policy: policyDescriptor() }),
    );
    expect(mocks.submitFundWithFreshLineage).toHaveBeenLastCalledWith(
      expect.objectContaining({ signer: gasSigner }),
    );
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledTimes(1);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("requires selecting the eligible parent version instead of using another eligible parent", async () => {
    mocks.findHeirLegitimacy.mockImplementation(
      ({
        root,
        rootVersionIndex,
      }: {
        root: { identityCommitment: bigint };
        rootVersionIndex: number;
      }) => (root.identityCommitment === 333n || rootVersionIndex === 3 ? [{ writtenAt: 0n }] : []),
    );
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    await selectFundingParentVersion(7);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    expect(
      screen
        .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
        .querySelector(`option[value="${wrapIdentityCommitmentAsPersonHash(99n)}"]`),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();

    const version = screen.getByRole("combobox", {
      name: "shielded.fields.familyVersion",
    }) as HTMLSelectElement;
    expect(version.value).toBe("7");
    await fillFundingRecipient(99n, 3);
    expect(screen.getByText(/Funding family:.*version 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenCalledWith(
      {
        rootIdentityCommitment: 777n,
        rootVersionIndex: 3n,
        amountPerPeriod: 10n,
        periodDays: 30n,
      },
      expect.objectContaining(scope),
    );
  });

  it("rejects funding when the unlocked parent's eligibility changes instead of switching parents", async () => {
    const recovered = walletSnapshot([valueNote(1n, 30n)]);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValueOnce(recovered)
      .mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    await fillFundingRecipient(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    mocks.findHeirLegitimacy.mockImplementation(
      ({ root }: { root: { identityCommitment: bigint } }) =>
        root.identityCommitment === 777n ? [] : [{ writtenAt: 0n }],
    );
    const loads = mocks.loadLineageSnapshot.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
    await waitFor(() => expect(mocks.loadLineageSnapshot.mock.calls.length).toBeGreaterThan(loads));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "shielded.actions.recover" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    expect(screen.queryByText(/Funding family:.*version 4/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
  });

  it("opens funding with an empty balance and guides deposits to the wallet task", async () => {
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    expect(screen.getByRole("heading", { name: "shielded.actions.fund" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.actions.fund" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.shield" })).toBeNull();
    expect(screen.getByText("shielded.fundingNoBalance")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.fundingRule" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.valueNote" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.fundingDepositAction" }));
    expect(
      screen.getByRole("tab", { name: "shielded.groups.wallet" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "shielded.actions.fund" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("textbox", { name: "shielded.fields.amount" })).toBeTruthy();
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
  });

  it("prefills only the missing private balance when the arrangement costs more than the available money", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 3n)]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    expect(screen.queryByRole("button", { name: "shielded.actions.shield" })).toBeNull();
    await selectFundingChild(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    expect(screen.getByText("Missing private balance: 7")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.fundingDepositAction" }));
    expect(
      screen.getByRole("tab", { name: "shielded.groups.wallet" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "shielded.actions.shield" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "shielded.actions.fund" })).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "shielded.fields.amount" }) as HTMLInputElement).value,
    ).toBe("7");
  });

  it("excludes another parent's recovered policies and templates from funding", async () => {
    const ownPolicy = policyDescriptor();
    const foreignPolicy = {
      ...ownPolicy,
      rootIdentityCommitment: 111n,
      rootVersionIndex: 1n,
    };
    const ownPolicyCommitment = computeShieldedPolicyCommitment(
      {
        ...ownPolicy,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
      },
      scope,
    ).toString();
    const foreignPolicyCommitment = computeShieldedPolicyCommitment(
      {
        ...foreignPolicy,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
      },
      scope,
    ).toString();
    const recovered = walletSnapshot([valueNote(1n, 30n)]);
    recovered.fundingTemplates?.set(3n, {
      note: budgetNote(3n, {
        rootIdentityCommitment: 111n,
        rootVersionIndex: 1n,
        heirIdentityCommitment: 222n,
        heirOwnerCommitment: 98n,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
      }).note as BudgetPayload,
      commitment: 3n,
      ciphertext: new Uint8Array(),
      shardId: 0n,
    });
    mocks.listRecoveredShieldedPolicies.mockReturnValue([ownPolicy, foreignPolicy]);
    mocks.loadLineageSnapshot.mockResolvedValue(
      familySnapshot({
        extraChildren: [{ identityCommitment: 222n, fatherIdentityCommitment: 111n }],
      }),
    );
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(222n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    const rules = screen.getByRole("combobox", {
      name: "shielded.fields.fundingRule",
    }) as HTMLSelectElement;
    expect(Array.from(rules.options, (option) => option.value)).toEqual(["", ownPolicyCommitment]);
    expect(rules.querySelector(`option[value="${foreignPolicyCommitment}"]`)).toBeNull();
    fireEvent.change(rules, { target: { value: ownPolicyCommitment } });
    await fillFundingRecipient(99n);
    expect(
      Array.from(
        (
          screen.getByRole("combobox", {
            name: "shielded.fields.heirPersonHash",
          }) as HTMLSelectElement
        ).options,
        (option) => option.value,
      ),
    ).toEqual(["", wrapIdentityCommitmentAsPersonHash(99n)]);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: receiveCodeFor(222n) },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.recipientMismatch"),
    );
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    expect(mocks.submitFund).not.toHaveBeenCalled();
    expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
  });

  it("reuses the unlocked parent's recovered private rule and automatically selects a sufficient balance", async () => {
    useRecoveredRule();
    mocks.loadLineageSnapshot.mockResolvedValue(
      familySnapshot({
        fatherVersions: [7, 3],
        mother: 0n,
        extraChildren: [{ identityCommitment: 222n, fatherIdentityCommitment: 444n }],
      }),
    );
    mocks.findHeirLegitimacy.mockImplementation(
      ({
        root,
        rootVersionIndex,
      }: {
        root: { identityCommitment: bigint };
        rootVersionIndex: number;
      }) => (root.identityCommitment === 777n && rootVersionIndex === 3 ? [{ writtenAt: 0n }] : []),
    );
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 25n)]),
    );
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policyDescriptor(),
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    expect(screen.queryByRole("checkbox", { name: "shielded.fundingOtherChildren" })).toBeNull();
    expect(
      Array.from(
        (
          screen.getByRole("combobox", {
            name: "shielded.fields.heirPersonHash",
          }) as HTMLSelectElement
        ).options,
        (option) => option.value,
      ),
    ).toEqual(["", wrapIdentityCommitmentAsPersonHash(99n)]);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "2" },
    });
    expect(screen.getByText(/Funding family:.*version 3/)).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.familyVersion" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "shielded.fields.rate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "shielded.receiveCodeErrors.malformed",
      ),
    );
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({
        fundMode: 0,
        donorCommitment: 2n,
        budgetPeriods: 2n,
        recipient: verifiedRecipient(99n),
        policy: policyDescriptor(),
      }),
    );
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
  });

  it("rejects a generated code for a different child before a funding proof", async () => {
    useRecoveredRule();
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 25n)]));
    mocks.createShieldedReceiveCodeForRecipient.mockResolvedValue(receiveCodeFor(100n));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(100n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policyDescriptor(),
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    const password = enterRecipientCredentials();
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "shielded.receiveCodeInputLabel",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe(receiveCodeFor(100n)),
    );
    expect(password.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.recipientMismatch"),
    );
    expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
  });

  it("automatically continues the original enrollment and enforces the existing recipient owner", async () => {
    useRecoveredRule();
    const recovered = walletSnapshot([valueNote(1n, 25n)]);
    const template = {
      note: budgetNote(3n, {
        rootIdentityCommitment: 777n,
        heirIdentityCommitment: 99n,
        heirOwnerCommitment: 98n,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
        eligibleFrom: 123n,
      }).note as BudgetPayload,
      commitment: 3n,
      ciphertext: new Uint8Array(),
      shardId: 0n,
    };
    recovered.fundingTemplates?.set(3n, template);
    mocks.findHeirLegitimacy.mockReturnValue([]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    mocks.verifyShieldedReceiveCode.mockResolvedValueOnce(verifiedRecipient(99n, 97n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policyDescriptor(),
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    expect(screen.getByText(/Funding family:.*version 3/)).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.eligibilityParent" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.familyVersion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.recipientMismatch"),
    );
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    mocks.verifyShieldedReceiveCode.mockResolvedValueOnce(verifiedRecipient(99n, 98n));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({
        fundMode: 1,
        budget: template,
        recipient: verifiedRecipient(99n, 98n),
        budgetPeriods: 1n,
      }),
    );
    expect(mocks.submitFund).toHaveBeenCalledTimes(1);
    expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
  });

  it("claims two compatible budgets in one transaction", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([budgetNote(2n, { remaining: 10n }), budgetNote(3n, { remaining: 10n })]),
    );
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    expect(screen.queryByRole("combobox", { name: "shielded.fields.budgetNote" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetCommitment: 2n,
        secondBudgetCommitment: 3n,
        periodIndices: [0n, 1n],
      }),
    );
  });

  it("claims the checked periods in increasing order and shows their selected amount", async () => {
    const recovered = walletSnapshot([budgetNote(1n, { remaining: 40n })]);
    mocks.getBlock.mockResolvedValue({
      timestamp: Number(1_000n + 4n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY)),
    });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });

    expect(screen.getByText("Claimable: 40 DEEP / 4 periods")).toBeTruthy();
    fireEvent.click(claimPeriodChoice(2));
    fireEvent.click(claimPeriodChoice(4));
    fireEvent.click(claimPeriodChoice(1));
    fireEvent.click(claimPeriodChoice(1));
    expect(claimPeriodChoice(1).checked).toBe(true);
    expect(claimPeriodChoice(2).checked).toBe(false);
    expect(claimPeriodChoice(3).checked).toBe(true);
    expect(claimPeriodChoice(4).checked).toBe(false);
    expect(screen.getByText("Claimable: 20 DEEP / 2 periods")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 1n, periodIndices: [0n, 2n] }),
    );
  });

  it("keeps an empty period selection empty until the holder selects all again", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([budgetNote(1n)]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(claimPeriodChoice(1));
    fireEvent.click(claimPeriodChoice(2));

    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(claimPeriodChoice(1).checked).toBe(false);
    expect(claimPeriodChoice(2).checked).toBe(false);
    fireEvent.click(submit);
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "shielded.selectAllClaimPeriods" }));
    expect(claimPeriodChoice(1).checked).toBe(true);
    expect(claimPeriodChoice(2).checked).toBe(true);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 1n, periodIndices: [0n, 1n] }),
    );
  });

  it("offers at most twelve unpaid due periods and never offers an already claimed period", async () => {
    const note = budgetNote(1n, { remaining: 200n });
    const recovered = walletSnapshot([note]);
    spendClaimPeriod(recovered, note, 1n);
    mocks.getBlock.mockResolvedValue({
      timestamp: Number(1_000n + 20n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY)),
    });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });

    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
    expect(
      screen.getAllByRole("checkbox").every((item) => (item as HTMLInputElement).checked),
    ).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Period 2: 10 DEEP" })).toBeNull();
    expect(claimPeriodChoice(13)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Period 14: 10 DEEP" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetCommitment: 1n,
        periodIndices: [0n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n],
      }),
    );
  });

  it("switches between separate budget arrangements and claims only the displayed arrangement", async () => {
    const first = budgetNote(1n, { remaining: 30n });
    const second = budgetNote(2n, {
      policySalt: 223n,
      amountPerPeriod: 25n,
      periodDays: 30n,
      remaining: 50n,
    });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([first, second]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    const picker = screen.getByRole("combobox", {
      name: "shielded.fields.budgetNote",
    }) as HTMLSelectElement;
    expect(picker.options).toHaveLength(2);
    const secondGroup = picker.options[1].value;
    fireEvent.click(claimPeriodChoice(2));
    fireEvent.change(picker, { target: { value: secondGroup } });

    expect(screen.queryByRole("checkbox", { name: "Period 1: 10 DEEP" })).toBeNull();
    expect(claimPeriodChoice(1, 25).checked).toBe(true);
    expect(claimPeriodChoice(2, 25).checked).toBe(true);
    expect(screen.getByText("Claimable: 50 DEEP / 2 periods")).toBeTruthy();
    fireEvent.click(claimPeriodChoice(2, 25));
    expect(screen.getByText("Claimable: 25 DEEP / 1 periods")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetCommitment: 2n,
        secondBudgetCommitment: undefined,
        periodIndices: [0n],
      }),
    );
  });

  it("preserves and blocks a checked selection when its budget disappears after refresh", async () => {
    const first = budgetNote(1n);
    const alternative = budgetNote(2n, { policySalt: 223n });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([first, alternative]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(claimPeriodChoice(2));
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([alternative]));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));

    await screen.findByText("shielded.claimSelectionUnavailable");
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
  });

  it("can reselect the remaining arrangement after the selected immature arrangement disappears", async () => {
    const claimable = budgetNote(1n);
    const immature = budgetNote(2n, {
      policySalt: 223n,
      eligibleFrom: 1_000n + 2n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
    });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([claimable, immature]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    const picker = screen.getByRole("combobox", {
      name: "shielded.fields.budgetNote",
    }) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: picker.options[1].value } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([claimable]));
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));

    await screen.findByText("shielded.claimSelectionUnavailable");
    expect(screen.queryByRole("combobox", { name: "shielded.fields.budgetNote" })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.reselectClaim" }));

    expect(screen.queryByText("shielded.claimSelectionUnavailable")).toBeNull();
    expect(claimPeriodChoice(1).checked).toBe(true);
    expect(claimPeriodChoice(2).checked).toBe(true);
    const submit = screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 1n, periodIndices: [0n, 1n] }),
    );
  });

  it("rejects a displayed budget that disappears on the final replay without substituting another", async () => {
    const first = budgetNote(1n);
    const alternative = budgetNote(2n, { policySalt: 223n });
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(walletSnapshot([alternative]))
      .mockResolvedValueOnce(walletSnapshot([first, alternative]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.claimSelectionUnavailable"),
    );
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("rejects a checked period claimed elsewhere during the final replay", async () => {
    const note = budgetNote(1n);
    const latest = walletSnapshot([note]);
    spendClaimPeriod(latest, note, 0n);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(latest)
      .mockResolvedValueOnce(walletSnapshot([note]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(claimPeriodChoice(2));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.claimSelectionUnavailable"),
    );
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("blocks a checked period that becomes spent when balances are refreshed", async () => {
    const note = budgetNote(1n);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([note]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    fireEvent.click(claimPeriodChoice(2));
    const latest = walletSnapshot([note]);
    spendClaimPeriod(latest, note, 0n);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(latest);
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));

    await screen.findByText("shielded.claimSelectionUnavailable");
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
  });

  it("rechecks current parent-child eligibility before preparing the displayed budget claim", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([budgetNote(1n)]));
    renderPanel();
    await unlock();
    await screen.findByRole("checkbox", { name: "Period 1: 10 DEEP" });
    mocks.findHeirLegitimacy.mockReturnValue([]);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.claimSelectionUnavailable"),
    );
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("organizes fragmented VALUE balance automatically before funding", async () => {
    useRecoveredRule();
    const fragmented = walletSnapshot([valueNote(1n, 3n), valueNote(2n, 4n), valueNote(3n, 5n)]);
    const partial = walletSnapshot([valueNote(3n, 5n), valueNote(4n, 7n)]);
    const organized = walletSnapshot([valueNote(5n, 12n)]);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(organized)
      .mockResolvedValueOnce(fragmented)
      .mockResolvedValueOnce(fragmented)
      .mockResolvedValueOnce(partial);
    mocks.prepareShieldedValueConsolidation.mockResolvedValue({ data: {}, witness: {} });
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment(
          {
            ...policyDescriptor(),
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n, scope),
          },
          scope,
        ).toString(),
      },
    });
    await fillFundingRecipient(99n);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedValueConsolidation).toHaveBeenCalledTimes(2);
    expect(mocks.submitPrivateTransfer).toHaveBeenCalledTimes(2);
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({ donorCommitment: 5n, wallet: organized }),
    );
    expect(mocks.submitFundWithFreshLineage).toHaveBeenCalledTimes(1);
  });

  it("never consolidates other balances to cover an insufficient checked withdrawal", async () => {
    const fragmented = walletSnapshot([valueNote(1n, 6n), valueNote(2n, 6n)]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(fragmented);
    mocks.prepareShieldedValueConsolidation.mockResolvedValue({ data: {}, witness: {} });
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.click(balanceChoice(1, 6));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.amountExceedsNotes"),
    );
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedUnshield).not.toHaveBeenCalled();
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
    expect(mocks.submitUnshield).not.toHaveBeenCalled();
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("localizes a failed withdrawal receipt with its transaction hash and never reports completion", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(3n, 12n)]));
    mocks.submitUnshield.mockResolvedValue({ receipt: { status: 0 }, transactionHash });
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.click(balanceChoice(1, 12));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() => {
      const error = screen.getByRole("alert").textContent;
      expect(error).toContain("shielded.transactionFailed");
      expect(error).toContain(transactionHash);
      expect(error).not.toContain("Transaction confirmed");
    });
    expect(mocks.submitUnshield).toHaveBeenCalledTimes(1);
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("shielded.done")).toBeNull();
    expect(balanceChoice(1, 12).checked).toBe(true);
  });

  it("does not report a failed manually funded withdrawal as completed", async () => {
    const recovered = walletSnapshot([valueNote(3n, 12n)]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    mocks.submitUnshield.mockRejectedValue(new Error("exit declined"));
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.click(balanceChoice(1, 12));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("exit declined"));
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
    expect(mocks.submitPrivateTransfer).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedUnshield).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ commitment: 3n, wallet: recovered }),
        amount: 10n,
      }),
    );
    expect(screen.queryByText("shielded.done")).toBeNull();
  });

  it("discards pending identity derivation after pagehide", async () => {
    const derivation = deferred<IdentityMaterialV1Result>();
    mocks.deriveIdentityFromForm.mockReturnValueOnce(derivation.promise);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event("pagehide")));
    await act(async () => derivation.resolve(identity));

    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("shielded.balanceAmount")).toBeNull();
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "shielded.unlock" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await unlock();
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(2);
  });

  it("keeps an unlocked identity and draft across transaction wallet changes", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 20n)]));
    const panel = renderPanel();
    await unlock();
    expect(screen.getByText(identity.personHash)).toBeTruthy();
    chooseAction("privateTransfer");
    fireEvent.click(balanceChoice(1, 20));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "5" },
    });
    panel.rerenderAccount(account, null);
    expect(screen.queryByRole("button", { name: "shielded.unlock" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    panel.rerenderAccount("0x00000000000000000000000000000000000000dd");

    expect(screen.queryByRole("button", { name: "shielded.unlock" })).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }) as HTMLInputElement)
        .value,
    ).toBe("5");
    expect(
      (screen.getByRole("button", { name: "shielded.submit" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
    expect(balanceChoice(1, 20).checked).toBe(true);
    expect(screen.getByText(identity.personHash)).toBeTruthy();
  });

  it.each([false, true])(
    "keeps identity, clears old pool choices, and automatically recovers a new pool (remount=%s)",
    async (remount) => {
      const nextPoolAddress = "0x00000000000000000000000000000000000000ee";
      const nextPool = { address: nextPoolAddress } as unknown as ShieldedPageModules["pool"];
      const first = walletSnapshot([valueNote(1n, 20n)]);
      const second = { ...walletSnapshot([valueNote(2n, 6n)]), poolAddress: nextPoolAddress };
      mocks.recoverLocalShieldedWallet.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const panel = renderPanel();
      await unlock();
      fillTransfer(receiveCodeFor(99n), "5", { index: 1, amount: 20 });
      expect(balanceChoice(1, 20).checked).toBe(true);

      panel.rerenderModules({ poolAddress: nextPoolAddress, pool: nextPool }, remount);
      await waitFor(() => expect(balanceChoice(1, 6)).toBeTruthy());
      expect(screen.queryByRole("button", { name: "shielded.unlock" })).toBeNull();
      expect(screen.getByText(identity.personHash)).toBeTruthy();
      expect(mocks.deriveIdentityFromForm).toHaveBeenCalledOnce();
      expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2);
      expect(mocks.recoverLocalShieldedWallet.mock.calls[1][0]).toBe(nextPool);
      expect(mocks.recoverLocalShieldedWallet.mock.calls[1][2].previous).toBeUndefined();
      expect(screen.queryByRole("checkbox", { name: "Balance 1: 20 DEEP" })).toBeNull();
      expect(balanceChoice(1, 6).checked).toBe(false);
      expect(
        (
          screen.getByRole("textbox", {
            name: "shielded.fields.transferAmount",
          }) as HTMLInputElement
        ).value,
      ).toBe("");
      expect(
        (
          screen.getByRole("textbox", {
            name: "shielded.receiveCodeInputLabel",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("");
      fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
        target: { value: receiveCodeFor(99n) },
      });
      expect(
        (screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    },
  );

  it.each([
    { action: "fund", change: "language" },
    { action: "fund", change: "modules" },
    { action: "privateTransfer", change: "language" },
    { action: "privateTransfer", change: "modules" },
  ])(
    "keeps the $action draft without recovering again when $change changes in the same pool",
    async ({ action, change }) => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 20n)]));
      const panel = renderPanel();
      await unlock();
      if (action === "fund") {
        chooseAction("fund");
        await selectFundingParentVersion(3);
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
          target: { value: "4" },
        });
        fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
          target: { value: "5" },
        });
      } else {
        fillTransfer(receiveCodeFor(99n), "5", { index: 1, amount: 20 });
      }
      if (change === "language") {
        mocks.translationRevision += 1;
        panel.rerenderAccount(account);
      } else {
        panel.rerenderModules({});
      }
      await act(async () => {});
      expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledOnce();
      expect(mocks.deriveIdentityFromForm).toHaveBeenCalledOnce();
      if (action === "fund") {
        expect(screen.getByRole("heading", { name: "shielded.actions.fund" })).toBeTruthy();
        expect(
          (screen.getByRole("textbox", { name: "shielded.fields.rate" }) as HTMLInputElement).value,
        ).toBe("4");
        expect(
          (screen.getByRole("textbox", { name: "shielded.fields.periods" }) as HTMLInputElement)
            .value,
        ).toBe("5");
        expect(
          (
            screen.getByRole("combobox", {
              name: "shielded.fields.familyVersion",
            }) as HTMLSelectElement
          ).value,
        ).toBe("3");
      } else {
        expect(
          screen.getByRole("heading", { name: "shielded.actionTitles.privateTransfer" }),
        ).toBeTruthy();
        expect(
          (
            screen.getByRole("textbox", {
              name: "shielded.fields.transferAmount",
            }) as HTMLInputElement
          ).value,
        ).toBe("5");
        expect(balanceChoice(1, 20).checked).toBe(true);
        expect(
          (
            screen.getByRole("textbox", {
              name: "shielded.receiveCodeInputLabel",
            }) as HTMLTextAreaElement
          ).value,
        ).toBe(receiveCodeFor(99n));
        expect(
          (screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }) as HTMLInputElement)
            .checked,
        ).toBe(true);
      }
    },
  );

  it.each([
    { remount: false, failure: false },
    { remount: false, failure: true },
    { remount: true, failure: false },
    { remount: true, failure: true },
  ])(
    "ignores a stale pool recovery without releasing the new recovery ($remount, $failure)",
    async ({ remount, failure }) => {
      const nextPoolAddress = "0x00000000000000000000000000000000000000ee";
      const oldRecovery = deferred<LocalShieldedWalletSnapshot>();
      const nextRecovery = deferred<LocalShieldedWalletSnapshot>();
      mocks.recoverLocalShieldedWallet
        .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 20n)]))
        .mockReturnValueOnce(oldRecovery.promise)
        .mockReturnValueOnce(nextRecovery.promise);
      const panel = renderPanel();
      await unlock();
      fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
      await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(2));
      panel.rerenderModules(
        { poolAddress: nextPoolAddress, pool: {} as ShieldedPageModules["pool"] },
        remount,
      );
      await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(3));

      await act(async () => {
        if (failure) oldRecovery.reject(new Error("Old pool RPC failed"));
        else oldRecovery.resolve(walletSnapshot([valueNote(3n, 99n)]));
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("shielded.done")).toBeNull();
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(screen.getByRole("status").textContent).toBe("shielded.stages.recovering");
      await act(async () =>
        nextRecovery.resolve({
          ...walletSnapshot([valueNote(2n, 6n)]),
          poolAddress: nextPoolAddress,
        }),
      );
      expect(balanceChoice(1, 6)).toBeTruthy();
      expect(screen.queryByRole("checkbox", { name: "Balance 1: 99 DEEP" })).toBeNull();
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(mocks.deriveIdentityFromForm).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    "does not broadcast a former pool's proof after switching assets (remount=%s)",
    async (remount) => {
      const nextPoolAddress = "0x00000000000000000000000000000000000000ee";
      const proving = deferred<void>();
      const broadcast = vi.fn();
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      mocks.recoverLocalShieldedWallet
        .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 20n)]))
        .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 20n)]))
        .mockResolvedValueOnce({
          ...walletSnapshot([valueNote(2n, 6n)]),
          poolAddress: nextPoolAddress,
        });
      mocks.submitPrivateTransfer.mockImplementationOnce(async ({ onStage }) => {
        onStage("proving");
        await proving.promise;
        onStage("submitting");
        broadcast();
        return { receipt: { status: 1 }, transactionHash };
      });
      const panel = renderPanel();
      await unlock();
      fillTransfer(receiveCodeFor(99n), "5", { index: 1, amount: 20 });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() => expect(mocks.submitPrivateTransfer).toHaveBeenCalledOnce());
      panel.rerenderModules(
        { poolAddress: nextPoolAddress, pool: {} as ShieldedPageModules["pool"] },
        remount,
      );
      await waitFor(() => expect(balanceChoice(1, 6)).toBeTruthy());
      await act(async () => proving.resolve());
      expect(broadcast).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("shielded.done")).toBeNull();
      expect(screen.getByText(identity.personHash)).toBeTruthy();
      expect(balanceChoice(1, 6).checked).toBe(false);
    },
  );

  it("does not accept an old panel's pending identity derivation after switching pools", async () => {
    const derivation = deferred<IdentityMaterialV1Result>();
    mocks.deriveIdentityFromForm.mockReturnValueOnce(derivation.promise);
    const panel = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "shielded.unlock" }));
    panel.rerenderModules({ poolAddress: "0x00000000000000000000000000000000000000ee" }, true);
    await act(async () => derivation.resolve(identity));
    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
    await unlock();
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "does not let a former pool's transaction confirmation change the new pool recovery (remount=%s)",
    async (remount) => {
      const nextPoolAddress = "0x00000000000000000000000000000000000000ee";
      const confirmation = deferred<void>();
      const nextRecovery = deferred<LocalShieldedWalletSnapshot>();
      mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
      mocks.recoverLocalShieldedWallet
        .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 20n)]))
        .mockResolvedValueOnce(walletSnapshot([valueNote(1n, 20n)]))
        .mockReturnValueOnce(nextRecovery.promise);
      mocks.submitPrivateTransfer.mockImplementationOnce(async ({ onStage }) => {
        onStage("submitting");
        await confirmation.promise;
        onStage("confirming");
        return { receipt: { status: 1 }, transactionHash };
      });
      const panel = renderPanel();
      await unlock();
      fillTransfer(receiveCodeFor(99n), "5", { index: 1, amount: 20 });
      fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
      await waitFor(() => expect(mocks.submitPrivateTransfer).toHaveBeenCalledOnce());
      panel.rerenderModules(
        { poolAddress: nextPoolAddress, pool: {} as ShieldedPageModules["pool"] },
        remount,
      );
      await waitFor(() => expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(3));
      await act(async () => confirmation.resolve());
      expect(screen.getByRole("status").textContent).toBe("shielded.stages.recovering");
      expect(
        (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(transactionHash)).toBeNull();
      expect(screen.queryByText("shielded.done")).toBeNull();
      await act(async () =>
        nextRecovery.resolve({
          ...walletSnapshot([valueNote(2n, 6n)]),
          poolAddress: nextPoolAddress,
        }),
      );
      expect(balanceChoice(1, 6)).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("opens the empty claim state when receiving has no budget and shares the code from the wallet", async () => {
    renderPanel();
    await unlock();
    chooseAction("claim");
    expect(screen.getByRole("heading", { name: "shielded.actions.claim" })).toBeTruthy();
    expect(await screen.findByText("shielded.claimOverview.noFunds")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.budgetNote" })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "shielded.fields.claimIndices" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.claim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.receiveCode" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.wallet" }));
    chooseAction("receiveCode");
    expect(
      screen
        .getByRole("button", { name: "shielded.actions.receiveCode" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("heading", { name: "shielded.actions.receiveCode" })).toBeTruthy();
    chooseAction("claim");
    expect(screen.getByRole("heading", { name: "shielded.actions.claim" })).toBeTruthy();
    expect(screen.getByText("shielded.claimOverview.noFunds")).toBeTruthy();
  });

  it("directly shows the checked claimable periods and next due date for a single arrangement", async () => {
    const recovered = walletSnapshot([budgetNote(1n, { remaining: 30n })]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    expect(await screen.findByText("Claimable: 20 DEEP / 2 periods")).toBeTruthy();
    expect(screen.getByText(/^Next due:/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.budgetNote" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "shielded.fields.claimIndices" })).toBeNull();
    expect(screen.queryByText("shielded.claimOptions", { selector: "summary" })).toBeNull();
    expect(claimPeriodChoice(1).checked).toBe(true);
    expect(claimPeriodChoice(2).checked).toBe(true);
  });

  it("defaults to depositing with unusable balances and opens claim for an existing immature budget", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([
        valueNote(1n, 0n),
        budgetNote(2n, {
          remaining: 9n,
          eligibleFrom: 3n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
        }),
      ]),
    );
    renderPanel();
    await unlock();

    expect(
      screen.getByRole("tab", { name: "shielded.groups.wallet" }).getAttribute("aria-selected"),
    ).toBe("true");
    const deposit = screen.getByRole("button", { name: "shielded.actions.shield" });
    expect(deposit.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("textbox", { name: "shielded.fields.amount" })).toBeTruthy();
    chooseAction("claim");
    expect(screen.getByRole("heading", { name: "shielded.actions.claim" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.actions.claim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.receiveCode" })).toBeNull();
  });

  it("uses the same private VALUE funding route for public recipient visibility without a receive code", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeInputLabel" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.fundingRule" })).toBeNull();
    await selectFundingChild(99n);
    const child = wrapIdentityCommitmentAsPersonHash(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedFund).toHaveBeenCalledWith(
      expect.objectContaining({
        fundMode: 0,
        budgetKind: 1,
        donorCommitment: 1n,
        publicRecipientPersonHash: child,
        recipient: undefined,
        budgetPeriods: 3n,
      }),
    );
    expect(mocks.submitFundWithFreshLineage).toHaveBeenCalledTimes(1);
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();
    expect(mocks.tokenAllowance).not.toHaveBeenCalled();
    expect(mocks.submitShield).not.toHaveBeenCalled();
  });

  it("shows recovered identity budgets in the common claim list with no public claim selector", async () => {
    const privateNote = budgetNote(1n, { remaining: 30n });
    if (privateNote.note.kind !== "budget") throw new Error("Expected budget");
    const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(
      privateNote.note,
      scope,
    );
    const note: Note = {
      ...privateNote,
      note: {
        kind: "budget",
        binding: "identity",
        rootIdentityCommitment: privateNote.note.rootIdentityCommitment,
        rootVersionIndex: privateNote.note.rootVersionIndex,
        heirIdentityCommitment: privateNote.note.heirIdentityCommitment,
        amountPerPeriod: privateNote.note.amountPerPeriod,
        periodDays: 30n,
        eligibleFrom: privateNote.note.eligibleFrom,
        remaining: 30n,
        nonce: 1n,
        policyCommitment,
        enrollmentCommitment,
      },
    };
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([note]));
    renderPanel();
    await unlock();
    expect(await screen.findByText("Claimable: 20 DEEP / 2 periods")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 1n, periodIndices: [0n, 1n] }),
    );
    expect(mocks.submitClaimWithFreshLineage).toHaveBeenCalledTimes(1);
  });
});
