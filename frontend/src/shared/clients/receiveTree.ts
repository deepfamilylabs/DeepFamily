import {
  createLineageTree,
  hashLineageNodes,
  SNARK_SCALAR_FIELD,
  type LineageTree,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, toQuantity, toBeHex, type Contract, type Provider } from "ethers";
import { getEventScanConfig } from "../config/env";

export type ReceiveTreeAnchor = { blockNumber: number; blockHash: string };
export type ReceiveTreePath = {
  leaf: bigint;
  root: bigint;
  index: bigint;
  depth: bigint;
  siblings: bigint[];
};
type Snapshot = { tree: LineageTree; anchor: ReceiveTreeAnchor };
const snapshots = new Map<string, Snapshot>();
const pending = new Map<string, Promise<Snapshot>>();
const MAX_CACHE_ENTRIES = 12;
const MAX_CACHED_LEAVES = 100_000n;
const hashPattern = /^0x[0-9a-f]{64}$/iu;

function assertAnchorShape(anchor: ReceiveTreeAnchor) {
  if (
    !Number.isSafeInteger(anchor.blockNumber) ||
    anchor.blockNumber < 0 ||
    !hashPattern.test(anchor.blockHash)
  )
    throw new Error("Invalid receive tree anchor");
}
async function blockHash(provider: Provider, blockNumber: number): Promise<string> {
  // JsonRpcProvider's normal getBlock cache can otherwise hide a quick reorg.
  const rpc = provider as Provider & {
    send?: (method: string, parameters: unknown[]) => Promise<unknown>;
  };
  if (typeof rpc.send === "function") {
    const block = (await rpc.send("eth_getBlockByNumber", [toQuantity(blockNumber), false])) as {
      hash?: string;
      number?: string;
    } | null;
    if (
      !block?.hash ||
      !hashPattern.test(block.hash) ||
      getBigInt(block.number ?? -1) !== BigInt(blockNumber)
    )
      throw new Error("Receive tree anchor block is unavailable");
    return block.hash.toLowerCase();
  }
  const block = await provider.getBlock(blockNumber);
  if (!block?.hash || !hashPattern.test(block.hash) || block.number !== blockNumber)
    throw new Error("Receive tree anchor block is unavailable");
  return block.hash.toLowerCase();
}
export async function readReceiveTreeAnchor(provider: Provider): Promise<ReceiveTreeAnchor> {
  const rpc = provider as Provider & {
    send?: (method: string, parameters: unknown[]) => Promise<unknown>;
  };
  const blockNumber =
    typeof rpc.send === "function"
      ? Number(getBigInt((await rpc.send("eth_blockNumber", [])) as string))
      : await provider.getBlockNumber();
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
    throw new Error("Invalid receive tree block number");
  return { blockNumber, blockHash: await blockHash(provider, blockNumber) };
}
export async function assertReceiveTreeAnchor(
  provider: Provider,
  anchor: ReceiveTreeAnchor,
): Promise<void> {
  assertAnchorShape(anchor);
  if ((await blockHash(provider, anchor.blockNumber)) !== anchor.blockHash.toLowerCase())
    throw new Error("Receive tree anchor was reorganized; retry synchronization");
}
function field(value: unknown, label: string, nonzero = false) {
  const parsed = getBigInt(value as bigint);
  if (parsed < 0n || parsed >= SNARK_SCALAR_FIELD || (nonzero && parsed === 0n))
    throw new Error(`Noncanonical receive tree ${label}`);
  return parsed;
}

