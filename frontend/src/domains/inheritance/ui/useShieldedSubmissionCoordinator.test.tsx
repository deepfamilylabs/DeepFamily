// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserProvider, Interface, type Contract, type Provider } from "ethers";
import { createChainContract, getChainErrorDetails, withTransactionHash } from "@deepfamily/chain-client";
import { describe, expect, it, vi } from "vitest";
import { TransactionCenterProvider, useTransactionCenter } from "../../transactions";
import { useShieldedSubmissionCoordinator, type ShieldedTrackedSubmission } from "./useShieldedSubmissionCoordinator";
import { submitShieldedApproval } from "../services/shieldedWalletSubmission";

const wrapper = ({children}: {children: ReactNode}) => <TransactionCenterProvider>{children}</TransactionCenterProvider>;
const provider = {} as Provider;
const poolAddress = "0x1111111111111111111111111111111111111111";
function fixture() {
  let current = true;
  const tracking = { current: null as ShieldedTrackedSubmission | null };
  const input = { chainId: 31337n, poolAddress, tracking, isCurrent: () => current,
    onPending: vi.fn(), onSettled: vi.fn(), onRejected: vi.fn() };
  const hook = renderHook(() => ({ coordinator: useShieldedSubmissionCoordinator(input), centre: useTransactionCenter() }), {wrapper});
  return { hook, input, stop: () => { current = false; } };
}

