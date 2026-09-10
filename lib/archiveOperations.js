import { getBytes, hexlify, keccak256 } from "ethers";
import {
  STORY_CHUNK_SCHEMA_ID,
  encodeStoryRecord,
  readStoryRecord,
  computeStoryRecordHash,
  computeStoryHead,
} from "@deepfamily/protocol-core";

/** Estimate the complete call and stop before sending if the buffered gas is invalid. */
export async function estimateArchiveCall({ method, args, provider }) {
  const estimatedGas = await method.estimateGas(...args);
  if (estimatedGas <= 0n) throw new Error("Archive gas estimate must be positive");
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const [network, block, request] = await Promise.all([
    provider.getNetwork(),
    provider.getBlock("latest"),
    method.populateTransaction(...args),
  ]);
  if (!block || block.gasLimit <= 0n) throw new Error("Current block gas limit is unavailable");
  const chainId = BigInt(network.chainId);
  const transactionCap = [1n, 11155111n].includes(chainId) ? 16_777_216n : block.gasLimit;
  if (gasLimit > block.gasLimit || gasLimit > transactionCap) {
    throw new Error(
      "Archive call with 20% gas buffer exceeds the current network transaction capacity",
    );
  }
  if ([71n, 1030n].includes(chainId) && gasLimit < BigInt(getBytes(request.data).length) * 100n) {
    throw new Error("Archive estimate does not cover the eSpace calldata gas floor");
  }
  return { estimatedGas, gasLimit, calldata: request.data, chainId };
}

export async function appendDfsStoryRecord({
  archive,
  tokenId,
  content,
  chunkType = 0,
  attachmentCID = "",
  expectedIndex,
  expectedPayloadHash,
}) {
  const payload = hexlify(encodeStoryRecord({ content, chunkType, attachmentCID }));
  const payloadHash = keccak256(payload);
  if (expectedPayloadHash != null && expectedPayloadHash.toLowerCase() !== payloadHash) {
    throw new Error("Expected payload hash does not match canonical DFS1 bytes");
  }
  const state = await archive.storyState(tokenId);
  if (state.isSealed) throw new Error("Story already sealed");
  if (expectedIndex != null && BigInt(expectedIndex) !== state.totalRecords) {
    throw new Error(`Record index must equal current totalRecords (${state.totalRecords})`);
  }
  const args = Object.freeze([
    tokenId,
    state.totalRecords,
    state.recordsHead,
    STORY_CHUNK_SCHEMA_ID,
    payload,
    payloadHash,
  ]);
  const provider = archive.runner.provider;
  const author = await archive.runner.getAddress();
  const gas = await estimateArchiveCall({ method: archive.appendStoryRecord, args, provider });
  const tx = await archive.appendStoryRecord(...args, { gasLimit: gas.gasLimit });
  const receipt = await tx.wait();
  if (receipt?.status !== 1 || receipt.hash.toLowerCase() !== tx.hash.toLowerCase()) {
    throw new Error("Archive transaction receipt does not match the submitted transaction");
  }
  const recordRef = await archive.storyRecordRef(tokenId, state.totalRecords, {
    blockTag: receipt.blockNumber,
  });
  if (
    recordRef.blob.payloadHash !== payloadHash ||
    recordRef.blob.payloadLength !== BigInt(getBytes(payload).length)
  ) {
    throw new Error("Stored Story ref differs from the submitted canonical payload");
  }
  const archiveAddress = await archive.getAddress();
  const recordHash = computeStoryRecordHash({
    chainId: gas.chainId,
    archive: archiveAddress,
    tokenId,
    index: state.totalRecords,
    schemaId: recordRef.schemaId,
    payloadHash,
    payloadLength: recordRef.blob.payloadLength,
    author: recordRef.author,
    timestamp: recordRef.timestamp,
  });
  const newHead = computeStoryHead({ previousHead: state.recordsHead, recordHash });
  const matchingEvents = receipt.logs
    .filter((log) => log.address.toLowerCase() === archiveAddress.toLowerCase())
    .map((log) => {
      try {
        return archive.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(
      (event) =>
        event?.name === "StoryRecordAppended" &&
        event.args.tokenId === BigInt(tokenId) &&
        event.args.index === state.totalRecords,
    );
  const event = matchingEvents[0]?.args;
  if (
    matchingEvents.length !== 1 ||
    recordRef.schemaId !== STORY_CHUNK_SCHEMA_ID ||
    recordRef.author.toLowerCase() !== author.toLowerCase() ||
    event.recordHash !== recordHash ||
    event.newHead !== newHead ||
    event.schemaId !== recordRef.schemaId ||
    event.author !== recordRef.author ||
    event.timestamp !== recordRef.timestamp ||
    ["pointer", "payloadHash", "payloadLength", "segmentCount"].some(
      (key) => event.blob[key] !== recordRef.blob[key],
    )
  ) {
    throw new Error("Story receipt event differs from the submitted payload and stored reference");
  }
  const result = await readStoryRecord({
    getCode: (address, blockTag) => provider.getCode(address, blockTag),
    recordRef,
    blockTag: receipt.blockNumber,
  });
  const finalState = await archive.storyState(tokenId, { blockTag: receipt.blockNumber });
  const expectedCount = state.totalRecords + 1n;
  if (
    finalState.totalRecords < expectedCount ||
    finalState.totalPayloadLength < state.totalPayloadLength + recordRef.blob.payloadLength ||
    (finalState.totalRecords === expectedCount &&
      (finalState.recordsHead !== newHead ||
        finalState.totalPayloadLength !== state.totalPayloadLength + recordRef.blob.payloadLength))
  ) {
    throw new Error("Stored Story state differs from the confirmed record");
  }
  return { tx, receipt, recordRef, record: result, payload, ...gas };
}

export async function sealArchiveStory({ archive, tokenId }) {
  const state = await archive.storyState(tokenId);
  const args = Object.freeze([tokenId, state.totalRecords, state.recordsHead]);
  const author = await archive.runner.getAddress();
  const archiveAddress = await archive.getAddress();
  const gas = await estimateArchiveCall({
    method: archive.sealStory,
    args,
    provider: archive.runner.provider,
  });
  const tx = await archive.sealStory(...args, { gasLimit: gas.gasLimit });
  const receipt = await tx.wait();
  const events = receipt.logs
    .filter((log) => log.address.toLowerCase() === archiveAddress.toLowerCase())
    .map((log) => {
      try {
        return archive.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((event) => event?.name === "StorySealed" && event.args.tokenId === BigInt(tokenId));
  const event = events[0]?.args;
  const final = await archive.storyState(tokenId, { blockTag: receipt.blockNumber });
  if (
    receipt.status !== 1 ||
    receipt.hash.toLowerCase() !== tx.hash.toLowerCase() ||
    events.length !== 1 ||
    event.totalRecords !== state.totalRecords ||
    event.recordsHead !== state.recordsHead ||
    event.totalPayloadLength !== state.totalPayloadLength ||
    event.sealer.toLowerCase() !== author.toLowerCase() ||
    event.timestamp !== final.lastUpdateTime ||
    !final.isSealed ||
    final.recordsHead !== state.recordsHead ||
    final.totalRecords !== state.totalRecords ||
    final.totalPayloadLength !== state.totalPayloadLength
  ) {
    throw new Error("Story seal receipt/state reconciliation failed");
  }
  return { tx, receipt, state: final, ...gas };
}
