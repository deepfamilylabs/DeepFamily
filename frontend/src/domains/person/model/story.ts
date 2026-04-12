import { ethers } from "ethers";
import type { StoryChunk } from "../../../shared/model";

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
