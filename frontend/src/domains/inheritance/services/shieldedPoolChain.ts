import {
  computeShieldedCiphertextHashField,
  createLineageTree,
  type LineageTree,
} from "@deepfamily/protocol-core";
import { getBytes, type Contract, type Log } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";

const MAX_SHARD_LEAVES = 1n << 32n;

export type PublicShieldedNote = {
  shardId: bigint;
  leafIndex: bigint;
  commitment: bigint;
  root: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
  blockNumber: number;
  logIndex: number;
  transactionHash?: string;
  /** Public atomic action boundary, independent of transaction batching. */
  action?: number;
  actionLogIndex?: number;
  outputIndex?: number;
};

export type OwnedShieldedNote<T> = PublicShieldedNote & { note: T };

/** A null result means this ciphertext cannot be opened with the local viewing key. */
export type ShieldedNoteDecoder<T> = (
  event: PublicShieldedNote,
) => Promise<{ note: T; commitment: bigint } | null>;

export type ShieldedPoolSnapshot<T> = {
  poolAddress: string;
  chainId: bigint;
  toBlock: number;
  blockHash: string;
  shards: Map<bigint, LineageTree>;
  ownedNotes: Map<bigint, OwnedShieldedNote<T>>;
  spentNullifiers: Set<bigint>;
  /** Incremental replay transfers the mutable state to a new snapshot. */
  invalidated?: boolean;
};

type ScanOptions<T> = {
  fromBlock?: number;
  /** Fix all reads and event replay to the factory's per-chain recovery anchor. */
  toBlock?: number;
  blockChunk?: number;
  previous?: ShieldedPoolSnapshot<T>;
};

/**
 * Replay all public note and nullifier logs with no indexed recipient/leaf filter.
 * A caller may reuse an in-memory snapshot to read only newer blocks. If the cache
 * is cleared or its block was reorganized, replay from the deployment block.
 * The decoder receives every ciphertext locally and must recompute its note commitment.
 */
