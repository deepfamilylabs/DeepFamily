// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedPolicyCommitment,
  deriveShieldedHeirKeyMaterial,
  encodeShieldedReceiveCode,
  INHERITANCE_PERIOD_SECONDS,
  wrapIdentityCommitmentAsPersonHash,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { Signer } from "ethers";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import {
  ShieldedReceiveCodeError,
  type VerifiedShieldedRecipient,
} from "../services/shieldedReceiveCode";
import type { OwnedShieldedNote } from "../services/shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "../services/shieldedWalletRecovery";
import type { PublicBudget, PublicBudgetSnapshot } from "../services/publicBudgetFlows";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";

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
  loadRootRegistry: vi.fn(),
  findHeirLegitimacy: vi.fn(),
  getBlock: vi.fn(),
  readPublicBudgets: vi.fn(),
  preparePublicBudgetFunding: vi.fn(),
  submitPublicBudgetFunding: vi.fn(),
  preparePublicBudgetClaim: vi.fn(),
  submitPublicBudgetClaim: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { detail?: string; identity?: string }) => {
      if (key === "shielded.confirmedRefreshFailed") {
        return `Transaction confirmed; balances refresh failed: ${options?.detail}`;
      }
      if (key === "shielded.refreshFailed") {
        return `Balances refresh failed; account still unlocked: ${options?.detail}`;
      }
      if (key === "shielded.recipientTarget") {
        return `Recipient: ${options?.identity}`;
      }
      return key;
    },
  }),
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props, ref) => {
      const passphrase = React.useRef<HTMLInputElement>(null);
      React.useImperativeHandle(ref, () => ({
        clearSecretInputs: () => {
          mocks.clearSecretInputs();
          if (passphrase.current) passphrase.current.value = "";
        },
      }));
      return (
        <input ref={passphrase} aria-label="Identity passphrase" defaultValue="raw passphrase" />
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
vi.mock("../services/publicBudgetFlows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicBudgetFlows")>()),
  readPublicBudgets: mocks.readPublicBudgets,
  preparePublicBudgetFunding: mocks.preparePublicBudgetFunding,
  submitPublicBudgetFunding: mocks.submitPublicBudgetFunding,
  preparePublicBudgetClaim: mocks.preparePublicBudgetClaim,
  submitPublicBudgetClaim: mocks.submitPublicBudgetClaim,
}));
vi.mock("../services/shieldedFreshLineageSubmit", () => ({
  submitClaimWithFreshLineage: mocks.submitClaimWithFreshLineage,
  submitFundWithFreshLineage: mocks.submitFundWithFreshLineage,
}));
vi.mock("../services/inheritanceChain", () => ({
  loadLineageSnapshot: mocks.loadLineageSnapshot,
  findHeirLegitimacy: mocks.findHeirLegitimacy,
  loadRootRegistry: mocks.loadRootRegistry,
  assertVersionKnown: vi.fn(),
}));
vi.mock("../../../shared/config/env", () => ({
  getShieldedPoolDeploymentBlock: () => 0,
}));

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget" }>;
const account = "0x00000000000000000000000000000000000000aa";
const poolAddress = "0x00000000000000000000000000000000000000bb";
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
  identityCommitment: "56",
  personHash: `0x${"12".repeat(32)}`,
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
      remaining: 20n,
      nonce: commitment,
      ...overrides,
    },
  };
}

function policyDescriptor() {
  return {
    rootIdentityCommitment: 111n,
    rootVersionIndex: 3n,
    policySalt: 222n,
    allocationKey: 444n,
    amountPerPeriod: 10n,
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

function publicBudget(overrides: Partial<PublicBudget> = {}): PublicBudget {
  return {
    budgetId: 1n,
    createdBy: account,
    rootPersonHash: identity.personHash,
    rootVersionIndex: 7n,
    heirPersonHash: wrapIdentityCommitmentAsPersonHash(99n),
    amountPerPeriod: 10n,
    eligibleFrom: 1_000n,
    remaining: 30n,
    nextPeriod: 0n,
    ...overrides,
  };
}

function publicSnapshot(budgets: PublicBudget[] = []): PublicBudgetSnapshot {
  return {
    poolAddress,
    chainId: 31337n,
    toBlock: 1,
    blockHash: `0x${"cd".repeat(32)}`,
    asOf: 1_000n + 2n * INHERITANCE_PERIOD_SECONDS,
    budgets,
    funders: new Map(budgets.map((budget) => [budget.budgetId, new Set([account.toLowerCase()])])),
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
function fillTransfer(code: string, amount: string) {
  chooseAction("privateTransfer");
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "shielded.recipientConfirm" }));
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
    target: { value: amount },
  });
}

