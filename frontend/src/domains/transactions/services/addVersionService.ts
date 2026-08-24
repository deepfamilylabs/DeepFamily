import { ethers } from "ethers";
import {
  computeVersionHash,
  parseEnvelopeCommonPrefix,
  unpackSubmitterAndSelfSuiteId,
} from "@deepfamily/protocol-core";
import type { ProofEnvelope } from "../../../shared/zk/zk";
import { wrapIdentityCommitmentAsPersonHash } from "../../../shared/zk/zk";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import {
  estimateGasWithFallbackDetails,
  parseReceiptEvents,
  waitForTransactionReceipt,
} from "../api/txGateway";

export type AddVersionPublicSignals = {
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  submitterAndSelfSuiteId: bigint;
  versionCommitment: bigint;
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
      versionCommitment: string;
    } | null;
    MetadataStored: {
      personHash: string;
      versionIndex: number;
      pointer: string;
      payloadHash: string;
      payloadLength: number;
    } | null;
    TokenRewardDistributed: {
      miner: string;
      personHash: string;
      versionIndex: number;
      reward: string;
    } | null;
  };
};

export type AddVersionTransactionPreview = {
  envelopeBytes: number;
  gasLimit: bigint;
} & ({ estimatedGas: bigint; estimated: true } | { estimatedGas: null; estimated: false });

export type ExecuteAddVersionFlowParams = {
  submitContract: any;
  preflightContract: any;
  contractAddress?: string | null;
  submitterAddress?: string | null;
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  metadataEnvelope: Uint8Array | string;
  fallbackGas?: bigint;
  isDev?: boolean;
  onTransactionSubmitted?: (txHash: string) => void;
  expectedChainId?: number | bigint | null;
  assertWalletScope?: () => Promise<void>;
  reconcileTransactionHash?: string | null;
  getTransactionReceipt?: (txHash: string) => Promise<any | null>;
  confirmTransactionPreview?: (preview: AddVersionTransactionPreview) => boolean | Promise<boolean>;
};

const makeValidationError = (reason: string) => {
  const error = new Error(reason);
  (error as any).reason = reason;
  return error;
};

const makeReconciliationError = (message: string, code: string, terminal = false): Error =>
  Object.assign(new Error(message), {
    reason: code,
    humanMessage: message,
    __dfDecodedReason: code,
    code,
    transactionReconciliationFinal: terminal,
  });

const sameHex = (left: unknown, right: unknown): boolean =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

function assertExactAddVersionReplacement(input: {
  replacement: any;
  expectedContractAddress?: string | null;
  expectedSubmitter: string | null;
  expectedChainId?: number | bigint | null;
  expectedData: string;
}): void {
  const { replacement } = input;
  const chainMatches =
    input.expectedChainId === undefined ||
    input.expectedChainId === null ||
    (replacement?.chainId !== undefined &&
      replacement?.chainId !== null &&
      BigInt(replacement.chainId) === BigInt(input.expectedChainId));
  const submitterMatches =
    input.expectedSubmitter === null || sameHex(replacement?.from, input.expectedSubmitter);
  const contractMatches =
    Boolean(input.expectedContractAddress) &&
    sameHex(replacement?.to, input.expectedContractAddress);
  const dataMatches = sameHex(replacement?.data, input.expectedData);
  const valueMatches =
    replacement?.value === undefined ||
    replacement?.value === null ||
    BigInt(replacement.value) === 0n;

  if (!chainMatches || !submitterMatches || !contractMatches || !dataMatches || !valueMatches) {
    throw makeReconciliationError(
      "The replacement transaction does not match the frozen Add Version package",
      "TRANSACTION_REPLACEMENT_MISMATCH",
      true,
    );
  }
}

