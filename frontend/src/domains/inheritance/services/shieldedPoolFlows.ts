import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { SHIELDED_POOL_ACTION, buildShieldedPoolPublicSignals } from "@deepfamily/protocol-core";
import {
  getBigInt,
  hexlify,
  getBytes,
  type BigNumberish,
  type BytesLike,
  type Contract,
  type ContractTransactionResponse,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import type { ShieldedCircuitName, ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { Groth16Proof } from "../../../shared/zk/zk";

/** All private values stay in the caller's memory and the local ZK worker. */
export type { ShieldedPoolActionData } from "../../../shared/zk/shieldedActionTypes";
import type { ShieldedPoolActionData } from "../../../shared/zk/shieldedActionTypes";

type ContractActionData = {
  fundMode: bigint;
  budgetKind: bigint;
  inputShardIds: bigint[];
  inputRoots: bigint[];
  inputNullifiers: bigint[];
  periodNullifiers: bigint[];
  outputCommitments: [bigint, bigint];
  outputCiphertexts: [string, string];
  relation0: bigint;
  relation1: bigint;
  asOf: bigint;
};

export type ShieldedPoolFlowStage = "proving" | "checkingGas" | "submitting" | "confirming";
export type ShieldedGasReview = {
  gasEstimate: bigint;
  gasLimit: bigint;
  maximumGasPrice: bigint;
  maximumGasFee: bigint;
};

export type ShieldedSubmissionAnchor = {
  nonce: number;
  fromBlock: number;
  signerAddress: string;
};

type BaseFlowInput = {
  pool: Contract;
  signer: Signer;
  expectedChainId: bigint;
  data: ShieldedPoolActionData;
  witness?: ShieldedWitness;
  /** Already verified in the asset worker; the main thread receives no private witness. */
  preparedProof?: Groth16Proof;
  onStage?: (stage: ShieldedPoolFlowStage) => void;
  onBroadcast?: (transactionHash: string) => void;
  /** Record this exact transaction slot before asking the wallet to submit it. */
  onSubmitting?: (anchor: ShieldedSubmissionAnchor) => void;
  /** Pause before requesting the wallet transaction so the user can review this step's fee. */
  onGasEstimate?: (review: ShieldedGasReview) => Promise<void> | void;
  /** Large lineage proofs can take longer than the default worker timeout. */
  proofTimeoutMs?: number;
};

export type ShieldFlowInput = BaseFlowInput & {
  amount: BigNumberish;
  assetKind: "erc20" | "native";
};
export type UnshieldFlowInput = BaseFlowInput & {
  amount: BigNumberish;
  recipient: string;
};
export type PrivatePoolFlowInput = BaseFlowInput;

export type ShieldedPoolFlowResult = {
  transactionHash: string;
  receipt: TransactionReceipt;
  gasEstimate: bigint;
  gasLimit: bigint;
};

type PoolAction = "shield" | "fund" | "claim" | "privateTransfer" | "unshield";

type PoolTransactionMethod = ((...args: unknown[]) => Promise<ContractTransactionResponse>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};

const ACTIONS: Record<PoolAction, { circuit: ShieldedCircuitName; id: number }> = {
  shield: { circuit: "shield", id: SHIELDED_POOL_ACTION.Shield },
  fund: { circuit: "fund", id: SHIELDED_POOL_ACTION.Fund },
  claim: { circuit: "claim", id: SHIELDED_POOL_ACTION.Claim },
  privateTransfer: { circuit: "privateTransfer", id: SHIELDED_POOL_ACTION.PrivateTransfer },
  unshield: { circuit: "unshield", id: SHIELDED_POOL_ACTION.Unshield },
};

function copyPair(pair: readonly [BigNumberish, BigNumberish]): [bigint, bigint] {
  if (pair.length !== 2) throw new Error("Shielded action needs exactly two note slots");
  return [getBigInt(pair[0]), getBigInt(pair[1])];
}

/** Snapshot caller-owned arrays so ciphertexts cannot change after proof generation. */
function copyActionData(data: ShieldedPoolActionData): ContractActionData {
  const capacity = data.inputNullifiers.length;
  if (
    (capacity !== 2 && capacity !== 8) ||
    data.inputShardIds.length !== capacity ||
    data.inputRoots.length !== capacity
  ) {
    throw new Error("Shielded action needs two or eight matching input slots");
  }
  if (data.periodNullifiers.length !== 12) {
    throw new Error("Shielded action needs exactly 12 period nullifier slots");
  }
  if (data.outputCiphertexts.length !== 2) {
    throw new Error("Shielded action needs exactly two output ciphertexts");
  }
  const outputCiphertexts: [string, string] = [
    hexlify(data.outputCiphertexts[0]),
    hexlify(data.outputCiphertexts[1]),
  ];
  if (outputCiphertexts.some((ciphertext) => getBytes(ciphertext).length !== 512)) {
    throw new Error("Shielded output ciphertext must be exactly 512 bytes");
  }
  return {
    fundMode: getBigInt(data.fundMode),
    budgetKind: getBigInt(data.budgetKind),
    inputShardIds: data.inputShardIds.map((value) => getBigInt(value)),
    inputRoots: data.inputRoots.map((value) => getBigInt(value)),
    inputNullifiers: data.inputNullifiers.map((value) => getBigInt(value)),
    periodNullifiers: data.periodNullifiers.map((value) => getBigInt(value)),
    outputCommitments: copyPair(data.outputCommitments),
    outputCiphertexts,
    relation0: getBigInt(data.relation0),
    relation1: getBigInt(data.relation1),
    asOf: getBigInt(data.asOf),
  };
}

async function assertSignerNetwork(signer: Signer, expectedChainId: bigint): Promise<void> {
  const actual = await signer.provider?.getNetwork();
  if (!actual || actual.chainId !== expectedChainId) {
    throw new Error("Transaction wallet is connected to the wrong network");
  }
}

function assertExpectedSignals(actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== expected.length) {
    throw new Error("Shielded proof public signal count does not match transaction");
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (BigInt(actual[index]) !== BigInt(expected[index])) {
      throw new Error(`Shielded proof public signal ${index} does not match transaction`);
    }
  }
}

/** Reserve native currency for gas and any public native deposit. */
async function assertTransactionGas(
  signer: Signer,
  signerAddress: string,
  estimate: bigint,
  value: bigint,
): Promise<{ review: ShieldedGasReview; feeOverrides: Record<string, bigint> }> {
  const provider = signer.provider;
  if (!provider) throw new Error("Transaction wallet has no provider");
  const feeData = await provider.getFeeData();
  const maximumGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maximumGasPrice === null || maximumGasPrice <= 0n) {
    throw new Error("Unable to determine the network gas price");
  }
  // Leave room for ordinary estimate variance while making the balance check conservative.
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const balance = await provider.getBalance(signerAddress);
  const required = gasLimit * maximumGasPrice + value;
  if (balance < required) {
    throw new Error(`Transaction wallet needs at least ${required} wei for the deposit and gas`);
  }
  return {
    review: {
      gasEstimate: estimate,
      gasLimit,
      maximumGasPrice,
      maximumGasFee: gasLimit * maximumGasPrice,
    },
    feeOverrides:
      feeData.maxFeePerGas !== null
        ? {
            maxFeePerGas: maximumGasPrice,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
          }
        : { gasPrice: maximumGasPrice },
  };
}

