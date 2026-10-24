import {
  MAX_UINT64,
  MAX_UINT256,
  SNARK_SCALAR_FIELD,
  bigintFrom,
  verifyShieldedIdentityAuthorizationWitness,
  type ShieldedIdentityAuthorizationWitness,
} from "@deepfamily/protocol-core";
import { getAddress, type BigNumberish, type Contract, type Provider } from "ethers";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { getEventScanConfig } from "../config/env";
import { reportPublicStateSyncProgress } from "../workers/publicStateSyncProgress";
import {
  openPublicStateStore,
  withPublicStateLock,
  PublicStateConflictError,
  type PublicStateHead,
  type PublicStatePending,
  type PublicStateReader,
  type PublicStateStore,
  type PublicStateWrite,
} from "./publicStateStore";
import type { ShieldedIdentityAuthorizationScope } from "./shieldedIdentityAuthorizationChain";

const PAGE = 256;
const KIND = "authorization-node";
const MAX_DELTA_BLOCKS = 128;
const MAX_DELTA_EVENTS = 4096;
type Node = { hash: bigint; key: bigint; counter: bigint; left: bigint; right: bigint };
type Metadata = { root: bigint; checkpointId: bigint; rootNodeId: bigint; nodeCount: bigint; asOf: bigint };
type Anchor = Omit<PublicStateHead, "dataset" | "revision">;
type Context = { contract: Contract; provider: Provider; chainId: bigint; address: string; creationBlock: number };
const ZERO: Node = Object.freeze({ hash: 0n, key: 0n, counter: 0n, left: 0n, right: 0n });
class AuthorizationCacheError extends Error {}
function local<T>(read: () => T): T {
  try { return read(); } catch (error) {
    throw new AuthorizationCacheError(error instanceof Error ? error.message : "Invalid authorization cache data");
  }
}
function cacheAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AuthorizationCacheError(message);
}
const field = (value: BigNumberish, label: string) => bigintFrom(value, label, SNARK_SCALAR_FIELD - 1n);
const uint64 = (value: BigNumberish, label: string) => bigintFrom(value, label, MAX_UINT64);
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function number(value: BigNumberish, label: string): number {
  const result = Number(bigintFrom(value, label, BigInt(Number.MAX_SAFE_INTEGER)));
  assert(Number.isSafeInteger(result), `Invalid ${label}`);
  return result;
}
function metadata(head: Pick<PublicStateHead, "data">): Metadata {
  const data = head.data as Record<string, string>;
  assert(data.formatVersion === "1", "Unsupported authorization cache format");
  const result = {
    root: field(data.root, "root"), checkpointId: bigintFrom(data.checkpointId, "checkpointId", MAX_UINT256),
    rootNodeId: uint64(data.rootNodeId, "rootNodeId"), nodeCount: uint64(data.nodeCount, "nodeCount"),
    asOf: uint64(data.asOf, "asOf"),
  };
  assert(result.checkpointId > 0n && result.rootNodeId <= result.nodeCount,
    "Invalid authorization snapshot header");
  assert((result.rootNodeId === 0n) === (result.nodeCount === 0n) &&
    (result.root === 0n) === (result.nodeCount === 0n), "Invalid empty authorization snapshot");
  number(result.nodeCount, "nodeCount");
  return result;
}
function data(meta: Metadata): Record<string, string> {
  return { formatVersion: "1", root: String(meta.root), checkpointId: String(meta.checkpointId),
    rootNodeId: String(meta.rootNodeId), nodeCount: String(meta.nodeCount), asOf: String(meta.asOf) };
}
function parseNode(input: Node, count: bigint): Node {
  assert(input && typeof input === "object", "Missing authorization cache node");
  const node: Node = { hash: field(input.hash, "node.hash"), key: field(input.key, "node.key"),
    counter: uint64(input.counter, "node.counter"), left: uint64(input.left, "node.left"),
    right: uint64(input.right, "node.right") };
  assert(node.hash !== 0n && node.left <= count && node.right <= count,
    "Invalid authorization node reference");
  if (node.counter !== 0n) {
    assert(node.key !== 0n && node.left === 0n && node.right === 0n &&
      poseidon3([node.key, node.counter, 1n]) === node.hash, "Invalid authorization leaf");
  } else assert(node.key === 0n && (node.left !== 0n || node.right !== 0n), "Invalid authorization branch");
  return node;
}
const write = (id: bigint, node: Node): PublicStateWrite => ({ kind: KIND, key: String(id), value: node });
type ReadNode = (id: bigint) => Promise<Node>;
function nodeReader(view: PublicStateReader, count: () => bigint, overlay?: Map<bigint, Node>): ReadNode {
  return async (id) => {
    if (id === 0n) return ZERO;
    cacheAssert(id > 0n && id <= count(), "Authorization node is outside the snapshot");
    // IDB failures remain storage errors; only malformed local values invalidate a dataset.
    const input = overlay?.get(id) ?? await view.get<Node>(KIND, String(id));
    return local(() => parseNode(input as Node, count()));
  };
}
async function checkedNode(read: ReadNode, id: bigint): Promise<Node> {
  const node = await read(id);
  if (id !== 0n && node.counter === 0n) {
    const [left, right] = await Promise.all([read(node.left), read(node.right)]);
    cacheAssert(poseidon2([left.hash, right.hash]) === node.hash, "Authorization branch hash is inconsistent");
    cacheAssert(!((node.left === 0n && right.counter !== 0n) || (node.right === 0n && left.counter !== 0n)),
      "Authorization leaf must be compressed");
  }
  return node;
}
async function scope(context: Context): Promise<void> {
  const [network, address] = await Promise.all([context.provider.getNetwork(), context.contract.getAddress()]);
  assert(BigInt(network.chainId) === context.chainId && getAddress(address) === context.address,
    "Authorization path scope changed while reading");
}
async function canonical(context: Context, head: Pick<PublicStateHead, "blockNumber" | "blockHash">): Promise<boolean> {
  const block = await context.provider.getBlock(head.blockNumber);
  assert(block?.hash, "Authorization checkpoint block is unavailable");
  return block.hash === head.blockHash;
}
async function readAnchor(context: Context, blockNumber: number): Promise<Anchor> {
  assert(Number.isSafeInteger(blockNumber) && blockNumber >= context.creationBlock,
    "Invalid authorization snapshot block");
  const block = await context.provider.getBlock(blockNumber);
  assert(block?.hash, "Authorization checkpoint block is unavailable");
  const overrides = { blockTag: blockNumber };
  const [header, rawRoot, rawCheckpoint] = await Promise.all([
    context.contract.getStateSnapshotHeader(overrides), context.contract.currentRoot(overrides),
    context.contract.currentCheckpointId(overrides),
  ]);
  assert(BigInt(header.formatVersion) === 1n, "Unsupported authorization snapshot format");
  const meta: Metadata = { root: field(header.root, "root"), checkpointId: bigintFrom(header.checkpointId, "checkpointId", MAX_UINT256),
    rootNodeId: uint64(header.rootNodeId, "rootNodeId"), nodeCount: uint64(header.nodeCount, "nodeCount"),
    asOf: uint64(block.timestamp, "asOf") };
  const anchor = { blockNumber, blockHash: block.hash, data: data(meta) };
  metadata(anchor);
  assert(meta.root === BigInt(rawRoot) && meta.checkpointId === BigInt(rawCheckpoint),
    "Authorization snapshot header does not match checkpoint");
  const checkpoint = await context.contract.getCheckpoint(meta.checkpointId, overrides);
  assert(BigInt(checkpoint.root) === meta.root && BigInt(checkpoint.createdAt) <= meta.asOf &&
    BigInt(checkpoint.retiredAt) === 0n, "Authorization checkpoint time is inconsistent");
  await scope(context);
  assert(await canonical(context, anchor), "Authorization checkpoint was reorganized");
  return anchor;
}
function sameMetadata(left: PublicStateHead | Anchor, right: PublicStateHead | Anchor) {
  return left.blockNumber === right.blockNumber && left.blockHash === right.blockHash &&
    JSON.stringify(left.data) === JSON.stringify(right.data);
}

