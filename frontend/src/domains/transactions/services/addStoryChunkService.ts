import { ethers, type JsonRpcSigner } from "ethers";
import {
  createDeepFamilyContract,
  createStoryArchiveContract,
  createStoryArchiveInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents, waitForTransactionReceipt } from "../api/txGateway";
import { normalizeStoryTxError } from "../../../shared/lib/errors";
import type { StoryChunk } from "../../../shared/model";

export interface AddStoryChunkResult {
  chunkIndex: number;
  contentLength: number;
  transactionHash: string;
  blockNumber: number;
  newChunk: StoryChunk;
  events: {
    StoryChunkAdded: {
      tokenId: string;
      chunkIndex: number;
      contentLength: number;
      chunkHash: string;
      editor: string;
      chunkType: number;
      attachmentCID: string;
    } | null;
  };
}

export async function addStoryChunkService(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
  chunkIndex: number,
  content: string,
  expectedHash: string,
  chunkType = 0,
  attachmentCID = "",
): Promise<AddStoryChunkResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;

  try {
    const storyArchiveAddress = await deepFamily.storyArchive();
    const contract = createStoryArchiveContract(storyArchiveAddress, signer);
    errorContract = contract;
    const tx = await contract.addStoryChunk(
      tokenId,
      chunkIndex,
      chunkType,
      content,
      attachmentCID,
      expectedHash || ethers.ZeroHash,
    );
    const receipt = await waitForTransactionReceipt(tx);
    const eventInterface = createStoryArchiveInterface();
    const storyEvent = parseReceiptEvents(receipt, eventInterface, storyArchiveAddress).find(
      (event) => event.name === "StoryChunkAdded",
    );

    const chunkAdded = storyEvent
      ? {
          tokenId: storyEvent.args.tokenId.toString(),
          chunkIndex: Number(storyEvent.args.chunkIndex),
          contentLength: Number(storyEvent.args.contentLength),
          chunkHash: storyEvent.args.chunkHash,
          editor: storyEvent.args.editor,
          chunkType: Number(storyEvent.args.chunkType),
          attachmentCID: storyEvent.args.attachmentCID,
        }
      : null;

    const newChunk: StoryChunk = {
      chunkIndex: chunkAdded?.chunkIndex ?? chunkIndex,
      chunkHash: chunkAdded?.chunkHash || ethers.keccak256(ethers.toUtf8Bytes(content)),
      content,
      timestamp: Math.floor(Date.now() / 1000),
      editor: chunkAdded?.editor || (await signer.getAddress()),
      chunkType: chunkAdded?.chunkType ?? chunkType,
      attachmentCID: chunkAdded?.attachmentCID ?? attachmentCID,
    };

    return {
      chunkIndex: newChunk.chunkIndex,
      contentLength: chunkAdded?.contentLength ?? ethers.toUtf8Bytes(content).length,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      newChunk,
      events: {
        StoryChunkAdded: chunkAdded,
      },
    };
  } catch (error: any) {
    throw normalizeStoryTxError(error, errorContract);
  }
}