describe("shielded public submission coordination", () => {
  it.each(["merge", "payment"] as const)(
    "retains the public %s step across broadcast and receipt without copying session data",
    (actionStep) => {
      const f = fixture();
      const pending = f.hook.result.current.coordinator.capture({
        id: "step", label: "private transaction", kind: "action", actionStep,
        feedbackScope: "private-session-sentinel",
        outputCommitments: ["123", "456"],
      }, provider);
      const anchor = { nonce: 4, fromBlock: 10, signerAddress: poolAddress };
      act(() => pending.onSubmitting(anchor));
      act(() => { pending.onBroadcast("0xstep"); pending.onReceipt("0xstep", 1); });

      expect(f.hook.result.current.centre?.records[0]).toMatchObject({
        phase: "done", transactionHash: "0xstep",
      });
      expect(f.hook.result.current.centre?.records[0].shieldedSubmission).toEqual({
        chainId: "31337", poolAddress, kind: "action", actionStep,
        ...anchor, outputCommitments: ["123", "456"],
      });
      expect(JSON.stringify(f.hook.result.current.centre?.records)).not.toContain("private-session-sentinel");
      expect(f.input.onSettled).toHaveBeenCalledWith(
        expect.objectContaining({ actionStep, feedbackScope: "private-session-sentinel", hash: "0xstep" }),
        1,
      );
    },
  );

  it("updates a departed owner's public merge receipt without repopulating local feedback", () => {
    const f = fixture();
    const pending = f.hook.result.current.coordinator.capture({
      id: "old-merge", label: "merge", kind: "action", actionStep: "merge",
      feedbackScope: "old-owner", outputCommitments: ["123"],
    }, provider);
    act(() => pending.onSubmitting({ nonce: 4, fromBlock: 10, signerAddress: poolAddress }));
    const tracking = f.input.tracking.current;
    f.stop();
    act(() => { pending.onBroadcast("0xmerge"); pending.onReceipt("0xmerge", 1); });

    expect(f.hook.result.current.centre?.records[0]).toMatchObject({
      id: "old-merge", phase: "done", transactionHash: "0xmerge",
      shieldedSubmission: { actionStep: "merge", outputCommitments: ["123"] },
    });
    expect(f.input.tracking.current).toBe(tracking);
    expect(f.input.onPending).toHaveBeenCalledOnce();
    expect(f.input.onSettled).not.toHaveBeenCalled();
    expect(f.input.onRejected).not.toHaveBeenCalled();
  });

  it("records a late public receipt without mutating a departed session", () => {
    const f = fixture();
    const pending = f.hook.result.current.coordinator.capture({id:"old", label:"approval", kind:"approval"}, provider);
    act(() => pending.onSubmitting({nonce:4, fromBlock:10, signerAddress:poolAddress}));
    f.stop();
    act(() => { pending.onBroadcast("0xconfirmed"); pending.onReceipt("0xconfirmed", 1); });
    expect(f.hook.result.current.centre?.records).toMatchObject([{id:"old", phase:"done", transactionHash:"0xconfirmed"}]);
    expect(f.input.onPending).toHaveBeenCalledOnce();
    expect(f.input.onSettled).not.toHaveBeenCalled();
  });

  it("keeps the original receipt separate from a newer transaction", () => {
    const f = fixture();
    const old = f.hook.result.current.coordinator.capture({id:"old", label:"approval", kind:"approval"}, provider);
    const next = f.hook.result.current.coordinator.capture({id:"new", label:"action", kind:"action"}, provider);
    act(() => old.onSubmitting({nonce:4, fromBlock:10, signerAddress:poolAddress}));
    act(() => next.onSubmitting({nonce:5, fromBlock:10, signerAddress:poolAddress}));
    act(() => old.onReceipt("0xold", 1));
    expect(f.input.tracking.current?.id).toBe("new");
    expect(f.input.onSettled).not.toHaveBeenCalled();
    expect(f.hook.result.current.centre?.records.find(record => record.id === "old")).toMatchObject({phase:"done", transactionHash:"0xold"});
    expect(f.hook.result.current.centre?.records.find(record => record.id === "new")?.phase).toBe("busy");
  });

  it("retains uncertain submissions but releases explicitly rejected wallet requests", () => {
    const f = fixture();
    const pending = f.hook.result.current.coordinator.capture({id:"approval", label:"approval", kind:"approval"}, provider);
    act(() => pending.onSubmitting({nonce:4, fromBlock:10, signerAddress:poolAddress}));
    act(() => pending.onError(new Error("RPC unavailable")));
    expect(f.input.tracking.current?.nonce).toBe(4);
    act(() => pending.onError(Object.assign(new Error("rejected"), {code:4001})));
    expect(f.input.tracking.current).toBeNull();
    expect(f.input.onRejected).toHaveBeenCalledOnce();
    expect(f.hook.result.current.centre?.records[0].phase).toBe("failed");
  });

  it("releases an approval that a real BrowserProvider rejects because another wallet request is pending", async () => {
    const account = poolAddress;
    const tokenAddress = "0x2222222222222222222222222222222222222222";
    const tokenInterface = new Interface(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [account];
      if (method === "eth_blockNumber") return "0xa";
      if (method === "eth_getTransactionCount") return "0x4";
      if (method === "eth_estimateGas") return "0x186a0";
      if (method === "eth_call") return tokenInterface.encodeFunctionResult("balanceOf", [100n]);
      if (method === "eth_sendTransaction") throw { code: -32002, message: "A wallet request is already pending" };
      throw new Error(`Unexpected test RPC ${method}`);
    });
    const browser = new BrowserProvider({ request });
    const signer = await browser.getSigner(account);
    const token = createChainContract(tokenAddress, tokenInterface, signer);
    const f = fixture();
    const tracked = f.hook.result.current.coordinator.capture({ id: "pending-request", label: "approval", kind: "approval" }, browser);
    let failure: unknown;
    await act(async () => {
      try {
        await submitShieldedApproval({
          signer, chainId: 31337n, account, token: token as Contract, spender: poolAddress, amount: 9n,
          onSubmitting: tracked.onSubmitting, onBroadcast: tracked.onBroadcast,
        });
      } catch (error) {
        failure = error;
        tracked.onError(error);
      }
    });
    expect(getChainErrorDetails(failure)).toMatchObject({ category: "wallet", code: "WALLET_REQUEST_PENDING", retryable: true });
    expect(f.input.tracking.current).toBeNull();
    expect(f.input.onRejected).toHaveBeenCalledOnce();
    expect(f.hook.result.current.centre?.records).toMatchObject([{ id: "pending-request", phase: "failed" }]);
    expect(request.mock.calls.filter(([input]) => input.method === "eth_sendTransaction")).toHaveLength(1);
    expect(f.input.onSettled).not.toHaveBeenCalled();
    browser.destroy();
  });

  it.each(["broadcast", "receipt"])("does not discard a %s submission on a wallet-pending error", (evidence) => {
    const f = fixture();
    const tracked = f.hook.result.current.coordinator.capture({ id: "known", label: "approval", kind: "approval" }, provider);
    act(() => tracked.onSubmitting({ nonce: 4, fromBlock: 10, signerAddress: poolAddress }));
    const cause = Object.assign(new Error("another wallet request is pending"), { code: -32002 });
    const failure = evidence === "broadcast" ? withTransactionHash(cause, "0xknown") : Object.assign(cause, { receipt: { status: 1, hash: "0xknown" } });
    act(() => tracked.onError(failure));
    expect(f.input.tracking.current?.id).toBe("known");
    expect(f.input.onRejected).not.toHaveBeenCalled();
    expect(f.hook.result.current.centre?.records[0].phase).toBe("busy");
  });

  it("does not clear a newer session's tracking when an older wallet request is refused", () => {
    const f = fixture();
    const old = f.hook.result.current.coordinator.capture({ id: "old", label: "approval", kind: "approval" }, provider);
    const next = f.hook.result.current.coordinator.capture({ id: "new", label: "action", kind: "action" }, provider);
    act(() => old.onSubmitting({ nonce: 4, fromBlock: 10, signerAddress: poolAddress }));
    act(() => next.onSubmitting({ nonce: 5, fromBlock: 10, signerAddress: poolAddress }));
    act(() => old.onError(Object.assign(new Error("pending"), { code: -32002 })));
    expect(f.input.tracking.current?.id).toBe("new");
    expect(f.input.onRejected).not.toHaveBeenCalled();
    expect(f.hook.result.current.centre?.records.find((record) => record.id === "old")?.phase).toBe("failed");
    expect(f.hook.result.current.centre?.records.find((record) => record.id === "new")?.phase).toBe("busy");
  });

  it("settles a refused wallet request after its session leaves without local callbacks", () => {
    const f = fixture();
    const tracked = f.hook.result.current.coordinator.capture({ id: "departed", label: "approval", kind: "approval" }, provider);
    act(() => tracked.onSubmitting({ nonce: 4, fromBlock: 10, signerAddress: poolAddress }));
    f.stop();
    act(() => tracked.onError(Object.assign(new Error("pending"), { code: -32002 })));
    expect(f.hook.result.current.centre?.records[0]).toMatchObject({ id: "departed", phase: "failed" });
    expect(f.input.onRejected).not.toHaveBeenCalled();
    expect(f.input.onPending).toHaveBeenCalledOnce();
  });
});
