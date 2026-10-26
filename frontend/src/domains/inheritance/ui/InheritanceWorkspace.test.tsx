// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import { InheritanceWorkspace } from "./InheritanceWorkspace";
import type { ReceiveWorkerContext } from "../../../shared/workers/receiveWorkerClient";

const mocks = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn(), clearSecrets: vi.fn(), matches: true,
  sendDeposit: vi.fn(), firstPreparation: vi.fn(), nextPreparation: vi.fn(), submitFunds: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: { index?: number }) => values?.index === undefined ? key : `${key} ${values.index}` }) }));
vi.mock("../../../shared/workers/receiveWorkerClient", () => ({ ReceiveWorkerClient: class { call = mocks.call; close = mocks.close; } }));
vi.mock("../../../shared/clients/receiveChain", () => ({ ReceiveChain: class {
  constructor(_deployment: unknown, _signer: unknown, private readonly options: { beforeTransaction(): void }) {}
  sendDeposit(prepared: unknown, shardId: unknown) { return mocks.sendDeposit(this.options, prepared, shardId); }
} }));
vi.mock("../../person", () => ({ PersonHashCalculator: React.forwardRef((_props, ref) => {
  React.useImperativeHandle(ref, () => ({ getRawIdentityFields: () => ({ fullName: "Family Subject", gender: 1, birthYear: 2000, birthMonth: 5, birthDay: 17, isBirthBC: false }),
    getSecretInputs: () => ({ passphrase: "identity passphrase" }), clearSecretInputs: mocks.clearSecrets, passphrasesMatch: () => mocks.matches }));
  return <div data-testid="identity-form" />;
}) }));
vi.mock("../../wallet", () => ({ WalletConnectButton: () => <button>Connect</button> }));
vi.mock("../../../shared/ui", () => ({ CopyIconButton: ({ label, onClick }: { label: string; onClick(): void }) => <button onClick={onClick}>{label}</button> }));
const context: ReceiveWorkerContext = { rpcUrl: "http://localhost:8545", deployment: { chainId: 31337n,
  registryAddress: "0x0000000000000000000000000000000000001234", poolAddress: "0x0000000000000000000000000000000000004321" },
  manifest: { version: 1, chainId: "31337", registryAddress: "0x0000000000000000000000000000000000001234", circuits: {} } };
