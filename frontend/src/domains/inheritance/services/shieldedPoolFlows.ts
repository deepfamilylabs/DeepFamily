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
  type Provider,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import type { Groth16Proof } from "../../../shared/zk/zk";
import { createLineageIndexContract } from "../../../shared/clients/contractFactory";
import { waitForShieldedTransaction } from "./shieldedTransactionReceipt";
import { assertShieldedDepositBalance } from "./shieldedDepositBalance";

/** Submissions contain only public action data and a proof produced by the asset Worker. */
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
  lineageCheckpointId: bigint;
  receiveAuthorizations: { checkpointId: bigint; asOf: bigint; expiresAt: bigint; recipientBinding: bigint; proof: string }[];
};

export type ShieldedPoolFlowStage = "checkingGas" | "submitting" | "confirming";
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
  /** Already verified in the asset worker; the main thread receives no private witness. */
  preparedProof: Groth16Proof;
  onStage?: (stage: ShieldedPoolFlowStage) => void;
  onBroadcast?: (transactionHash: string) => void;
  /** Record this exact transaction slot before asking the wallet to submit it. */
  onSubmitting?: (anchor: ShieldedSubmissionAnchor) => void;
  /** Keep the unlocked session through a wallet handoff, then release it before receipt tracking. */
  onWalletRequest?: () => () => void;
  /** Pause before requesting the wallet transaction so the user can review this step's fee. */
  onGasEstimate?: (review: ShieldedGasReview) => Promise<void> | void;
};

export type ShieldFlowInput = BaseFlowInput & {
  amount: BigNumberish;
} & ({ assetKind: "erc20"; token: Contract } | { assetKind: "native" });
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
type PoolSubmission =
  | { action: "shield"; input: ShieldFlowInput }
  | { action: Exclude<PoolAction, "shield">; input: BaseFlowInput };

type PoolTransactionMethod = ((...args: unknown[]) => Promise<ContractTransactionResponse>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};

const ACTIONS: Record<PoolAction, number> = {
  shield: SHIELDED_POOL_ACTION.Shield,
  fund: SHIELDED_POOL_ACTION.Fund,
  claim: SHIELDED_POOL_ACTION.Claim,
  privateTransfer: SHIELDED_POOL_ACTION.PrivateTransfer,
  unshield: SHIELDED_POOL_ACTION.Unshield,
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
  const authorizations = data.receiveAuthorizations ?? Array.from({ length: 2 }, () => ({ checkpointId: 0n, asOf: 0n, expiresAt: 0n, recipientBinding: 0n, proof: "0x" }));
  if (authorizations.length !== 2) throw new Error("Shielded action needs two receive authorization slots");
  return {
    receiveAuthorizations: authorizations.map((item) => ({ checkpointId: getBigInt(item.checkpointId), asOf: getBigInt(item.asOf), expiresAt: getBigInt(item.expiresAt), recipientBinding: getBigInt(item.recipientBinding), proof: hexlify(item.proof) })),
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
    lineageCheckpointId: getBigInt(data.lineageCheckpointId),
  };
}

async function assertSignerNetwork(signer: Signer, expectedChainId: bigint): Promise<void> {
  const actual = await signer.provider?.getNetwork();
  if (!actual || actual.chainId !== expectedChainId) {
    throw new Error("Transaction wallet is connected to the wrong network");
  }
}