/** Validate the complete canonical graph with a depth-bounded stack, never a full tree Map. */
async function verifyPending(store: PublicStateStore, pending: PublicStatePending): Promise<void> {
  const meta = metadata(pending);
  const stack = meta.rootNodeId === 0n ? [] : [{ id: meta.rootNodeId, depth: 0, prefix: 0n }];
  let visited = 0;
  const total = number(meta.nodeCount, "nodeCount");
  while (stack.length) {
    await store.read(pending, async (view) => {
      const read = nodeReader(view, () => meta.nodeCount);
      for (let step = 0; step < PAGE && stack.length; step++) {
        const next = stack.pop()!;
        assert(++visited <= total && next.depth <= 64, "Authorization snapshot has repeated or cyclic nodes");
        const node = await checkedNode(read, next.id);
        if (next.depth === 0) assert(node.hash === meta.root, "Authorization snapshot root does not match");
        if (node.counter !== 0n) {
          assert((node.key & ((1n << BigInt(next.depth)) - 1n)) === next.prefix,
            "Authorization leaf is on the wrong path");
        } else {
          assert(next.depth < 64, "Authorization snapshot exceeds path depth");
          if (node.right !== 0n) stack.push({ id: node.right, depth: next.depth + 1,
            prefix: next.prefix | (1n << BigInt(next.depth)) });
          if (node.left !== 0n) stack.push({ id: node.left, depth: next.depth + 1, prefix: next.prefix });
        }
      }
    }, true);
    reportPublicStateSyncProgress({ domain: "authorization", phase: "verify", completed: visited, total });
  }
  assert(visited === total, "Authorization snapshot contains unreachable nodes");
}

