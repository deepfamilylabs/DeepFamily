// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationSalt,
  computeShieldedRegistrationTag,
  deriveShieldedHeirKeyMaterial,
  INHERITANCE_PERIOD_SECONDS,
  wrapIdentityCommitmentAsPersonHash,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { Signer } from "ethers";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import type { KeyRegistrySnapshot } from "../services/shieldedKeyRegistryChain";
import { encodeShieldedReceiveCode } from "../services/shieldedReceiveCode";
import type { OwnedShieldedNote } from "../services/shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "../services/shieldedWalletRecovery";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";

const mocks = vi.hoisted(() => ({
  deriveIdentityFromForm: vi.fn(),
  deriveShieldedRecipientMaterial: vi.fn(),
  clearSecretInputs: vi.fn(),
  recoverLocalShieldedWallet: vi.fn(),
  listUnspentRecoveredShieldedNotes: vi.fn(),
  listRecoveredTopUpTemplates: vi.fn(),
  loadKeyRegistrySnapshot: vi.fn(),
  registerShieldedHeirKey: vi.fn(),
  prepareShieldedPrivateTransfer: vi.fn(),
  prepareShieldedUnshield: vi.fn(),
  submitPrivateTransfer: vi.fn(),
  submitUnshield: vi.fn(),
  prepareShieldedCreatePolicy: vi.fn(),
  submitCreatePolicy: vi.fn(),
  prepareShieldedAllocate: vi.fn(),
  prepareShieldedTopUp: vi.fn(),
  submitAllocateWithFreshLineage: vi.fn(),
  submitTopUp: vi.fn(),
  prepareShieldedMergeBudget: vi.fn(),
  submitMergeBudget: vi.fn(),
  prepareShieldedClaim: vi.fn(),
  submitClaimWithFreshLineage: vi.fn(),
  loadLineageSnapshot: vi.fn(),
  loadRootRegistry: vi.fn(),
  findHeirLegitimacy: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { detail?: string }) => {
      if (key === "shielded.confirmedRefreshFailed") {
        return `Transaction confirmed; balances refresh failed: ${options?.detail}`;
      }
      if (key === "shielded.refreshFailed") {
        return `Balances refresh failed; account still unlocked: ${options?.detail}`;
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
  deriveShieldedRecipientMaterial: mocks.deriveShieldedRecipientMaterial,
}));
vi.mock("../services/shieldedWalletRecovery", () => ({
  recoverLocalShieldedWallet: mocks.recoverLocalShieldedWallet,
  listUnspentRecoveredShieldedNotes: mocks.listUnspentRecoveredShieldedNotes,
  listRecoveredTopUpTemplates: mocks.listRecoveredTopUpTemplates,
}));
vi.mock("../services/shieldedKeyRegistryChain", () => ({
  loadKeyRegistrySnapshot: mocks.loadKeyRegistrySnapshot,
}));
vi.mock("../services/shieldedKeyRegistrationFlow", () => ({
  registerShieldedHeirKey: mocks.registerShieldedHeirKey,
}));
vi.mock("../services/shieldedTransferExitPreparation", () => ({
  prepareShieldedPrivateTransfer: mocks.prepareShieldedPrivateTransfer,
  prepareShieldedUnshield: mocks.prepareShieldedUnshield,
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitPrivateTransfer: mocks.submitPrivateTransfer,
  submitUnshield: mocks.submitUnshield,
  submitShield: vi.fn(),
  submitCreatePolicy: mocks.submitCreatePolicy,
  submitTopUp: mocks.submitTopUp,
  submitMergeBudget: mocks.submitMergeBudget,
}));
vi.mock("../services/shieldedNotePreparation", () => ({
  prepareShieldedCreatePolicy: mocks.prepareShieldedCreatePolicy,
  prepareShieldedShield: vi.fn(),
}));
vi.mock("../services/shieldedFundingPreparation", () => ({
  prepareShieldedAllocate: mocks.prepareShieldedAllocate,
  prepareShieldedTopUp: mocks.prepareShieldedTopUp,
}));
vi.mock("../services/shieldedMergeBudgetPreparation", () => ({
  prepareShieldedMergeBudget: mocks.prepareShieldedMergeBudget,
}));
vi.mock("../services/shieldedClaimPreparation", () => ({
  prepareShieldedClaim: mocks.prepareShieldedClaim,
}));
vi.mock("../services/shieldedFreshLineageSubmit", () => ({
  submitClaimWithFreshLineage: mocks.submitClaimWithFreshLineage,
  submitAllocateWithFreshLineage: mocks.submitAllocateWithFreshLineage,
}));
vi.mock("../services/inheritanceChain", () => ({
  loadLineageSnapshot: mocks.loadLineageSnapshot,
  findHeirLegitimacy: mocks.findHeirLegitimacy,
  loadRootRegistry: mocks.loadRootRegistry,
  assertVersionKnown: vi.fn(),
}));
vi.mock("../../../shared/config/env", () => ({
  getShieldedKeyRegistryDeploymentBlock: () => 0,
  getShieldedPoolDeploymentBlock: () => 0,
}));

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget" }>;
const account = "0x00000000000000000000000000000000000000aa";
const poolAddress = "0x00000000000000000000000000000000000000bb";
const registryAddress = "0x00000000000000000000000000000000000000cc";
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

function policyNote(commitment: bigint): Note {
  return {
    ...publicNote(commitment),
    note: {
      kind: "policy",
      rootIdentityCommitment: 111n,
      rootVersionIndex: 3n,
      policySalt: 222n,
      allocationKey: 444n,
      amountPerPeriod: 10n,
      nonce: commitment,
    },
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
    topUpTemplates: new Map(),
  };
}

function registrySnapshot(): KeyRegistrySnapshot {
  return {
    registryAddress,
    chainId: 31337n,
    toBlock: 1,
    blockHash: `0x${"ef".repeat(32)}`,
    shards: new Map(),
    keys: new Map(),
  };
}

function addRegistration(
  snapshot: KeyRegistrySnapshot,
  {
    identityCommitment,
    registrationSalt,
    registrationTag,
    ownerCommitment = 98n,
    viewingKey = `0x${"77".repeat(32)}`,
  }: {
    identityCommitment: bigint;
    registrationSalt: bigint;
    registrationTag: bigint;
    ownerCommitment?: bigint;
    viewingKey?: string;
  },
) {
  const publicKey = BigInt(viewingKey);
  snapshot.keys.set(registrationTag, {
    registrationTag,
    ownerCommitment,
    viewingKey,
    shardId: 0n,
    leafIndex: 0n,
    leaf: computeShieldedRegistrationLeaf({
      identityCommitment,
      ownerCommitment,
      viewKeyHi: publicKey >> 128n,
      viewKeyLo: publicKey & ((1n << 128n) - 1n),
      salt: registrationSalt,
    }),
  });
}

function ownRegistrationContext() {
  const input = {
    derivedSecretField: BigInt(identity.derivedSecretField),
    identityCommitment: BigInt(identity.identityCommitment),
    chainId: 31337n,
    registryAddress,
  };
  return {
    identityCommitment: input.identityCommitment,
    registrationTag: computeShieldedRegistrationTag(input),
    registrationSalt: computeShieldedRegistrationSalt(input),
    ownerCommitment: deriveShieldedHeirKeyMaterial(identity.derivedSecretField).ownerCommitment,
  };
}

function renderPanel() {
  const modules = {
    chainId: 31337n,
    poolAddress,
    registry: {},
    pool: {},
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
  fireEvent.click(screen.getAllByRole("button", { name: `shielded.actions.${action}` })[0]);
}

function openOptions(key: string) {
  fireEvent.click(screen.getByText(key, { selector: "summary" }));
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
    mocks.loadKeyRegistrySnapshot.mockResolvedValue(registrySnapshot());
    mocks.listUnspentRecoveredShieldedNotes.mockImplementation(
      (snapshot: LocalShieldedWalletSnapshot) =>
        [...snapshot.ownedNotes.values()].filter((item) => item.note.kind !== "policy"),
    );
    mocks.listRecoveredTopUpTemplates.mockImplementation(
      (snapshot: LocalShieldedWalletSnapshot) => [...(snapshot.topUpTemplates?.values() ?? [])],
    );
    mocks.registerShieldedHeirKey.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.prepareShieldedPrivateTransfer.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitPrivateTransfer.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.prepareShieldedClaim.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitClaimWithFreshLineage.mockImplementation(
      async ({ prepare }: { prepare: () => Promise<unknown> }) => {
        await prepare();
        return { receipt: { status: 1 }, transactionHash };
      },
    );
    mocks.loadLineageSnapshot.mockResolvedValue({ versions: new Map() });
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
    mocks.prepareShieldedCreatePolicy.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitCreatePolicy.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
    mocks.prepareShieldedAllocate.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitAllocateWithFreshLineage.mockImplementation(
      async ({ prepare }: { prepare: () => Promise<unknown> }) => {
        await prepare();
        return { receipt: { status: 1 }, transactionHash };
      },
    );
    mocks.prepareShieldedMergeBudget.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitMergeBudget.mockResolvedValue({ receipt: { status: 1 }, transactionHash });
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

  it("derives once on unlock and reuses that identity for registration and refresh", async () => {
    renderPanel();
    await unlock();

    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
    expect(mocks.recoverLocalShieldedWallet).toHaveBeenCalledTimes(1);
    expect(mocks.recoverLocalShieldedWallet.mock.calls[0][1]).toEqual({
      derivedSecretField: identity.derivedSecretField,
      identityCommitment: identity.identityCommitment,
    });
    expect(mocks.loadKeyRegistrySnapshot).toHaveBeenCalledTimes(1);

    openOptions("shielded.groups.tools");
    chooseAction("register");
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");
    expect(mocks.registerShieldedHeirKey).toHaveBeenCalledWith(
      expect.objectContaining({ identity }),
    );

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

  it("requires a separate fee wallet confirmation before registration", async () => {
    renderPanel();
    await unlock();
    openOptions("shielded.groups.tools");
    chooseAction("register");
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.privateWalletRequired"),
    );
    expect(mocks.registerShieldedHeirKey).not.toHaveBeenCalled();
  });

  it("shows a private receive code only after this identity's registration is confirmed", async () => {
    const before = registrySnapshot();
    addRegistration(before, {
      identityCommitment: 99n,
      registrationSalt: 77n,
      registrationTag: 88n,
    });
    const after = registrySnapshot();
    addRegistration(after, {
      identityCommitment: 99n,
      registrationSalt: 77n,
      registrationTag: 88n,
    });
    const own = ownRegistrationContext();
    addRegistration(after, own);
    mocks.loadKeyRegistrySnapshot
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    renderPanel();
    await unlock();
    expect(screen.queryByRole("textbox", { name: "shielded.receiveCodeLabel" })).toBeNull();

    openOptions("shielded.groups.tools");
    chooseAction("register");
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await screen.findByText("shielded.done");

    const code = screen.getByRole("textbox", {
      name: "shielded.receiveCodeLabel",
    }) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);
    expect(code.value).toBe(
      encodeShieldedReceiveCode(own.identityCommitment, own.registrationSalt),
    );
    fireEvent.click(screen.getByRole("button", { name: "shielded.lock" }));
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
    const registrationCalls = mocks.loadKeyRegistrySnapshot.mock.calls;
    expect(registrationCalls[registrationCalls.length - 1][1].previous).toBeUndefined();
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

  it("preserves the confirmed registration transaction hash if the later registry refresh fails", async () => {
    mocks.loadKeyRegistrySnapshot
      .mockResolvedValueOnce(registrySnapshot())
      .mockResolvedValueOnce(registrySnapshot())
      .mockRejectedValueOnce(new Error("RPC unavailable"));
    renderPanel();
    await unlock();
    openOptions("shielded.groups.tools");
    chooseAction("register");
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Transaction confirmed"),
    );
    expect(screen.getByRole("alert").textContent).toContain("RPC unavailable");
    expect(screen.getByRole("alert").textContent).toContain(transactionHash);
    expect(mocks.registerShieldedHeirKey).toHaveBeenCalledTimes(1);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("shows local wallet nonce recovery guidance instead of the raw RPC error", async () => {
    mocks.registerShieldedHeirKey.mockRejectedValueOnce(
      new Error("RPC 0x7a69: Nonce too high. Expected nonce 1344 but got 1353"),
    );
    renderPanel();
    await unlock();
    openOptions("shielded.groups.tools");
    chooseAction("register");
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
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
    expect(mocks.registerShieldedHeirKey).not.toHaveBeenCalled();
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

  it("automatically selects a sufficient balance note for a transfer without manual input selection", async () => {
    const recipientIdentityCommitment = 99n;
    const registrationSalt = 77n;
    const receiveCode = encodeShieldedReceiveCode(recipientIdentityCommitment, registrationSalt);
    const registration = registrySnapshot();
    addRegistration(registration, {
      identityCommitment: recipientIdentityCommitment,
      registrationSalt,
      registrationTag: 88n,
    });
    mocks.loadKeyRegistrySnapshot.mockResolvedValue(registration);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 3n), valueNote(2n, 7n)]),
    );
    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Receive code"));
    expect(mocks.prepareShieldedPrivateTransfer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: receiveCode },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() => expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledTimes(1));
    expect(mocks.prepareShieldedPrivateTransfer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        inputs: [expect.objectContaining({ commitment: 2n })],
        destinations: [
          expect.objectContaining({
            kind: "registered",
            identityCommitment: recipientIdentityCommitment,
            registrationSalt,
            amount: 6n,
          }),
          expect.objectContaining({ kind: "inputOwner", amount: 1n }),
        ],
      }),
    );
    await screen.findByText("shielded.done");
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("accepts recipient identity credentials for a private transfer and clears the passphrase before proof work", async () => {
    const childIdentityCommitment = 99n;
    const registrationSalt = 77n;
    const childHash = wrapIdentityCommitmentAsPersonHash(childIdentityCommitment);
    const registration = registrySnapshot();
    addRegistration(registration, {
      identityCommitment: childIdentityCommitment,
      registrationSalt,
      registrationTag: 88n,
    });
    mocks.loadKeyRegistrySnapshot.mockResolvedValue(registration);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 10n)]));
    const recipientDerivation = deferred<{
      identityCommitment: bigint;
      registrationSalt: bigint;
      personHash: string;
    }>();
    mocks.deriveShieldedRecipientMaterial.mockReturnValue(recipientDerivation.promise);

    renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    const password = enterRecipientCredentials("child-passphrase-sentinel");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() => expect(mocks.deriveShieldedRecipientMaterial).toHaveBeenCalledTimes(1));
    expect(password.value).toBe("");
    expect(mocks.deriveShieldedRecipientMaterial).toHaveBeenCalledWith({
      identity: {
        fullName: "Child Recipient",
        gender: 2,
        isBirthBC: false,
        birthYear: 2004,
        birthMonth: 5,
        birthDay: 6,
      },
      rawPassphrase: "child-passphrase-sentinel",
      chainId: 31337n,
      registryAddress,
    });
    expect(Object.keys(mocks.deriveShieldedRecipientMaterial.mock.calls[0][0]).sort()).toEqual(
      ["chainId", "identity", "rawPassphrase", "registryAddress"].sort(),
    );

    await act(async () =>
      recipientDerivation.resolve({
        identityCommitment: childIdentityCommitment,
        registrationSalt,
        personHash: childHash,
      }),
    );
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedPrivateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destinations: [
          {
            kind: "registered",
            identityCommitment: childIdentityCommitment,
            registrationSalt,
            amount: 6n,
          },
          { kind: "inputOwner", inputIndex: 0, amount: 4n },
        ],
      }),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
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

  it("uses the latest scanned parent version by default and preserves an explicit version override", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 20n)]));
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("createPolicy");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rate" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedCreatePolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rootVersionIndex: 7,
        rootIdentityCommitment: 777n,
        amountPerPeriod: 10n,
      }),
    );
    expect(screen.getByRole("heading", { name: "shielded.actions.allocate" })).toBeTruthy();

    chooseAction("createPolicy");
    openOptions("shielded.advancedOptions");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.rootVersion" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.prepareShieldedCreatePolicy).toHaveBeenCalledTimes(2));
    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedCreatePolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rootVersionIndex: 3,
        rootIdentityCommitment: 333n,
      }),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("funds an allocation from a sufficient single balance instead of an insufficient first note", async () => {
    const childIdentityCommitment = 99n;
    const childHash = wrapIdentityCommitmentAsPersonHash(childIdentityCommitment);
    const registrationSalt = 77n;
    const registration = registrySnapshot();
    addRegistration(registration, {
      identityCommitment: childIdentityCommitment,
      registrationSalt,
      registrationTag: 88n,
    });
    mocks.loadKeyRegistrySnapshot.mockResolvedValue(registration);
    mocks.loadLineageSnapshot.mockResolvedValue({
      versions: new Map([
        [
          childHash,
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
    const recovered = walletSnapshot([valueNote(1n, 3n), valueNote(2n, 25n), policyNote(3n)]);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("allocate");
    await waitFor(() =>
      expect(
        screen
          .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
          .querySelectorAll("option").length,
      ).toBe(2),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" }), {
      target: { value: childHash },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.periods" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Receive code"));
    expect(mocks.prepareShieldedAllocate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
      target: { value: encodeShieldedReceiveCode(childIdentityCommitment, registrationSalt) },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedAllocate).toHaveBeenCalledWith(
      expect.objectContaining({
        donorCommitment: 2n,
        budgetPeriods: 2n,
        heirIdentityCommitment: childIdentityCommitment,
        registrationSalt,
        policy: expect.objectContaining({ commitment: 3n }),
      }),
    );
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
  });

  it("rejects direct recipient credentials for a different child before allocation proof", async () => {
    const selectedChildHash = wrapIdentityCommitmentAsPersonHash(99n);
    mocks.loadLineageSnapshot.mockResolvedValue({
      versions: new Map([
        [
          selectedChildHash,
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
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 25n), policyNote(2n)]),
    );
    mocks.deriveShieldedRecipientMaterial.mockResolvedValue({
      identityCommitment: 100n,
      registrationSalt: 77n,
      personHash: wrapIdentityCommitmentAsPersonHash(100n),
    });

    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("allocate");
    await waitFor(() =>
      expect(
        screen
          .getByRole("combobox", { name: "shielded.fields.heirPersonHash" })
          .querySelectorAll("option").length,
      ).toBe(2),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.heirPersonHash" }), {
      target: { value: selectedChildHash },
    });
    const password = enterRecipientCredentials();
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.recipientMismatch"),
    );
    expect(password.value).toBe("");
    expect(mocks.deriveShieldedRecipientMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.submitAllocateWithFreshLineage).not.toHaveBeenCalled();
    expect(mocks.prepareShieldedAllocate).not.toHaveBeenCalled();
  });

  it("uses matching direct recipient credentials for a top-up template", async () => {
    const childIdentityCommitment = 99n;
    const registrationSalt = 77n;
    const recovered = walletSnapshot([valueNote(1n, 25n)]);
    recovered.topUpTemplates?.set(3n, {
      note: budgetNote(3n, { heirIdentityCommitment: childIdentityCommitment }).note as BudgetPayload,
      commitment: 3n,
      ciphertext: new Uint8Array(),
      shardId: 0n,
    });
    mocks.recoverLocalShieldedWallet.mockResolvedValue(recovered);
    mocks.deriveShieldedRecipientMaterial.mockResolvedValue({
      identityCommitment: childIdentityCommitment,
      registrationSalt,
      personHash: wrapIdentityCommitmentAsPersonHash(childIdentityCommitment),
    });
    mocks.prepareShieldedTopUp.mockResolvedValue({ data: {}, witness: {} });
    mocks.submitTopUp.mockResolvedValue({ receipt: { status: 1 }, transactionHash });

    renderPanel();
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: "shielded.groups.inheritance" }));
    chooseAction("topUp");
    const password = enterRecipientCredentials();
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(password.value).toBe("");
    expect(mocks.prepareShieldedTopUp).toHaveBeenCalledWith(
      expect.objectContaining({
        heirIdentityCommitment: childIdentityCommitment,
        registrationSalt,
        budget: expect.objectContaining({ commitment: 3n }),
      }),
    );
    expect(mocks.submitTopUp).toHaveBeenCalledTimes(1);
  });

  it("automatically finds a compatible first budget when only the second merge budget is selected", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([budgetNote(1n, { policySalt: 999n }), budgetNote(2n), budgetNote(3n)]),
    );
    renderPanel();
    await unlock();
    openOptions("shielded.groups.tools");
    chooseAction("mergeBudget");
    openOptions("shielded.advancedOptions");
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.fields.secondBudgetNote" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await screen.findByText("shielded.done");
    expect(mocks.prepareShieldedMergeBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        inputCommitments: [2n, 3n],
      }),
    );
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
    expect(mocks.loadKeyRegistrySnapshot).not.toHaveBeenCalled();
  });

  it("keeps an unlocked identity and draft across transaction wallet changes", async () => {
    mocks.recoverLocalShieldedWallet.mockResolvedValue(walletSnapshot([valueNote(1n, 20n)]));
    const panel = renderPanel();
    await unlock();
    chooseAction("privateTransfer");
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.fields.transferAmount" }), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }));
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
      (screen.getByRole("checkbox", { name: "shielded.privateWalletCheck" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(mocks.deriveIdentityFromForm).toHaveBeenCalledTimes(1);
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
    const registration = registrySnapshot();
    addRegistration(registration, ownRegistrationContext());
    mocks.loadKeyRegistrySnapshot.mockResolvedValue(registration);
    mocks.recoverLocalShieldedWallet.mockResolvedValue(
      walletSnapshot([valueNote(1n, 0n), budgetNote(2n, { remaining: 9n })]),
    );
    renderPanel();
    await unlock();

    expect(
      screen.getByRole("tab", { name: "shielded.groups.wallet" }).getAttribute("aria-selected"),
    ).toBe("true");
    const deposit = screen
      .getAllByRole("button", { name: "shielded.actions.shield" })
      .find((button) => button.getAttribute("aria-pressed") === "true");
    expect(deposit).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "shielded.fields.amount" })).toBeTruthy();
    expect(screen.queryByText("shielded.nextStep.shield")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "shielded.privateWalletCheck" })).toBeNull();
  });
});
