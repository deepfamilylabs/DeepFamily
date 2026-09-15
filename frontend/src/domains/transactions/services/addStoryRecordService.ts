import { encodePublicStoryRecord } from "../../../shared/config/storyEncoding";
import { ethers, type JsonRpcSigner } from "ethers";
import {
  decodeStoryRecord,
  STORY_ENVELOPE_SCHEMA_ID,
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
import type { StoryRecord } from "../../../shared/model";
import {
  archivePreviewRejectedError,
  archiveValidationError,
  assertBlobRefMatches,
  estimateArchiveTransaction,
  type ArchiveTransactionPreview,
} from "./archiveTransaction";

export interface AddStoryRecordResult {
  recordIndex: number;
  payloadLength: number;
  transactionHash: string;
  blockNumber: number;
  recordsHead: string;
  newRecord: StoryRecord;
  events: {
    StoryRecordAppended: {
      tokenId: string;
      recordIndex: number;
      payloadLength: number;
      payloadHash: string;
      author: string;
      title: string;
      recordType: number;
      attachmentCID: string;
    };
  };
}

export async function addStoryRecordService(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
  recordIndex: number,
  title: string,
  content: string,
  expectedPayloadHash: string,
  recordType = 1,
  attachmentCID = "",
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>,
  /**
   * The provider the page read the story through. The record index the caller
   * passes came from it, so the pre-write state it is checked against must come
   * from it too; the wallet's provider is a different endpoint, with its own
   * caching, and comparing a count from one against a count from the other
   * refused writes the chain would have taken. Signing still goes through the
   * wallet.
   */
  readProvider?: ethers.Provider,
): Promise<AddStoryRecordResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;
  try {
    // Freeze the exact DFS1 bytes before any RPC/wallet await.
    if (!Number.isInteger(recordType) || recordType < 1 || recordType > 255)
      throw archiveValidationError("Type 0 is reserved for the mint biography", {
        key: "archive.errors.recordTypeReserved",
      });
    const payload = ethers.hexlify(
      encodePublicStoryRecord({ title, content, recordType, attachmentCID }),
    );
    const decoded = decodeStoryRecord(payload);
    if (decoded.title !== title || decoded.content !== content)
      throw archiveValidationError("Story compression did not preserve the original text", {
        key: "archive.errors.encodingMismatch",
      });
    const payloadHash = ethers.keccak256(payload);
    if (expectedPayloadHash && expectedPayloadHash.toLowerCase() !== payloadHash.toLowerCase()) {
      throw archiveValidationError("Expected hash does not match canonical story bytes", {
        key: "archive.errors.encodingMismatch",
      });
    }
    const archiveAddress = await deepFamily.archive();
    const contract = createArchiveContract(archiveAddress, signer);
    errorContract = contract;
    const stateReader = readProvider
      ? createArchiveContract(archiveAddress, readProvider)
      : contract;
    const [state, author, network] = await Promise.all([
      stateReader.storyState(tokenId),
      signer.getAddress(),
      signer.provider.getNetwork(),
    ]);
    // Same reason the archive itself would revert with, so the caller can tell
    // this apart from every other validation failure and reload instead of
    // leaving the writer staring at a dead end.
    if (BigInt(state.totalRecords) !== BigInt(recordIndex))
      throw archiveValidationError(
        "Story changed; refresh before appending",
        { key: "archive.errors.storyChanged" },
        "StoryIndexMismatch",
      );
    const args = Object.freeze([
      tokenId,
      recordIndex,
      state.recordsHead,
      STORY_ENVELOPE_SCHEMA_ID,
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
      throw archivePreviewRejectedError("Story submission cancelled before wallet request");
    }
    const [currentNetwork, currentAuthor] = await Promise.all([
      signer.provider.getNetwork(),
      signer.getAddress(),
    ]);
    if (
      currentNetwork.chainId !== network.chainId ||
      currentAuthor.toLowerCase() !== author.toLowerCase()
    ) {
      throw archiveValidationError("Wallet network or account changed; preview the story again", {
        key: "archive.errors.walletScopeChanged",
      });
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
      Number(event.args.index) !== recordIndex ||
      event.args.schemaId !== STORY_ENVELOPE_SCHEMA_ID ||
      String(event.args.author).toLowerCase() !== author.toLowerCase() ||
      String(receipt.hash ?? receipt.transactionHash).toLowerCase() !== tx.hash.toLowerCase()
    ) {
      throw archiveValidationError("Story receipt does not match the frozen record", {
        key: "archive.errors.confirmationMismatch",
      });
    }
    const expectedBlob = {
      payloadHash,
      payloadLength: preview.payloadBytes,
      segmentCount: preview.segmentCount,
    };
    assertBlobRefMatches(event.args.blob, expectedBlob);
    const [ref, finalState] = await Promise.all([
      contract.storyRecordRef(tokenId, recordIndex, { blockTag: receipt.blockNumber }),
      contract.storyState(tokenId, { blockTag: receipt.blockNumber }),
    ]);
    assertBlobRefMatches(ref.blob, { ...expectedBlob, pointer: event.args.blob.pointer });
    if (
      ref.schemaId !== STORY_ENVELOPE_SCHEMA_ID ||
      ref.author.toLowerCase() !== author.toLowerCase() ||
      BigInt(ref.timestamp) !== BigInt(event.args.timestamp) ||
      BigInt(finalState.totalRecords) < BigInt(recordIndex + 1) ||
      BigInt(finalState.totalPayloadLength) <
        BigInt(state.totalPayloadLength) + BigInt(preview.payloadBytes) ||
      (BigInt(finalState.totalRecords) === BigInt(recordIndex + 1) &&
        (finalState.recordsHead !== event.args.newHead ||
          BigInt(finalState.totalPayloadLength) !==
            BigInt(state.totalPayloadLength) + BigInt(preview.payloadBytes)))
    ) {
      throw archiveValidationError("Stored story reference differs from the confirmed event", {
        key: "archive.errors.confirmationMismatch",
      });
    }
    const computedRecordHash = computeStoryRecordHash({
      chainId: network.chainId,
      archive: archiveAddress,
      tokenId,
      index: recordIndex,
      schemaId: STORY_ENVELOPE_SCHEMA_ID,
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
      throw archiveValidationError("Story event commitment differs from the frozen record", {
        key: "archive.errors.confirmationMismatch",
      });
    }
    const newRecord: StoryRecord = {
      recordIndex,
      payloadHash,
      title,
      content,
      timestamp: Number(ref.timestamp),
      author: author,
      recordType,
      attachmentCID,
      schemaId: STORY_ENVELOPE_SCHEMA_ID,
      rawPayload: payload,
      payloadLength: preview.payloadBytes,
      segmentCount: preview.segmentCount,
      recordHash: event.args.recordHash,
    };
    return {
      recordIndex,
      payloadLength: preview.payloadBytes,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      recordsHead: event.args.newHead,
      newRecord,
      events: {
        StoryRecordAppended: {
          tokenId,
          recordIndex,
          payloadLength: preview.payloadBytes,
          payloadHash,
          author: author,
          title,
          recordType,
          attachmentCID,
        },
      },
    };
  } catch (error: any) {
    throw normalizeStoryTxError(error, errorContract);
  }
}