async function bootstrap(context: Context, store: PublicStateStore, latest: number): Promise<PublicStateHead> {
  const envelope = await store.envelope();
  let pending = envelope.pending;
  const resumed = Boolean(pending);
  assert(!pending || pending.blockNumber <= latest, "Authorization RPC head is behind its pending snapshot");
  if (pending && (pending.baseRevision !== (envelope.head?.revision ?? 0) || !await canonical(context, pending))) {
    await store.discardPending(pending);
    pending = undefined;
  }
  const anchor = await readAnchor(context, pending?.blockNumber ?? latest);
  if (pending && !sameMetadata(pending, anchor)) throw new Error("Authorization pending snapshot changed");
  pending ??= await store.startPending(anchor);
  const meta = metadata(pending);
  const total = number(meta.nodeCount, "nodeCount");
  let downloaded = pending.cursors.downloaded ?? 0;
  assert(Number.isSafeInteger(downloaded) && downloaded >= 0 && downloaded <= total,
    "Invalid authorization snapshot cursor");
  reportPublicStateSyncProgress({ domain: "authorization", phase: "download", completed: downloaded, total, resumed });
  while (downloaded < total) {
    const length = Math.min(PAGE, total - downloaded);
    const page = await context.contract.getNodePage(downloaded + 1, PAGE, { blockTag: pending.blockNumber });
    assert(Array.isArray(page) && page.length === length, "Authorization snapshot page is incomplete");
    const writes = page.map((node: Node, index: number) => write(BigInt(downloaded + index + 1), parseNode(node, meta.nodeCount)));
    assert(await canonical(context, pending), "Authorization snapshot was reorganized");
    await scope(context);
    downloaded += length;
    pending = await store.writePending(pending, writes, { downloaded });
    reportPublicStateSyncProgress({ domain: "authorization", phase: "download", completed: downloaded, total, resumed });
  }
  try {
    await verifyPending(store, pending);
  } catch (error) {
    // Only this candidate is discarded. Committed data is retained, and network
    // failures happen outside this local verification block.
    if (!(error instanceof PublicStateConflictError) && !(error instanceof DOMException))
      await store.discardPending(pending);
    throw error;
  }
  const final = await readAnchor(context, pending.blockNumber);
  assert(sameMetadata(pending, final), "Authorization snapshot changed while downloading");
  return store.finishPending(pending);
}