/** Shared validation for explicit chain getters and untrusted proof APIs. */
export function validateReceiveTreePath(
  value: unknown,
  expectedRoot: bigint,
  maxDepth: 32 | 64,
  slot?: { leafIndex: bigint; size: bigint },
): ReceiveTreePath {
  if (!value || typeof value !== "object" || (maxDepth !== 32 && maxDepth !== 64))
    throw new Error("Invalid receive tree path");
  const input = value as Record<string, unknown>;
  const root = field(input.root, "root", true);
  const leaf = field(input.leaf, "leaf", true);
  const index = getBigInt(input.index as bigint);
  const depth = getBigInt(input.depth as bigint);
  if (
    root !== field(expectedRoot, "expected root", true) ||
    depth < 0n ||
    depth > BigInt(maxDepth) ||
    !Array.isArray(input.siblings) ||
    input.siblings.length !== Number(depth) ||
    index < 0n ||
    index >= 1n << depth
  )
    throw new Error("Invalid receive tree membership path");
  if (slot) {
    if (slot.leafIndex < 0n || slot.leafIndex >= slot.size || slot.size > 1n << BigInt(maxDepth))
      throw new Error("Invalid receive tree leaf slot");
    let position = slot.leafIndex,
      width = slot.size,
      wantedDepth = 0n,
      wantedIndex = 0n;
    while (width > 1n) {
      if ((position & 1n) !== 0n || position + 1n < width) {
        if ((position & 1n) !== 0n) wantedIndex |= 1n << wantedDepth;
        wantedDepth++;
      }
      position >>= 1n;
      width = (width + 1n) >> 1n;
    }
    if (depth !== wantedDepth || index !== wantedIndex)
      throw new Error("Receive tree path belongs to another leaf slot");
  }
  const siblings = input.siblings.map((sibling) => field(sibling, "sibling"));
  let node = leaf;
  for (let level = 0; level < siblings.length; level++)
    node =
      (index >> BigInt(level)) & 1n
        ? hashLineageNodes(siblings[level], node)
        : hashLineageNodes(node, siblings[level]);
  if (node !== root) throw new Error("Receive tree path does not authenticate its leaf");
  return { leaf, root, index, depth, siblings };
}
function remember(scope: string, snapshot: Snapshot) {
  const existing = snapshots.get(scope);
  if (existing && existing.anchor.blockNumber > snapshot.anchor.blockNumber) return;
  if (snapshot.tree.sizeBigInt > MAX_CACHED_LEAVES) return;
  snapshots.delete(scope);
  snapshots.set(scope, snapshot);
  let leaves = [...snapshots.values()].reduce((sum, item) => sum + item.tree.sizeBigInt, 0n);
  while (snapshots.size > MAX_CACHE_ENTRIES || leaves > MAX_CACHED_LEAVES) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    leaves -= snapshots.get(oldest)!.tree.sizeBigInt;
    snapshots.delete(oldest);
  }
}

