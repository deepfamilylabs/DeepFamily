import { createLineageTree, type LineageTree } from "@deepfamily/protocol-core";
import { getBytes, type Contract, type Log } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";
import type { PublicPoolActionObservation } from "./shieldedPublicObserverAudit";

const MAX_SHARD_LEAVES = 1n << 32n;
const CIPHERTEXT_BYTES = 512;
const MAX_ACTION = 5;

export type PublicPoolObservationSnapshot = {
  poolAddress: string;
  chainId: bigint;
  deploymentBlock: number;
  toBlock: number;
  blockHash: string;
  actions: PublicPoolActionObservation[];
  /** True only after deployment-code, all-event, receipt, and shard-root checks. */
  historyVerifiedFromDeployment: true;
};

function blockNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

/**
 * Replay every ActionExecuted/NoteAppended log from pool deployment, matching
 * each action event to its next two output notes. This works for contract-wallet
 * callers and multiple pool calls inside one transaction; it never needs the
 * top-level transaction calldata. Receipt and pinned shard-root checks fail
 * closed on missing or reordered logs. `deploymentBlock` must be exact.
 * Queries filter only by pool address and these public event types, never a
 * child, leaf index, commitment, or recipient.
 */
export async function loadPublicPoolActionObservations(
  pool: Contract,
  options: { deploymentBlock: number; throughBlock?: number; blockChunk?: number },
): Promise<PublicPoolObservationSnapshot> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Shielded pool has no provider");
  const deploymentBlock = blockNumber(options.deploymentBlock, "deploymentBlock");
  const toBlock = blockNumber(
    options.throughBlock ?? (await provider.getBlockNumber()),
    "throughBlock",
  );
  if (toBlock < deploymentBlock) throw new Error("Scan ends before the pool deployment block");
  const blockChunk = blockNumber(
    options.blockChunk ?? getEventScanConfig().blockChunk,
    "blockChunk",
  );
  if (blockChunk === 0) throw new Error("blockChunk must be positive");
  const poolAddress = (await pool.getAddress()).toLowerCase();
  const chainId = (await provider.getNetwork()).chainId;
  const anchor = await provider.getBlock(toBlock);
  if (!anchor?.hash) throw new Error("Pool scan anchor block is unavailable");
  const deployedCode = await provider.getCode(poolAddress, deploymentBlock);
  const priorCode =
    deploymentBlock === 0 ? "0x" : await provider.getCode(poolAddress, deploymentBlock - 1);
  if (deployedCode === "0x" || priorCode !== "0x") {
    throw new Error("deploymentBlock does not identify the pool's first code block");
  }
  const actionEvent = pool.interface.getEvent("ActionExecuted");
  const noteEvent = pool.interface.getEvent("NoteAppended");
  if (!actionEvent || !noteEvent) {
    throw new Error("Shielded pool ABI is missing public action or note events");
  }
  const publicTopics = new Set([actionEvent.topicHash, noteEvent.topicHash]);
  const shards = new Map<bigint, LineageTree>();
  const receiptLogs = new Map<string, Log[]>();
  const actions: PublicPoolActionObservation[] = [];
  let pending:
    | {
        txHash: string;
        blockNumber: number;
        actionLogIndex: number;
        action: PublicPoolActionObservation["action"];
        inputShardIds: readonly [bigint, bigint];
        outputs: Array<PublicPoolActionObservation["outputs"][number]>;
      }
    | undefined;

  for (let start = deploymentBlock; start <= toBlock; start += blockChunk) {
    const end = Math.min(toBlock, start + blockChunk - 1);
    const logs = await provider.getLogs({
      address: poolAddress,
      topics: [[actionEvent.topicHash, noteEvent.topicHash]],
      fromBlock: start,
      toBlock: end,
    });
    logs.sort(
      (left: Log, right: Log) => left.blockNumber - right.blockNumber || left.index - right.index,
    );
    for (const log of logs) {
      if (
        log.address.toLowerCase() !== poolAddress ||
        log.blockNumber < start ||
        log.blockNumber > end ||
        !publicTopics.has(log.topics[0])
      ) {
        throw new Error("Pool event is outside the requested public scan");
      }
      const txHash = log.transactionHash.toLowerCase();
      const logsForReceipt = receiptLogs.get(txHash) ?? [];
      logsForReceipt.push(log);
      receiptLogs.set(txHash, logsForReceipt);
      const parsed = pool.interface.parseLog(log);
      if (!parsed) throw new Error("Unrecognized public pool event");
      if (parsed.name === "ActionExecuted") {
        if (pending) throw new Error("Pool action boundary appeared before two output notes");
        const rawAction = Number(parsed.args.action);
        if (!Number.isInteger(rawAction) || rawAction < 0 || rawAction > MAX_ACTION) {
          throw new Error("Pool action event has an unknown action code");
        }
        if (
          rawAction === 5 &&
          (BigInt(parsed.args.inputShardId0) !== 0n || BigInt(parsed.args.inputShardId1) !== 0n)
        ) {
          throw new Error("Public budget claim must have empty shielded input slots");
        }
        pending = {
          txHash,
          blockNumber: log.blockNumber,
          actionLogIndex: log.index,
          action: rawAction as PublicPoolActionObservation["action"],
          inputShardIds: [BigInt(parsed.args.inputShardId0), BigInt(parsed.args.inputShardId1)],
          outputs: [],
        };
        continue;
      }
      if (parsed.name !== "NoteAppended") throw new Error("Unexpected public pool event");
      if (!pending || pending.txHash !== txHash || pending.blockNumber !== log.blockNumber) {
        throw new Error("Pool note event has no matching action boundary");
      }
      const shardId = BigInt(parsed.args.shardId);
      const leafIndex = BigInt(parsed.args.leafIndex);
      const commitment = BigInt(parsed.args.commitment);
      const root = BigInt(parsed.args.root);
      if (getBytes(parsed.args.ciphertext).length !== CIPHERTEXT_BYTES) {
        throw new Error("Pool note log has invalid ciphertext length");
      }
      let tree = shards.get(shardId);
      if (!tree) {
        if (
          shardId !== BigInt(shards.size) ||
          (shardId > 0n && shards.get(shardId - 1n)?.sizeBigInt !== MAX_SHARD_LEAVES)
        ) {
          throw new Error("Pool note shard sequence is invalid");
        }
        tree = createLineageTree();
        shards.set(shardId, tree);
      }
      if (tree.sizeBigInt !== leafIndex || tree.sizeBigInt >= MAX_SHARD_LEAVES) {
        throw new Error("Pool note leaf sequence is invalid");
      }
      tree.insert(commitment);
      if (tree.root !== root) throw new Error("Pool note root does not match event replay");
      pending.outputs.push({ commitment, shardId });
      if (pending.outputs.length === 2) {
        actions.push({
          txHash,
          actionLogIndex: pending.actionLogIndex,
          action: pending.action,
          inputShardIds: pending.inputShardIds,
          outputs: [pending.outputs[0], pending.outputs[1]],
        });
        pending = undefined;
      }
    }
  }
  if (pending) throw new Error("Pool action ended without two output notes");

  const currentShardId = BigInt(await pool.currentShardId({ blockTag: toBlock }));
  if (
    shards.size !== Number(currentShardId + 1n) &&
    !(shards.size === 0 && currentShardId === 0n)
  ) {
    throw new Error("Pool note event history is incomplete");
  }
  for (let shardId = 0n; shardId <= currentShardId; shardId += 1n) {
    const onChain = await pool.noteShard(shardId, { blockTag: toBlock });
    const tree = shards.get(shardId);
    if (
      BigInt(onChain.size) !== (tree?.sizeBigInt ?? 0n) ||
      BigInt(onChain.root) !== (tree?.root ?? 0n)
    ) {
      throw new Error(`Pool shard ${shardId} does not match chain state`);
    }
  }

  for (const [txHash, observedLogs] of receiptLogs) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (
      !receipt ||
      receipt.status !== 1 ||
      receipt.hash.toLowerCase() !== txHash ||
      receipt.blockNumber !== observedLogs[0].blockNumber ||
      observedLogs.some(
        (log) => log.blockNumber !== receipt.blockNumber || log.blockHash !== receipt.blockHash,
      )
    ) {
      throw new Error("Pool action receipt is missing or inconsistent");
    }
    const actualLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === poolAddress && publicTopics.has(log.topics[0]),
    );
    if (
      actualLogs.length !== observedLogs.length ||
      actualLogs.some(
        (log, index) =>
          log.index !== observedLogs[index].index ||
          log.data !== observedLogs[index].data ||
          log.topics.length !== observedLogs[index].topics.length ||
          log.topics.some((topic, topicIndex) => topic !== observedLogs[index].topics[topicIndex]),
      )
    ) {
      throw new Error("Pool public events do not match the successful receipt");
    }
  }
  const finalAnchor = await provider.getBlock(toBlock);
  if (!finalAnchor?.hash || finalAnchor.hash !== anchor.hash) {
    throw new Error("Pool scan anchor block was reorganized");
  }
  return {
    poolAddress,
    chainId,
    deploymentBlock,
    toBlock,
    blockHash: anchor.hash,
    actions,
    historyVerifiedFromDeployment: true,
  };
}