function renderPanel() {
  const modules = {
    chainId: 31337n,
    poolAddress,
    pool: {},
    token: { allowance: mocks.tokenAllowance },
    tokenDecimals: 0,
    provider: { getBlock: mocks.getBlock },
    lineageIndex: {},
    deepFamily: {},
  } as unknown as ShieldedPageModules;
  const signer = {
    provider: { getNetwork: async () => ({ chainId: 31337n }) },
    getAddress: async () => account,
  } as unknown as Signer;
  const publicActivityAddresses = new Set<string>();
  const view = (transactionAccount: string, transactionSigner: Signer | null = signer) => (
    <ShieldedInheritancePanel
      modules={modules}
      signer={transactionSigner}
      account={transactionAccount}
      publicActivityAddresses={publicActivityAddresses}
    />
  );
  const rendered = render(view(account));
  return {
    ...rendered,
    rerenderAccount: (transactionAccount: string, transactionSigner: Signer | null = signer) =>
      rendered.rerender(view(transactionAccount, transactionSigner)),
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
  fireEvent.click(screen.getByRole("button", { name: `shielded.actions.${action}` }));
}

function openOptions(key: string) {
  fireEvent.click(screen.getByText(key, { selector: "summary" }));
}

async function fillFundingRecipient(commitment: bigint) {
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
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
    target: { value: receiveCodeFor(commitment) },
  });
}