async function waitForExactAddVersionTransaction(input: {
  transaction: any;
  expectedContractAddress?: string | null;
  expectedSubmitter: string | null;
  expectedChainId?: number | bigint | null;
  expectedData: string;
  onTransactionSubmitted?: (txHash: string) => void;
}): Promise<{ transactionHash: string; receipt: any }> {
  let transaction = input.transaction;

  while (true) {
    try {
      const receipt = await waitForTransactionReceipt(transaction);
      return { transactionHash: transaction.hash, receipt };
    } catch (error: any) {
      if (error?.code !== "TRANSACTION_REPLACED") throw error;
      if (error?.cancelled === true) {
        throw makeReconciliationError(
          "The Add Version transaction was cancelled by a nonce replacement",
          "TRANSACTION_REPLACED_CANCELLED",
          true,
        );
      }

      const replacement = error?.replacement;
      if (!replacement?.hash) {
        throw makeReconciliationError(
          "The Add Version replacement transaction is missing",
          "TRANSACTION_REPLACEMENT_MISMATCH",
          true,
        );
      }
      assertExactAddVersionReplacement({
        replacement,
        expectedContractAddress: input.expectedContractAddress,
        expectedSubmitter: input.expectedSubmitter,
        expectedChainId: input.expectedChainId,
        expectedData: input.expectedData,
      });
      input.onTransactionSubmitted?.(replacement.hash);

      if (error?.receipt) {
        const receiptHash = error.receipt.hash ?? error.receipt.transactionHash;
        if (
          Number(error.receipt.status) !== 1 ||
          (receiptHash && !sameHex(receiptHash, replacement.hash))
        ) {
          throw makeReconciliationError(
            "The exact Add Version replacement transaction did not succeed",
            "TRANSACTION_RECONCILIATION_MISMATCH",
            true,
          );
        }
        return { transactionHash: replacement.hash, receipt: error.receipt };
      }
      transaction = replacement;
    }
  }
}

const readTotalVersions = async (
  preflightContract: any,
  personHash: string,
): Promise<number | null> => {
  const personVersionsCountFn = preflightContract?.personVersionsCount;
  if (typeof personVersionsCountFn === "function") {
    return Number(await personVersionsCountFn(personHash));
  }

  const listPersonVersionsFn = preflightContract?.listPersonVersions;
  if (typeof listPersonVersionsFn !== "function") return null;
  const out = await listPersonVersionsFn(personHash, 0, 0);
  return Number(out?.totalVersions ?? out?.[1] ?? 0);
};

function parseAddVersionReceipt(input: {
  receipt: any;
  transactionHash: string;
  contractAddress?: string | null;
}): AddVersionResult {
  const { receipt, transactionHash, contractAddress } = input;
  const events: AddVersionResult["events"] = {
    PersonHashZKVerified: null,
    PersonVersionAdded: null,
    MetadataStored: null,
    TokenRewardDistributed: null,
  };

  let personHash = "unknown";
  let versionIndex = 0;
  let rewardAmount = 0;
  const eventInterface = createDeepFamilyInterface();
  const metadataArchiveInterface = new ethers.Interface([
    "event MetadataStored(bytes32 indexed personHash,uint256 indexed versionIndex,address pointer,bytes32 payloadHash,uint32 payloadLength)",
  ]);

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
          versionCommitment: parsedEvent.args.versionCommitment.toString(),
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

  for (const log of receipt.logs || []) {
    try {
      const parsedEvent = metadataArchiveInterface.parseLog(log);
      if (parsedEvent?.name !== "MetadataStored") continue;
      events.MetadataStored = {
        personHash: parsedEvent.args.personHash,
        versionIndex: Number(parsedEvent.args.versionIndex),
        pointer: parsedEvent.args.pointer,
        payloadHash: parsedEvent.args.payloadHash,
        payloadLength: Number(parsedEvent.args.payloadLength),
      };
    } catch {
      // Other receipt logs belong to DeepFamily, the token, or the verifier path.
    }
  }

  return {
    hash: personHash,
    index: versionIndex,
    rewardAmount,
    transactionHash,
    blockNumber: Number(receipt.blockNumber),
    events,
  };
}

