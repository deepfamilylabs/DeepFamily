import { describe, expect, it, vi } from "vitest";
import type { Contract, Signer } from "ethers";
import type { Groth16Proof } from "../../../shared/zk/zk";
import {
  assertShieldedDepositBalance,
  ShieldedDepositBalanceError,
} from "./shieldedDepositBalance";
import {
  submitFund,
  submitClaim,
  submitPrivateTransfer,
  submitShield,
  submitUnshield,
  type ShieldedPoolActionData,
  type ShieldedSubmissionAnchor,
} from "./shieldedPoolFlows";

const POOL_ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const LINEAGE_ADDRESS = "0x4444444444444444444444444444444444444444";
const BLOCK_HASH = `0x${"aa".repeat(32)}`;
const mocks = vi.hoisted(() => ({ lineageContract: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", () => ({
  createLineageIndexContract: mocks.lineageContract,
}));
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
    lineageCheckpointId: 7n,
  };
}

function fixture() {
  let chainId = 71n;
  let gasBalance = 10n ** 18n;
  const receipt = { status: 1 };
  const lineageRoot = vi.fn(async (_kind: number, _overrides: { blockTag: number }) => 0n);
  const knownCheckpoint = vi.fn(async (..._args: unknown[]) => true);
  const lineageIndex = vi.fn(async (_overrides: { blockTag: number }) => LINEAGE_ADDRESS);
  const proofLifetime = vi.fn(async (_overrides: { blockTag: number }) => 300n);
  mocks.lineageContract.mockReturnValue({ root: lineageRoot, isKnownCheckpoint: knownCheckpoint });
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
    getBlock: vi.fn(async (_blockNumber: number) => ({ hash: BLOCK_HASH, timestamp: 0 })),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 1_000_000_000n, gasPrice: null })),
  };
  const signer = {
    provider,
    getAddress: vi.fn(async () => WALLET_ADDRESS),
  } as unknown as Signer;
  const pool = {
    getAddress: vi.fn(async () => POOL_ADDRESS),
    connect: vi.fn(() => methods),
    LINEAGE_INDEX: lineageIndex,
    ACTION_PROOF_LIFETIME: proofLifetime,
  } as unknown as Contract;
  const tokenBalance = vi.fn(async (_account: string) => 1_000_000n * 10n ** 18n);
  const token = { balanceOf: tokenBalance } as unknown as Contract;
  const common = {
    assetKind: "erc20" as const,
    token,
    pool,
    signer,
    expectedChainId: 71n,
    data: actionData(),
    preparedProof: { ...PROOF, protocol: "groth16", curve: "bn128" } as Groth16Proof,
  };
  return {
    common,
    methods,
    estimateGas,
    provider,
    lineageRoot,
    knownCheckpoint,
    lineageIndex,
    proofLifetime,
    tokenBalance,
    setChainId: (value: bigint) => {
      chainId = value;
    },
    setBalance: (value: bigint) => {
      gasBalance = value;
    },
  };
}