async function witnessFromNodes(read: ReadNode, meta: Metadata, alias: bigint): Promise<ShieldedIdentityAuthorizationWitness> {
  let id = meta.rootNodeId;
  let node = await checkedNode(read, id);
  cacheAssert(node.hash === meta.root, "Authorization cached root is inconsistent");
  const siblings: bigint[] = [];
  while (id !== 0n && node.counter === 0n) {
    cacheAssert(siblings.length < 64, "Authorization path exceeds supported depth");
    const right = (alias >> BigInt(siblings.length)) & 1n;
    siblings.push((await read(right ? node.left : node.right)).hash);
    id = right ? node.right : node.left;
    node = await checkedNode(read, id);
  }
  const present = id !== 0n && node.key === alias;
  return local(() => verifyShieldedIdentityAuthorizationWitness({ authorizationAlias: alias,
    authorizationCounter: present ? node.counter : 0n, stateRoot: meta.root,
    depth: BigInt(siblings.length), siblings: [...siblings, ...Array(64 - siblings.length).fill(0n)],
    oldKey: node.key, oldValue: node.counter, isOld0: id === 0n ? 1n : 0n,
    absent: present ? 0n : 1n }, meta.root, alias));
}

/** Mirror the contract's stable node IDs; all writes remain private until range verification. */
async function increment(read: ReadNode, meta: Metadata, dirty: Map<bigint, Node>, alias: bigint,
  oldCounter: bigint, newCounter: bigint): Promise<void> {
  const lookup = await witnessFromNodes(read, meta, alias);
  assert(lookup.authorizationCounter === oldCounter && newCounter === oldCounter + 1n,
    "Authorization counter history is inconsistent");
  const ancestors: bigint[] = [];
  let id = meta.rootNodeId;
  let node = await read(id);
  while (id !== 0n && node.counter === 0n) {
    ancestors.push(id);
    id = (alias >> BigInt(ancestors.length - 1)) & 1n ? node.right : node.left;
    node = await read(id);
  }
  const leaf = (): bigint => {
    const next = ++meta.nodeCount;
    dirty.set(next, { hash: poseidon3([alias, newCounter, 1n]), key: alias,
      counter: newCounter, left: 0n, right: 0n });
    return next;
  };
  const branch = async (left: bigint, right: bigint): Promise<bigint> => {
    const next = ++meta.nodeCount;
    dirty.set(next, { hash: poseidon2([(await read(left)).hash, (await read(right)).hash]),
      key: 0n, counter: 0n, left, right });
    return next;
  };
  let updated: bigint;
  if (id === 0n) updated = leaf();
  else if (node.key === alias) {
    updated = id;
    dirty.set(id, { ...node, counter: newCounter, hash: poseidon3([alias, newCounter, 1n]) });
  } else {
    let split = ancestors.length;
    while (split < 64 && ((node.key >> BigInt(split)) & 1n) === ((alias >> BigInt(split)) & 1n)) split++;
    assert(split < 64, "Authorization dictionary keys exceed the supported path depth");
    const next = leaf();
    updated = (alias >> BigInt(split)) & 1n ? await branch(id, next) : await branch(next, id);
    while (split > ancestors.length) {
      split--;
      updated = (alias >> BigInt(split)) & 1n ? await branch(0n, updated) : await branch(updated, 0n);
    }
  }
  for (let depth = ancestors.length - 1; depth >= 0; depth--) {
    const parentId = ancestors[depth];
    const parent = await read(parentId);
    const left = (alias >> BigInt(depth)) & 1n ? parent.left : updated;
    const right = (alias >> BigInt(depth)) & 1n ? updated : parent.right;
    dirty.set(parentId, { ...parent, left, right,
      hash: poseidon2([(await read(left)).hash, (await read(right)).hash]) });
    updated = parentId;
  }
  meta.rootNodeId = updated;
  meta.root = (await read(updated)).hash;
}

