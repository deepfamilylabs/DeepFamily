// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { ShieldedWorkerContext } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { PrivateLetterPreparationExpiredError, type ProvenPrivateLetter } from "../services/privateLetterChain";
import { useBudgetLetterDelivery } from "./useBudgetLetterDelivery";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  submit: vi.fn(),
  lock: null as null | (() => void),
  walletChange: null as null | (() => void),
  walletGeneration: 0,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../shared/workers/shieldedAssetWorkerClient", () => ({
  shieldedAssetWorkerCall: mocks.worker,
  subscribeShieldedAssetWorkerLock: (listener: () => void) => {
    mocks.lock = listener;
    return () => { mocks.lock = null; };
  },
}));
vi.mock("../../wallet", () => ({
  getWalletConnectionGeneration: () => mocks.walletGeneration,
  subscribeWalletConnectionChange: (listener: () => void) => {
    mocks.walletChange = listener;
    return () => { mocks.walletChange = null; };
  },
}));
vi.mock("../services/privateLetterChain", async original => ({
  ...await original<typeof import("../services/privateLetterChain")>(),
  submitPrivateLetter: mocks.submit,
}));

const context: ShieldedWorkerContext = {
  rpcUrl: "http://localhost:8545", chainId: "31337",
  factoryAddress: "0x1111111111111111111111111111111111111111", factoryDeploymentBlock: 1,
  familyAddress: "0x2222222222222222222222222222222222222222",
  lineageIndexAddress: "0x3333333333333333333333333333333333333333",
  poolAddress: "0x4444444444444444444444444444444444444444", poolDeploymentBlock: 1,
  assetKind: "native", lettersAddress: "0x5555555555555555555555555555555555555555",
};
const letter: ProvenPrivateLetter = {
  delivery: { messageId: "7", checkpointId: "1", asOf: "900", deadline: "1200", recipientBinding: "9" },
  ciphertext: "0x010203", proof: "0x1234",
};
const draft = { code: "budget-receive-code", body: "A private family letter" };
const current = () => true;
const tr = (key: string) => `shielded.privateLetters.${key}`;
const props = () => ({ context, scope: "identity-and-key", signer: {} as Signer, beginWalletRequest: vi.fn(() => vi.fn()) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.walletGeneration = 0;
  mocks.worker.mockReset().mockImplementation(async (method: string) => method === "prepareLetter" ? letter : { ok: true });
  mocks.submit.mockReset().mockResolvedValue({ transactionHash: "0xletter" });
});
afterEach(cleanup);