/** All rebuild requests replay public partitions, never a requested recipient index. */
export async function readReceiveTreePath(input: {
  contract: Contract;
  chainId: bigint;
  anchor: ReceiveTreeAnchor;
  mode: "rebuild" | "chain";
  treeId?: 0 | 1;
  leafIndex: bigint;
}): Promise<ReceiveTreePath> {
  const { contract, chainId, anchor, mode, treeId, leafIndex } = input;
  assertAnchorShape(anchor);
  if (mode !== "rebuild" && mode !== "chain") throw new Error("Unsupported receive tree read mode");
  if (treeId !== undefined && treeId !== 0 && treeId !== 1)
    throw new Error("Invalid receive source tree");
  if (typeof leafIndex !== "bigint" || leafIndex < 0n)
    throw new Error("Invalid receive tree leaf index");
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Receive tree requires a provider");
  if (chainId <= 0n || (await provider.getNetwork()).chainId !== chainId)
    throw new Error("Receive tree belongs to another chain");
  await assertReceiveTreeAnchor(provider, anchor);
  const source = treeId !== undefined;
  const maxDepth = source ? 64 : 32;
  const overrides = { blockTag: anchor.blockNumber };
  const [rawCount, rawRoot] = await Promise.all(
    source
      ? [
          contract.sourceSize(treeId, overrides),
          treeId === 0 ? contract.sourceRoot(overrides) : contract.trustedRoot(overrides),
        ]
      : [contract.credentialCount(overrides), contract.issuanceRoot(overrides)],
  );
  const count = getBigInt(rawCount);
  const root = field(rawRoot, "root");
  if (count < 0n || count > 1n << BigInt(maxDepth) || (count === 0n) !== (root === 0n))
    throw new Error("Invalid receive tree state");
  if (leafIndex >= count) throw new Error("Receive tree leaf index is out of range");
  if (mode === "chain") {
    const path = source
      ? await contract.getSourceProof(treeId, leafIndex, overrides)
      : await contract.getCredentialProof(leafIndex, overrides);
    const validated = validateReceiveTreePath(path, root, maxDepth, { leafIndex, size: count });
    await assertReceiveTreeAnchor(provider, anchor);
    return validated;
  }

  const configured = getEventScanConfig();
  const fromBlock = configured.fromBlock;
  const blockChunk = configured.blockChunk;
  if (
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    !Number.isSafeInteger(blockChunk) ||
    blockChunk < 1
  )
    throw new Error("Invalid receive tree replay range");
  const address = getAddress(await contract.getAddress());
  const scope = `${chainId}:${address.toLowerCase()}:${treeId ?? "q"}:${fromBlock}`;
  const job = `${scope}:${anchor.blockNumber}:${anchor.blockHash.toLowerCase()}`;
  let replay = pending.get(job);
  if (!replay) {
    replay = (async () => {
      const cached = snapshots.get(scope);
      let previous: Snapshot | undefined;
      if (cached && cached.anchor.blockNumber <= anchor.blockNumber) {
        if ((await blockHash(provider, cached.anchor.blockNumber)) === cached.anchor.blockHash)
          previous = cached;
        else if (snapshots.get(scope) === cached) snapshots.delete(scope);
      }
      const tree = previous?.tree.clone() ?? createLineageTree();
      const eventName = source ? "SourceLeafPublished" : "CredentialIssued";
      const event = contract.interface.getEvent(eventName);
      if (!event) throw new Error("Receive tree event ABI is missing");
      const topics = source ? [event.topicHash, toBeHex(treeId, 32)] : [event.topicHash];
      const startBlock = previous ? previous.anchor.blockNumber + 1 : fromBlock;
      let lastPosition: { block: number; index: number } | undefined;
      for (let start = startBlock; start <= anchor.blockNumber; start += blockChunk) {
        const end = Math.min(anchor.blockNumber, start + blockChunk - 1);
        const logs = await provider.getLogs({ address, topics, fromBlock: start, toBlock: end });
        logs.sort(
          (left, right) => left.blockNumber - right.blockNumber || left.index - right.index,
        );
        for (const log of logs) {
          if (
            log.removed ||
            getAddress(log.address) !== address ||
            !Number.isSafeInteger(log.blockNumber) ||
            log.blockNumber < start ||
            log.blockNumber > end ||
            !Number.isSafeInteger(log.index) ||
            log.index < 0 ||
            (lastPosition &&
              log.blockNumber === lastPosition.block &&
              log.index <= lastPosition.index) ||
            (log.blockNumber === anchor.blockNumber &&
              log.blockHash.toLowerCase() !== anchor.blockHash.toLowerCase())
          )
            throw new Error("Invalid receive tree event position");
          const parsed = contract.interface.parseLog(log);
          if (
            !parsed ||
            parsed.name !== eventName ||
            (source && getBigInt(parsed.args.treeId) !== BigInt(treeId))
          )
            throw new Error("Unexpected receive tree event");
          const eventIndex = getBigInt(parsed.args.leafIndex);
          const leaf = field(
            source ? parsed.args.leaf : parsed.args.credential,
            "event leaf",
            true,
          );
          if (eventIndex !== tree.sizeBigInt || tree.sizeBigInt >= 1n << BigInt(maxDepth))
            throw new Error("Receive tree append sequence is incomplete");
          tree.insert(leaf);
          if (tree.root !== field(parsed.args.root, "event root", true))
            throw new Error("Receive tree event root does not match replay");
          lastPosition = { block: log.blockNumber, index: log.index };
        }
      }
      if (tree.sizeBigInt !== count || tree.root !== root)
        throw new Error("Receive tree history does not match anchored state");
      await assertReceiveTreeAnchor(provider, anchor);
      const result = { tree, anchor: { ...anchor, blockHash: anchor.blockHash.toLowerCase() } };
      remember(scope, result);
      return result;
    })();
    pending.set(job, replay);
  }
  let snapshot: Snapshot;
  try {
    snapshot = await replay;
  } finally {
    if (pending.get(job) === replay) pending.delete(job);
  }
  if (snapshot.tree.sizeBigInt !== count || snapshot.tree.root !== root)
    throw new Error("Concurrent receive tree state does not match anchored state");
  const proof = snapshot.tree.generateProof(leafIndex);
  const validated = validateReceiveTreePath(
    { ...proof, depth: BigInt(proof.siblings.length) },
    root,
    maxDepth,
    { leafIndex, size: count },
  );
  await assertReceiveTreeAnchor(provider, anchor);
  return validated;
}
