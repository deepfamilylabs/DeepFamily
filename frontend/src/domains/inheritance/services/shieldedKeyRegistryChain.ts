import {
  computeShieldedRegistrationLeaf,
  createLineageTree,
  type LineageTree,
} from "@deepfamily/protocol-core";
import { keccak256, toBeHex, zeroPadValue, type Contract, type Log } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";

const MAX_SHARD_LEAVES = 1n << 32n;

export type PublicHeirKey = {
  personHash: string;
  identityCommitment: bigint;
  ownerCommitment: bigint;
  viewingKey: string;
  shardId: bigint;
  leafIndex: bigint;
  leaf: bigint;
};

export type KeyRegistrySnapshot = {
  registryAddress: string;
  chainId: bigint;
  toBlock: number;
  blockHash: string;
  shards: Map<bigint, LineageTree>;
  keys: Map<string, PublicHeirKey>;
  invalidated?: boolean;
};

type ScanOptions = {
  fromBlock?: number;
  blockChunk?: number;
  previous?: KeyRegistrySnapshot;
};

/** Read every public key event so a shared RPC sees no target child's identity query. */
export async function loadKeyRegistrySnapshot(
  registry: Contract,
  options: ScanOptions = {},
): Promise<KeyRegistrySnapshot> {
  const provider = registry.runner?.provider;
  if (!provider) throw new Error("Key registry has no provider");
  const registryAddress = (await registry.getAddress()).toLowerCase();
  const chainId = (await provider.getNetwork()).chainId;
  const toBlock = await provider.getBlockNumber();
  const previous = options.previous;
  if (previous?.invalidated) throw new Error("Key registry snapshot is invalid");
  if (previous && (previous.registryAddress !== registryAddress || previous.chainId !== chainId)) {
    throw new Error("Key registry snapshot belongs to another chain or contract");
  }
  if (previous) {
    const ancestor = await provider.getBlock(previous.toBlock);
    if (!ancestor || ancestor.hash !== previous.blockHash || previous.toBlock > toBlock) {
      throw new Error("Key registry snapshot was reorganized; replay from deployment block");
    }
  }

  const config = getEventScanConfig();
  const fromBlock = previous
    ? previous.toBlock + 1
    : Math.max(0, options.fromBlock ?? config.fromBlock);
  const blockChunk = Math.max(1, options.blockChunk ?? config.blockChunk);
  const registrationEvent = registry.interface.getEvent("ViewingKeyRegistered");
  const leafEvent = registry.interface.getEvent("KeyLeafAppended");
  if (!registrationEvent || !leafEvent)
    throw new Error("Key registry ABI is missing public events");
  const shards = previous?.shards ?? new Map<bigint, LineageTree>();
  const keys = previous?.keys ?? new Map<string, PublicHeirKey>();

  try {
    for (let start = fromBlock; start <= toBlock; start += blockChunk) {
      const logs = await provider.getLogs({
        address: registryAddress,
        topics: [[registrationEvent.topicHash, leafEvent.topicHash]],
        fromBlock: start,
        toBlock: Math.min(toBlock, start + blockChunk - 1),
      });
      logs.sort((a: Log, b: Log) => a.blockNumber - b.blockNumber || a.index - b.index);
      const pending = new Map<string, PublicHeirKey[]>();
      for (const log of logs) {
        const parsed = registry.interface.parseLog(log);
        if (!parsed) throw new Error("Unrecognized key registry log");
        const txHash = log.transactionHash.toLowerCase();
        if (parsed.name === "ViewingKeyRegistered") {
          const identityCommitment = BigInt(parsed.args.identityCommitment);
          const personHash = String(parsed.args.personHash).toLowerCase();
          if (
            keccak256(zeroPadValue(toBeHex(identityCommitment), 32)).toLowerCase() !== personHash
          ) {
            throw new Error("Key registry identity hash does not match commitment");
          }
          if (keys.has(personHash)) throw new Error("Duplicate key registration event");
          const viewingKey = String(parsed.args.viewingKey).toLowerCase();
          const ownerCommitment = BigInt(parsed.args.ownerCommitment);
          const key: PublicHeirKey = {
            personHash,
            identityCommitment,
            ownerCommitment,
            viewingKey,
            shardId: -1n,
            leafIndex: -1n,
            leaf: computeShieldedRegistrationLeaf({
              identityCommitment,
              ownerCommitment,
              viewKeyHi: BigInt(viewingKey) >> 128n,
              viewKeyLo: BigInt(viewingKey) & ((1n << 128n) - 1n),
            }),
          };
          const queue = pending.get(txHash) ?? [];
          queue.push(key);
          pending.set(txHash, queue);
          continue;
        }
        if (parsed.name !== "KeyLeafAppended") throw new Error("Unexpected key registry log");
        const key = pending.get(txHash)?.shift();
        if (!key) throw new Error("Key registry leaf has no matching registration");
        const shardId = BigInt(parsed.args.shardId);
        const leafIndex = BigInt(parsed.args.leafIndex);
        if (BigInt(parsed.args.leaf) !== key.leaf) {
          throw new Error("Key registry leaf does not match registration");
        }
        let tree = shards.get(shardId);
        if (!tree) {
          if (shardId !== BigInt(shards.size))
            throw new Error("Key registry shard sequence skipped");
          if (shardId > 0n && shards.get(shardId - 1n)?.sizeBigInt !== MAX_SHARD_LEAVES) {
            throw new Error("Key registry shard rotated before reaching capacity");
          }
          tree = createLineageTree();
          shards.set(shardId, tree);
        }
        if (leafIndex !== tree.sizeBigInt || tree.sizeBigInt >= MAX_SHARD_LEAVES) {
          throw new Error("Key registry leaf sequence is invalid");
        }
        tree.insert(key.leaf);
        if (tree.root !== BigInt(parsed.args.root)) {
          throw new Error("Key registry root does not match replay");
        }
        key.shardId = shardId;
        key.leafIndex = leafIndex;
        keys.set(key.personHash, key);
      }
      if ([...pending.values()].some((queue) => queue.length !== 0)) {
        throw new Error("Key registry registration has no matching leaf");
      }
    }
    const currentShardId = BigInt(await registry.currentShardId({ blockTag: toBlock }));
    if (
      shards.size !== Number(currentShardId + 1n) &&
      !(shards.size === 0 && currentShardId === 0n)
    ) {
      throw new Error("Key registry event history is incomplete");
    }
    for (let shardId = 0n; shardId <= currentShardId; shardId += 1n) {
      const onChain = await registry.keyShard(shardId, { blockTag: toBlock });
      const tree = shards.get(shardId);
      if (
        BigInt(onChain.size) !== (tree?.sizeBigInt ?? 0n) ||
        BigInt(onChain.root) !== (tree?.root ?? 0n)
      ) {
        throw new Error(`Key registry shard ${shardId} does not match chain state`);
      }
    }
    const block = await provider.getBlock(toBlock);
    if (!block?.hash) throw new Error("Key registry scan block is unavailable");
    // The maps and trees move to this snapshot; the prior block metadata no
    // longer describes their contents, even if no new event was observed.
    if (previous) previous.invalidated = true;
    return { registryAddress, chainId, toBlock, blockHash: block.hash, shards, keys };
  } catch (error) {
    if (previous) previous.invalidated = true;
    throw error;
  }
}

/** Local registry witness for Allocate/TopUp without querying the child's leaf slot. */
export function getLocalHeirKeyProof(snapshot: KeyRegistrySnapshot, personHash: string) {
  if (snapshot.invalidated) throw new Error("Key registry snapshot is invalid");
  const key = snapshot.keys.get(personHash.toLowerCase());
  if (!key) throw new Error("Heir has no registered viewing key");
  const tree = snapshot.shards.get(key.shardId);
  if (!tree) throw new Error("Key registry shard is missing");
  if (tree.sizeBigInt < 2n) {
    throw new Error("Key registry shard needs at least two keys before private allocation");
  }
  const proof = tree.generateProof(key.leafIndex);
  if (proof.leaf !== key.leaf || proof.siblings.length > 32) {
    throw new Error("Local key registry proof is invalid");
  }
  return {
    key,
    root: proof.root,
    shardId: key.shardId,
    proofIndex: BigInt(proof.index),
    proofDepth: proof.siblings.length,
    siblings: [...proof.siblings, ...Array<bigint>(32 - proof.siblings.length).fill(0n)],
  };
}
