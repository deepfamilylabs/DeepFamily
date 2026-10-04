import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract, Signer } from "ethers";
import {
  submitFund,
  submitClaim,
  submitPrivateTransfer,
  submitShield,
  submitUnshield,
  type ShieldedPoolActionData,
} from "./shieldedPoolFlows";

const mocks = vi.hoisted(() => ({ zkWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: mocks.zkWorkerCall,
}));

const POOL_ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
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

function actionData(): ShieldedPoolActionData {
  return {
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: Array<bigint>(12).fill(0n),
    outputCommitments: [123n, 456n],
    outputCiphertexts: [CIPHERTEXT, CIPHERTEXT],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
  };
}

function fixture() {
  let chainId = 71n;
  let gasBalance = 10n ** 18n;
  const receipt = { status: 1 };
  const estimateGas = vi.fn(async () => 100_000n);
  const methodNames = ["shield", "fund", "claim", "privateTransfer", "unshield"] as const;
  const methods = Object.fromEntries(
    methodNames.map((name) => {
      const method = Object.assign(
        vi.fn(async () => ({
          hash: `0x${name}`,
          wait: async () => receipt,
        })),
        { estimateGas },
      );
      return [name, method];
    }),
  ) as Record<
    (typeof methodNames)[number],
    ReturnType<typeof vi.fn> & { estimateGas: typeof estimateGas }
  >;
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId })),
    getBalance: vi.fn(async () => gasBalance),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 1_000_000_000n, gasPrice: null })),
  };
  const signer = {
    provider,
    getAddress: vi.fn(async () => WALLET_ADDRESS),
  } as unknown as Signer;
  const pool = {
    getAddress: vi.fn(async () => POOL_ADDRESS),
    connect: vi.fn(() => methods),
  } as unknown as Contract;
  const common = {
    assetKind: "erc20" as const,
    pool,
    signer,
    expectedChainId: 71n,
    data: actionData(),
    witness: { secret: "private-test-witness" },
  };
  return {
    common,
    methods,
    estimateGas,
    provider,
    setChainId: (value: bigint) => {
      chainId = value;
    },
    setBalance: (value: bigint) => {
      gasBalance = value;
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

describe("shielded pool local proof and self-submit flows", () => {
  it("sends the native deposit amount for both estimation and submission", async () => {
    const f = fixture();
    const amount = 10n ** 17n;
    await submitShield({ ...f.common, assetKind: "native", amount });
    expect(f.estimateGas.mock.calls[0][f.estimateGas.mock.calls[0].length - 1]).toEqual({
      value: amount,
    });
    expect(f.methods.shield.mock.calls[0][f.methods.shield.mock.calls[0].length - 1]).toEqual({
      value: amount,
      gasLimit: 120_000n,
    });
  });

  it("requires native balance to cover the deposit and the full gas limit", async () => {
    const f = fixture();
    const amount = 10n ** 17n;
    f.setBalance(amount + 120_000n * 1_000_000_000n - 1n);
    await expect(submitShield({ ...f.common, assetKind: "native", amount })).rejects.toThrow(
      "deposit and gas",
    );
    expect(f.methods.shield).not.toHaveBeenCalled();
  });
  it("proves the public deposit locally, checks CFX gas, and signs the exact shield call", async () => {
    const f = fixture();
    const stages: string[] = [];
    const result = await submitShield({
      ...f.common,
      amount: 100n,
      onStage: (stage) => stages.push(stage),
    });
    expect(result).toMatchObject({
      transactionHash: "0xshield",
      gasEstimate: 100_000n,
      gasLimit: 120_000n,
    });
    expect(stages).toEqual(["proving", "checkingGas", "submitting", "confirming"]);
    expect(mocks.zkWorkerCall).toHaveBeenCalledWith(
      "generateShieldedProof",
      expect.objectContaining({
        circuit: "shield",
        witness: f.common.witness,
        expectedPublicSignals: expect.any(Array),
      }),
      { timeoutMs: 1_200_000 },
    );
    const signals = mocks.zkWorkerCall.mock.calls[0][1].expectedPublicSignals;
    // Shield proves chainId, pool, two outputs, two ciphertext hashes and the amount.
    expect(signals).toHaveLength(7);
    expect(signals[1]).toBe(BigInt(POOL_ADDRESS).toString());
    expect(signals[6]).toBe("100");
    expect(f.methods.shield).toHaveBeenCalledWith(
      100n,
      expect.objectContaining({ outputCommitments: [123n, 456n] }),
      expect.stringMatching(/^0x[0-9a-f]{512}$/),
      { gasLimit: 120_000n },
    );
    expect(f.common.pool.connect).toHaveBeenCalledWith(f.common.signer);
    expect(f.provider.getBalance).toHaveBeenCalledWith(WALLET_ADDRESS);
  });

  it("routes each private action and public withdrawal to the matching circuit and method", async () => {
    const cases = [
      ["fund", submitFund],
      ["claim", submitClaim],
      ["privateTransfer", submitPrivateTransfer],
    ] as const;
    for (const [name, submit] of cases) {
      const f = fixture();
      await submit(f.common);
      expect(mocks.zkWorkerCall.mock.lastCall?.[1].circuit).toBe(name);
      expect(f.methods[name]).toHaveBeenCalledOnce();
      expect(f.methods[name].mock.calls[0][0]).toEqual(f.common.data);
    }
    const f = fixture();
    await submitUnshield({ ...f.common, recipient: RECIPIENT, amount: 75n });
    const signals = mocks.zkWorkerCall.mock.lastCall?.[1].expectedPublicSignals;
    expect(signals).toHaveLength(12);
    expect(signals[10]).toBe("75");
    expect(signals[11]).toBe(BigInt(RECIPIENT).toString());
    expect(f.methods.unshield.mock.calls[0][0]).toBe(RECIPIENT);
    expect(f.methods.unshield.mock.calls[0][1]).toBe(75n);
  });

  it("rejects a public signal mismatch before estimating or sending a transaction", async () => {
    const f = fixture();
    mocks.zkWorkerCall.mockImplementationOnce(async (_name, params) => ({
      proof: PROOF,
      publicSignals: params.expectedPublicSignals.map((value: string, index: number) =>
        index === 6 ? "999" : value,
      ),
    }));
    await expect(submitShield({ ...f.common, amount: 100n })).rejects.toThrow(
      "public signal 6 does not match transaction",
    );
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("rejects the wrong chain before generating a proof", async () => {
    const f = fixture();
    f.setChainId(1n);
    await expect(submitClaim(f.common)).rejects.toThrow("wrong network");
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });

  it("refuses to send when the gas wallet cannot pay the estimated CFX fee", async () => {
    const f = fixture();
    f.setBalance(1n);
    await expect(submitClaim(f.common)).rejects.toThrow("Transaction wallet needs at least");
    expect(f.methods.claim).not.toHaveBeenCalled();
  });

  it("rejects malformed ciphertexts before sending private data to the proof worker", async () => {
    const f = fixture();
    const data = { ...f.common.data, outputCiphertexts: ["0xab", CIPHERTEXT] as const };
    await expect(submitClaim({ ...f.common, data })).rejects.toThrow("exactly 512 bytes");
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });
});
