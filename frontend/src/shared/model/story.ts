import { ethers } from "ethers";
import { computeStoryHead } from "@deepfamily/protocol-core";
import type { StoryRecord } from "./graph";

export function computeStoryRecordsHead(records: StoryRecord[]): string {
  let head = ethers.ZeroHash;
  for (const record of [...records].sort((a, b) => a.recordIndex - b.recordIndex)) {
    if (!record.recordHash) throw new Error("Verified story record commitment is missing");
    head = computeStoryHead({ previousHead: head, recordHash: record.recordHash });
  }
  return head;
}
