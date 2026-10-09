import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract, Signer } from "ethers";
import {
  ShieldedLineageSubmissionError,
  submitFundWithFreshLineage,
  submitClaimWithFreshLineage,
  type CurrentLineageRoots,
} from "./shieldedFreshLineageSubmit";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";

const mocks = vi.hoisted(() => ({ zkWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({ zkWorkerCall: mocks.zkWorkerCall }));

const POOL_ADDRESS = "0x1111111111111111111111111111111111111111";
const LINEAGE_ADDRESS = "0x2222222222222222222222222222222222222222";
const OTHER_ADDRESS = "0x3333333333333333333333333333333333333333";
const WALLET_ADDRESS = "0x4444444444444444444444444444444444444444";
const CIPHERTEXT = `0x${"ab".repeat(512)}`;
const PROOF = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};

function actionData(roots: CurrentLineageRoots): ShieldedPoolActionData {
  return {
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: Array<bigint>(12).fill(0n),
    outputCommitments: [123n, 456n],
    outputCiphertexts: [CIPHERTEXT, CIPHERTEXT],
    relation0: roots.endorsement,
    relation1: roots.trusted,
    asOf: 1n,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let roots = { endorsement: 10n, trusted: 20n };
  let configuredIndex = LINEAGE_ADDRESS;
  let balanceCalls = 0;
  let afterBalance: ((calls: number) => void) | undefined;
  const receipt = { status: 1 };
  const estimateGas = vi.fn(async () => 100_000n);
  const fund = Object.assign(
    vi.fn(async () => ({ hash: "0xfund", wait: async () => receipt })),
    { estimateGas },
  );
  const claim = Object.assign(
    vi.fn(async () => ({ hash: "0xclaim", wait: async () => receipt })),
    { estimateGas },
  );
  const provider = {
    getBlockNumber: vi.fn(async () => 100),
    getNetwork: vi.fn(async () => ({ chainId: 71n })),
    getBalance: vi.fn(async () => {
      balanceCalls += 1;
      afterBalance?.(balanceCalls);
      return 10n ** 18n;
    }),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 1_000_000_000n, gasPrice: null })),
  };
  const signer = { provider, getAddress: vi.fn(async () => WALLET_ADDRESS) } as unknown as Signer;
  const lineageRoot = vi.fn(async (kind: number) =>
    kind === 0 ? roots.endorsement : roots.trusted,
  );
  const lineageIndex = {
    getAddress: vi.fn(async () => LINEAGE_ADDRESS),
    root: lineageRoot,
  } as unknown as Contract;
  const pool = {
    getAddress: vi.fn(async () => POOL_ADDRESS),
    LINEAGE_INDEX: vi.fn(async () => configuredIndex),
    connect: vi.fn(() => ({ fund, claim })),
  } as unknown as Contract;
  const prepare = vi.fn(async (current: CurrentLineageRoots, attempt: number) => ({
    data: actionData(current),
    witness: { attempt },
  }));
  const common = { pool, lineageIndex, signer, expectedChainId: 71n, prepare };
  return {
    common,
    prepare,
    fund,
    claim,
    estimateGas,
    lineageIndex,
    lineageRoot,
    provider,
    setRoots: (endorsement: bigint, trusted: bigint) => {
      roots = { endorsement, trusted };
    },
    setIndex: (value: string) => {
      configuredIndex = value;
    },
    onBalance: (callback: (calls: number) => void) => {
      afterBalance = callback;
    },
  };
}

beforeEach(() => {
  mocks.zkWorkerCall.mockReset();
  mocks.zkWorkerCall.mockImplementation(async (_name, params) => ({
    proof: PROOF,
    publicSignals: params.expectedPublicSignals,
  }));
});

