import { getBytes, hexlify, keccak256 } from "ethers";
import {
  STORY_ENVELOPE_SCHEMA_ID,
  encodeStoryRecord,
  readStoryRecord,
  computeStoryRecordHash,
  computeStoryHead,
} from "@deepfamily/protocol-core";
import {
  validateArchiveGas,
  executeChainTransaction,
  runChainRead,
  withConfirmedTransaction,
  readConfirmedDetails,
  verifyConfirmedDetails,
} from "@deepfamily/chain-client";

/** Estimate the complete call and stop before sending if the buffered gas is invalid. */
export async function estimateArchiveCall({ method, args, provider }) {
  const estimatedGas = await runChainRead({ read: () => method.estimateGas(...args), operation: "estimate" });
  const [network, block, request] = await Promise.all([
    provider.getNetwork(),
    provider.getBlock("latest"),
    method.populateTransaction(...args),
  ]);
  const gas = validateArchiveGas({
    estimatedGas,
    chainId: network.chainId,
    blockGasLimit: block?.gasLimit,
    calldata: request.data,
  });
  return { ...gas, calldata: request.data, chainId: BigInt(network.chainId) };
}

function receiptEvents(receipt, archive, address, name, tokenId) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === address.toLowerCase())
    .map((log) => {
      try {
        return archive.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((event) => event?.name === name && event.args.tokenId === BigInt(tokenId));
}

export async function appendDfsStoryRecord({
  archive,
  tokenId,
  title = "",
  content,
  recordType = 1,
  attachmentURI = "",
  expectedIndex,
  expectedPayloadHash,
}) {
  if (!Number.isInteger(recordType) || recordType < 1 || recordType > 255) {
    throw new Error(
      "Ordinary story types must be 1 through 255; type 0 is reserved for mint biography",
    );
  }
  const payload = hexlify(encodeStoryRecord({ title, content, recordType, attachmentURI }));
  const payloadHash = keccak256(payload);
  if (expectedPayloadHash != null && expectedPayloadHash.toLowerCase() !== payloadHash) {
    throw new Error("Expected payload hash does not match the compressed story envelope");
  }
  const state = await runChainRead({ read: () => archive.storyState(tokenId) });
  if (state.isSealed) throw new Error("Story already sealed");
  if (expectedIndex != null && BigInt(expectedIndex) !== state.totalRecords) {
    throw new Error(`Record index must equal current totalRecords (${state.totalRecords})`);
  }
  const args = Object.freeze([
    tokenId,
    state.totalRecords,
    state.recordsHead,
    STORY_ENVELOPE_SCHEMA_ID,
    payload,
    payloadHash,
  ]);
  const provider = archive.runner.provider;
  const author = await archive.runner.getAddress();
  const archiveAddress = await archive.getAddress();
  const gas = await estimateArchiveCall({ method: archive.appendStoryRecord, args, provider });
  const { transaction: tx, receipt, transactionHash } = await executeChainTransaction({
    provider,
    send: () => archive.appendStoryRecord(...args, { gasLimit: gas.gasLimit }),
    label: "append-story-record",
  });
  // Establish the submitted record's event before any readback RPC. A successful receipt
  // does not imply that its domain details have already been read or independently verified.
  const matchingEvents = receiptEvents(
    receipt,
    archive,
    archiveAddress,
    "StoryRecordAppended",
    tokenId,
  ).filter((event) => event.args.index === state.totalRecords);
  const event = matchingEvents[0]?.args;
  if (
    matchingEvents.length !== 1 ||
    event.schemaId !== STORY_ENVELOPE_SCHEMA_ID ||
    event.author.toLowerCase() !== author.toLowerCase() ||
    event.blob.payloadHash !== payloadHash ||
    event.blob.payloadLength !== BigInt(getBytes(payload).length)
  ) {
    throw withConfirmedTransaction(
      new Error("Story receipt event differs from the frozen record"),
      transactionHash,
      "mismatch",
    );
  }
  return verifyConfirmedDetails(transactionHash, async () => {
    const recordRef = await readConfirmedDetails(transactionHash, () =>
      archive.storyRecordRef(tokenId, state.totalRecords, { blockTag: receipt.blockNumber }),
    );
    if (
      recordRef.blob.payloadHash !== payloadHash ||
      recordRef.blob.payloadLength !== BigInt(getBytes(payload).length)
    ) {
      throw new Error("Stored Story ref differs from the submitted canonical payload");
    }
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
    if (
      recordRef.schemaId !== STORY_ENVELOPE_SCHEMA_ID ||
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
      throw new Error(
        "Story receipt event differs from the submitted payload and stored reference",
      );
    }
    const result = await readStoryRecord({
      getCode: (address, blockTag) =>
        readConfirmedDetails(transactionHash, () => provider.getCode(address, blockTag)),
      recordRef,
      blockTag: receipt.blockNumber,
    }).catch((error) => {
      if (error?.code === "ARCHIVE_CODE_READ_FAILED")
        throw withConfirmedTransaction(error, transactionHash, "read");
      throw error;
    });
    const finalState = await readConfirmedDetails(transactionHash, () =>
      archive.storyState(tokenId, { blockTag: receipt.blockNumber }),
    );
    const expectedCount = state.totalRecords + 1n;
    if (
      finalState.totalRecords < expectedCount ||
      finalState.totalPayloadLength < state.totalPayloadLength + recordRef.blob.payloadLength ||
      (finalState.totalRecords === expectedCount &&
        (finalState.recordsHead !== newHead ||
          finalState.totalPayloadLength !==
            state.totalPayloadLength + recordRef.blob.payloadLength))
    ) {
      throw new Error("Stored Story state differs from the confirmed record");
    }
    return { tx, receipt, transactionHash, recordRef, record: result, payload, ...gas };
  });
}

export async function sealArchiveStory({ archive, tokenId }) {
  const state = await runChainRead({ read: () => archive.storyState(tokenId) });
  const args = Object.freeze([tokenId, state.totalRecords, state.recordsHead]);
  const author = await archive.runner.getAddress();
  const archiveAddress = await archive.getAddress();
  const gas = await estimateArchiveCall({
    method: archive.sealStory,
    args,
    provider: archive.runner.provider,
  });
  const { transaction: tx, receipt, transactionHash } = await executeChainTransaction({
    provider: archive.runner.provider,
    send: () => archive.sealStory(...args, { gasLimit: gas.gasLimit }),
    label: "seal-story",
  });
  const events = receiptEvents(receipt, archive, archiveAddress, "StorySealed", tokenId);
  const event = events[0]?.args;
  if (
    events.length !== 1 ||
    event.totalRecords !== state.totalRecords ||
    event.recordsHead !== state.recordsHead ||
    event.totalPayloadLength !== state.totalPayloadLength ||
    event.sealer.toLowerCase() !== author.toLowerCase()
  ) {
    throw withConfirmedTransaction(
      new Error("Story seal receipt event differs from the submitted state"),
      transactionHash,
      "mismatch",
    );
  }
  return verifyConfirmedDetails(transactionHash, async () => {
    const final = await readConfirmedDetails(transactionHash, () =>
      archive.storyState(tokenId, { blockTag: receipt.blockNumber }),
    );
    if (
      event.timestamp !== final.lastUpdateTime ||
      !final.isSealed ||
      final.recordsHead !== state.recordsHead ||
      final.totalRecords !== state.totalRecords ||
      final.totalPayloadLength !== state.totalPayloadLength
    ) {
      throw new Error("Story seal receipt/state reconciliation failed");
    }
    return { tx, receipt, transactionHash, state: final, ...gas };
  });
}