async function submitAction(
  action: PoolAction,
  input: BaseFlowInput,
  publicAmount = 0n,
  publicRecipient?: string,
  transactionValue = 0n,
): Promise<ShieldedPoolFlowResult> {
  const { pool, signer, expectedChainId, witness, onStage } = input;
  await assertSignerNetwork(signer, expectedChainId);
  const provider = signer.provider;
  if (!provider) throw new Error("Transaction wallet has no provider");
  const signerAddress = await signer.getAddress();
  if ((await provider.getBalance(signerAddress)) === 0n) {
    throw new Error("Transaction wallet has no gas balance");
  }
  const data = copyActionData(input.data);
  const poolAddress = await pool.getAddress();
  const { id } = ACTIONS[action];
  const large = data.inputNullifiers.length === 8;
  if (large && action !== "privateTransfer" && action !== "unshield") {
    throw new Error("Only VALUE transfer and unshield support eight inputs");
  }
  const circuit: ShieldedCircuitName = large
    ? action === "privateTransfer"
      ? "privateTransfer8"
      : "unshield8"
    : ACTIONS[action].circuit;
  const expectedSignals = buildShieldedPoolPublicSignals({
    action: id,
    fundMode: data.fundMode,
    budgetKind: data.budgetKind,
    chainId: expectedChainId,
    poolAddress,
    inputShardIds: data.inputShardIds,
    inputRoots: data.inputRoots,
    inputNullifiers: data.inputNullifiers,
    periodNullifiers: data.periodNullifiers,
    outputCommitments: data.outputCommitments,
    outputCiphertexts: data.outputCiphertexts,
    amount: publicAmount,
    recipient: publicRecipient,
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
  }).map(String);
  let groth16Proof = input.preparedProof;
  if (groth16Proof) {
    if (witness !== undefined)
      throw new Error("Prepared proof submission must not include a witness");
  } else {
    if (!witness) throw new Error("Shielded action needs a prepared proof or a private witness");
    onStage?.("proving");
    const generated = await zkWorkerCall(
      "generateShieldedProof",
      { circuit, witness, expectedPublicSignals: expectedSignals },
      { timeoutMs: input.proofTimeoutMs ?? 1_200_000 },
    );
    assertExpectedSignals(generated.publicSignals, expectedSignals);
    groth16Proof = generated.proof;
  }
  const proof = encodeGroth16AbcProofData(normalizeGroth16Proof(groth16Proof));
  await assertSignerNetwork(signer, expectedChainId);
  const connected = pool.connect(signer) as unknown as Record<PoolAction, PoolTransactionMethod>;
  const method = connected[action];
  if (typeof method !== "function" || typeof method.estimateGas !== "function") {
    throw new Error(`Shielded pool ABI is missing ${action}`);
  }
  const args: unknown[] =
    action === "shield"
      ? [publicAmount, data, proof]
      : action === "unshield"
        ? [publicRecipient, publicAmount, data, proof]
        : [data, proof];
  onStage?.("checkingGas");
  const valueOverrides = transactionValue > 0n ? { value: transactionValue } : {};
  const gasEstimate = await method.estimateGas(...args, valueOverrides);
  const { review: gasReview, feeOverrides } = await assertTransactionGas(
    signer,
    signerAddress,
    gasEstimate,
    transactionValue,
  );
  const { gasLimit } = gasReview;
  await input.onGasEstimate?.(gasReview);
  await assertSignerNetwork(signer, expectedChainId);
  let submission: ShieldedSubmissionAnchor | undefined;
  if (input.onSubmitting) {
    const [nonce, fromBlock] = await Promise.all([
      provider.getTransactionCount(signerAddress, "pending"),
      provider.getBlockNumber(),
    ]);
    if (
      !Number.isSafeInteger(nonce) ||
      nonce < 0 ||
      !Number.isSafeInteger(fromBlock) ||
      fromBlock < 0
    )
      throw new Error("Transaction submission anchor is invalid");
    submission = { nonce, fromBlock, signerAddress };
  }
  // This synchronous boundary lets the caller recheck lock/context state after
  // every preparatory RPC read, before recording an unknown broadcast attempt.
  onStage?.("submitting");
  if (submission) input.onSubmitting?.(submission);
  const tx = await method(...args, {
    ...valueOverrides,
    chainId: expectedChainId,
    gasLimit,
    ...feeOverrides,
    ...(submission ? { nonce: submission.nonce } : {}),
  });
  input.onBroadcast?.(tx.hash);
  onStage?.("confirming");
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Shielded pool transaction has no receipt");
  return { transactionHash: tx.hash, receipt, gasEstimate, gasLimit };
}

/** ERC-20 deposits require allowance; native deposits send the proven amount as value. */
export function submitShield(input: ShieldFlowInput): Promise<ShieldedPoolFlowResult> {
  const amount = getBigInt(input.amount);
  if (amount <= 0n) throw new Error("Shield amount must be positive");
  return submitAction(
    "shield",
    input,
    amount,
    undefined,
    input.assetKind === "native" ? amount : 0n,
  );
}

export function submitFund(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("fund", input);
}

export function submitClaim(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("claim", input);
}

export function submitPrivateTransfer(
  input: PrivatePoolFlowInput,
): Promise<ShieldedPoolFlowResult> {
  return submitAction("privateTransfer", input);
}

export function submitUnshield(input: UnshieldFlowInput): Promise<ShieldedPoolFlowResult> {
  const amount = getBigInt(input.amount);
  if (amount <= 0n) throw new Error("Unshield amount must be positive");
  return submitAction("unshield", input, amount, input.recipient);
}