describe("shielded pool asset-worker proof submission", () => {
  describe.each([
    ["fund", submitFund],
    ["claim", submitClaim],
  ] as const)("final public bindings for %s", (action, submit) => {
    it.each(["fee review", "nonce lookup"] as const)("rejects a %s wait with an expired checkpoint before starting a wallet request", async (wait) => {
      const f = fixture();
      const onWalletRequest = vi.fn(() => vi.fn());
      const onSubmitting = vi.fn();
      const onStage = vi.fn();
      let release!: () => void;
      const hold = () => new Promise<void>((resolve) => { release = resolve; });
      const onGasEstimate = wait === "fee review" ? vi.fn(hold) : vi.fn();
      if (wait === "nonce lookup") {
        f.provider.getTransactionCount.mockImplementationOnce(async () => {
          await hold();
          return 9;
        });
      }
      const pending = submit({ ...f.common, onGasEstimate, onStage, onSubmitting, onWalletRequest });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      expect(f.lineageRoot).not.toHaveBeenCalled();
      f.knownCheckpoint.mockResolvedValue(false);
      const rejection = expect(pending).rejects.toThrow("Family eligibility snapshot expired before submission");
      release();
      await rejection;
      expect(f.methods[action]).not.toHaveBeenCalled();
      expect(onStage).not.toHaveBeenCalledWith("submitting");
      expect(onWalletRequest).not.toHaveBeenCalled();
      expect(onSubmitting).not.toHaveBeenCalled();
    });

    it.each([
      ["expired", 300, 0n],
      ["future", 0, 1n],
    ] as const)("rejects a %s proof after fee review without recording an unknown broadcast", async (_reason, timestamp, asOf) => {
      const f = fixture();
      const onSubmitting = vi.fn();
      const onWalletRequest = vi.fn(() => vi.fn());
      const onStage = vi.fn();
      const onGasEstimate = vi.fn(async () => {
        f.provider.getBlock.mockResolvedValue({ hash: BLOCK_HASH, timestamp });
      });
      await expect(submit({
        ...f.common, data: { ...f.common.data, asOf },
        onGasEstimate, onSubmitting, onWalletRequest, onStage,
      }))
        .rejects.toThrow("proof expired before submission");
      expect(f.methods[action]).not.toHaveBeenCalled();
      expect(onStage).not.toHaveBeenCalledWith("submitting");
      expect(onWalletRequest).not.toHaveBeenCalled();
      expect(onSubmitting).not.toHaveBeenCalled();
    });

    it("checks the snapshot checkpoint and lifetime at one anchored block after nonce lookup", async () => {
      const f = fixture();
      f.provider.getBlockNumber.mockResolvedValueOnce(77).mockResolvedValueOnce(78);
      const onSubmitting = vi.fn();
      await submit({ ...f.common, onSubmitting });
      expect(f.lineageIndex).toHaveBeenCalledExactlyOnceWith({ blockTag: 78 });
      expect(f.proofLifetime).toHaveBeenCalledExactlyOnceWith({ blockTag: 78 });
      expect(mocks.lineageContract).toHaveBeenLastCalledWith(LINEAGE_ADDRESS, f.provider);
      expect(f.knownCheckpoint).toHaveBeenCalledExactlyOnceWith(7n, 0n, 0n, 0n, { blockTag: 78 });
      expect(f.lineageRoot).not.toHaveBeenCalled();
      expect(f.provider.getBlock.mock.calls).toEqual([[78], [78]]);
      expect(onSubmitting).toHaveBeenCalledExactlyOnceWith({
        nonce: 9, fromBlock: 77, signerAddress: WALLET_ADDRESS,
      });
      expect(f.methods[action]).toHaveBeenCalledOnce();
    });

    it("submits the original proof after unrelated roots change while its checkpoint remains valid", async () => {
      const f = fixture();
      const data = { ...f.common.data, relation0: 700n, relation1: 800n };
      await submit({ ...f.common, data, onGasEstimate: async () => { f.lineageRoot.mockResolvedValue(999n); } });
      expect(f.knownCheckpoint).toHaveBeenCalledWith(7n, 700n, 800n, 0n, { blockTag: 77 });
      expect(f.lineageRoot).not.toHaveBeenCalled();
      expect(f.methods[action].mock.calls[0][0]).toMatchObject({ lineageCheckpointId: 7n, relation0: 700n, relation1: 800n });
    });

    it("rejects a reorganized final anchor before any submission bookkeeping", async () => {
      const f = fixture();
      f.provider.getBlock
        .mockResolvedValueOnce({ hash: BLOCK_HASH, timestamp: 0 })
        .mockResolvedValueOnce({ hash: `0x${"bb".repeat(32)}`, timestamp: 0 });
      const onSubmitting = vi.fn();
      const onWalletRequest = vi.fn(() => vi.fn());
      await expect(submit({ ...f.common, onSubmitting, onWalletRequest }))
        .rejects.toThrow("submission block was reorganized");
      expect(f.methods[action]).not.toHaveBeenCalled();
      expect(onWalletRequest).not.toHaveBeenCalled();
      expect(onSubmitting).not.toHaveBeenCalled();
    });

    it("rechecks the caller after the final checkpoint RPC before marking submission", async () => {
      const f = fixture();
      let locked = false;
      f.knownCheckpoint.mockImplementation(async () => { locked = true; return true; });
      const onSubmitting = vi.fn();
      const onWalletRequest = vi.fn(() => vi.fn());
      const onStage = vi.fn((stage) => {
        if (stage === "submitting" && locked) throw new Error("Locked during final roots check");
      });
      await expect(submit({ ...f.common, onStage, onSubmitting, onWalletRequest }))
        .rejects.toThrow("Locked during final roots check");
      expect(f.methods[action]).not.toHaveBeenCalled();
      expect(onWalletRequest).not.toHaveBeenCalled();
      expect(onSubmitting).not.toHaveBeenCalled();
    });
  });

  it("does not query lineage or time for VALUE actions or budget refills", async () => {
    const f = fixture();
    await submitShield({ ...f.common, amount: 10n });
    await submitPrivateTransfer({ ...f.common, data: actionData(4) });
    await submitUnshield({ ...f.common, data: actionData(4), amount: 10n, recipient: RECIPIENT });
    await submitFund({ ...f.common, data: { ...f.common.data, fundMode: 1n } });
    expect(f.lineageIndex).not.toHaveBeenCalled();
    expect(f.proofLifetime).not.toHaveBeenCalled();
    expect(f.lineageRoot).not.toHaveBeenCalled();
    expect(f.provider.getBlock).not.toHaveBeenCalled();
    expect(f.provider.getBlockNumber).not.toHaveBeenCalled();
  });

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
    const pending = submitPrivateTransfer({ ...f.common, data: actionData(4), onGasEstimate });
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
      data: actionData(4),
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
      data: actionData(4),
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
    await submitPrivateTransfer({ ...f.common, data: actionData(4) });
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
      submitPrivateTransfer({ ...f.common, data: actionData(4), onSubmitting, onBroadcast }),
    ).rejects.toThrow("disconnected");
    expect(onSubmitting).toHaveBeenCalledOnce();
    expect(onSubmitting).toHaveBeenCalledWith({
      nonce: 9,
      fromBlock: 77,
      signerAddress: WALLET_ADDRESS,
    });
    expect(onBroadcast).not.toHaveBeenCalled();
  });

  it("submits only an asset-worker proof and reports broadcast immediately", async () => {
    const f = fixture();
    const onBroadcast = vi.fn();
    await submitPrivateTransfer({ ...f.common, data: actionData(4), onBroadcast });
    expect(onBroadcast).toHaveBeenCalledWith("0xprivateTransfer");
    const witnessInput = { ...f.common, data: actionData(4), witness: { secret: "private" } };
    await expect(submitPrivateTransfer(witnessInput)).rejects.toThrow("accepts no witness");
    await expect(submitPrivateTransfer({ ...f.common, data: actionData(4), preparedProof: undefined! }))
      .rejects.toThrow("requires an asset-worker proof");
    expect(f.methods.privateTransfer).toHaveBeenCalledOnce();
  });

  it("routes canonical four-input actions to their contract methods", async () => {
    for (const action of ["privateTransfer", "unshield"] as const) {
      const f = fixture();
      const data = {
        ...f.common.data,
        inputShardIds: Array(4).fill(0n),
        inputRoots: Array(4).fill(123n),
        inputNullifiers: Array.from({ length: 4 }, (_, i) => BigInt(i + 1)),
      };
      if (action === "privateTransfer") await submitPrivateTransfer({ ...f.common, data });
      else await submitUnshield({ ...f.common, data, recipient: RECIPIENT, amount: 75n });
      expect(f.methods[action]).toHaveBeenCalledOnce();
    }
  });

  it("rejects invalid VALUE input capacity before estimation or submission", async () => {
    for (const action of ["privateTransfer", "unshield"] as const) {
      const f = fixture();
      const pending =
        action === "privateTransfer"
          ? submitPrivateTransfer(f.common)
          : submitUnshield({ ...f.common, recipient: RECIPIENT, amount: 75n });
      await expect(pending).rejects.toThrow("inputShardIds must have 4 values");
      expect(f.methods[action]).not.toHaveBeenCalled();
      expect(f.estimateGas).not.toHaveBeenCalled();
    }
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
  it("checks gas and signs the exact public shield call with its prepared proof", async () => {
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
    expect(stages).toEqual(["checkingGas", "submitting", "confirming"]);
    expect(f.methods.shield).toHaveBeenCalledWith(
      100n,
      expect.objectContaining({ outputCommitments: [123n, 456n] }),
      expect.stringMatching(/^0x[0-9a-f]{512}$/),
      { chainId: 71n, gasLimit: 120_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 0n },
    );
    expect(f.common.pool.connect).toHaveBeenCalledWith(f.common.signer);
    expect(f.provider.getBalance).toHaveBeenCalledWith(WALLET_ADDRESS);
  });

  it("routes each private action and public withdrawal to the matching method", async () => {
    const cases = [
      ["fund", submitFund],
      ["claim", submitClaim],
      ["privateTransfer", submitPrivateTransfer],
    ] as const;
    for (const [name, submit] of cases) {
      const f = fixture();
      const data = name === "privateTransfer" ? actionData(4) : f.common.data;
      await submit({ ...f.common, data });
      expect(f.methods[name]).toHaveBeenCalledOnce();
      expect(f.methods[name].mock.calls[0][0]).toEqual({ ...data, receiveAuthorizations: Array.from({ length: 2 }, () => ({ checkpointId: 0n, asOf: 0n, expiresAt: 0n, recipientBinding: 0n, proof: "0x" })) });
    }
    const f = fixture();
    await submitUnshield({ ...f.common, data: actionData(4), recipient: RECIPIENT, amount: 75n });
    expect(f.methods.unshield.mock.calls[0][0]).toBe(RECIPIENT);
    expect(f.methods.unshield.mock.calls[0][1]).toBe(75n);
  });

  it("rejects a malformed prepared proof before estimating or sending", async () => {
    const f = fixture();
    const preparedProof = { ...f.common.preparedProof, pi_a: [] } as unknown as Groth16Proof;
    await expect(submitShield({ ...f.common, preparedProof, amount: 100n })).rejects.toThrow();
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("rejects the wrong chain before estimation or submission", async () => {
    const f = fixture();
    f.setChainId(1n);
    await expect(submitClaim(f.common)).rejects.toThrow("wrong network");
    expect(f.estimateGas).not.toHaveBeenCalled();
  });

  it("refuses to send when the gas wallet cannot pay the estimated CFX fee", async () => {
    const f = fixture();
    f.setBalance(1n);
    await expect(submitClaim(f.common)).rejects.toThrow("Transaction wallet needs at least");
    expect(f.methods.claim).not.toHaveBeenCalled();
  });

  it("rejects malformed ciphertexts before estimation or submission", async () => {
    const f = fixture();
    const data = { ...f.common.data, outputCiphertexts: ["0xab", CIPHERTEXT] as const };
    await expect(submitClaim({ ...f.common, data })).rejects.toThrow("exactly 512 bytes");
    expect(f.estimateGas).not.toHaveBeenCalled();
  });
});

describe("public-wallet funds required by ERC-20 shield deposits", () => {
  const amount = 10_000n * 10n ** 18n;

  it.each([0n, amount - 1n])("rejects balance %s before estimation, fee review, or a wallet request", async (balance) => {
    const f = fixture();
    f.tokenBalance.mockResolvedValue(balance);
    const onGasEstimate = vi.fn();
    const onSubmitting = vi.fn();
    const onWalletRequest = vi.fn(() => vi.fn());
    const onStage = vi.fn();

    await expect(submitShield({
      ...f.common, amount, onGasEstimate, onSubmitting, onWalletRequest, onStage,
    })).rejects.toMatchObject({
      name: "ShieldedDepositBalanceError", balance, amount,
    });

    expect(f.tokenBalance).toHaveBeenCalledExactlyOnceWith(WALLET_ADDRESS);
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
    expect(onGasEstimate).not.toHaveBeenCalled();
    expect(onSubmitting).not.toHaveBeenCalled();
    expect(onWalletRequest).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalledWith("submitting");
  });

  it.each([amount, amount + 1n])("allows a deposit with sufficient public balance %s", async (balance) => {
    const f = fixture();
    f.tokenBalance.mockResolvedValue(balance);

    await submitShield({ ...f.common, amount });

    expect(f.tokenBalance).toHaveBeenCalledExactlyOnceWith(WALLET_ADDRESS);
    expect(f.estimateGas).toHaveBeenCalledOnce();
    expect(f.methods.shield).toHaveBeenCalledOnce();
  });

  it("does not use a token balance for a native deposit", async () => {
    const f = fixture();
    f.tokenBalance.mockRejectedValue(new Error("ERC-20 balance must not be requested"));

    await submitShield({ ...f.common, assetKind: "native", amount: 100n });

    expect(f.tokenBalance).not.toHaveBeenCalled();
    expect(f.methods.shield).toHaveBeenCalledOnce();
  });

  it("preserves a failed balance read instead of estimating or sending", async () => {
    const f = fixture();
    const failure = new Error("Token balance unavailable");
    f.tokenBalance.mockRejectedValue(failure);

    await expect(submitShield({ ...f.common, amount })).rejects.toBe(failure);

    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it("rechecks the network after an asynchronous token balance read", async () => {
    const f = fixture();
    f.tokenBalance.mockImplementation(async () => {
      f.setChainId(72n);
      return amount;
    });

    await expect(submitShield({ ...f.common, amount })).rejects.toThrow("wrong network");

    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
  });

  it.each(["session locked", "wallet changed"])("rechecks caller state after a late token balance read: %s", async (reason) => {
    const f = fixture();
    let release!: (balance: bigint) => void;
    f.tokenBalance.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    let invalidated = false;
    const onSubmitting = vi.fn();
    const onWalletRequest = vi.fn(() => vi.fn());
    const pending = submitShield({
      ...f.common, amount, onSubmitting, onWalletRequest,
      onStage: (stage) => {
        if (stage === "checkingGas" && invalidated) throw new Error(reason);
      },
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    invalidated = true;
    const rejection = expect(pending).rejects.toThrow(reason);
    release(amount);
    await rejection;

    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.methods.shield).not.toHaveBeenCalled();
    expect(onSubmitting).not.toHaveBeenCalled();
    expect(onWalletRequest).not.toHaveBeenCalled();
  });

  it("normalizes BigNumberish values and exposes exact raw units to the caller", async () => {
    const balanceOf = vi.fn(async (_account: string) => "9999");
    const token = { balanceOf } as unknown as Contract;
    const pending = assertShieldedDepositBalance(token, WALLET_ADDRESS, "10000");

    await expect(pending).rejects.toBeInstanceOf(ShieldedDepositBalanceError);
    await expect(pending).rejects.toMatchObject({ balance: 9999n, amount: 10000n });
    expect(balanceOf).toHaveBeenCalledExactlyOnceWith(WALLET_ADDRESS);
  });
});