function assertReconciledAddVersion(input: {
  receipt: any;
  result: AddVersionResult;
  transactionHash: string;
  expectedPersonHash: string;
  expectedFatherHash: string;
  expectedMotherHash: string;
  expectedSubmitter: string | null;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  versionCommitment: bigint;
  metadataEnvelope: Uint8Array | string;
}): void {
  const receiptHash = input.receipt?.hash ?? input.receipt?.transactionHash;
  if (Number(input.receipt?.status) !== 1) {
    throw makeReconciliationError(
      "The submitted Add Version transaction reverted",
      "CALL_EXCEPTION",
      true,
    );
  }
  if (!receiptHash || !sameHex(receiptHash, input.transactionHash)) {
    throw makeReconciliationError(
      "The receipt hash does not match the submitted Add Version transaction",
      "TRANSACTION_RECONCILIATION_MISMATCH",
      true,
    );
  }

  const version = input.result.events.PersonVersionAdded;
  const metadata = input.result.events.MetadataStored;
  const expectedPayloadHash = ethers.keccak256(input.metadataEnvelope);
  const expectedPayloadLength = ethers.getBytes(input.metadataEnvelope).length;
  const matches =
    version !== null &&
    metadata !== null &&
    sameHex(version.personHash, input.expectedPersonHash) &&
    sameHex(version.fatherHash, input.expectedFatherHash) &&
    sameHex(version.motherHash, input.expectedMotherHash) &&
    version.fatherVersionIndex === input.fatherVersionIndex &&
    version.motherVersionIndex === input.motherVersionIndex &&
    version.versionCommitment === input.versionCommitment.toString() &&
    (input.expectedSubmitter === null || sameHex(version.addedBy, input.expectedSubmitter)) &&
    sameHex(metadata.personHash, input.expectedPersonHash) &&
    metadata.versionIndex === version.versionIndex &&
    sameHex(metadata.payloadHash, expectedPayloadHash) &&
    metadata.payloadLength === expectedPayloadLength;

  if (!matches) {
    throw makeReconciliationError(
      "The submitted transaction receipt does not match the frozen Add Version package",
      "TRANSACTION_RECONCILIATION_MISMATCH",
      true,
    );
  }
}

