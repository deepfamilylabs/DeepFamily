import type { ContractReceipt } from "../../../shared/clients/transactionTypes";
import { type JsonRpcSigner } from "ethers";
import {
  createDeepFamilyContract,
  createArchiveContract,
  createArchiveInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents } from "../api/txGateway";
import { normalizeStoryTxError } from "../../../shared/lib/errors";
import { executeChainTransaction, withTransactionHash } from "@deepfamily/chain-client";
import { readConfirmedDetails, verifyConfirmedDetails } from "@deepfamily/chain-client";

import {
  archivePreviewRejectedError,
  archiveValidationError,
  estimateArchiveTransaction,
  type ArchiveTransactionPreview,
} from "./archiveTransaction";

export interface SealStoryResult {
  totalRecords: number;
  recordsHead: string;
  transactionHash: string;
  blockNumber: number;
  receipt: ContractReceipt;
  events: {
    StorySealed: { tokenId: string; totalRecords: number; recordsHead: string; sealer: string };
  };
}

export interface SealStoryCommand {
  signer: JsonRpcSigner;
  contractAddress: string;
  tokenId: string;
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>;
  assertActive?: () => void;
  onSubmitted?: (transactionHash: string) => void;
  onConfirmed?: (transactionHash: string, receipt: ContractReceipt) => void;
}

export async function sealStoryService({
  signer, contractAddress, tokenId, confirmTransactionPreview, assertActive, onSubmitted, onConfirmed,
}: SealStoryCommand): Promise<SealStoryResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;
  let transactionHash: string | undefined;
  try {
    const archiveAddress = await deepFamily.archive();
    const contract = createArchiveContract(archiveAddress, signer);
    errorContract = contract;
    const [state, author, network] = await Promise.all([
      contract.storyState(tokenId),
      signer.getAddress(),
      signer.provider.getNetwork(),
    ]);
    const args = Object.freeze([tokenId, state.totalRecords, state.recordsHead]);
    const preview = await estimateArchiveTransaction({
      contractMethod: contract.sealStory,
      args,
      provider: signer.provider,
      calldata: contract.interface.encodeFunctionData("sealStory", args),
      payload: "0x",
      kind: "Seal",
    });
    if (!confirmTransactionPreview || !(await confirmTransactionPreview(preview))) {
      throw archivePreviewRejectedError("Story seal cancelled before wallet request");
    }
    const [currentNetwork, currentAuthor, fromBlock] = await Promise.all([
      signer.provider.getNetwork(),
      signer.getAddress(),
      signer.provider.getBlockNumber(),
    ]);
    if (
      currentNetwork.chainId !== network.chainId ||
      currentAuthor.toLowerCase() !== author.toLowerCase()
    ) {
      throw archiveValidationError("Wallet network or account changed; preview the seal again", {
        key: "archive.errors.walletScopeChanged",
      });
    }
    const tracked = await executeChainTransaction<ContractReceipt>({
      fromBlock,
      assertActive,
      send: () => contract.sealStory(...args, { gasLimit: preview.gasLimit }),
      expected: { chainId: network.chainId, from: author, to: archiveAddress,
        data: contract.interface.encodeFunctionData("sealStory", args), value: 0n },
      onSubmitted: (hash) => { transactionHash = hash; onSubmitted?.(hash); },
    });
    const { receipt } = tracked;
    transactionHash = tracked.transactionHash;
    const event = parseReceiptEvents(receipt, createArchiveInterface(), archiveAddress).find(
      (item) => item.name === "StorySealed",
    );
    if (
      Number(receipt?.status) !== 1 ||
      !event ||
      String(event.args.tokenId) !== tokenId ||
      BigInt(event.args.totalRecords) !== BigInt(state.totalRecords) ||
      event.args.recordsHead !== state.recordsHead ||
      BigInt(event.args.totalPayloadLength) !== BigInt(state.totalPayloadLength) ||
      event.args.sealer.toLowerCase() !== author.toLowerCase() ||
      String(receipt.hash ?? receipt.transactionHash).toLowerCase() !== tracked.transactionHash.toLowerCase()
    ) {
      throw archiveValidationError("Story seal receipt does not match the expected state", {
        key: "archive.errors.confirmationMismatch",
      });
    }
    onConfirmed?.(tracked.transactionHash, receipt);
    return await verifyConfirmedDetails(tracked.transactionHash, async () => {
      const finalState = await readConfirmedDetails(tracked.transactionHash, () =>
        contract.storyState(tokenId, { blockTag: receipt.blockNumber }),
      );
      if (
        !finalState.isSealed ||
        finalState.recordsHead !== state.recordsHead ||
        BigInt(finalState.totalRecords) !== BigInt(state.totalRecords) ||
        BigInt(finalState.totalPayloadLength) !== BigInt(state.totalPayloadLength) ||
        BigInt(finalState.lastUpdateTime) !== BigInt(event.args.timestamp)
      ) {
        throw archiveValidationError("Stored story seal differs from the confirmed event", {
          key: "archive.errors.confirmationMismatch",
        });
      }
      const sealed = {
        tokenId,
        totalRecords: Number(state.totalRecords),
        recordsHead: state.recordsHead,
        sealer: author,
      };
      return {
        ...sealed,
        transactionHash: tracked.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        receipt,
        events: { StorySealed: sealed },
      };
    });
  } catch (error: any) {
    throw normalizeStoryTxError(
      transactionHash ? withTransactionHash(error, transactionHash) : error,
      errorContract,
    );
  }
}
