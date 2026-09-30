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

/** All private values stay in the caller's memory and the local ZK worker. */
export type ShieldedPoolActionData = {
  inputShardIds: readonly [BigNumberish, BigNumberish];
  inputRoots: readonly [BigNumberish, BigNumberish];
  inputNullifiers: readonly [BigNumberish, BigNumberish];
  periodNullifiers: ReadonlyArray<BigNumberish>;
  outputCommitments: readonly [BigNumberish, BigNumberish];
  outputCiphertexts: readonly [BytesLike, BytesLike];
  relation0: BigNumberish;
  relation1: BigNumberish;
  asOf: BigNumberish;
};

type ContractActionData = {
  inputShardIds: [bigint, bigint];
  inputRoots: [bigint, bigint];
  inputNullifiers: [bigint, bigint];
  periodNullifiers: bigint[];
  outputCommitments: [bigint, bigint];
  outputCiphertexts: [string, string];
  relation0: bigint;
  relation1: bigint;
  asOf: bigint;
};

export type ShieldedPoolFlowStage = "proving" | "checkingGas" | "submitting" | "confirming";

type BaseFlowInput = {
  pool: Contract;
  signer: Signer;
  expectedChainId: bigint;
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  onStage?: (stage: ShieldedPoolFlowStage) => void;
  /** Large lineage proofs can take longer than the default worker timeout. */
  proofTimeoutMs?: number;
};

export type ShieldFlowInput = BaseFlowInput & { amount: BigNumberish };
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

type PoolAction =
  | "shield"
  | "createPolicy"
  | "allocate"
  | "topUp"
  | "mergeBudget"
  | "claim"
  | "privateTransfer"
  | "unshield";

type PoolTransactionMethod = ((...args: unknown[]) => Promise<ContractTransactionResponse>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};

const ACTIONS: Record<PoolAction, { circuit: ShieldedCircuitName; id: number }> = {
  shield: { circuit: "shield", id: SHIELDED_POOL_ACTION.Shield },
  createPolicy: { circuit: "createPolicy", id: SHIELDED_POOL_ACTION.CreatePolicy },
  allocate: { circuit: "allocate", id: SHIELDED_POOL_ACTION.Allocate },
  topUp: { circuit: "topUp", id: SHIELDED_POOL_ACTION.TopUp },
  mergeBudget: { circuit: "mergeBudget", id: SHIELDED_POOL_ACTION.MergeBudget },
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
    inputShardIds: copyPair(data.inputShardIds),
    inputRoots: copyPair(data.inputRoots),
    inputNullifiers: copyPair(data.inputNullifiers),
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
    throw new Error("CFX transaction wallet is connected to the wrong network");
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

/** The user pays eSpace gas directly, so the submitting wallet needs CFX. */
async function assertTransactionGas(
  signer: Signer,
  signerAddress: string,
  estimate: bigint,
): Promise<bigint> {
  const provider = signer.provider;
  if (!provider) throw new Error("CFX transaction wallet has no provider");
  const feeData = await provider.getFeeData();
  const maximumGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maximumGasPrice === null || maximumGasPrice <= 0n) {
    throw new Error("Unable to determine the eSpace gas price");
  }
  // Leave room for ordinary estimate variance while making the balance check conservative.
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const balance = await provider.getBalance(signerAddress);
  const required = gasLimit * maximumGasPrice;
  if (balance < required) {
    throw new Error(`CFX transaction wallet needs at least ${required} wei for gas`);
  }
  return gasLimit;
}

async function submitAction(
  action: PoolAction,
  input: BaseFlowInput,
  publicAmount = 0n,
  publicRecipient?: string,
): Promise<ShieldedPoolFlowResult> {
  const { pool, signer, expectedChainId, witness, onStage } = input;
  await assertSignerNetwork(signer, expectedChainId);
  const provider = signer.provider;
  if (!provider) throw new Error("CFX transaction wallet has no provider");
  const signerAddress = await signer.getAddress();
  if ((await provider.getBalance(signerAddress)) === 0n) {
    throw new Error("CFX transaction wallet has no gas balance");
  }
  const data = copyActionData(input.data);
  const poolAddress = await pool.getAddress();
  const { circuit, id } = ACTIONS[action];
  const expectedSignals = buildShieldedPoolPublicSignals({
    action: id,
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
  onStage?.("proving");
  const generated = await zkWorkerCall(
    "generateShieldedProof",
    { circuit, witness, expectedPublicSignals: expectedSignals },
    { timeoutMs: input.proofTimeoutMs ?? 1_200_000 },
  );
  // The worker verifies the proof locally. Repeat this check at the transaction boundary.
  assertExpectedSignals(generated.publicSignals, expectedSignals);
  const proof = encodeGroth16AbcProofData(normalizeGroth16Proof(generated.proof));
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
  const gasEstimate = await method.estimateGas(...args);
  const gasLimit = await assertTransactionGas(signer, signerAddress, gasEstimate);
  await assertSignerNetwork(signer, expectedChainId);
  onStage?.("submitting");
  const tx = await method(...args, { gasLimit });
  onStage?.("confirming");
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Shielded pool transaction has no receipt");
  return { transactionHash: tx.hash, receipt, gasEstimate, gasLimit };
}

/** DEEP allowance for this public deposit must be approved by the same wallet first. */
export function submitShield(input: ShieldFlowInput): Promise<ShieldedPoolFlowResult> {
  const amount = getBigInt(input.amount);
  if (amount <= 0n) throw new Error("Shield amount must be positive");
  return submitAction("shield", input, amount);
}

export function submitCreatePolicy(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("createPolicy", input);
}

export function submitAllocate(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("allocate", input);
}

export function submitTopUp(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("topUp", input);
}

export function submitMergeBudget(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction("mergeBudget", input);
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