describe("budget letter delivery", () => {
  it("stages a funding submission without preparing or sending its letter", async () => {
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => {
      result.current.setEnabled(true);
      result.current.setBody(draft.body);
      result.current.stageDeposit(draft, "73", "funding:1");
    });
    expect(result.current.hasDeposit("funding:1")).toBe(true);
    expect(result.current.hasDeposit("another-funding")).toBe(false);
    expect(result.current.delivery?.status).toBe("awaitingDeposit");
    expect(result.current.delivery?.budget).toBe("73");
    await act(async () => { await result.current.retry(current); });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.body).toBe(draft.body);
  });

  it("consumes only the matching confirmed funding ID once, including concurrent confirmations", async () => {
    const prepared = deferred<ProvenPrivateLetter>();
    mocks.worker.mockReturnValueOnce(prepared.promise);
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.stageDeposit(draft, "73", "funding:1"); });
    await act(async () => { await result.current.confirmDeposit("another-funding", current); });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(result.current.hasDeposit("funding:1")).toBe(true);
    await act(async () => { await result.current.confirmDeposit("funding:1", () => false); });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(result.current.hasDeposit("funding:1")).toBe(true);
    let sending!: Promise<void>;
    act(() => { sending = result.current.confirmDeposit("funding:1", current); });
    expect(result.current.hasDeposit("funding:1")).toBe(false);
    await act(async () => { await result.current.confirmDeposit("funding:1", current); });
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect(mocks.worker).toHaveBeenCalledWith("prepareLetter", {
      context, ...draft, budgetCommitment: "73",
    }, expect.anything());
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => { prepared.resolve(letter); await sending; });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(result.current.delivery?.status).toBe("sent");
    await act(async () => { await result.current.confirmDeposit("funding:1", current); });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("cancels only the matching awaiting deposit and retains the form draft", async () => {
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => {
      result.current.setEnabled(true);
      result.current.setBody(draft.body);
      result.current.stageDeposit(draft, "73", "funding:1");
    });
    act(() => { result.current.cancelDeposit("another-funding"); });
    expect(result.current.hasDeposit("funding:1")).toBe(true);
    expect(result.current.delivery?.status).toBe("awaitingDeposit");
    act(() => { result.current.cancelDeposit("funding:1"); });
    expect(result.current.hasDeposit("funding:1")).toBe(false);
    expect(result.current.delivery).toBeNull();
    expect(result.current.enabled).toBe(true);
    expect(result.current.body).toBe(draft.body);
    await act(async () => { await result.current.confirmDeposit("funding:1", current); });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("cannot continue a staged deposit after its secret session locks", async () => {
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => {
      result.current.setEnabled(true);
      result.current.setBody(draft.body);
      result.current.stageDeposit(draft, "73", "funding:1");
    });
    act(() => { mocks.lock?.(); });
    expect(result.current.hasDeposit("funding:1")).toBe(false);
    expect(result.current.delivery).toBeNull();
    expect(result.current.body).toBe("");
    await act(async () => { await result.current.confirmDeposit("funding:1", current); });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does no preflight or delivery work unless the optional letter is enabled", async () => {
    const { result } = renderHook(() => useBudgetLetterDelivery(props()));
    await expect(result.current.preflight(draft.code, 1, current)).resolves.toBeNull();
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects an empty enabled letter before making any worker request", async () => {
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setEnabled(true); result.current.setBody("  \n "); });
    await expect(result.current.preflight(draft.code, 0, current)).rejects.toThrow(tr("bodyRequired"));
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("stops the combined operation when preflight fails", async () => {
    mocks.worker.mockRejectedValueOnce(new Error("Revoked receive authorization"));
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    await expect((async () => {
      const checked = await result.current.preflight(draft.code, 1, current);
      if (checked) await result.current.start(checked, "73", current);
    })()).rejects.toThrow(tr("preflightFailed"));
    expect(mocks.worker.mock.calls.map(([method]) => method)).toEqual(["validateLetter"]);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.body).toBe(draft.body);
    expect(result.current.delivery).toBeNull();
  });

  it("preflights first and sends for the confirmed budget with the same code and body", async () => {
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    let checked: typeof draft | null = null;
    await act(async () => { checked = await result.current.preflight(draft.code, 1, current); });
    expect(checked).toEqual(draft);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.worker).toHaveBeenCalledWith("validateLetter", { context, ...draft, keyMode: 1 }, expect.anything());
    await act(async () => { await result.current.start(checked!, "73", current); });
    expect(mocks.worker.mock.calls.map(([method]) => method)).toEqual(["validateLetter", "prepareLetter"]);
    expect(mocks.worker).toHaveBeenLastCalledWith("prepareLetter", { context, ...draft, budgetCommitment: "73" }, expect.anything());
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      signer: input.signer, address: context.lettersAddress, chainId: context.chainId,
      letter, onWalletRequest: input.beginWalletRequest,
    }));
    expect(result.current.delivery).toEqual({ budget: "73", status: "sent", hash: "0xletter", canUpdateCode: false });
    expect(result.current.body).toBe("");
  });

  it("retries an uncertain delivery with the same prepared message and does not prepare another proof", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("RPC interrupted"));
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    await act(async () => { await result.current.start(draft, "73", current); });
    expect(result.current.delivery).toEqual({ budget: "73", status: "failed", canUpdateCode: false, expired: false });
    expect(result.current.body).toBe(draft.body);
    act(() => { result.current.setReplacementCode("must-not-replace-an-uncertain-message"); });
    await act(async () => { await result.current.retry(current); });
    expect(mocks.worker.mock.calls.map(([method]) => method)).toEqual(["prepareLetter"]);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[0][0].letter).toBe(mocks.submit.mock.calls[1][0].letter);
    expect(result.current.delivery?.status).toBe("sent");
    expect(result.current.body).toBe("");
    expect(result.current.replacementCode).toBe("");
    await act(async () => { await result.current.retry(current); });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("allows a replacement code and fresh proof after irreversible preparation expiry", async () => {
    const replacementLetter = { ...letter, delivery: { ...letter.delivery, messageId: "8" } };
    mocks.submit.mockRejectedValueOnce(new PrivateLetterPreparationExpiredError());
    mocks.worker.mockResolvedValueOnce(letter).mockResolvedValueOnce(replacementLetter);
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setBody(draft.body); });
    await act(async () => { await result.current.start(draft, "73", current); });
    expect(result.current.delivery).toEqual({ budget: "73", status: "failed", canUpdateCode: true, expired: true });
    act(() => { result.current.setReplacementCode("fresh-budget-code"); });
    await act(async () => { await result.current.retry(current); });
    expect(mocks.worker.mock.calls.map(([method]) => method)).toEqual(["prepareLetter", "prepareLetter"]);
    expect(mocks.worker).toHaveBeenLastCalledWith("prepareLetter", {
      context, code: "fresh-budget-code", body: draft.body, budgetCommitment: "73",
    }, expect.anything());
    expect(mocks.submit.mock.calls.map(([request]) => request.letter.delivery.messageId)).toEqual(["7", "8"]);
    expect(result.current.delivery?.status).toBe("sent");
  });

  it.each(["lock", "wallet", "scope", "signer", "deployment"] as const)("clears plaintext and ignores late proof results after a %s change", async change => {
    const prepared = deferred<ProvenPrivateLetter>();
    mocks.worker.mockReturnValueOnce(prepared.promise);
    const initial = props();
    const { result, rerender } = renderHook(input => useBudgetLetterDelivery(input), { initialProps: initial });
    act(() => {
      result.current.setEnabled(true);
      result.current.setBody(draft.body);
      result.current.setReplacementCode("private-replacement-code");
    });
    let sending!: Promise<void>;
    act(() => { sending = result.current.start(draft, "73", current); });
    expect(result.current.delivery?.status).toBe("sending");
    if (change === "lock") act(() => { mocks.lock?.(); });
    else if (change === "wallet") act(() => { mocks.walletGeneration++; mocks.walletChange?.(); });
    else if (change === "scope") rerender({ ...initial, scope: "replacement-identity" });
    else if (change === "signer") rerender({ ...initial, signer: {} as Signer });
    else rerender({ ...initial, context: { ...context, poolAddress: "0x6666666666666666666666666666666666666666" } });
    expect(result.current.enabled).toBe(false);
    expect(result.current.body).toBe("");
    expect(result.current.replacementCode).toBe("");
    expect(result.current.delivery).toBeNull();
    await act(async () => { prepared.resolve(letter); await sending; });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.delivery).toBeNull();
    await act(async () => { await result.current.retry(current); });
    expect(mocks.worker).toHaveBeenCalledTimes(1);
  });

  it("ignores a late confirmed submission after the session is locked", async () => {
    const submitted = deferred<{ transactionHash: string }>();
    mocks.submit.mockReturnValueOnce(submitted.promise);
    const input = props();
    const { result } = renderHook(() => useBudgetLetterDelivery(input));
    act(() => { result.current.setBody(draft.body); });
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.start(draft, "73", current); await Promise.resolve(); });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const request = mocks.submit.mock.calls[0][0];
    expect(request.isCurrent()).toBe(true);
    act(() => { mocks.lock?.(); });
    expect(request.isCurrent()).toBe(false);
    await act(async () => { submitted.resolve({ transactionHash: "0xlate" }); await sending; });
    expect(result.current.body).toBe("");
    expect(result.current.delivery).toBeNull();
  });

  it("rejects late preflight results after the identity scope changes", async () => {
    const validation = deferred<{ ok: true }>();
    mocks.worker.mockReturnValueOnce(validation.promise);
    const initial = props();
    const { result, rerender } = renderHook(input => useBudgetLetterDelivery(input), { initialProps: initial });
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    const checked = result.current.preflight(draft.code, 0, current);
    const rejected = expect(checked).rejects.toThrow("shielded.unlockRequired");
    rerender({ ...initial, scope: "replacement-key" });
    await act(async () => { validation.resolve({ ok: true }); await rejected; });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.body).toBe("");
  });

  it("preserves the draft when only the public-state read strategy changes", () => {
    const initial = props();
    const { result, rerender } = renderHook(input => useBudgetLetterDelivery(input), { initialProps: initial });
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    rerender({ ...initial, context: { ...context, stateReadMode: "chain" } });
    expect(result.current.enabled).toBe(true);
    expect(result.current.body).toBe(draft.body);
  });

  it("invalidates a pending receipt on a read-mode change and retries the same prepared message", async () => {
    const submitted = deferred<{ transactionHash: string }>();
    mocks.submit.mockReturnValueOnce(submitted.promise);
    const initial = props();
    const { result, rerender } = renderHook(input => useBudgetLetterDelivery(input), { initialProps: initial });
    act(() => { result.current.setEnabled(true); result.current.setBody(draft.body); });
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.start(draft, "73", current); await Promise.resolve(); });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const originalSubmission = mocks.submit.mock.calls[0][0];
    expect(originalSubmission.isCurrent()).toBe(true);
    rerender({ ...initial, context: { ...context, stateReadMode: "chain" } });
    expect(originalSubmission.isCurrent()).toBe(false);
    expect(result.current.delivery).toEqual({ budget: "73", status: "failed", canUpdateCode: false });
    expect(result.current.enabled).toBe(true);
    expect(result.current.body).toBe(draft.body);
    await act(async () => { submitted.resolve({ transactionHash: "0xold-read-mode" }); await sending; });
    expect(result.current.delivery?.status).toBe("failed");
    expect(result.current.delivery?.hash).toBeUndefined();
    await act(async () => { await result.current.retry(current); });
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][0].letter).toBe(originalSubmission.letter);
    expect(mocks.submit.mock.calls[1][0].isCurrent()).toBe(false);
    expect(result.current.delivery).toEqual({ budget: "73", status: "sent", hash: "0xletter", canUpdateCode: false });
    expect(result.current.body).toBe("");
  });
});
