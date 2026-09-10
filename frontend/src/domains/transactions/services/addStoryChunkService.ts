import { ethers, type JsonRpcSigner } from "ethers";
import {
  encodeStoryRecord,
  STORY_CHUNK_SCHEMA_ID,
  computeStoryRecordHash,
  computeStoryHead,
} from "@deepfamily/protocol-core";
import {
  createDeepFamilyContract,
  createArchiveContract,
  createArchiveInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents, waitForTransactionReceipt } from "../api/txGateway";
import { normalizeStoryTxError } from "../../../shared/lib/errors";
import type { StoryChunk } from "../../../shared/model";
import {
  archiveValidationError,
  assertBlobRefMatches,
  estimateArchiveTransaction,
  type ArchiveTransactionPreview,
} from "./archiveTransaction";

export interface AddStoryChunkResult {
  chunkIndex: number;
  contentLength: number;
  transactionHash: string;
  blockNumber: number;
  recordsHead: string;
  newChunk: StoryChunk;
  events: {
    StoryRecordAppended: {
      tokenId: string;
      chunkIndex: number;
      contentLength: number;
      chunkHash: string;
      editor: string;
      chunkType: number;
      attachmentCID: string;
    };
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
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>,
): Promise<AddStoryChunkResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;
  try {
    // Freeze the exact DFS1 bytes before any RPC/wallet await.
    const payload = ethers.hexlify(encodeStoryRecord({ content, chunkType, attachmentCID }));
    const payloadHash = ethers.keccak256(payload);
    if (expectedHash && expectedHash.toLowerCase() !== payloadHash.toLowerCase()) {
      throw archiveValidationError("Expected hash does not match canonical story bytes");
    }
    const archiveAddress = await deepFamily.archive();
    const contract = createArchiveContract(archiveAddress, signer);
    errorContract = contract;
    const [state, author, network] = await Promise.all([
      contract.storyState(tokenId),
      signer.getAddress(),
      signer.provider.getNetwork(),
    ]);
    if (BigInt(state.totalRecords) !== BigInt(chunkIndex))
      throw archiveValidationError("Story changed; refresh before appending");
    const args = Object.freeze([
      tokenId,
      chunkIndex,
      state.recordsHead,
      STORY_CHUNK_SCHEMA_ID,
      payload,
      payloadHash,
    ]);
    const preview = await estimateArchiveTransaction({
      contractMethod: contract.appendStoryRecord,
      args,
      provider: signer.provider,
      calldata: contract.interface.encodeFunctionData("appendStoryRecord", args),
      payload,
      kind: "Story",
    });
    if (!confirmTransactionPreview || !(await confirmTransactionPreview(preview))) {
      throw archiveValidationError("Story submission cancelled before wallet request");
    }
    const [currentNetwork, currentAuthor] = await Promise.all([
      signer.provider.getNetwork(),
      signer.getAddress(),
    ]);
    if (
      currentNetwork.chainId !== network.chainId ||
      currentAuthor.toLowerCase() !== author.toLowerCase()
    ) {
      throw archiveValidationError("Wallet network or account changed; preview the story again");
    }
    const tx = await contract.appendStoryRecord(...args, { gasLimit: preview.gasLimit });
    const receipt = await waitForTransactionReceipt(tx);
    const event = parseReceiptEvents(receipt, createArchiveInterface(), archiveAddress).find(
      (item) => item.name === "StoryRecordAppended",
    );
    if (
      Number(receipt?.status) !== 1 ||
      !event ||
      String(event.args.tokenId) !== tokenId ||
      Number(event.args.index) !== chunkIndex ||
      event.args.schemaId !== STORY_CHUNK_SCHEMA_ID ||
      String(event.args.author).toLowerCase() !== author.toLowerCase() ||
      String(receipt.hash ?? receipt.transactionHash).toLowerCase() !== tx.hash.toLowerCase()
    ) {
      throw archiveValidationError("Story receipt does not match the frozen record");
    }
    const expectedBlob = {
      payloadHash,
      payloadLength: preview.payloadBytes,
      segmentCount: preview.segmentCount,
    };
    assertBlobRefMatches(event.args.blob, expectedBlob);
    const [ref, finalState] = await Promise.all([
      contract.storyRecordRef(tokenId, chunkIndex, { blockTag: receipt.blockNumber }),
      contract.storyState(tokenId, { blockTag: receipt.blockNumber }),
    ]);
    assertBlobRefMatches(ref.blob, { ...expectedBlob, pointer: event.args.blob.pointer });
    if (
      ref.schemaId !== STORY_CHUNK_SCHEMA_ID ||
      ref.author.toLowerCase() !== author.toLowerCase() ||
      BigInt(ref.timestamp) !== BigInt(event.args.timestamp) ||
      BigInt(finalState.totalRecords) < BigInt(chunkIndex + 1) ||
      BigInt(finalState.totalPayloadLength) <
        BigInt(state.totalPayloadLength) + BigInt(preview.payloadBytes) ||
      (BigInt(finalState.totalRecords) === BigInt(chunkIndex + 1) &&
        (finalState.recordsHead !== event.args.newHead ||
          BigInt(finalState.totalPayloadLength) !==
            BigInt(state.totalPayloadLength) + BigInt(preview.payloadBytes)))
    ) {
      throw archiveValidationError("Stored story reference differs from the confirmed event");
    }
    const computedRecordHash = computeStoryRecordHash({
      chainId: network.chainId,
      archive: archiveAddress,
      tokenId,
      index: chunkIndex,
      schemaId: STORY_CHUNK_SCHEMA_ID,
      payloadHash,
      payloadLength: preview.payloadBytes,
      author,
      timestamp: ref.timestamp,
    });
    if (
      computedRecordHash !== event.args.recordHash ||
      computeStoryHead({ previousHead: state.recordsHead, recordHash: computedRecordHash }) !==
        event.args.newHead
    ) {
      throw archiveValidationError("Story event commitment differs from the frozen record");
    }
    const newChunk: StoryChunk = {
      chunkIndex,
      chunkHash: payloadHash,
      content,
      timestamp: Number(ref.timestamp),
      editor: author,
      chunkType,
      attachmentCID,
      schemaId: STORY_CHUNK_SCHEMA_ID,
      rawPayload: payload,
      payloadLength: preview.payloadBytes,
      segmentCount: preview.segmentCount,
      recordHash: event.args.recordHash,
    };
    return {
      chunkIndex,
      contentLength: preview.payloadBytes,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      recordsHead: event.args.newHead,
      newChunk,
      events: {
        StoryRecordAppended: {
          tokenId,
          chunkIndex,
          contentLength: preview.payloadBytes,
          chunkHash: payloadHash,
          editor: author,
          chunkType,
          attachmentCID,
        },
      },
    };
  } catch (error: any) {
    throw normalizeStoryTxError(error, errorContract);
  }
}
