import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract, Signer } from "ethers";
import type { Groth16Proof } from "../../../shared/zk/zk";
import {
  submitFund,
  submitClaim,
  submitPrivateTransfer,
  submitShield,
  submitUnshield,
  type ShieldedPoolActionData,
  type ShieldedSubmissionAnchor,
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

function actionData(capacity = 2): ShieldedPoolActionData {
  return {
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: Array(capacity).fill(0n),
    inputRoots: Array(capacity).fill(0n),
    inputNullifiers: Array(capacity).fill(0n),
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
    getTransactionCount: vi.fn(async () => 9),
    getBlockNumber: vi.fn(async () => 77),
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
  it.each([1, 0])("returns a repriced transaction's hash and receipt status %i", async (status) => {
    const f = fixture();
    const receipt = { status };
    const replacement = Object.assign(new Error("Transaction repriced"), {
      code: "TRANSACTION_REPLACED",
      reason: "repriced",
      cancelled: false,
      replacement: { hash: "0xrepriced" },
      receipt,
    });
    f.methods.shield.mockResolvedValueOnce({
      hash: "0xshield",
      wait: vi.fn().mockRejectedValue(replacement),
    });
    const onBroadcast = vi.fn();

    const result = await submitShield({ ...f.common, amount: 100n, onBroadcast });

    expect(result).toMatchObject({ transactionHash: "0xrepriced", receipt });
    expect(onBroadcast.mock.calls).toEqual([["0xshield"], ["0xrepriced"]]);
    expect(f.methods.shield).toHaveBeenCalledOnce();
  });

  it.each(["cancelled", "replaced"])(
    "leaves a %s transaction for public reconciliation without reporting its receipt as success",
    async (reason) => {
      const f = fixture();
      const replacement = Object.assign(new Error("Transaction replaced"), {
        code: "TRANSACTION_REPLACED",
        reason,
        cancelled: true,
        replacement: { hash: "0xother-call" },
        receipt: { status: 1 },
      });
      f.methods.shield.mockResolvedValueOnce({
        hash: "0xshield",
        wait: vi.fn().mockRejectedValue(replacement),
      });
      const onBroadcast = vi.fn();

      await expect(submitShield({ ...f.common, amount: 100n, onBroadcast })).rejects.toBe(
        replacement,
      );

      expect(onBroadcast).toHaveBeenCalledExactlyOnceWith("0xshield");
      expect(f.methods.shield).toHaveBeenCalledOnce();
    },
  );

  it("holds the wallet request guard only until the wallet returns, before broadcasting or waiting for a receipt", async () => {
    const f = fixture();
    const order: string[] = [];
    let releaseWallet!: (transaction: { hash: string; wait: typeof wait }) => void;
    let releaseReceipt!: (receipt: { status: number }) => void;
    const wait = vi.fn(() => {
      order.push("receipt");
      return new Promise<{ status: number }>((resolve) => {
        releaseReceipt = resolve;
      });
    });
    const endWalletRequest = vi.fn(() => order.push("end"));
    const onWalletRequest = vi.fn(() => {
      order.push("begin");
      expect(f.methods.shield).not.toHaveBeenCalled();
      return endWalletRequest;
    });
    f.methods.shield.mockImplementationOnce(() => {
      order.push("wallet");
      return new Promise((resolve) => {
        releaseWallet = resolve;
      });
    });
    const pending = submitShield({
      ...f.common,
      amount: 100n,
      onSubmitting: () => order.push("anchor"),
      onWalletRequest,
      onBroadcast: () => order.push("broadcast"),
      onStage: (stage) => {
        if (stage === "confirming") order.push("confirming");
      },
    });
    await vi.waitFor(() => expect(f.methods.shield).toHaveBeenCalledOnce());
    expect(order).toEqual(["begin", "anchor", "wallet"]);
    expect(endWalletRequest).not.toHaveBeenCalled();
    releaseWallet({ hash: "0xshield", wait });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    expect(order).toEqual([
      "begin",
      "anchor",
      "wallet",
      "end",
      "broadcast",
      "confirming",
      "receipt",
    ]);
    expect(onWalletRequest).toHaveBeenCalledOnce();
    expect(endWalletRequest).toHaveBeenCalledOnce();
    releaseReceipt({ status: 1 });
    await pending;
    expect(endWalletRequest).toHaveBeenCalledOnce();
  });

  it("ends the wallet request guard when the wallet rejects submission", async () => {
    const f = fixture();
    const endWalletRequest = vi.fn();
    const onWalletRequest = vi.fn(() => endWalletRequest);
    const onBroadcast = vi.fn();
    const onStage = vi.fn();
    const rejection = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    f.methods.shield.mockRejectedValueOnce(rejection);
    await expect(
      submitShield({ ...f.common, amount: 100n, onWalletRequest, onBroadcast, onStage }),
    ).rejects.toBe(rejection);
    expect(onWalletRequest).toHaveBeenCalledOnce();
    expect(endWalletRequest).toHaveBeenCalledOnce();
    expect(onBroadcast).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalledWith("confirming");
  });

  it.each([
    "preflight",
    "network",
    "gas balance",
    "fee review",
    "network after fee review",
  ] as const)("does not start a wallet request guard when %s fails", async (failure) => {
    const f = fixture();
    const onWalletRequest = vi.fn(() => vi.fn());
    const onGasEstimate = vi.fn();
    let data = f.common.data;
    let message: string;
    switch (failure) {
      case "preflight":
        data = { ...data, outputCiphertexts: ["0xab", CIPHERTEXT] };
        message = "exactly 512 bytes";
        break;
      case "network":
        f.setChainId(1n);
        message = "wrong network";
        break;
      case "gas balance":
        f.setBalance(1n);
        message = "Transaction wallet needs at least";
        break;
      case "fee review":
        onGasEstimate.mockRejectedValueOnce(new Error("Fee review canceled"));
        message = "Fee review canceled";
        break;
      case "network after fee review":
        onGasEstimate.mockImplementationOnce(() => f.setChainId(1n));
        message = "wrong network";
        break;
    }
    await expect(
      submitShield({ ...f.common, data, amount: 100n, onGasEstimate, onWalletRequest }),
    ).rejects.toThrow(message);
    expect(onWalletRequest).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("does not send a transaction when the wallet request boundary rejects the caller's state", async () => {
    const f = fixture();
    const onSubmitting = vi.fn();
    const onWalletRequest = vi.fn(() => {
      throw new Error("Inheritance session locked before the wallet request");
    });
    await expect(
      submitShield({ ...f.common, amount: 100n, onSubmitting, onWalletRequest }),
    ).rejects.toThrow("Inheritance session locked before the wallet request");
    expect(onWalletRequest).toHaveBeenCalledOnce();
    expect(onSubmitting).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("ends the wallet request guard without sending when recording the submission fails", async () => {
    const f = fixture();
    const endWalletRequest = vi.fn();
    const onWalletRequest = vi.fn(() => endWalletRequest);
    const onSubmitting = vi.fn(() => {
      throw new Error("Submission record unavailable");
    });
    await expect(
      submitShield({ ...f.common, amount: 100n, onWalletRequest, onSubmitting }),
    ).rejects.toThrow("Submission record unavailable");
    expect(onWalletRequest).toHaveBeenCalledOnce();
    expect(onSubmitting).toHaveBeenCalledOnce();
    expect(endWalletRequest).toHaveBeenCalledOnce();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("waits for fee review before sending and rechecks the chain afterwards", async () => {
    const f = fixture();
    let continueReview!: () => void;
    const onGasEstimate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          continueReview = resolve;
        }),
    );
    const pending = submitPrivateTransfer({ ...f.common, data: actionData(8), onGasEstimate });
    while (!onGasEstimate.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onGasEstimate).toHaveBeenCalledWith({
      gasEstimate: 100_000n,
      gasLimit: 120_000n,
      maximumGasPrice: 1_000_000_000n,
      maximumGasFee: 120_000_000_000_000n,
    });
    expect(f.methods.privateTransfer).not.toHaveBeenCalled();
    f.setChainId(1n);
    const rejected = expect(pending).rejects.toThrow("wrong network");
    continueReview();
    await rejected;
    expect(f.methods.privateTransfer).not.toHaveBeenCalled();
  });

  it("records a fixed pending nonce after fee approval and sends it with the reviewed fee caps", async () => {
    const f = fixture();
    let approve!: () => void;
    const order: string[] = [];
    const onGasEstimate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        }),
    );
    const onSubmitting = vi.fn((anchor: ShieldedSubmissionAnchor) => {
      order.push("anchor");
      expect(anchor).toEqual({ nonce: 9, fromBlock: 77, signerAddress: WALLET_ADDRESS });
      expect(f.methods.privateTransfer).not.toHaveBeenCalled();
    });
    const pending = submitPrivateTransfer({
      ...f.common,
      data: actionData(8),
      onGasEstimate,
      onSubmitting,
      onStage: (stage) => {
        if (stage === "submitting") order.push("current");
      },
    });
    await vi.waitFor(() => expect(onGasEstimate).toHaveBeenCalledOnce());
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.provider.getBlockNumber).not.toHaveBeenCalled();
    expect(onSubmitting).not.toHaveBeenCalled();
    approve();
    await pending;
    expect(f.provider.getTransactionCount).toHaveBeenCalledWith(WALLET_ADDRESS, "pending");
    expect(f.provider.getBlockNumber).toHaveBeenCalledOnce();
    expect(order).toEqual(["current", "anchor"]);
    expect(
      f.methods.privateTransfer.mock.calls[0][f.methods.privateTransfer.mock.calls[0].length - 1],
    ).toEqual({
      nonce: 9,
      chainId: 71n,
      gasLimit: 120_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
  });

  it("rechecks caller state after pending-nonce reads before marking or sending a transaction", async () => {
    const f = fixture();
    let release!: (nonce: number) => void;
    f.provider.getTransactionCount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let locked = false;
    const onSubmitting = vi.fn();
    const pending = submitPrivateTransfer({
      ...f.common,
      data: actionData(8),
      onSubmitting,
      onStage: (stage) => {
        if (stage === "submitting" && locked)
          throw new Error("Locked while reading the transaction nonce");
      },
    });
    await vi.waitFor(() => expect(f.provider.getTransactionCount).toHaveBeenCalledOnce());
    locked = true;
    const rejection = expect(pending).rejects.toThrow("Locked while reading");
    release(9);
    await rejection;
    expect(onSubmitting).not.toHaveBeenCalled();
    expect(f.methods.privateTransfer).not.toHaveBeenCalled();
  });

  it("binds a native deposit to the reviewed chain even if the wallet switches during nonce lookup", async () => {
    const f = fixture();
    f.provider.getTransactionCount.mockImplementationOnce(async () => {
      f.setChainId(72n);
      return 9;
    });
    await submitShield({ ...f.common, assetKind: "native", amount: 100n, onSubmitting: vi.fn() });
    const overrides = f.methods.shield.mock.calls[0][f.methods.shield.mock.calls[0].length - 1];
    expect(overrides).toMatchObject({ chainId: 71n, nonce: 9, value: 100n });
  });

  it("leaves nonce choice unchanged when submission tracking is not requested", async () => {
    const f = fixture();
    await submitPrivateTransfer({ ...f.common, data: actionData(8) });
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.provider.getBlockNumber).not.toHaveBeenCalled();
    expect(
      f.methods.privateTransfer.mock.calls[0][f.methods.privateTransfer.mock.calls[0].length - 1],
    ).not.toHaveProperty("nonce");
  });

  it("retains the submission anchor when the wallet's broadcast result is unknown", async () => {
    const f = fixture();
    const onSubmitting = vi.fn(),
      onBroadcast = vi.fn();
    f.methods.privateTransfer.mockRejectedValueOnce(
      new Error("Wallet disconnected before returning a hash"),
    );
    await expect(
      submitPrivateTransfer({ ...f.common, data: actionData(8), onSubmitting, onBroadcast }),
    ).rejects.toThrow("disconnected");
    expect(onSubmitting).toHaveBeenCalledOnce();
    expect(onSubmitting).toHaveBeenCalledWith({
      nonce: 9,
      fromBlock: 77,
      signerAddress: WALLET_ADDRESS,
    });
    expect(onBroadcast).not.toHaveBeenCalled();
  });

  it("submits an asset-worker proof without a main-thread witness and reports broadcast immediately", async () => {
    const f = fixture();
    const onBroadcast = vi.fn();
    const preparedProof = { ...PROOF, protocol: "groth16", curve: "bn128" } as Groth16Proof;
    await submitPrivateTransfer({
      ...f.common,
      data: actionData(8),
      witness: undefined,
      preparedProof,
      onBroadcast,
    });
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
    expect(onBroadcast).toHaveBeenCalledWith("0xprivateTransfer");
    await expect(
      submitPrivateTransfer({ ...f.common, data: actionData(8), preparedProof }),
    ).rejects.toThrow("must not include a witness");
  });

  it("uses the canonical eight-input circuit names and matching contract methods", async () => {
    for (const action of ["privateTransfer", "unshield"] as const) {
      const f = fixture();
      const data = {
        ...f.common.data,
        inputShardIds: Array(8).fill(0n),
        inputRoots: Array(8).fill(123n),
        inputNullifiers: Array.from({ length: 8 }, (_, i) => BigInt(i + 1)),
      };
      if (action === "privateTransfer") await submitPrivateTransfer({ ...f.common, data });
      else await submitUnshield({ ...f.common, data, recipient: RECIPIENT, amount: 75n });
      expect(mocks.zkWorkerCall.mock.lastCall?.[1].circuit).toBe(action);
      expect(mocks.zkWorkerCall.mock.lastCall?.[1].expectedPublicSignals).toHaveLength(
        action === "privateTransfer" ? 30 : 32,
      );
      expect(f.methods[action]).toHaveBeenCalledOnce();
    }
  });

  it("rejects the removed small VALUE input shape before proving or submission", async () => {
    for (const action of ["privateTransfer", "unshield"] as const) {
      const f = fixture();
      const pending =
        action === "privateTransfer"
          ? submitPrivateTransfer(f.common)
          : submitUnshield({ ...f.common, recipient: RECIPIENT, amount: 75n });
      await expect(pending).rejects.toThrow("inputShardIds must have 8 values");
      expect(f.methods[action]).not.toHaveBeenCalled();
    }
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });
  it("sends the native deposit amount for both estimation and submission", async () => {
    const f = fixture();
    const amount = 10n ** 17n;
    await submitShield({ ...f.common, assetKind: "native", amount });
    expect(f.estimateGas.mock.calls[0][f.estimateGas.mock.calls[0].length - 1]).toEqual({
      value: amount,
    });
    expect(f.methods.shield.mock.calls[0][f.methods.shield.mock.calls[0].length - 1]).toEqual({
      value: amount,
      chainId: 71n,
      gasLimit: 120_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 0n,
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
      { chainId: 71n, gasLimit: 120_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 0n },
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
      const data = name === "privateTransfer" ? actionData(8) : f.common.data;
      await submit({ ...f.common, data });
      expect(mocks.zkWorkerCall.mock.lastCall?.[1].circuit).toBe(name);
      expect(f.methods[name]).toHaveBeenCalledOnce();
      expect(f.methods[name].mock.calls[0][0]).toEqual(data);
    }
    const f = fixture();
    await submitUnshield({ ...f.common, data: actionData(8), recipient: RECIPIENT, amount: 75n });
    const signals = mocks.zkWorkerCall.mock.lastCall?.[1].expectedPublicSignals;
    expect(signals).toHaveLength(32);
    expect(signals[30]).toBe("75");
    expect(signals[31]).toBe(BigInt(RECIPIENT).toString());
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