export async function loadShieldedPoolSnapshot<T>(
  pool: Contract,
  decode: ShieldedNoteDecoder<T>,
  options: ScanOptions<T> = {},
): Promise<ShieldedPoolSnapshot<T>> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Shielded pool has no provider");
  const poolAddress = (await pool.getAddress()).toLowerCase();
  const chainId = (await provider.getNetwork()).chainId;
  const toBlock = options.toBlock ?? (await provider.getBlockNumber());
  if (!Number.isSafeInteger(toBlock) || toBlock < 0) throw new Error("Invalid shielded scan block");
  const anchor = await provider.getBlock(toBlock);
  if (!anchor?.hash) throw new Error("Shielded pool scan block is unavailable");
  // Lightweight test doubles have no protocolVersion method. Actual pool
  // contracts must expose the complete public nullifier count and action ABI.
  const protocolVersion =
    typeof pool.protocolVersion === "function"
      ? Number(await pool.protocolVersion({ blockTag: toBlock }))
      : undefined;
  const previous = options.previous;
  if (previous?.invalidated)
    throw new Error("Shielded pool snapshot is invalid; replay from deployment block");
  if (previous && (previous.poolAddress !== poolAddress || previous.chainId !== chainId)) {
    throw new Error("Shielded pool snapshot belongs to another chain or contract");
  }
  if (previous) {
    const ancestor = await provider.getBlock(previous.toBlock);
    if (!ancestor || ancestor.hash !== previous.blockHash || previous.toBlock > toBlock) {
      throw new Error("Shielded pool snapshot was reorganized; replay from deployment block");
    }
  }
  const configured = getEventScanConfig();
  const fromBlock = previous
    ? previous.toBlock + 1
    : Math.max(0, options.fromBlock ?? configured.fromBlock);
  const blockChunk = Math.max(1, options.blockChunk ?? configured.blockChunk);
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(blockChunk))
    throw new Error("Invalid shielded replay block range");
  const noteEvent = pool.interface.getEvent("NoteAppended");
  const spentEvent = pool.interface.getEvent("NullifierSpent");
  const actionEvent = pool.interface.getEvent("ActionExecuted");
  if (!noteEvent || !spentEvent) throw new Error("Shielded pool ABI is missing public events");
  if (protocolVersion === 1 && (!actionEvent || typeof pool.nullifierCount !== "function"))
    throw new Error("Shielded pool recovery ABI is incomplete");

  const shards = previous?.shards ?? new Map<bigint, LineageTree>();
  const ownedNotes = previous?.ownedNotes ?? new Map<bigint, OwnedShieldedNote<T>>();
  const spentNullifiers = previous?.spentNullifiers ?? new Set<bigint>();
  let actionBoundary:
    | { action: number; transactionHash: string; logIndex: number; outputIndex: number }
    | undefined;
  try {
    for (let start = fromBlock; start <= toBlock; start += blockChunk) {
      const logs = await provider.getLogs({
        address: poolAddress,
        topics: [
          [
            noteEvent.topicHash,
            spentEvent.topicHash,
            ...(actionEvent ? [actionEvent.topicHash] : []),
          ],
        ],
        fromBlock: start,
        toBlock: Math.min(toBlock, start + blockChunk - 1),
      });
      logs.sort((a: Log, b: Log) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const log of logs) {
        const parsed = pool.interface.parseLog(log);
        if (!parsed) throw new Error("Unrecognized shielded pool log");
        if (parsed.name === "ActionExecuted") {
          const action = Number(parsed.args.action);
          if (!Number.isInteger(action) || action < 0 || action > 4 || !log.transactionHash)
            throw new Error("Invalid shielded action boundary");
          actionBoundary = {
            action,
            transactionHash: log.transactionHash,
            logIndex: log.index,
            outputIndex: 0,
          };
          continue;
        }
        if (parsed.name === "NullifierSpent") {
          const nullifier = BigInt(parsed.args.nullifier);
          if (spentNullifiers.has(nullifier)) throw new Error("Repeated shielded nullifier event");
          spentNullifiers.add(nullifier);
          continue;
        }
        if (parsed.name !== "NoteAppended") throw new Error("Unexpected shielded pool log");
        const boundary =
          actionBoundary &&
          actionBoundary.transactionHash === log.transactionHash &&
          actionBoundary.outputIndex < 2
            ? actionBoundary
            : undefined;
        if (protocolVersion === 1 && !boundary)
          throw new Error("Shielded pool action history is incomplete");
        const shardId = BigInt(parsed.args.shardId);
        const leafIndex = BigInt(parsed.args.leafIndex);
        const commitment = BigInt(parsed.args.commitment);
        const root = BigInt(parsed.args.root);
        const ciphertext = getBytes(parsed.args.ciphertext);
        if (ciphertext.length !== 512) throw new Error("Invalid shielded note ciphertext length");
        let tree = shards.get(shardId);
        if (!tree) {
          if (shardId !== BigInt(shards.size))
            throw new Error("Shielded note shard sequence skipped");
          if (shardId > 0n && shards.get(shardId - 1n)?.sizeBigInt !== MAX_SHARD_LEAVES) {
            throw new Error("Shielded note shard rotated before reaching capacity");
          }
          tree = createLineageTree();
          shards.set(shardId, tree);
        }
        if (leafIndex !== tree.sizeBigInt || tree.sizeBigInt >= MAX_SHARD_LEAVES) {
          throw new Error("Shielded note leaf sequence is invalid");
        }
        tree.insert(commitment);
        if (tree.root !== root) throw new Error("Shielded note event root does not match replay");
        const event: PublicShieldedNote = {
          shardId,
          leafIndex,
          commitment,
          root,
          ciphertext,
          ciphertextHashField: computeShieldedCiphertextHashField(ciphertext),
          blockNumber: log.blockNumber,
          logIndex: log.index,
          transactionHash: log.transactionHash,
          ...(boundary
            ? {
                action: boundary.action,
                actionLogIndex: boundary.logIndex,
                outputIndex: boundary.outputIndex++,
              }
            : {}),
        };
        const opened = await decode(event);
        if (opened) {
          if (opened.commitment !== commitment) {
            throw new Error("Decrypted shielded note does not match its public commitment");
          }
          ownedNotes.set(commitment, { ...event, note: opened.note });
        }
      }
    }

    const currentShardId = BigInt(await pool.currentShardId({ blockTag: toBlock }));
    if (
      shards.size !== Number(currentShardId + 1n) &&
      !(shards.size === 0 && currentShardId === 0n)
    ) {
      throw new Error("Shielded pool event history is incomplete");
    }
    for (let shardId = 0n; shardId <= currentShardId; shardId += 1n) {
      const onChain = await pool.noteShard(shardId, { blockTag: toBlock });
      const tree = shards.get(shardId);
      if (
        BigInt(onChain.size) !== (tree?.sizeBigInt ?? 0n) ||
        BigInt(onChain.root) !== (tree?.root ?? 0n)
      ) {
        throw new Error(`Shielded pool shard ${shardId} does not match chain state`);
      }
    }
    if (
      protocolVersion === 1 &&
      BigInt(await pool.nullifierCount({ blockTag: toBlock })) !== BigInt(spentNullifiers.size)
    )
      throw new Error("Shielded pool nullifier history is incomplete");
    const block = await provider.getBlock(toBlock);
    if (!block?.hash || block.hash !== anchor.hash)
      throw new Error("Shielded pool scan block was reorganized");
    // Replaying in place avoids copying every tree node and note. The prior
    // snapshot's block metadata is now stale, so it must never be reused.
    if (previous) previous.invalidated = true;
    return {
      poolAddress,
      chainId,
      toBlock,
      blockHash: block.hash,
      shards,
      ownedNotes,
      spentNullifiers,
    };
  } catch (error) {
    if (previous) previous.invalidated = true;
    throw error;
  }
}

/** Build an owned note's compact path locally, without a leaf-index RPC request. */
export function getLocalShieldedNoteProof<T>(
  snapshot: ShieldedPoolSnapshot<T>,
  commitment: bigint,
) {
  if (snapshot.invalidated) throw new Error("Shielded pool snapshot is invalid");
  const owned = snapshot.ownedNotes.get(commitment);
  if (!owned) throw new Error("Shielded note is not in the local wallet");
  const tree = snapshot.shards.get(owned.shardId);
  if (!tree) throw new Error("Shielded note shard is missing");
  if (tree.sizeBigInt < 2n) throw new Error("Single-leaf note roots cannot be spent privately");
  const proof = tree.generateProof(owned.leafIndex);
  if (proof.leaf !== commitment || proof.siblings.length > 32) {
    throw new Error("Shielded note local Merkle proof is invalid");
  }
  return {
    shardId: owned.shardId,
    root: proof.root,
    proofIndex: BigInt(proof.index),
    proofDepth: proof.siblings.length,
    siblings: [...proof.siblings, ...Array<bigint>(32 - proof.siblings.length).fill(0n)],
  };
}