function useRecoveredRule() {
  mocks.listRecoveredShieldedPolicies.mockReturnValue([policyDescriptor()]);
  mocks.loadLineageSnapshot.mockResolvedValue({
    versions: new Map([
      [
        wrapIdentityCommitmentAsPersonHash(99n),
        [
          {
            versionIndex: 1,
            identityCommitment: 99n,
            fatherIdentityCommitment: 111n,
            motherIdentityCommitment: 0n,
          },
        ],
      ],
    ]),
  });
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ShieldedInheritancePanel unlocked account", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.deriveIdentityFromForm.mockResolvedValue(identity);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot());
    mocks.readPublicBudgets.mockResolvedValue(publicSnapshot());
    mocks.preparePublicBudgetFunding.mockResolvedValue({ data: {}, amount: 30n, context: {} });
    mocks.submitPublicBudgetFunding.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.preparePublicBudgetClaim.mockResolvedValue({
      data: {},
      amount: 20n,
      witness: {},
      context: {},
    });
    mocks.submitPublicBudgetClaim.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
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
    mocks.prepareShieldedClaim.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitClaimWithFreshLineage.mockImplementation(
      async ({ prepare }: { prepare: () => Promise<unknown> }) => {
        await prepare();
        return { receipt: { status: 1 }, transactionHash };
      },
    );
    mocks.loadLineageSnapshot.mockResolvedValue({
      versions: new Map([
        [
          identity.personHash,
          [
            {
              versionIndex: 7,
              identityCommitment: 777n,
              fatherIdentityCommitment: 0n,
              motherIdentityCommitment: 0n,
            },
            {
              versionIndex: 3,
              identityCommitment: 333n,
              fatherIdentityCommitment: 0n,
              motherIdentityCommitment: 0n,
            },
          ],
        ],
        [
          wrapIdentityCommitmentAsPersonHash(99n),
          [
            {
              versionIndex: 1,
              identityCommitment: 99n,
              fatherIdentityCommitment: 777n,
              motherIdentityCommitment: 333n,
            },
          ],
        ],
      ]),
    });
    mocks.loadRootRegistry.mockResolvedValue({
      blockNumber: 1,
      versions: new Map([
        [
          identity.personHash,
          [
            { versionIndex: 7, identityCommitment: 777n },
            { versionIndex: 3, identityCommitment: 333n },
          ],
        ],
      ]),
      trustedEndorsers: new Map(),
    });
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
      timestamp: Number(1_000n + 2n * INHERITANCE_PERIOD_SECONDS),
    });
  });

  afterEach(() => cleanup());

  it("hides action controls and decrypted balances until the identity is unlocked", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "shielded.unlock" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Identity passphrase" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText("shielded.balanceAmount")).toBeNull();
    expect(screen.queryByRole("button", { name: "shielded.actions.recover" })).toBeNull();
    expect(mocks.recoverLocalShieldedWallet).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
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

  it("generates the receive code without a transaction wallet or fee-wallet confirmation", async () => {
    const panel = renderPanel();
    await unlock();
    panel.rerenderAccount(account, null);
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
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

    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
    chooseAction("receiveCode");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    const code = (await screen.findByRole("textbox", {
      name: "shielded.receiveCodeLabel",
    })) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeNull();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
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
    await unlock();

    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(2);
    expect(mocks.recoverLocalShieldedWallet.mock.calls[2][1].identityCommitment).toBe(
      otherIdentity.identityCommitment,
    );
    expect(mocks.recoverLocalShieldedWallet.mock.calls[2][2].previous).toBeUndefined();
    expect(screen.queryByText(identity.personHash)).toBeNull();
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

  it("separates wallet, giving, and receiving tasks while keeping manual selection in advanced options", async () => {
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
    const options = screen
      .getByText("shielded.advancedOptions", { selector: "summary" })
      .closest("details");
    expect(options?.open).toBe(false);
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.secondValueNote", hidden: true }),
    ).toBeNull();

    openOptions("shielded.advancedOptions");
    const secondOption = screen.getByRole("checkbox", {
      name: "shielded.fields.useSecondValueNote",
    });
    fireEvent.click(secondOption);
    expect(screen.getByRole("combobox", { name: "shielded.fields.secondValueNote" })).toBeTruthy();
    fireEvent.click(secondOption);
    expect(
      screen.queryByRole("combobox", { name: "shielded.fields.secondValueNote", hidden: true }),
    ).toBeNull();
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

  it("automatically selects a sufficient balance note and pays only a verified receive code", async () => {
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

  it("does not block credentials with a hidden receive-code confirmation and reconfirms a new code", async () => {
    const oldCode = receiveCodeFor(99n);
    const newCode = receiveCodeFor(100n);
    const generation = deferred<string>();
    mocks.createShieldedReceiveCodeForRecipient.mockReturnValue(generation.promise);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
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
    const timestamp = Number(1_000n + 2n * INHERITANCE_PERIOD_SECONDS);
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

  it("creates a private arrangement in the funding action, with latest or explicit parent version", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 30n)]));
    mocks.verifyShieldedReceiveCode.mockResolvedValue(verifiedRecipient(99n));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    await fillFundingRecipient(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenLastCalledWith({
      rootVersionIndex: 7n,
      rootIdentityCommitment: 777n,
      amountPerPeriod: 10n,
    });
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
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: { value: "" },
    });
    openOptions("shielded.advancedOptions");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rootVersion" }), {
      target: { value: "3" },
    });
    await fillFundingRecipient(99n);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.prepareShieldedFund).toHaveBeenCalledTimes(2));
    await screen.findByText("shielded.done");
    expect(mocks.createShieldedPolicyDescriptor).toHaveBeenLastCalledWith({
      rootVersionIndex: 3n,
      rootIdentityCommitment: 333n,
      amountPerPeriod: 10n,
    });
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("reuses a recovered private rule and automatically selects a sufficient single balance", async () => {
    useRecoveredRule();
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 25n)]),
    );
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.fundingRule" }), {
      target: {
        value: computeShieldedPolicyCommitment({
          ...policyDescriptor(),
          allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n),
        }).toString(),
      },
    });
    await fillFundingRecipient(99n);
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "2" },
    });
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
        value: computeShieldedPolicyCommitment({
          ...policyDescriptor(),
          allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n),
        }).toString(),
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
        heirIdentityCommitment: 99n,
        heirOwnerCommitment: 98n,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n),
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
        value: computeShieldedPolicyCommitment({
          ...policyDescriptor(),
          allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n),
        }).toString(),
      },
    });
    await fillFundingRecipient(99n);
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
        value: computeShieldedPolicyCommitment({
          ...policyDescriptor(),
          allocationKeyCommitment: computeShieldedAllocationKeyCommitment(444n),
        }).toString(),
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

  it("organizes fragmented balance before withdrawal and does not report a failed exit as completed", async () => {
    const fragmented = walletSnapshot([valueNote(1n, 6n), valueNote(2n, 6n)]);
    const organized = walletSnapshot([valueNote(3n, 12n)]);
    mocks.recoverLocalShieldedWallet
      .mockResolvedValue(organized)
      .mockResolvedValueOnce(fragmented)
      .mockResolvedValueOnce(fragmented);
    mocks.prepareShieldedValueConsolidation.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitUnshield.mockRejectedValue(new Error("exit declined"));
    renderPanel();
    await unlock();
    chooseAction("unshield");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.amount" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.exitRecipient" }), {
      target: { value: account },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.preparedButNotCompleted"),
    );
    expect(mocks.submitPrivateTransfer).toHaveBeenCalledTimes(1);
    expect(mocks.prepareShieldedUnshield).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ commitment: 3n, wallet: organized }),
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
  });

  it("keeps an unlocked identity and draft across transaction wallet changes", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 20n)]));
    const panel = renderPanel();
    await unlock();
    chooseAction("privateTransfer");
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
  });

  it("suggests sharing a receive code when nothing has been set aside yet", async () => {
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.receive" }));
    const receiveCode = screen.getByRole("button", { name: "shielded.actions.receiveCode" });
    expect(receiveCode.getAttribute("aria-pressed")).toBe("true");
    chooseAction("claim");
    expect(screen.getByText("shielded.nextStep.receiveCode")).toBeTruthy();
  });

  it("shows the claimable batch and next due date after checking lineage", async () => {
    const recovered = walletSnapshot([budgetNote(1n, { remaining: 30n })]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    expect(await screen.findByText("shielded.claimOverview.claimable")).toBeTruthy();
    expect(screen.getByText("shielded.claimOverview.nextDue")).toBeTruthy();
  });

  it("defaults to depositing when recovered notes have zero value or cannot fund a whole inheritance period", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 0n), budgetNote(2n, { remaining: 9n })]),
    );
    renderPanel();
    await unlock();

    expect(
      screen.getByRole("tab", { name: "shielded.groups.wallet" }).getAttribute("aria-selected"),
    ).toBe("true");
    const deposit = screen.getByRole("button", { name: "shielded.actions.shield" });
    expect(deposit.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("textbox", { name: "shielded.fields.amount" })).toBeTruthy();
    expect(screen.queryByText("shielded.nextStep.shield")).toBeNull();
  });

  it("funds a public arrangement directly from the ordinary wallet without free VALUE or a receive code", async () => {
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeInputLabel" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.valueNote" })).toBeNull();
    expect(screen.getByText("shielded.publicFundingVisibility")).toBeTruthy();
    expect(screen.getByText("shielded.fundingSources.public")).toBeTruthy();
    const child = wrapIdentityCommitmentAsPersonHash(99n);
    await waitFor(() =>
      expect(
        screen
          .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
          .querySelector(`option[value="${child}"]`),
      ).toBeTruthy(),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" }), {
      target: { value: child },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.preparePublicBudgetFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: undefined,
        rootPersonHash: identity.personHash,
        rootVersionIndex: 7n,
        heirPersonHash: child,
        amountPerPeriod: 10n,
        budgetPeriods: 3n,
      }),
    );
    expect(mocks.submitPublicBudgetFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.objectContaining({ allowance: mocks.tokenAllowance }),
        expectedChainId: 31337n,
        prepared: expect.objectContaining({ amount: 30n }),
      }),
    );
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedFund).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedValueConsolidation).not.toHaveBeenCalled();
  });

  it("adds public money using an existing arrangement's fixed child, rate, root version, and clock", async () => {
    const budget = publicBudget({ budgetId: 9n, rootVersionIndex: 3n, eligibleFrom: 123n });
    mocks.readPublicBudgets.mockResolvedValue(publicSnapshot([budget]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.publicArrangement" }), {
      target: { value: "9" },
    });
    expect(screen.queryByRole("textbox", { name: "shielded.fields.rate" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "shielded.fields.heirPersonHash" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "shielded.fields.rootVersion" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.preparePublicBudgetFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: 9n,
        rootPersonHash: budget.rootPersonHash,
        rootVersionIndex: 3n,
        heirPersonHash: budget.heirPersonHash,
        amountPerPeriod: budget.amountPerPeriod,
        budgetPeriods: 4n,
      }),
    );
    expect(mocks.createShieldedPolicyDescriptor).not.toHaveBeenCalled();
    expect(mocks.submitFund).not.toHaveBeenCalled();
    expect(mocks.submitFundWithFreshLineage).not.toHaveBeenCalled();
  });

  it("claims an incoming public arrangement into the private page balance without a recipient code", async () => {
    const parentHash = wrapIdentityCommitmentAsPersonHash(777n);
    const budget = publicBudget({
      budgetId: 7n,
      rootPersonHash: parentHash,
      heirPersonHash: identity.personHash,
      nextPeriod: 1n,
      remaining: 40n,
    });
    const snapshots = publicSnapshot([budget]);
    mocks.readPublicBudgets.mockResolvedValue(snapshots);
    mocks.loadLineageSnapshot.mockResolvedValue({
      versions: new Map([
        [parentHash, [{ versionIndex: 7, identityCommitment: 777n }]],
        [
          identity.personHash,
          [{ versionIndex: 1, identityCommitment: 56n, fatherIdentityCommitment: 777n }],
        ],
      ]),
    });
    renderPanel();
    await unlock();
    expect(
      (screen.getByRole("radio", { name: "shielded.claimModes.public" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await screen.findByText("shielded.claimOverview.claimable");
    expect(screen.getByText("shielded.publicClaimVisibility")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "shielded.fields.claimIndices" })).toBeNull();
    expect(screen.getByText("shielded.budgetAmount").parentElement?.textContent).toContain("40");
    mocks.submitPublicBudgetClaim.mockImplementation(async () => {
      mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(22n, 10n)]));
      mocks.readPublicBudgets.mockResolvedValue(
        publicSnapshot([{ ...budget, remaining: 30n, nextPeriod: 2n }]),
      );
      return { receipt: { status: 1 }, transactionHash };
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.preparePublicBudgetClaim).toHaveBeenCalledWith(
      expect.objectContaining({ identity, budgetId: 7n }),
    );
    expect(mocks.submitPublicBudgetClaim).toHaveBeenCalledTimes(1);
    expect(mocks.verifyShieldedReceiveCode).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedClaim).not.toHaveBeenCalled();
    expect(screen.getByText("shielded.balanceAmount").parentElement?.textContent).toContain("10");
    expect(screen.getByText("shielded.budgetAmount").parentElement?.textContent).toContain("30");
  });

  it("counts public and private incoming funds together while keeping their claim inputs separate", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([budgetNote(1n, { remaining: 20n })]),
    );
    mocks.readPublicBudgets.mockResolvedValue(
      publicSnapshot([
        publicBudget({ budgetId: 7n, heirPersonHash: identity.personHash, remaining: 30n }),
      ]),
    );
    renderPanel();
    await unlock();
    expect(screen.getByText("shielded.budgetAmount").parentElement?.textContent).toContain("50");
    expect(
      (screen.getByRole("radio", { name: "shielded.claimModes.private" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "shielded.claimModes.public" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "shielded.fields.publicClaimArrangement" }),
      {
        target: { value: "7" },
      },
    );
    fireEvent.click(screen.getByRole("radio", { name: "shielded.claimModes.private" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ budgetCommitment: 1n }),
    );
    expect(mocks.preparePublicBudgetClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "shielded.claimModes.public" }));
    expect(
      (
        screen.getByRole("combobox", {
          name: "shielded.fields.publicClaimArrangement",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");
  });

  it("clears the public arrangement and recipient-code state when changing funding privacy", async () => {
    mocks.readPublicBudgets.mockResolvedValue(publicSnapshot([publicBudget({ budgetId: 9n })]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: receiveCodeFor(99n) },
    });
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.publicArrangement" }), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.private" }));
    expect(
      (screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }) as HTMLInputElement)
        .value,
    ).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    expect(
      (
        screen.getByRole("combobox", {
          name: "shielded.fields.publicArrangement",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(screen.getByRole("textbox", { name: "shielded.fields.rate" })).toBeTruthy();
    expect(mocks.preparePublicBudgetFunding).not.toHaveBeenCalled();
  });

  it("refuses a stale public arrangement after refreshing the current ledger", async () => {
    mocks.readPublicBudgets.mockResolvedValue(publicSnapshot([publicBudget({ budgetId: 9n })]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("fund");
    fireEvent.click(screen.getByRole("radio", { name: "shielded.fundingModes.public" }));
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.publicArrangement" }), {
      target: { value: "9" },
    });
    mocks.readPublicBudgets.mockResolvedValue(publicSnapshot());
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.publicBudgetMissing"),
    );
    expect(mocks.preparePublicBudgetFunding).not.toHaveBeenCalled();
    expect(mocks.submitPublicBudgetFunding).not.toHaveBeenCalled();
  });

  it("shows a localized public claim rejection while preserving actionable preparation errors", async () => {
    mocks.readPublicBudgets.mockResolvedValue(
      publicSnapshot([publicBudget({ budgetId: 7n, heirPersonHash: identity.personHash })]),
    );
    mocks.submitPublicBudgetClaim.mockRejectedValue({
      code: "CALL_EXCEPTION",
      data: "0x6a35c33f",
      message: "execution reverted",
    });
    renderPanel();
    await unlock();
    await screen.findByText("shielded.claimOverview.claimable");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "errors.contractError.PublicBudgetNotMature",
      ),
    );
    expect(screen.queryByText("shielded.done")).toBeNull();

    mocks.preparePublicBudgetClaim.mockRejectedValue(
      new Error("Refresh the public family records"),
    );
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Refresh the public family records"),
    );
    expect(mocks.submitPublicBudgetClaim).toHaveBeenCalledTimes(1);
  });
});
