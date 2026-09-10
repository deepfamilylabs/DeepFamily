import { ethers } from "ethers";
import { computeStoryHead } from "@deepfamily/protocol-core";
import type { StoryChunk } from "./graph";

export function computeStoryHash(chunks: StoryChunk[]): string {
  let head = ethers.ZeroHash;
  for (const chunk of [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    if (!chunk.recordHash) throw new Error("Verified story record commitment is missing");
    head = computeStoryHead({ previousHead: head, recordHash: chunk.recordHash });
  }
  return head;
}
