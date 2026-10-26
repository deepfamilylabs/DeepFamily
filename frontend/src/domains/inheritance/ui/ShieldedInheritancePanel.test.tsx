// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";
import { ShieldedWalletSessionProvider } from "./ShieldedWalletSessionContext";
import { encodeBudgetRule } from "../../../shared/zk/budgetRule";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  close: vi.fn(),
  clearSecrets: vi.fn(),
  matches: true,
  sendDeposit: vi.fn(),
  sendClaim: vi.fn(),
  firstValidation: vi.fn(),
  nextSubmission: vi.fn(),
  submitFunds: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { index?: number }) =>
      values?.index === undefined ? key : `${key} ${values.index}`,
  }),
}));
vi.mock("../../../shared/workers/receiveWorkerClient", () => ({
  ReceiveWorkerClient: class {
    call = mocks.call;
    close = mocks.close;
  },
}));
vi.mock("../../../shared/clients/walletBackupStore", () => ({
  saveEncryptedWalletBackup: vi.fn(async () => {}),
  readLatestEncryptedWalletBackup: vi.fn(async () => null),
}));
vi.mock("../../../shared/clients/receiveChain", () => ({
  ReceiveChain: class {
    constructor(
      _deployment: unknown,
      _signer: unknown,
      private readonly options: { beforeTransaction(): void },
    ) {}
    sendDeposit(prepared: unknown, shardId: unknown) {
      return mocks.sendDeposit(this.options, prepared, shardId);
    }
    sendClaim(prepared: unknown, shardId: unknown) {
      return mocks.sendClaim(this.options, prepared, shardId);
    }
  },
}));
vi.mock("../../person", () => ({
  PersonHashCalculator: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      getRawIdentityFields: () => ({
        fullName: "Family Subject",
        gender: 1,
        birthYear: 2000,
        birthMonth: 5,
        birthDay: 17,
        isBirthBC: false,
      }),
      getSecretInputs: () => ({ passphrase: "identity passphrase" }),
      clearSecretInputs: mocks.clearSecrets,
      passphrasesMatch: () => mocks.matches,
    }));
    return <div data-testid="identity-form" />;
  }),
}));
vi.mock("../../../shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui")>()),
  CopyIconButton: ({ label, onClick }: { label: string; onClick(): void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

const pool = "0x0000000000000000000000000000000000004321";
const modules: ShieldedPageModules = {
  context: {
    rpcUrl: "http://localhost:8545",
    deployment: {
      chainId: 31337n,
      registryAddress: "0x0000000000000000000000000000000000001234",
      poolAddress: pool,
      lettersAddress: "0x0000000000000000000000000000000000005678",
    },
    manifest: {
      version: 1,
      chainId: "31337",
      registryAddress: "0x0000000000000000000000000000000000001234",
      circuits: {},
    },
  },
  assetAddress: "0x0000000000000000000000000000000000000003",
  assetSymbol: "DEEP",
  tokenDecimals: 18,
};
const context = modules.context;
const state = { unlocked: true, codeCount: "1", credentialCount: 3, backupChanged: false };
const recovered = {
  state: {
    ...state,
    identity: {
      fullName: "Family Subject",
      personHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
  },
  notes: [
    { handle: "11", kind: "value", amount: "100", codeIndex: "0" },
    {
      handle: "21",
      kind: "budget",
      amount: "30",
      codeIndex: "1",
      rate: "10",
      periodDays: "1",
      eligibleFrom: "1000",
      claimPeriod: "0",
    },
  ],
  letters: [
    {
      messageId: "7",
      sender: "0x0000000000000000000000000000000000000009",
      body: "A letter for the family",
      transactionHash: "0x01",
      registeredAt: "1700000000",
    },
  ],
};
const rule = encodeBudgetRule({
  chainId: "31337",
  poolAddress: pool,
  familyCommitment: "1",
  parentVersion: "1",
  rate: "10",
  periodDays: "1",
  policySalt: "5",
  allocationKeyCommitment: "6",
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.matches = true;
  mocks.sendDeposit.mockReset();
  mocks.sendClaim.mockReset();
  mocks.call.mockImplementation(async (method: string) => {
    if (method === "walletReadQualifications")
      return {
        qualifications: [
          { index: 0, current: false, selected: false },
          { index: 1, current: true, selected: true },
          { index: 2, current: true, selected: true },
        ],
      };
    if (method === "walletRecover") return recovered;
    if (method === "walletPrepareDeposit" || method === "walletPrepareClaim")
      return { inputShardId: 0n };
    return { state, backup: new Uint8Array([1, 2, 3]), code: "receiving-code" };
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:backup"), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = (signer: Signer | null = null) =>
  render(
    <ShieldedWalletSessionProvider enabled>
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account="0x1111111111111111111111111111111111111111"
      />
    </ShieldedWalletSessionProvider>,
  );
const openConnected = () => open({} as Signer);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}
function enterPassword() {
  fireEvent.change(screen.getByLabelText("walletProtocol.backupPassword"), {
    target: { value: "encrypted backup password" },
  });
}
async function createWallet() {
  enterPassword();
  fireEvent.click(screen.getByRole("button", { name: "walletProtocol.create" }));
  await screen.findByRole("navigation", { name: "shielded.actionsTitle" });
}
async function refresh() {
  fireEvent.click(screen.getByRole("button", { name: "shielded.actions.recover" }));
  await screen.findByText("Family Subject");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "shielded.actions.recover" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
async function prepareFund() {
  await refresh();
  fireEvent.click(screen.getByRole("button", { name: "shielded.actions.fund" }));
  fireEvent.change(screen.getByLabelText("walletProtocol.rule"), { target: { value: rule } });
  fireEvent.change(screen.getByRole("textbox", { name: "shielded.receiveCodeInputLabel" }), {
    target: { value: "dfrecv-child" },
  });
  fireEvent.click(screen.getByLabelText("shielded.valueOption 1"));
}

describe("inheritance panel layout", () => {
  it("restores the grouped task rail, overview and receipt around the unlocked wallet", async () => {
    openConnected();
    await createWallet();
    const navigation = screen.getByRole("navigation", { name: "shielded.actionsTitle" });
    expect(within(navigation).getAllByRole("group")).toHaveLength(3);
    expect(
      within(navigation)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "shielded.actions.shield",
      "shielded.actions.privateTransfer",
      "shielded.actions.unshield",
      "shielded.actions.fund",
      "shielded.actions.claim",
      "qualificationManager.title",
      "shielded.privateLetters.write",
      "shielded.privateLetters.inbox",
    ]);
    expect(screen.getByRole("region", { name: "shielded.balanceTitle" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "shielded.spendReview.preview" }),
    ).toBeTruthy();
    await refresh();
    // A recovered budget settles the first task, and a qualification opens rule creation.
    expect(
      within(navigation)
        .getByRole("button", { name: /shielded.actions.claim/u })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      within(navigation).getByRole("button", { name: "walletProtocol.createRule" }),
    ).toBeTruthy();
    expect(screen.getByText("shielded.identityHash")).toBeTruthy();
  });
  it("lists recovered letters with their registration time", async () => {
    openConnected();
    await createWallet();
    await refresh();
    fireEvent.click(screen.getByRole("button", { name: "shielded.privateLetters.inbox" }));
    expect(screen.getByText("A letter for the family")).toBeTruthy();
    expect(screen.getByText(new Date(1_700_000_000_000).toLocaleString())).toBeTruthy();
  });
});

describe("receiving wallet identity and qualification controls", () => {
  it("keeps ordinary creation free of identity and derives a family wallet through the existing identity form", async () => {
    const view = open();
    expect(screen.queryByTestId("identity-form")).toBeNull();
    await createWallet();
    expect(mocks.call).toHaveBeenCalledWith(
      "walletCreate",
      { rawPassphrase: "encrypted backup password" },
      context,
    );
    view.unmount();
    mocks.call.mockClear();
    open();
    fireEvent.click(screen.getByRole("radio", { name: "walletProtocol.familyWallet" }));
    expect(screen.getByTestId("identity-form")).toBeTruthy();
    await createWallet();
    expect(mocks.call).toHaveBeenCalledWith(
      "walletCreate",
      expect.objectContaining({
        identity: {
          fields: {
            fullName: "Family Subject",
            gender: 1,
            birthYear: 2000,
            birthMonth: 5,
            birthDay: 17,
            isBirthBC: false,
          },
          rawPassphrase: "identity passphrase",
        },
      }),
      context,
    );
    expect(mocks.clearSecrets).toHaveBeenCalled();
    expect(mocks.call.mock.calls[0][1]).not.toHaveProperty("codeRootSecret");
  });
  it("lets the next code omit every qualification", async () => {
    open();
    await createWallet();
    await refresh();
    fireEvent.click(screen.getByRole("button", { name: "shielded.actions.receiveCode" }));
    await screen.findByLabelText("walletProtocol.qualification 2");
    expect(screen.getByText("walletProtocol.qualificationPrivacy")).toBeTruthy();
    expect(
      (screen.getByLabelText(/walletProtocol.qualification 1/u) as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("walletProtocol.qualification 2"));
    fireEvent.click(screen.getByLabelText("walletProtocol.qualification 3"));
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "shielded.receiveCodeLabel",
        })) as HTMLTextAreaElement
      ).value,
    ).toBe("receiving-code");
    expect(mocks.call).toHaveBeenCalledWith(
      "walletCreateCode",
      expect.objectContaining({ credentialIndices: [] }),
      context,
    );
  });
});

describe("budget transactions", () => {
  it("deposits with the pasted rule, code and chosen balance", async () => {
    mocks.sendDeposit.mockImplementation(async (options: { beforeTransaction(): void }) => {
      options.beforeTransaction();
      return { hash: "0xabc", wait: async () => ({ status: 1 }) };
    });
    openConnected();
    await createWallet();
    await prepareFund();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.sendDeposit).toHaveBeenCalledTimes(1));
    expect(mocks.call).toHaveBeenCalledWith(
      "walletPrepareDeposit",
      { code: "dfrecv-child", rule, budgetPeriods: "1", noteHandle: "11" },
      context,
    );
    await screen.findByText(/0xabc/u);
  });
  it("claims the due period of the chosen budget", async () => {
    mocks.sendClaim.mockImplementation(async (options: { beforeTransaction(): void }) => {
      options.beforeTransaction();
      return { hash: "0xdef", wait: async () => ({ status: 1 }) };
    });
    openConnected();
    await createWallet();
    await refresh();
    expect(
      (screen.getByRole("checkbox", { name: "shielded.claimPeriodOption" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.sendClaim).toHaveBeenCalledTimes(1));
    expect(mocks.call).toHaveBeenCalledWith(
      "walletPrepareClaim",
      { noteHandle: "21", periodIndex: "0" },
      context,
    );
  });
  it("stops submission when cancelled while awaiting transaction validation", async () => {
    const receipt = deferred<void>();
    mocks.sendDeposit.mockImplementation(async (options: { beforeTransaction(): void }) => {
      options.beforeTransaction();
      mocks.firstValidation();
      await receipt.promise;
      options.beforeTransaction();
      mocks.nextSubmission();
      mocks.submitFunds();
      return { hash: "0xabc", wait: async () => ({ status: 1 }) };
    });
    openConnected();
    await createWallet();
    await prepareFund();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.firstValidation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.cancel" }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      receipt.resolve();
      await receipt.promise;
    });
    expect(mocks.nextSubmission).not.toHaveBeenCalled();
    expect(mocks.submitFunds).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "walletProtocol.create" })).toBeTruthy();
  });
  it("does not send funds after unmounting while the worker is proving a deposit", async () => {
    const prepared = deferred<{ inputShardId: bigint }>();
    const defaultCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method: string, ...args: unknown[]) =>
      method === "walletPrepareDeposit" ? prepared.promise : defaultCall(method, ...args),
    );
    const view = openConnected();
    await createWallet();
    await prepareFund();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith("walletPrepareDeposit", expect.any(Object), context),
    );
    view.unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      prepared.resolve({ inputShardId: 0n });
      await prepared.promise;
    });
    expect(mocks.sendDeposit).not.toHaveBeenCalled();
    expect(mocks.firstValidation).not.toHaveBeenCalled();
    expect(mocks.submitFunds).not.toHaveBeenCalled();
  });
  it("keeps a new operation busy when an earlier canceled transaction finishes", async () => {
    const oldReceipt = deferred<{ status: number }>(),
      nextWallet = deferred<unknown>();
    mocks.sendDeposit.mockResolvedValue({ hash: "0xabc", wait: () => oldReceipt.promise });
    openConnected();
    await createWallet();
    await prepareFund();
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));
    await waitFor(() => expect(mocks.sendDeposit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.cancel" }));
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method: string, ...args: unknown[]) =>
      method === "walletCreate" ? nextWallet.promise : original(method, ...args),
    );
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.create" }));
    const unlocking = await screen.findByRole("button", { name: "shielded.walletKeys.unlocking" });
    expect((unlocking as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      oldReceipt.resolve({ status: 1 });
      await oldReceipt.promise;
    });
    expect((unlocking as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("transaction.success")).toBeNull();
    await act(async () => {
      nextWallet.resolve({ state, backup: new Uint8Array([1, 2, 3]) });
      await nextWallet.promise;
    });
    await screen.findByRole("navigation", { name: "shielded.actionsTitle" });
  });
});
