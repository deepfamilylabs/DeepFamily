import type { Signer } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { captureWalletDraft } from "./walletDraft";
import { invalidateWalletConnection } from "./walletConnectionGeneration";

const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}`;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const view = { current: 1, accounts: [alice, bob], chain: "0x7a69" };
  const rpc = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "eth_chainId") return view.chain;
    if (method === "eth_accounts") return view.accounts;
    throw new Error(`Unexpected wallet prompt: ${method}`);
  });
  const signer = { getAddress: async () => alice, provider: { send: rpc } } as unknown as Signer;
  const capture = (id: number) => captureWalletDraft({ signer, account: alice, chainId: 31337n, isCurrent: () => view.current === id });
  const receipt = { status: 1, hash };
  const send = vi.fn(async () => ({ hash, wait: vi.fn(async () => receipt) }));
  return { view, rpc, capture, send, receipt };
}

describe("wallet draft handoff", () => {
  it.each(["account", "chain", "draft", "disconnect and reconnect"])("stops before signing if %s changes during preparation", async (change) => {
    const { view, capture, send } = fixture();
    const draft = capture(1);
    const anchor = deferred<number>();
    const submitted = draft.submit({ provider: { getBlockNumber: () => anchor.promise }, send, expected: { to: bob } });
    if (change === "account") view.accounts = [bob, alice];
    if (change === "chain") view.chain = "0x1";
    if (change === "draft") view.current = 2;
    if (change === "disconnect and reconnect") invalidateWalletConnection();
    anchor.resolve(3);
    await expect(submitted).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a retired draft even if the final pending account read returns the original account", async () => {
    const { view, rpc, capture, send } = fixture();
    const accounts = deferred<string[]>();
    rpc.mockImplementation(async method => method === "eth_accounts" ? accounts.promise : view.chain);
    const pending = capture(1).submit({ send, expected: { to: bob } });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("eth_accounts", []));
    view.current++;
    accounts.resolve([alice]);
    await expect(pending).rejects.toThrow("no longer active");
    expect(send).not.toHaveBeenCalled();
  });

  it("settles a broadcast once for its original draft without updating a newer form", async () => {
    const { view, rpc, capture, receipt } = fixture();
    const confirmation = deferred<typeof receipt>();
    const wait = vi.fn(() => confirmation.promise);
    const send = vi.fn(async () => ({ hash, wait }));
    const recordHash = vi.fn(), recordReceipt = vi.fn(), updateOldForm = vi.fn(), updateNewForm = vi.fn();
    const original = capture(1);
    const pending = original.submit({ send, expected: { to: bob }, onSubmitted: recordHash, onConfirmed: recordReceipt });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    view.current++;
    const next = capture(2);
    confirmation.resolve(receipt);
    const result = await pending;
    original.commit(() => updateOldForm(result));
    next.commit(updateNewForm);
    expect(result.transactionHash).toBe(hash);
    expect(recordHash).toHaveBeenCalledExactlyOnceWith(hash);
    expect(recordReceipt).toHaveBeenCalledExactlyOnceWith(hash, receipt);
    expect(updateOldForm).not.toHaveBeenCalled();
    expect(updateNewForm).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.map(([method]) => method).sort()).toEqual(["eth_accounts", "eth_chainId"]);
  });
});
