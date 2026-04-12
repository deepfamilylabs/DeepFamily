import { ethers } from "ethers";
import type { ProofEnvelope } from "../../../shared/zk/zk";
import { wrapIdentityCommitmentAsPersonHash } from "../../../shared/zk/zk";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import {
  estimateGasWithFallback,
  parseReceiptEvents,
  waitForTransactionReceipt,
} from "../api/txGateway";

export type AddVersionPublicSignals = {
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  submitter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export type AddVersionResult = {
  hash: string;
  index: number;
  rewardAmount: number;
  transactionHash: string;
  blockNumber: number;
  events: {
    PersonHashZKVerified: {
      personHash: string;
      prover: string;
    } | null;
    PersonVersionAdded: {
      personHash: string;
      versionIndex: number;
      addedBy: string;
      timestamp: number;
      fatherHash: string;
      fatherVersionIndex: number;
      motherHash: string;
      motherVersionIndex: number;
      tag: string;
    } | null;
    TokenRewardDistributed: {
      miner: string;
      personHash: string;
      versionIndex: number;
      reward: string;
    } | null;
  };
};

export type ExecuteAddVersionFlowParams = {
  submitContract: any;
  preflightContract: any;
  contractAddress?: string | null;
  submitterAddress?: string | null;
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  tag: string;
  metadataCID: string;
  fallbackGas?: bigint;
  isDev?: boolean;
  onTransactionSubmitted?: (txHash: string) => void;
};

const makeValidationError = (reason: string) => {
  const error = new Error(reason);
  (error as any).reason = reason;
  return error;
};

const readTotalVersions = async (
  preflightContract: any,
  personHash: string,
): Promise<number | null> => {
  const listPersonVersionsFn = preflightContract?.listPersonVersions;
  if (typeof listPersonVersionsFn !== "function") return null;
  const out = await listPersonVersionsFn(personHash, 0, 0);
  return Number(out?.totalVersions ?? out?.[1] ?? 0);
};

export async function executeAddVersionFlow({
  submitContract,
  preflightContract,
  contractAddress,
  submitterAddress,
  proof,
  publicSignals,
  fatherVersionIndex,
  motherVersionIndex,
  tag,
  metadataCID,
  fallbackGas = 6_500_000n,
  isDev = false,
  onTransactionSubmitted,
}: ExecuteAddVersionFlowParams): Promise<AddVersionResult> {
  const addPersonArgs = [
    proof,
    publicSignals,
    fatherVersionIndex,
    motherVersionIndex,
    tag,
    metadataCID,
  ] as const;

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const expectedPersonHash = wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
  const expectedFatherHash =
    publicSignals.fatherIdentityCommitment === 0n
      ? ethers.ZeroHash
      : wrapIdentityCommitmentAsPersonHash(publicSignals.fatherIdentityCommitment);
  const expectedMotherHash =
    publicSignals.motherIdentityCommitment === 0n
      ? ethers.ZeroHash
      : wrapIdentityCommitmentAsPersonHash(publicSignals.motherIdentityCommitment);
  const expectedSubmitter = submitterAddress ? BigInt(submitterAddress) : null;

  if (expectedSubmitter !== null && publicSignals.submitter !== expectedSubmitter) {
    throw makeValidationError("CallerMismatch");
  }

  if (
    expectedFatherHash === expectedPersonHash ||
    expectedMotherHash === expectedPersonHash ||
    (expectedFatherHash !== ethers.ZeroHash && expectedFatherHash === expectedMotherHash)
  ) {
    throw makeValidationError("InvalidParentHash");
  }

  if (expectedFatherHash === ethers.ZeroHash && fatherVersionIndex !== 0) {
    throw makeValidationError("InvalidParentHash");
  }

  if (expectedMotherHash === ethers.ZeroHash && motherVersionIndex !== 0) {
    throw makeValidationError("InvalidParentHash");
  }

  const verifierRegistryFn = preflightContract?.verifierRegistry;
  if (typeof verifierRegistryFn === "function") {
    const verifierAddress = await verifierRegistryFn(proof.proofSystemId, 0);
    if (!verifierAddress || verifierAddress === ethers.ZeroAddress) {
      throw makeValidationError("VerifierRouteNotSet");
    }
  }

  if (expectedFatherHash !== ethers.ZeroHash && fatherVersionIndex > 0) {
    const fatherTotalVersions = await readTotalVersions(preflightContract, expectedFatherHash);
    if (fatherTotalVersions !== null && fatherVersionIndex > fatherTotalVersions) {
      throw makeValidationError("InvalidFatherVersionIndex");
    }
  }

  if (expectedMotherHash !== ethers.ZeroHash && motherVersionIndex > 0) {
    const motherTotalVersions = await readTotalVersions(preflightContract, expectedMotherHash);
    if (motherTotalVersions !== null && motherVersionIndex > motherTotalVersions) {
      throw makeValidationError("InvalidMotherVersionIndex");
    }
  }

  const versionHash = ethers.keccak256(
    abiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "uint256", "string"],
      [
        expectedPersonHash,
        expectedFatherHash,
        expectedMotherHash,
        fatherVersionIndex,
        motherVersionIndex,
        tag,
      ],
    ),
  );

  const versionExistsFn = preflightContract?.versionExists;
  if (typeof versionExistsFn === "function") {
    try {
      const exists = await versionExistsFn(expectedPersonHash, versionHash);
      if (exists) {
        const duplicateError = new Error("DuplicateVersion");
        (duplicateError as any).reason = "DuplicateVersion";
        (duplicateError as any).__dfDecodedReason = "DuplicateVersion";
        throw duplicateError;
      }
    } catch (preflightError: any) {
      if ((preflightError as any)?.reason === "DuplicateVersion") {
        throw preflightError;
      }
      if (isDev) {
        console.debug("[addVersionService] duplicate preflight failed; continuing with submit", preflightError);
      }
    }
  }

  const gasLimit = await estimateGasWithFallback({
    contractMethod: submitContract.addPersonVersion,
    args: addPersonArgs,
    decodeContract: submitContract ?? preflightContract,
    fallbackGas,
    isDev,
    label: "addPersonVersion",
  });

  const tx = await submitContract.addPersonVersion(...addPersonArgs, gasLimit ? { gasLimit } : {});
  onTransactionSubmitted?.(tx.hash);
  const receipt = await waitForTransactionReceipt(tx);
  const events: AddVersionResult["events"] = {
    PersonHashZKVerified: null,
    PersonVersionAdded: null,
    TokenRewardDistributed: null,
  };

  let personHash = "unknown";
  let versionIndex = 0;
  let rewardAmount = 0;
  const eventInterface = createDeepFamilyInterface();

  for (const parsedEvent of parseReceiptEvents(receipt, eventInterface, contractAddress)) {
    switch (parsedEvent.name) {
      case "PersonHashZKVerified":
        events.PersonHashZKVerified = {
          personHash: parsedEvent.args.personHash,
          prover: parsedEvent.args.prover,
        };
        break;
      case "PersonVersionAdded":
        personHash = parsedEvent.args.personHash;
        versionIndex = Number(parsedEvent.args.versionIndex);
        events.PersonVersionAdded = {
          personHash,
          versionIndex,
          addedBy: parsedEvent.args.addedBy,
          timestamp: Number(parsedEvent.args.timestamp),
          fatherHash: parsedEvent.args.fatherHash,
          fatherVersionIndex: Number(parsedEvent.args.fatherVersionIndex),
          motherHash: parsedEvent.args.motherHash,
          motherVersionIndex: Number(parsedEvent.args.motherVersionIndex),
          tag: parsedEvent.args.tag,
        };
        break;
      case "TokenRewardDistributed":
        events.TokenRewardDistributed = {
          miner: parsedEvent.args.miner,
          personHash: parsedEvent.args.personHash,
          versionIndex: Number(parsedEvent.args.versionIndex),
          reward: parsedEvent.args.reward.toString(),
        };
        rewardAmount = Number(parsedEvent.args.reward) / Math.pow(10, 18);
        break;
    }
  }

  return {
    hash: personHash,
    index: versionIndex,
    rewardAmount,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    events,
  };
}
