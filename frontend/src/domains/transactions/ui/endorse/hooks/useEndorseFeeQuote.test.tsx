// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndorseFeeQuote } from "./useEndorseFeeQuote";

const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("../../../../../shared/clients/contractFactory", () => ({
  createDeepTokenContract: mocks.token,
}));

const address = "0x1111111111111111111111111111111111111111";
const nextAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function fixture() {
  const contract = {
    runner: {},
    DEEP_FAMILY_TOKEN_CONTRACT: vi.fn().mockResolvedValue(tokenAddress),
    protocolEndorsementFeeBps: vi.fn().mockResolvedValue(500),
  };
  const token = {
    recentReward: vi.fn().mockResolvedValue(5n),
    decimals: vi.fn().mockResolvedValue(0),
    balanceOf: vi.fn().mockResolvedValue(20n),
    symbol: vi.fn().mockResolvedValue("DEEP"),
  };
  mocks.token.mockReturnValue(token);
  return { contract, token };
}

describe("useEndorseFeeQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clears a previous account's quote while the replacement read is pending or fails", async () => {
    const { contract, token } = fixture();
    const hook = renderHook(
      ({ owner }) => useEndorseFeeQuote({ isOpen: true, address: owner, contract }),
      {
        initialProps: { owner: address },
      },
    );
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const oldApplyFeeQuote = hook.result.current.applyFeeQuote;
    let rejectBalance!: (error: Error) => void;
    token.balanceOf.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectBalance = reject;
      }),
    );
    hook.rerender({ owner: nextAddress });
    expect(hook.result.current).toMatchObject({
      loaded: false,
      userDeepBalanceRaw: 0n,
      deepTokenAddress: "",
    });
    await vi.waitFor(() => expect(token.balanceOf).toHaveBeenCalledWith(nextAddress));
    await act(async () => {
      rejectBalance(new Error("Account balance unavailable"));
      oldApplyFeeQuote({ fee: 9n, feeFormatted: "9", decimals: 0, symbol: "OLD" });
    });
    expect(hook.result.current).toMatchObject({
      loaded: false,
      userDeepBalanceRaw: 0n,
      deepTokenAddress: "",
    });
  });

  it("ignores an old contract's late quote after a new contract has loaded", async () => {
    const { contract: oldContract } = fixture();
    let finishOld!: (address: string) => void;
    oldContract.DEEP_FAMILY_TOKEN_CONTRACT.mockReturnValue(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    const { contract: nextContract } = fixture();
    const hook = renderHook(
      ({ contract }) => useEndorseFeeQuote({ isOpen: true, address, contract }),
      {
        initialProps: { contract: oldContract },
      },
    );
    hook.rerender({ contract: nextContract });
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true));
    await act(async () => {
      finishOld("0x4444444444444444444444444444444444444444");
    });
    expect(hook.result.current.deepTokenAddress).toBe(tokenAddress);
  });

  it("does not retain a loaded quote across close and reopen when the next lookup fails", async () => {
    const { contract } = fixture();
    const hook = renderHook(({ isOpen }) => useEndorseFeeQuote({ isOpen, address, contract }), {
      initialProps: { isOpen: true },
    });
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true));
    hook.rerender({ isOpen: false });
    expect(hook.result.current.loaded).toBe(false);
    contract.DEEP_FAMILY_TOKEN_CONTRACT.mockRejectedValue(new Error("RPC unavailable"));
    hook.rerender({ isOpen: true });
    await vi.waitFor(() => expect(contract.DEEP_FAMILY_TOKEN_CONTRACT).toHaveBeenCalledTimes(2));
    expect(hook.result.current).toMatchObject({
      loaded: false,
      userDeepBalanceRaw: 0n,
      deepTokenAddress: "",
    });
  });
});