/** Recheck public proof bindings after every fee-review and nonce wait. */
async function assertTimeBoundActionCurrent(
  pool: Contract,
  provider: Provider,
  data: ContractActionData,
): Promise<void> {
  const blockNumber = await provider.getBlockNumber();
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
    throw new Error("Shielded submission block is invalid");
  const overrides = { blockTag: blockNumber };
  const [anchor, lineageAddress, rawLifetime] = await Promise.all([
    provider.getBlock(blockNumber),
    pool.LINEAGE_INDEX(overrides) as Promise<string>,
    pool.ACTION_PROOF_LIFETIME(overrides) as Promise<bigint>,
  ]);
  if (!anchor?.hash) throw new Error("Shielded submission block is unavailable");
  const lifetime = getBigInt(rawLifetime);
  if (
    lifetime <= 0n ||
    data.asOf > BigInt(anchor.timestamp) ||
    BigInt(anchor.timestamp) - data.asOf >= lifetime
  )
    throw new Error("The proof expired before submission. Prepare and confirm a fresh preview.");
  const lineage = createLineageIndexContract(lineageAddress, provider);
  const known = await lineage.isKnownCheckpoint(
    data.lineageCheckpointId,
    data.relation0,
    data.relation1,
    data.asOf,
    overrides,
  );
  const finalAnchor = await provider.getBlock(blockNumber);
  if (finalAnchor?.hash !== anchor.hash)
    throw new Error("The submission block was reorganized. Prepare and confirm a fresh preview.");
  if (data.lineageCheckpointId <= 0n || !known)
    throw new Error(
      "Family eligibility snapshot expired before submission. Prepare and confirm a fresh preview.",
    );
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
  submissionRequest: PoolSubmission,
  publicAmount = 0n,
  publicRecipient?: string,
  transactionValue = 0n,
): Promise<ShieldedPoolFlowResult> {
  const { action, input } = submissionRequest;
  const { pool, signer, expectedChainId, preparedProof, onStage } = input;
  if ("witness" in input || !preparedProof)
    throw new Error("Shielded submission requires an asset-worker proof and accepts no witness");
  await assertSignerNetwork(signer, expectedChainId);
  const provider = signer.provider;
  if (!provider) throw new Error("Transaction wallet has no provider");
  const signerAddress = await signer.getAddress();
  if ((await provider.getBalance(signerAddress)) === 0n) {
    throw new Error("Transaction wallet has no gas balance");
  }
  const data = copyActionData(input.data);
  const poolAddress = await pool.getAddress();
  // Enforce the current action's public shape before estimation or wallet handoff.
  buildShieldedPoolPublicSignals({
    action: ACTIONS[action],
    receiveAuthorizations: data.receiveAuthorizations,
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
  });
  const proof = encodeGroth16AbcProofData(normalizeGroth16Proof(preparedProof));
  if (submissionRequest.action === "shield" && submissionRequest.input.assetKind === "erc20") {
    await assertShieldedDepositBalance(submissionRequest.input.token, signerAddress, publicAmount);
  }
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
  if (action === "claim" || (action === "fund" && data.fundMode === 0n)) {
    await assertTimeBoundActionCurrent(pool, provider, data);
  }
  const activeReceipts = data.receiveAuthorizations.filter((item) => item.recipientBinding !== 0n);
  if (activeReceipts.length) {
    const block = await provider.getBlock("latest");
    if (!block || activeReceipts.some((item) => BigInt(block.timestamp) >= item.expiresAt)) throw new Error("The receive code expired before submission");
  }
  // This synchronous boundary lets the caller recheck lock/context state after
  // every preparatory RPC read, before recording an unknown broadcast attempt.
  onStage?.("submitting");
  const endWalletRequest = input.onWalletRequest?.();
  let tx: ContractTransactionResponse;
  try {
    if (submission) input.onSubmitting?.(submission);
    tx = await method(...args, {
      ...valueOverrides,
      chainId: expectedChainId,
      gasLimit,
      ...feeOverrides,
      ...(submission ? { nonce: submission.nonce } : {}),
    });
  } finally {
    endWalletRequest?.();
  }
  input.onBroadcast?.(tx.hash);
  onStage?.("confirming");
  const { transactionHash, receipt } = await waitForShieldedTransaction(tx, input.onBroadcast);
  return { transactionHash, receipt, gasEstimate, gasLimit };
}

/** ERC-20 deposits need both public funds and allowance; native deposits send the proven amount. */
export function submitShield(input: ShieldFlowInput): Promise<ShieldedPoolFlowResult> {
  const amount = getBigInt(input.amount);
  if (amount <= 0n) throw new Error("Shield amount must be positive");
  return submitAction(
    { action: "shield", input },
    amount,
    undefined,
    input.assetKind === "native" ? amount : 0n,
  );
}

export function submitFund(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction({ action: "fund", input });
}

export function submitClaim(input: PrivatePoolFlowInput): Promise<ShieldedPoolFlowResult> {
  return submitAction({ action: "claim", input });
}

export function submitPrivateTransfer(
  input: PrivatePoolFlowInput,
): Promise<ShieldedPoolFlowResult> {
  return submitAction({ action: "privateTransfer", input });
}

export function submitUnshield(input: UnshieldFlowInput): Promise<ShieldedPoolFlowResult> {
  const amount = getBigInt(input.amount);
  if (amount <= 0n) throw new Error("Unshield amount must be positive");
  return submitAction({ action: "unshield", input }, amount, input.recipient);
}