describe("fresh lineage proof self-submit", () => {
  it.each([
    ["fund", submitFundWithFreshLineage],
    ["claim", submitClaimWithFreshLineage],
  ] as const)(
    "rebuilds %s before broadcast when roots change during proving",
    async (action, submit) => {
      const f = fixture();
      let proofCount = 0;
      mocks.zkWorkerCall.mockImplementation(async (_name, params) => {
        proofCount += 1;
        if (proofCount === 1) f.setRoots(11n, 21n);
        return { proof: PROOF, publicSignals: params.expectedPublicSignals };
      });
      const result = await submit(f.common);
      expect(result.attempts).toBe(2);
      expect(result.prepared.witness).toEqual({ attempt: 2 });
      expect(f.prepare).toHaveBeenCalledTimes(2);
      expect(mocks.zkWorkerCall).toHaveBeenCalledTimes(2);
      expect(f[action]).toHaveBeenCalledOnce();
      expect(f[action]).toHaveBeenCalledWith(
        expect.objectContaining({ relation0: 11n, relation1: 21n }),
        expect.any(String),
        {
          chainId: 71n,
          gasLimit: 120_000n,
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 0n,
        },
      );
      expect(f.lineageIndex.root).toHaveBeenCalledWith(0, { blockTag: 100 });
      expect(f.lineageIndex.root).toHaveBeenCalledWith(1, { blockTag: 100 });
    },
  );

  it("does not retry after broadcast and reports the transaction hash when roots change", async () => {
    const f = fixture();
    f.claim.mockImplementationOnce(async () => {
      f.setRoots(11n, 21n);
      return {
        hash: "0xclaim",
        wait: async () => {
          throw new Error("transaction reverted");
        },
      };
    });
    await expect(submitClaimWithFreshLineage(f.common)).rejects.toMatchObject({
      name: "ShieldedLineageSubmissionError",
      transactionHash: "0xclaim",
      message: expect.stringContaining("lineage roots changed"),
    });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.claim).toHaveBeenCalledOnce();
  });

  it("aborts without an automatic retry if roots change as submitting begins", async () => {
    const f = fixture();
    f.onBalance((calls) => {
      if (calls === 2) f.setRoots(11n, 21n);
    });
    await expect(submitFundWithFreshLineage(f.common)).rejects.toThrow(
      "Lineage roots changed as submission began",
    );
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.fund).not.toHaveBeenCalled();
  });

  it.each([
    ["fund", submitFundWithFreshLineage],
    ["claim", submitClaimWithFreshLineage],
  ] as const)(
    "does not request %s after the operation becomes stale during the final roots RPC",
    async (action, submit) => {
      const f = fixture();
      const rootsRead = deferred<bigint>();
      let submitting = false;
      let waitingForRoots = false;
      let current = true;
      f.lineageRoot.mockImplementation(async (kind: number) => {
        if (submitting && kind === 0) {
          waitingForRoots = true;
          return rootsRead.promise;
        }
        return kind === 0 ? 10n : 20n;
      });
      const onStage = vi.fn((stage: string) => {
        if (stage === "submitting") {
          submitting = true;
          if (!current) throw new Error("Operation scope or wallet changed");
        }
      });
      const pending = submit({ ...f.common, onStage }).catch((error: unknown) => error);
      await vi.waitFor(() => expect(waitingForRoots).toBe(true));
      current = false;
      rootsRead.resolve(10n);
      expect(await pending).toMatchObject({
        name: "ShieldedLineageSubmissionError",
        cause: expect.objectContaining({ message: "Operation scope or wallet changed" }),
      });
      expect(onStage.mock.calls.filter(([stage]) => stage === "submitting")).toHaveLength(2);
      expect(f.prepare).toHaveBeenCalledOnce();
      expect(f[action]).not.toHaveBeenCalled();
    },
  );

  it("checks the wallet network after the final roots RPC before requesting a transaction", async () => {
    const f = fixture();
    const rootsRead = deferred<bigint>();
    let submitting = false;
    let waitingForRoots = false;
    f.lineageRoot.mockImplementation(async (kind: number) => {
      if (submitting && kind === 0) {
        waitingForRoots = true;
        return rootsRead.promise;
      }
      return kind === 0 ? 10n : 20n;
    });
    const pending = submitFundWithFreshLineage({
      ...f.common,
      onStage: (stage) => {
        if (stage === "submitting") submitting = true;
      },
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(waitingForRoots).toBe(true));
    f.provider.getNetwork.mockResolvedValue({ chainId: 72n });
    rootsRead.resolve(10n);
    expect(await pending).toMatchObject({
      name: "ShieldedLineageSubmissionError",
      cause: expect.objectContaining({
        message: "Transaction wallet is connected to the wrong network",
      }),
    });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.fund).not.toHaveBeenCalled();
  });

  it("checks the current operation again after the final network RPC", async () => {
    const f = fixture();
    const networkRead = deferred<{ chainId: bigint }>();
    let submitting = false;
    let waitingForNetwork = false;
    let current = true;
    f.provider.getNetwork.mockImplementation(async () => {
      if (submitting) {
        waitingForNetwork = true;
        return networkRead.promise;
      }
      return { chainId: 71n };
    });
    const pending = submitClaimWithFreshLineage({
      ...f.common,
      onStage: (stage) => {
        if (stage === "submitting") {
          submitting = true;
          if (!current) throw new Error("Identity locked");
        }
      },
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(waitingForNetwork).toBe(true));
    current = false;
    networkRead.resolve({ chainId: 71n });
    expect(await pending).toMatchObject({
      name: "ShieldedLineageSubmissionError",
      cause: expect.objectContaining({ message: "Identity locked" }),
    });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.claim).not.toHaveBeenCalled();
  });

  it("stops after the bounded number of stale proofs without broadcasting", async () => {
    const f = fixture();
    let next = 11n;
    mocks.zkWorkerCall.mockImplementation(async (_name, params) => {
      f.setRoots(next, next + 10n);
      next += 1n;
      return { proof: PROOF, publicSignals: params.expectedPublicSignals };
    });
    await expect(submitFundWithFreshLineage(f.common)).rejects.toThrow("exhausted 3 attempts");
    expect(f.prepare).toHaveBeenCalledTimes(3);
    expect(mocks.zkWorkerCall).toHaveBeenCalledTimes(3);
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.fund).not.toHaveBeenCalled();
  });

  it("checks that the supplied global lineage index belongs to the pool", async () => {
    const f = fixture();
    f.setIndex(OTHER_ADDRESS);
    await expect(submitClaimWithFreshLineage(f.common)).rejects.toThrow(
      "Lineage index does not belong to this shielded pool",
    );
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.lineageIndex.root).not.toHaveBeenCalled();
  });

  it("reports a mined revert and never retries it", async () => {
    const f = fixture();
    f.claim.mockImplementationOnce(async () => ({
      hash: "0xclaim",
      wait: async () => ({ status: 0 }),
    }));
    let error: unknown;
    try {
      await submitClaimWithFreshLineage(f.common);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ShieldedLineageSubmissionError);
    expect(error).toMatchObject({ transactionHash: "0xclaim", receiptStatus: 0 });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.claim).toHaveBeenCalledOnce();
  });
});