async function catchup(context: Context, store: PublicStateStore, initial: PublicStateHead, latest: number) {
  let head = initial;
  const configuredChunk = getEventScanConfig().blockChunk;
  assert(Number.isSafeInteger(configuredChunk) && configuredChunk > 0, "Invalid authorization replay block range");
  const chunk = Math.min(configuredChunk, MAX_DELTA_BLOCKS);
  const event = context.contract.interface.getEvent("CounterIncremented");
  assert(event, "Authorization state ABI is incomplete");
  const total = Math.max(0, latest - head.blockNumber);
  const starting = head.blockNumber;
  for (let start = head.blockNumber + 1; start <= latest; start += chunk) {
    const end = Math.min(latest, start + chunk - 1);
    assert(await canonical(context, head), "Authorization cached checkpoint was reorganized");
    const logs = await context.provider.getLogs({ address: context.address, topics: [event.topicHash], fromBlock: start, toBlock: end });
    assert(logs.length <= MAX_DELTA_EVENTS,
      "Authorization event range exceeds the synchronization limit; refresh global state");
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const before = local(() => metadata(head));
    const meta = { ...before };
    const dirty = new Map<bigint, Node>();
    try { await store.read(head, async (view) => {
      const read = nodeReader(view, () => meta.nodeCount, dirty);
      for (const log of logs) {
        assert(!log.removed && log.blockNumber >= start && log.blockNumber <= end,
          "Authorization update history is inconsistent");
        const update = context.contract.interface.parseLog(log)?.args;
        assert(update && BigInt(update.checkpointId) === meta.checkpointId + 1n && BigInt(update.oldRoot) === meta.root,
          "Authorization update history is incomplete");
        const alias = field(update.aliasR, "authorizationAlias");
        assert(alias !== 0n, "Authorization alias must be nonzero");
        await increment(read, meta, dirty, alias, uint64(update.oldCounter, "oldCounter"), uint64(update.newCounter, "newCounter"));
        assert(meta.root === BigInt(update.newRoot), "Authorization root does not match replay");
        meta.checkpointId++;
      }
    }); } catch (error) {
      if (error instanceof AuthorizationCacheError) await store.invalidateHead(head);
      throw error;
    }
    const anchor = await readAnchor(context, end);
    const expected = metadata(anchor);
    assert(expected.root === meta.root && expected.checkpointId === meta.checkpointId &&
      expected.rootNodeId === meta.rootNodeId && expected.nodeCount === meta.nodeCount,
      "Authorization checkpoint does not match replay");
    assert(await canonical(context, head), "Authorization cached checkpoint was reorganized");
    head = await store.commit(head, anchor, [...dirty].map(([id, node]) => write(id, node)));
    reportPublicStateSyncProgress({ domain: "authorization", phase: "catchup", completed: end - starting, total });
  }
  return head;
}