export async function executeAddVersionFlow({
  submitContract,
  preflightContract,
  contractAddress,
  submitterAddress,
  proof,
  publicSignals,
  fatherVersionIndex,
  motherVersionIndex,
  metadataEnvelope,
  fallbackGas = 6_500_000n,
  isDev = false,
  onTransactionSubmitted,
  expectedChainId,
  assertWalletScope,
  reconcileTransactionHash,
  getTransactionReceipt,
  confirmTransactionPreview,
}: ExecuteAddVersionFlowParams): Promise<AddVersionResult> {
  const addPersonArgs = [
    proof,
    publicSignals,
    fatherVersionIndex,
    motherVersionIndex,
    metadataEnvelope,
  ] as const;
  const expectedTransactionData = createDeepFamilyInterface().encodeFunctionData(
    "addPersonVersion",
    addPersonArgs,
  );

  const expectedPersonHash = wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
  const expectedFatherHash =
    publicSignals.fatherIdentityCommitment === 0n
      ? ethers.ZeroHash
      : wrapIdentityCommitmentAsPersonHash(publicSignals.fatherIdentityCommitment);
  const expectedMotherHash =
    publicSignals.motherIdentityCommitment === 0n
      ? ethers.ZeroHash
      : wrapIdentityCommitmentAsPersonHash(publicSignals.motherIdentityCommitment);
  const packedSubmitter = unpackSubmitterAndSelfSuiteId(publicSignals.submitterAndSelfSuiteId);
  const expectedSubmitter = submitterAddress ? ethers.getAddress(submitterAddress) : null;
  const envelopePrefix = parseEnvelopeCommonPrefix(metadataEnvelope);

  if (
    expectedSubmitter !== null &&
    ethers.getAddress(packedSubmitter.submitter) !== expectedSubmitter
  ) {
    throw makeValidationError("CallerMismatch");
  }
  if (packedSubmitter.selfSuiteId !== envelopePrefix.identitySuiteId) {
    throw makeValidationError("CallerOrIdentitySuiteMismatch");
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

  const versionHash = computeVersionHash({
    personHash: expectedPersonHash,
    fatherHash: expectedFatherHash,
    fatherVersionIndex,
    motherHash: expectedMotherHash,
    motherVersionIndex,
    versionCommitment: publicSignals.versionCommitment,
  });

  // A hash recorded from this exact frozen package is the only safe basis for
  // reconciliation. Never treat versionExists as proof that our transaction
  // succeeded: another account may have submitted the same public content.
  if (reconcileTransactionHash) {
    if (!getTransactionReceipt) {
      throw makeReconciliationError(
        "A receipt provider is required to reconcile the submitted Add Version transaction",
        "TRANSACTION_RECEIPT_READER_UNAVAILABLE",
      );
    }
    const receipt = await getTransactionReceipt(reconcileTransactionHash);
    if (!receipt) {
      throw makeReconciliationError(
        "The submitted Add Version transaction is still pending",
        "TRANSACTION_RECEIPT_PENDING",
      );
    }
    const result = parseAddVersionReceipt({
      receipt,
      transactionHash: reconcileTransactionHash,
      contractAddress,
    });
    assertReconciledAddVersion({
      receipt,
      result,
      transactionHash: reconcileTransactionHash,
      expectedPersonHash,
      expectedFatherHash,
      expectedMotherHash,
      expectedSubmitter,
      fatherVersionIndex,
      motherVersionIndex,
      versionCommitment: publicSignals.versionCommitment,
      metadataEnvelope,
    });
    return result;
  }

  const verifierRegistryFn = preflightContract?.verifierRegistry;
  if (typeof verifierRegistryFn === "function") {
    const verifierAddress = await verifierRegistryFn(0, proof.circuitId);
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

  const versionExistsFn = preflightContract?.versionExists;
  if (typeof versionExistsFn === "function") {
    try {
      const exists = await versionExistsFn(expectedPersonHash, versionHash);
      if (exists) {
        const duplicateError = new Error("DuplicateVersionCommitment");
        (duplicateError as any).reason = "DuplicateVersionCommitment";
        (duplicateError as any).__dfDecodedReason = "DuplicateVersionCommitment";
        throw duplicateError;
      }
    } catch (preflightError: any) {
      if ((preflightError as any)?.reason === "DuplicateVersionCommitment") {
        throw preflightError;
      }
      if (isDev) {
        console.debug(
          "[addVersionService] duplicate preflight failed; continuing with submit",
          preflightError,
        );
      }
    }
  }

  const gasDetails = await estimateGasWithFallbackDetails({
    contractMethod: submitContract.addPersonVersion,
    args: addPersonArgs,
    decodeContract: submitContract ?? preflightContract,
    fallbackGas,
    isDev,
    label: "addPersonVersion",
  });

  if (confirmTransactionPreview) {
    const envelopeBytes = ethers.getBytes(metadataEnvelope).length;
    const preview: AddVersionTransactionPreview = gasDetails.estimated
      ? {
          envelopeBytes,
          estimatedGas: gasDetails.estimatedGas,
          gasLimit: gasDetails.gasLimit,
          estimated: true,
        }
      : {
          envelopeBytes,
          estimatedGas: null,
          gasLimit: gasDetails.gasLimit,
          estimated: false,
        };
    const approved = await confirmTransactionPreview(preview);
    if (!approved) {
      throw Object.assign(new Error("Add Version submission cancelled before wallet request"), {
        reason: "Add Version submission cancelled before wallet request",
        code: "ADD_VERSION_PREVIEW_REJECTED",
      });
    }
  }

  // This is intentionally the last awaited operation before requesting the
  // wallet transaction. Injected-wallet network/account events can reach React
  // after the provider itself has already switched scope.
  await assertWalletScope?.();
  const tx = await submitContract.addPersonVersion(
    ...addPersonArgs,
    gasDetails.gasLimit ? { gasLimit: gasDetails.gasLimit } : {},
  );
  onTransactionSubmitted?.(tx.hash);
  if (
    expectedChainId !== undefined &&
    expectedChainId !== null &&
    tx.chainId !== undefined &&
    tx.chainId !== null &&
    BigInt(tx.chainId) !== BigInt(expectedChainId)
  ) {
    throw Object.assign(
      makeReconciliationError(
        "The wallet submitted the Add Version transaction on a different chain",
        "ADD_VERSION_SCOPE_CHANGED",
        true,
      ),
      { transactionHash: tx.hash },
    );
  }
  const finalTransaction = await waitForExactAddVersionTransaction({
    transaction: tx,
    expectedContractAddress: contractAddress,
    expectedSubmitter,
    expectedChainId,
    expectedData: expectedTransactionData,
    onTransactionSubmitted,
  });
  return parseAddVersionReceipt({
    receipt: finalTransaction.receipt,
    transactionHash: finalTransaction.transactionHash,
    contractAddress,
  });
}