const state = { unlocked: true, codeCount: "1", credentialCount: 3, backupChanged: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.matches = true;
  mocks.sendDeposit.mockReset();
  mocks.call.mockImplementation(async (method: string) => {
    if (method === "walletReadQualifications") return { qualifications: [
      { index: 0, current: false, selected: false }, { index: 1, current: true, selected: true }, { index: 2, current: true, selected: true },
    ] };
    if (method === "walletRecover") return { state, notes: [], letters: [] };
    return { state, backup: new Uint8Array([1, 2, 3]), code: "receiving-code" };
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:backup"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => render(<InheritanceWorkspace context={context} signer={null} account={null} symbol="DEEP" decimals={18} />);
const openConnected = () => render(<InheritanceWorkspace context={context} signer={{} as Signer}
  account="0x1111111111111111111111111111111111111111" symbol="DEEP" decimals={18} />);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ready => { resolve = ready; });
  return { promise, resolve };
}
function enterPassword() { fireEvent.change(screen.getByLabelText("walletProtocol.backupPassword"), { target: { value: "encrypted backup password" } }); }
async function createWallet() {
  enterPassword(); fireEvent.click(screen.getByRole("button", { name: "walletProtocol.create" }));
  await screen.findByText("walletProtocol.unlocked · walletProtocol.qualifications");
}
describe("receiving wallet identity and qualification controls", () => {
  it("keeps ordinary creation free of identity and derives a family wallet through the existing identity form", async () => {
    const view = open();
    expect(screen.queryByTestId("identity-form")).toBeNull();
    await createWallet();
    expect(mocks.call).toHaveBeenCalledWith("walletCreate", { rawPassphrase: "encrypted backup password" }, context);
    view.unmount(); mocks.call.mockClear();
    open(); fireEvent.change(screen.getByLabelText("walletProtocol.walletKind"), { target: { value: "family" } });
    expect(screen.getByTestId("identity-form")).toBeTruthy();
    await createWallet();
    expect(mocks.call).toHaveBeenCalledWith("walletCreate", expect.objectContaining({ identity: {
      fields: { fullName: "Family Subject", gender: 1, birthYear: 2000, birthMonth: 5, birthDay: 17, isBirthBC: false }, rawPassphrase: "identity passphrase",
    } }), context);
    expect(mocks.clearSecrets).toHaveBeenCalled();
    expect(mocks.call.mock.calls[0][1]).not.toHaveProperty("codeRootSecret");
  });
  it("imports an encrypted qualification backup and lets the next code omit every qualification", async () => {
    open(); await createWallet();
    fireEvent.change(screen.getByLabelText("walletProtocol.qualificationBackup"), { target: { files: [{ arrayBuffer: async () => new Uint8Array([4, 5]).buffer }] } });
    fireEvent.change(screen.getByLabelText("walletProtocol.qualificationPassword"), { target: { value: "source backup password" } });
    enterPassword();
    await waitFor(() => expect((screen.getByRole("button", { name: "walletProtocol.importQualificationsAndBackup" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.importQualificationsAndBackup" }));
    await screen.findByText("walletProtocol.qualificationsImported");
    expect(mocks.call).toHaveBeenCalledWith("walletImportQualifications", { backup: new Uint8Array([4, 5]),
      sourcePassphrase: "source backup password", rawPassphrase: "encrypted backup password" }, context);
    expect((screen.getByLabelText(/walletProtocol.qualification 1/u) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("walletProtocol.qualification 2"));
    fireEvent.click(screen.getByLabelText("walletProtocol.qualification 3"));
    enterPassword(); fireEvent.click(screen.getByRole("button", { name: "walletProtocol.generateCode" }));
    await screen.findByText("walletProtocol.codeReady");
    expect(mocks.call).toHaveBeenCalledWith("walletCreateCode", expect.objectContaining({ credentialIndices: [] }), context);
  });
  it("stops later preparation and funds when cancelled while awaiting a preparation receipt", async () => {
    const receipt = deferred<void>();
    mocks.sendDeposit.mockImplementation(async (options: { beforeTransaction(): void }) => {
      options.beforeTransaction();
      mocks.firstPreparation();
      await receipt.promise;
      options.beforeTransaction();
      mocks.nextPreparation();
      mocks.submitFunds();
      return { wait: async () => ({ status: 1 }) };
    });
    openConnected(); await createWallet();
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.budget" }));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.submit" }));
    await waitFor(() => expect(mocks.firstPreparation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.cancel" }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await act(async () => { receipt.resolve(); await receipt.promise; });
    expect(mocks.nextPreparation).not.toHaveBeenCalled();
    expect(mocks.submitFunds).not.toHaveBeenCalled();
    expect(screen.queryByText("walletProtocol.confirmed")).toBeNull();
  });
  it("does not begin preparation or send funds after unmounting while the worker is preparing a deposit", async () => {
    const prepared = deferred<{ inputShardId: bigint }>();
    const defaultCall = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method: string, ...args: unknown[]) => method === "walletPrepareDeposit"
      ? prepared.promise : defaultCall(method, ...args));
    const view = openConnected(); await createWallet();
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.budget" }));
    fireEvent.click(screen.getByRole("button", { name: "walletProtocol.submit" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("walletPrepareDeposit", expect.any(Object), context));
    view.unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await act(async () => { prepared.resolve({ inputShardId: 0n }); await prepared.promise; });
    expect(mocks.sendDeposit).not.toHaveBeenCalled();
    expect(mocks.firstPreparation).not.toHaveBeenCalled();
    expect(mocks.submitFunds).not.toHaveBeenCalled();
  });
});