/** Global public downloads only: the requested alias is used exclusively in local IDB reads. */
export async function loadPersistedIdentityAuthorizationWitness(contract: Contract, authorizationAlias: BigNumberish,
  expectedScope?: ShieldedIdentityAuthorizationScope) {
  const alias = field(authorizationAlias, "authorizationAlias");
  assert(alias !== 0n, "Authorization alias must be nonzero");
  const provider = contract.runner?.provider;
  assert(provider, "Authorization state has no provider");
  const [network, rawAddress, rawCreation] = await Promise.all([
    provider.getNetwork(), contract.getAddress(), contract.creationBlock(),
  ]);
  const chainId = BigInt(network.chainId);
  const address = getAddress(rawAddress);
  assert(!expectedScope || (BigInt(expectedScope.chainId) === chainId &&
    getAddress(expectedScope.authorizationStateAddress) === address), "Authorization path scope does not match");
  const creationBlock = number(rawCreation, "creationBlock");
  const deployment = await provider.getBlock(creationBlock);
  assert(deployment?.hash, "Authorization deployment block is unavailable");
  const context: Context = { contract, provider, chainId, address, creationBlock };
  const key = `authorization:v1:${chainId}:${address.toLowerCase()}:${creationBlock}:${deployment.hash}`;
  return withPublicStateLock(key, async () => {
    const store = await openPublicStateStore(key);
    let latest = await provider.getBlockNumber();
    assert(Number.isSafeInteger(latest) && latest >= creationBlock, "Invalid authorization snapshot block");
    let head = (await store.envelope()).head;
    assert(!head || head.blockNumber <= latest, "Authorization RPC head is behind its verified cache");
    while (head && !await canonical(context, head)) head = await store.rollback(head);
    if (head) {
      // Authenticate metadata before parsing it; malformed local counters must not
      // permanently block recovery, while RPC failures retain the committed data.
      const savedAnchor = await readAnchor(context, head.blockNumber);
      if (!sameMetadata(head, savedAnchor)) {
        await store.invalidateHead(head);
        throw new AuthorizationCacheError("Authorization cached metadata does not match its chain checkpoint");
      }
    }
    if (head && head.blockNumber < latest) {
      // A current global snapshot is cheaper than replaying a long counter history.
      // Existing verified data stays committed until the replacement has passed validation.
      const current = await readAnchor(context, latest);
      const previous = local(() => metadata(head!));
      const next = metadata(current);
      assert(next.checkpointId >= previous.checkpointId, "Authorization state moved backwards without a reorganization");
      if (next.checkpointId === previous.checkpointId) {
        assert(next.root === previous.root && next.nodeCount === previous.nodeCount &&
          next.rootNodeId === previous.rootNodeId, "Authorization state changed without a checkpoint update");
        // The monotonically increasing checkpoint proves no counter update was
        // skipped, even across a very long interval containing only empty blocks.
        assert(await canonical(context, head), "Authorization cached checkpoint was reorganized");
        await scope(context);
        assert(await canonical(context, current), "Authorization checkpoint was reorganized");
        head = await store.commit(head, current, []);
      } else if (next.checkpointId - previous.checkpointId > BigInt(MAX_DELTA_EVENTS))
        head = await bootstrap(context, store, latest);
    }
    if (!head) {
      head = await bootstrap(context, store, latest);
      latest = await provider.getBlockNumber();
      assert(Number.isSafeInteger(latest) && latest >= head.blockNumber, "Authorization chain moved behind its snapshot");
    }
    head = await catchup(context, store, head, latest);
    const anchor = await readAnchor(context, head.blockNumber);
    assert(sameMetadata(head, anchor), "Authorization cached checkpoint is inconsistent");
    const meta = metadata(head);
    let witness: ShieldedIdentityAuthorizationWitness;
    try {
      witness = await store.read(head, (view) => witnessFromNodes(nodeReader(view, () => meta.nodeCount), meta, alias));
    } catch (error) {
      if (error instanceof AuthorizationCacheError) await store.invalidateHead(head);
      throw error;
    }
    await scope(context);
    assert(await canonical(context, head), "Authorization checkpoint was reorganized");
    reportPublicStateSyncProgress({ domain: "authorization", phase: "complete", completed: 1, total: 1 });
    return { witness, stateRoot: meta.root, checkpointId: meta.checkpointId, asOf: meta.asOf,
      blockNumber: head.blockNumber, blockHash: head.blockHash, chainId, authorizationStateAddress: address };
  });
}
