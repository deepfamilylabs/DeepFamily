// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTrustedEndorserAccess } from "./useTrustedEndorserAccess";

const mocks = vi.hoisted(() => ({
  config: { rpcUrl: "rpc", chainId: 1, contractAddress: "family", readerAddress: "reader" },
  wallet: { signer: {}, address: "owner" },
  update: vi.fn(), generation: 0,
}));
vi.mock("../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../../wallet", () => ({ useWallet: () => mocks.wallet, getWalletConnectionGeneration: () => mocks.generation }));
vi.mock("../services/trustedEndorserService", () => ({ updateTrustedEndorser: mocks.update, loadTrustedEndorsers: vi.fn() }));
beforeEach(() => { mocks.update.mockReset(); mocks.config.chainId = 1; mocks.generation = 0; });
afterEach(cleanup);

it("refreshes local data after an active mutation", async () => {
  mocks.update.mockResolvedValue({});
  const onChanged = vi.fn();
  const { result } = renderHook(() => useTrustedEndorserAccess(onChanged));
  await act(async () => { await result.current!.addTrustedEndorser("hash", 1, "account"); });
  expect(onChanged).toHaveBeenCalledOnce();
});

it.each(["network", "wallet", "unmount"])("does not refresh the new view after %s changes", async (change) => {
  let complete!: () => void;
  mocks.update.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
  const onChanged = vi.fn();
  const { result, rerender, unmount } = renderHook(() => useTrustedEndorserAccess(onChanged));
  const pending = result.current!.removeTrustedEndorser("hash", 1, "account");
  if (change === "network") { mocks.config.chainId = 2; rerender(); }
  else if (change === "wallet") mocks.generation++;
  else unmount();
  complete();
  await act(async () => { await pending; });
  expect(onChanged).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls[0][0].isCurrent()).toBe(false);
});
