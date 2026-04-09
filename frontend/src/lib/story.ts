import { ethers, Contract, type JsonRpcSigner } from "ethers";
import DeepFamilyAbi from "../abi/DeepFamily.json";
import { extractRevertReason } from "./errors";
import type { StoryChunk } from "../types/graph";

export function computeStoryHash(chunks: StoryChunk[]): string {
  if (!chunks || chunks.length === 0) return ethers.ZeroHash;
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  let accumulator = ethers.ZeroHash;
  for (const chunk of sorted) {
    accumulator = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "uint256", "bytes32"],
        [accumulator, BigInt(chunk.chunkIndex), chunk.chunkHash],
      ),
    );
  }
  return accumulator;
}

/**
 * Result from adding a story chunk
 */
export interface AddStoryChunkResult {
  chunkIndex: number;
  contentLength: number;
  transactionHash: string;
  blockNumber: number;
  newChunk: StoryChunk; // Return complete chunk data for immediate UI update
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

/**
 * Result from sealing a story
 */
export interface SealStoryResult {
  totalChunks: number;
  fullStoryHash: string;
  transactionHash: string;
  blockNumber: number;
  events: {
    StorySealed: {
      tokenId: string;
      totalChunks: number;
      fullStoryHash: string;
      sealer: string;
    } | null;
  };
}

/**
 * Add a story chunk to an NFT
 */
export async function addStoryChunk(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
  chunkIndex: number,
  content: string,
  expectedHash: string,
  chunkType = 0,
  attachmentCID = "",
): Promise<AddStoryChunkResult> {
  const contract = new Contract(contractAddress, DeepFamilyAbi.abi, signer);

  try {
    const tx = await contract.addStoryChunk(
      tokenId,
      chunkIndex,
      chunkType,
      content,
      attachmentCID,
      expectedHash || ethers.ZeroHash,
    );

    // Wait for confirmation
    const receipt = await tx.wait();

    // Parse events
    const events = {
      StoryChunkAdded: null as any,
    };

    let parsedChunkIndex = chunkIndex;
    let parsedContentLength = content.length;

    for (const log of receipt.logs) {
      try {
        const parsedEvent = contract.interface.parseLog(log);
        if (parsedEvent) {
          if (parsedEvent.name === "StoryChunkAdded") {
            events.StoryChunkAdded = {
              tokenId: parsedEvent.args.tokenId.toString(),
              chunkIndex: Number(parsedEvent.args.chunkIndex),
              contentLength: Number(parsedEvent.args.contentLength),
              chunkHash: parsedEvent.args.chunkHash,
              editor: parsedEvent.args.editor,
              chunkType: Number(parsedEvent.args.chunkType),
              attachmentCID: parsedEvent.args.attachmentCID,
            };
            parsedChunkIndex = events.StoryChunkAdded.chunkIndex;
            parsedContentLength = events.StoryChunkAdded.contentLength;
          }
        }
      } catch (error) {
        continue;
      }
    }

    // Build new chunk data for immediate UI update
    const newChunk: StoryChunk = {
      chunkIndex: parsedChunkIndex,
      chunkHash: events.StoryChunkAdded?.chunkHash || ethers.keccak256(ethers.toUtf8Bytes(content)),
      content: content,
      timestamp: Math.floor(Date.now() / 1000), // Use current time as approximation
      editor: events.StoryChunkAdded?.editor || (await signer.getAddress()),
      chunkType: events.StoryChunkAdded?.chunkType ?? chunkType,
      attachmentCID: events.StoryChunkAdded?.attachmentCID ?? attachmentCID,
    };

    return {
      chunkIndex: parsedChunkIndex,
      contentLength: parsedContentLength,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      newChunk,
      events,
    };
  } catch (error: any) {
    console.error("Add story chunk failed:", error);
    throw parseStoryContractError(error, contract);
  }
}

/**
 * Seal a story to make it immutable
 */
export async function sealStory(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
): Promise<SealStoryResult> {
  const contract = new Contract(contractAddress, DeepFamilyAbi.abi, signer);

  try {
    const tx = await contract.sealStory(tokenId);

    // Wait for confirmation
    const receipt = await tx.wait();

    // Parse events
    const events = {
      StorySealed: null as any,
    };

    let parsedTotalChunks = 0;
    let parsedFullStoryHash = ethers.ZeroHash;

    for (const log of receipt.logs) {
      try {
        const parsedEvent = contract.interface.parseLog(log);
        if (parsedEvent) {
          if (parsedEvent.name === "StorySealed") {
            events.StorySealed = {
              tokenId: parsedEvent.args.tokenId.toString(),
              totalChunks: Number(parsedEvent.args.totalChunks),
              fullStoryHash: parsedEvent.args.fullStoryHash,
              sealer: parsedEvent.args.sealer,
            };
            parsedTotalChunks = events.StorySealed.totalChunks;
            parsedFullStoryHash = events.StorySealed.fullStoryHash;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return {
      totalChunks: parsedTotalChunks,
      fullStoryHash: parsedFullStoryHash,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      events,
    };
  } catch (error: any) {
    console.error("Seal story failed:", error);
    throw parseStoryContractError(error, contract);
  }
}

/**
 * Parse contract errors into user-friendly messages
 */
function parseStoryContractError(error: any, contract: Contract): Error {
  console.error("[Story] Contract error:", error);

  if (
    error?.code === "WALLET_POPUP_TIMEOUT" ||
    error?.type === "WALLET_POPUP_TIMEOUT" ||
    (typeof error?.message === "string" && /wallet confirmation timed out/i.test(error.message))
  ) {
    const err = new Error(
      "Wallet confirmation timed out. Please reopen your wallet and confirm the transaction.",
    );
    (err as any).type = "WALLET_POPUP_TIMEOUT";
    (err as any).code = "WALLET_POPUP_TIMEOUT";
    return err;
  }

  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    const err = new Error("Transaction was rejected by user");
    (err as any).type = "USER_REJECTED";
    (err as any).code = "USER_REJECTED";
    return err;
  }

  const revertReason = extractRevertReason(contract, error);
  if (revertReason) {
    const err = new Error(getErrorMessage(revertReason));
    (err as any).type = revertReason;
    return err;
  }

  if (
    error?.code === -32002 ||
    (typeof error?.message === "string" && /request (?:is )?already pending/i.test(error.message))
  ) {
    const err = new Error(
      "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
    );
    (err as any).type = "WALLET_REQUEST_PENDING";
    (err as any).code = "WALLET_REQUEST_PENDING";
    return err;
  }

  // Check for standard error messages
  if (error?.message) {
    if (error.message.includes("execution reverted")) {
      // Try to extract custom error from message
      const customErrorMatch = error.message.match(/custom error '(\w+)'/);
      if (customErrorMatch) {
        const customError = customErrorMatch[1];
        const err = new Error(getErrorMessage(customError));
        (err as any).type = customError;
        return err;
      }
      const err = new Error("Transaction failed: execution reverted");
      (err as any).type = "EXECUTION_REVERTED";
      return err;
    }

    if (error.message.includes("user rejected")) {
      const err = new Error("Transaction was rejected by user");
      (err as any).type = "USER_REJECTED";
      return err;
    }

    if (error.message.includes("insufficient funds")) {
      const err = new Error("Insufficient funds for gas");
      (err as any).type = "INSUFFICIENT_FUNDS";
      return err;
    }
  }

  // Fallback to original error message or generic error
  const err = new Error(error?.message || "An unknown error occurred");
  (err as any).type = "UNKNOWN_ERROR";
  return err;
}

/**
 * Get user-friendly error message for custom error names
 */
function getErrorMessage(errorName: string): string {
  const messages: Record<string, string> = {
    MustBeNFTHolder: "You must own this NFT to edit its story",
    Unauthorized: "Not authorized to perform this action",
    OnlyOwner: "Only the owner can perform this action",
    StorySealed: "Story is sealed and cannot be modified",
    ChunkIndexExists: "Chunk at this index already exists",
    InvalidChunkIndex: "Invalid chunk index",
    ContentTooLong: "Content exceeds maximum length",
    ExpectedHashMismatch: "Expected hash does not match",
    ChunkHashMismatch: "Chunk content does not match expected hash",
    ChunkIndexOutOfRange: "Chunk index is out of valid range",
  };

  return messages[errorName] || `Contract error: ${errorName}`;
}
