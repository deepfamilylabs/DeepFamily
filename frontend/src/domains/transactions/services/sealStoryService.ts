import { type JsonRpcSigner } from "ethers";
import {
  createDeepFamilyContract,
  createArchiveContract,
  createArchiveInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents, waitForTransactionReceipt } from "../api/txGateway";
import { normalizeStoryTxError } from "../../../shared/lib/errors";

import {
  archiveValidationError,
  estimateArchiveTransaction,
  type ArchiveTransactionPreview,
} from "./archiveTransaction";

export interface SealStoryResult {
  totalChunks: number;
  fullStoryHash: string;
  transactionHash: string;
  blockNumber: number;
  events: {
    StorySealed: { tokenId: string; totalChunks: number; fullStoryHash: string; sealer: string };
  };
}

export async function sealStoryService(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>,
): Promise<SealStoryResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;
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
      throw archiveValidationError("Story seal cancelled before wallet request");
    }
    const [currentNetwork, currentAuthor] = await Promise.all([
      signer.provider.getNetwork(),
      signer.getAddress(),
    ]);
    if (
      currentNetwork.chainId !== network.chainId ||
      currentAuthor.toLowerCase() !== author.toLowerCase()
    ) {
      throw archiveValidationError("Wallet network or account changed; preview the seal again");
    }
    const tx = await contract.sealStory(...args, { gasLimit: preview.gasLimit });
    const receipt = await waitForTransactionReceipt(tx);
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
      String(receipt.hash ?? receipt.transactionHash).toLowerCase() !== tx.hash.toLowerCase()
    ) {
      throw archiveValidationError("Story seal receipt does not match the expected state");
    }
    const finalState = await contract.storyState(tokenId, { blockTag: receipt.blockNumber });
    if (
      !finalState.isSealed ||
      finalState.recordsHead !== state.recordsHead ||
      BigInt(finalState.totalRecords) !== BigInt(state.totalRecords) ||
      BigInt(finalState.totalPayloadLength) !== BigInt(state.totalPayloadLength) ||
      BigInt(finalState.lastUpdateTime) !== BigInt(event.args.timestamp)
    ) {
      throw archiveValidationError("Stored story seal differs from the confirmed event");
    }
    const sealed = {
      tokenId,
      totalChunks: Number(state.totalRecords),
      fullStoryHash: state.recordsHead,
      sealer: author,
    };
    return {
      ...sealed,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      events: { StorySealed: sealed },
    };
  } catch (error: any) {
    throw normalizeStoryTxError(error, errorContract);
  }
}
