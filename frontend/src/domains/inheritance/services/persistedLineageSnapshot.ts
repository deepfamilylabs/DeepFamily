import {
  SNARK_SCALAR_FIELD,
  buildLineageMerkleProofFromPath,
  hashLineageNodes,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getAddress, type Contract } from "ethers";
import {
  openPublicStateStore,
  withPublicStateLock,
  PublicStateConflictError,
  type PublicStateHead,
  type PublicStatePending,
  type PublicStateReader,
  type PublicStateStore,
  type PublicStateWrite,
} from "../../../shared/clients/publicStateStore";
import { reportPublicStateSyncProgress } from "../../../shared/workers/publicStateSyncProgress";
import { getEventScanConfig } from "../../../shared/config/env";
import { InheritanceError } from "../model/inheritanceErrors";
import {
  RequestedLineagePaths,
  LineageSnapshotLimitError,
  type TargetedLineageRequest,
} from "./targetedInheritanceChain";
import type { IndexedVersion, LineageSnapshot } from "./inheritanceChain";

export type LocalLineageRequest = TargetedLineageRequest & {
  publicEligibility?: readonly {
    heirPersonHash: string;
    rootIdentityCommitment: bigint;
    rootVersionIndex: number;
  }[];
};

const PAGE = 256;
class GlobalSnapshotRequired extends Error {}
const lower = (value: unknown) => String(value).toLowerCase();
const person = (identity: bigint) => lower(wrapIdentityCommitmentAsPersonHash(identity));
function fail(message: string): never {
  throw new InheritanceError("snapshotMismatch", message);
}
function uint(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > max) fail(`Invalid lineage ${label}`);
  return result;
}
function field(value: unknown): bigint {
  const result = BigInt(value as bigint);
  if (result < 0n || result >= SNARK_SCALAR_FIELD) fail("Invalid lineage field");
  return result;
}
type Data = {
  roots: string[];
  sizes: number[];
  versions: number;
  checkpointId: string;
  createdAt: string;
  timestamp: string;
};
type Endorsement = {
  slot: number;
  personHash: string;
  endorser: string;
  versionIndex: number;
  writtenAt: bigint;
  active: boolean;
};
type Trusted = {
  slot: number;
  personHash: string;
  versionIndex: number;
  account: string;
  active: boolean;
};
const nodeKind = (id: number) => `lineage:${id}`;
const nodeKey = (level: number, index: number) => `${level}:${index}`;
const versionKey = (hash: string, version: number) => `${hash}:${version}`;
function data(head: PublicStateHead): Data {
  return head.data as unknown as Data;
}
const progress = (
  phase: "download" | "verify" | "catchup" | "complete",
  completed: number,
  total: number,
  resumed = false,
) => reportPublicStateSyncProgress({ domain: "lineage", phase, completed, total, resumed });

async function current(index: Contract, blockNumber: number, blockHash: string, timestamp: number) {
  const overrides = { blockTag: blockNumber };
  const [roots, sizes, versions, rawCheckpointId] = await Promise.all([
    Promise.all([0, 1].map((id) => index.root(id, overrides))),
    Promise.all([0, 1].map((id) => index.size(id, overrides))),
    index.versionMetadataCount(overrides),
    index.currentCheckpointId(overrides),
  ]);
  const checkpointId = BigInt(rawCheckpointId);
  const checkpoint = await index.getCheckpoint(checkpointId, overrides);
  const state: Data = {
    roots: roots.map((root) => String(field(root))),
    sizes: sizes.map((size) => uint(size, "size")),
    versions: uint(versions, "version count"),
    checkpointId: String(checkpointId),
    createdAt: String(checkpoint.createdAt),
    timestamp: String(timestamp),
  };
  if (
    checkpointId < 0n ||
    (checkpointId === 0n && state.sizes.some(Boolean)) ||
    field(checkpoint.endorsementRoot) !== BigInt(state.roots[0]) ||
    field(checkpoint.trustedRoot) !== BigInt(state.roots[1]) ||
    BigInt(state.createdAt) < 0n ||
    BigInt(state.createdAt) > BigInt(timestamp) ||
    BigInt(checkpoint.retiredAt) !== 0n
  )
    fail("Lineage checkpoint does not match the current state");
  return { blockNumber, blockHash, data: state as unknown as Record<string, unknown> };
}
function version(raw: Record<string, unknown>): IndexedVersion {
  const value = {
    personHash: lower(raw.personHash),
    versionIndex: uint(raw.versionIndex, "version index"),
    identityCommitment: field(raw.identityCommitment),
    fatherIdentityCommitment: field(raw.fatherIdentityCommitment),
    motherIdentityCommitment: field(raw.motherIdentityCommitment),
  };
  if (
    value.versionIndex === 0 ||
    value.identityCommitment === 0n ||
    person(value.identityCommitment) !== value.personHash
  )
    fail("Lineage version identity is inconsistent");
  return value;
}
function versionWrite(value: IndexedVersion, ordinal: number): PublicStateWrite {
  return {
    kind: "version",
    key: versionKey(value.personHash, value.versionIndex),
    value: { ...value, ordinal },
    lookups: [
      `person:${value.personHash}`,
      ...[value.fatherIdentityCommitment, value.motherIdentityCommitment]
        .filter((identity) => identity !== 0n)
        .map((identity) => `parent:${identity}`),
    ],
  };
}
function endorsement(raw: Record<string, unknown>, slot: number): Endorsement {
  const result = {
    slot,
    personHash: lower(raw.personHash),
    endorser: lower(getAddress(String(raw.endorser))),
    versionIndex: uint(raw.versionIndex, "endorsement version"),
    writtenAt: BigInt(raw.writtenAt as bigint),
    active: raw.active as boolean,
  };
  if (
    !/^0x[0-9a-f]{64}$/.test(result.personHash) ||
    BigInt(result.endorser) === 0n ||
    typeof result.active !== "boolean" ||
    result.writtenAt < 0n ||
    result.writtenAt > (1n << 64n) - 1n ||
    (result.active
      ? result.versionIndex === 0
      : result.versionIndex !== 0 || result.writtenAt !== 0n)
  )
    fail("Lineage endorsement metadata is invalid");
  return result;
}
function trusted(raw: Record<string, unknown>, slot: number): Trusted {
  const result = {
    slot,
    personHash: lower(raw.personHash),
    account: lower(getAddress(String(raw.account))),
    versionIndex: uint(raw.versionIndex, "trusted version"),
    active: raw.active as boolean,
  };
  if (
    !/^0x[0-9a-f]{64}$/.test(result.personHash) ||
    BigInt(result.account) === 0n ||
    result.versionIndex === 0 ||
    typeof result.active !== "boolean"
  )
    fail("Lineage trust metadata is invalid");
  return result;
}
const endorsementWrite = (value: Endorsement): PublicStateWrite => ({
  kind: "endorsement",
  key: String(value.slot),
  value,
  lookups: [`person:${value.personHash}`],
});
const trustedWrite = (value: Trusted): PublicStateWrite => ({
  kind: "trusted",
  key: String(value.slot),
  value,
  lookups: [`version:${value.personHash}:${value.versionIndex}`],
});

async function expectedEndorsement(view: PublicStateReader, item: Endorsement) {
  if (!item.active) return 0n;
  const record = await view.get<IndexedVersion>(
    "version",
    versionKey(item.personHash, item.versionIndex),
  );
  if (
    !record ||
    version(record as unknown as Record<string, unknown>).personHash !== item.personHash
  )
    fail("Endorsement version is missing from the global snapshot");
  return computeLineageEndorsementLeaf({
    identityCommitment: record.identityCommitment,
    parentsDigest: computeLineageParentsDigest(record),
    versionIndex: item.versionIndex,
    endorser: item.endorser,
    writtenAt: item.writtenAt,
  });
}
async function expectedTrusted(view: PublicStateReader, item: Trusted) {
  if (!item.active) return 0n;
  const record = await view.get<IndexedVersion>(
    "version",
    versionKey(item.personHash, item.versionIndex),
  );
  if (
    !record ||
    version(record as unknown as Record<string, unknown>).personHash !== item.personHash
  )
    fail("Trusted version is missing from the global snapshot");
  return computeLineageTrustedLeaf({
    rootIdentityCommitment: record.identityCommitment,
    rootVersionIndex: item.versionIndex,
    account: item.account,
  });
}
async function fetchPage(
  index: Contract,
  method: string,
  start: number,
  count: number,
  block: number,
  treeId?: number,
) {
  const args = treeId === undefined ? [start, count] : [treeId, start, count];
  const page = (await index[method](...args, { blockTag: block })) as unknown[];
  if (!Array.isArray(page) || page.length !== count) fail("Incomplete global lineage page");
  return page;
}

async function bootstrap(
  store: PublicStateStore,
  index: Contract,
  target: number,
  validate: (head: PublicStateHead) => Promise<void>,
) {
  let saved = (await store.envelope()).pending;
  if (saved && saved.blockNumber > target)
    fail("The pending lineage snapshot is newer than this provider. Refresh recovery.");
  if (saved) {
    const savedBlock = await index.runner!.provider!.getBlock(saved.blockNumber);
    if (!savedBlock?.hash) fail("The RPC cannot read the pending lineage anchor");
    if (savedBlock.hash !== saved.blockHash) {
      await store.discardPending(saved);
      saved = undefined;
    } else await validate(saved);
  }
  const blockNumber = saved?.blockNumber ?? target;
  const provider = index.runner!.provider!;
  const block = await provider.getBlock(blockNumber);
  if (!block?.hash) fail("Lineage bootstrap block is unavailable");
  const anchor = await current(index, blockNumber, block.hash, block.timestamp);
  let pending = await store.startPending(anchor);
  const state = data(pending);
  const resumed = Object.values(pending.cursors).some((cursor) => cursor > 0);
  const tasks = [
    { key: "leaves0", total: state.sizes[0], method: "getLeafPage", tree: 0 },
    { key: "leaves1", total: state.sizes[1], method: "getLeafPage", tree: 1 },
    { key: "versions", total: state.versions, method: "getVersionPage" },
    { key: "endorsements", total: state.sizes[0], method: "getEndorsementPage" },
    { key: "trusted", total: state.sizes[1], method: "getTrustedPage" },
  ];
  const total = tasks.reduce((sum, task) => sum + Math.ceil(task.total / PAGE), 0);
  const completed = () =>
    tasks.reduce((sum, task) => sum + Math.ceil((pending.cursors[task.key] ?? 0) / PAGE), 0);
  progress("download", completed(), total, resumed);
  for (const task of tasks) {
    for (let start = pending.cursors[task.key] ?? 0; start < task.total; ) {
      const count = Math.min(PAGE, task.total - start);
      const page = await fetchPage(index, task.method, start, count, blockNumber, task.tree);
      const writes = page.flatMap((raw, offset): PublicStateWrite[] => {
        if (task.tree !== undefined)
          return [
            { kind: nodeKind(task.tree), key: nodeKey(0, start + offset), value: field(raw) },
          ];
        if (task.key === "versions") {
          const item = version(raw as Record<string, unknown>);
          return [
            versionWrite(item, start + offset),
            {
              kind: "version-slot",
              key: String(start + offset),
              value: versionKey(item.personHash, item.versionIndex),
            },
          ];
        }
        if (task.key === "endorsements")
          return [endorsementWrite(endorsement(raw as Record<string, unknown>, start + offset))];
        return [trustedWrite(trusted(raw as Record<string, unknown>, start + offset))];
      });
      if (task.key === "versions") {
        await store.read(
          pending,
          async (view) => {
            const seen = new Set<string>();
            for (const item of writes.filter((entry) => entry.kind === "version")) {
              if (seen.has(item.key) || (await view.get("version", item.key)))
                fail("Duplicated global lineage version");
              seen.add(item.key);
            }
          },
          true,
        );
      }
      start += count;
      pending = await store.writePending(pending, writes, { [task.key]: start });
      progress("download", completed(), total, resumed);
    }
  }
  try {
    pending = await verifyBootstrap(store, pending, resumed);
  } catch (error) {
    if (!(error instanceof PublicStateConflictError) && !(error instanceof DOMException)) {
      const candidate = (await store.envelope()).pending;
      if (candidate?.dataset === pending.dataset) await store.discardPending(candidate);
    }
    throw error;
  }
  await validate(pending);
  // Re-read the pinned checkpoint after all downloaded data has been authenticated.
  const final = await current(
    index,
    pending.blockNumber,
    pending.blockHash,
    Number(state.timestamp),
  );
  if (JSON.stringify(final.data) !== JSON.stringify(pending.data))
    fail("Lineage bootstrap checkpoint changed");
  return store.finishPending(pending);
}

async function verifyBootstrap(
  store: PublicStateStore,
  initial: PublicStatePending,
  resumed: boolean,
) {
  let pending = initial;
  const state = data(pending);
  const total = state.sizes.reduce((sum, initial) => {
    let size = initial;
    while (size > 1) {
      size = Math.ceil(size / 2);
      sum += size;
    }
    return sum + initial;
  }, state.versions);
  let verified = 0;
  // Download cursors are resumable. Verification is repeated after a restart so
  // mutable browser data cannot certify itself through a saved progress cursor.
  for (let start = 0; start < state.versions; start += PAGE) {
    const end = Math.min(state.versions, start + PAGE);
    await store.read(
      pending,
      async (view) => {
        for (let ordinal = start; ordinal < end; ordinal++) {
          const key = await view.get<string>("version-slot", String(ordinal));
          const raw = key
            ? await view.get<IndexedVersion & { ordinal: number }>("version", key)
            : undefined;
          if (!raw || raw.ordinal !== ordinal)
            fail("Global lineage versions are missing or duplicated");
          const item = version(raw as unknown as Record<string, unknown>);
          if (key !== versionKey(item.personHash, item.versionIndex))
            fail("Global lineage version index is inconsistent");
        }
      },
      true,
    );
    verified = end;
    progress("verify", verified, total, resumed);
  }
  for (let id = 0; id < 2; id++) {
    let size = state.sizes[id],
      level = 0;
    while (size > 1) {
      const count = Math.ceil(size / 2),
        cursor = `verify:${id}:${level}`;
      for (let start = 0; start < count; ) {
        const end = Math.min(count, start + PAGE);
        const writes = await store.read(
          pending,
          async (view) => {
            const result: PublicStateWrite[] = [];
            for (let offset = start; offset < end; offset++) {
              const left = await view.get<bigint>(nodeKind(id), nodeKey(level, offset * 2));
              const right =
                offset * 2 + 1 < size
                  ? await view.get<bigint>(nodeKind(id), nodeKey(level, offset * 2 + 1))
                  : undefined;
              if (left === undefined || (offset * 2 + 1 < size && right === undefined))
                fail("Missing lineage node in downloaded page");
              result.push({
                kind: nodeKind(id),
                key: nodeKey(level + 1, offset),
                value:
                  right === undefined ? field(left) : hashLineageNodes(field(left), field(right)),
              });
            }
            return result;
          },
          true,
        );
        pending = await store.writePending(pending, writes, { [cursor]: end });
        start = end;
        progress("verify", Math.min(total, verified + start), total, resumed);
      }
      verified += count;
      size = count;
      level++;
    }
    await store.read(
      pending,
      async (view) => {
        const root =
          state.sizes[id] === 0 ? 0n : await view.get<bigint>(nodeKind(id), nodeKey(level, 0));
        if (root === undefined || field(root) !== BigInt(state.roots[id]))
          fail("Downloaded lineage tree does not match its chain root");
      },
      true,
    );
  }
  for (let id = 0; id < 2; id++) {
    const kind = id === 0 ? "endorsement" : "trusted";
    const totalRecords = state.sizes[id];
    for (let start = 0; start < totalRecords; ) {
      const end = Math.min(totalRecords, start + PAGE);
      await store.read(
        pending,
        async (view) => {
          for (let slot = start; slot < end; slot++) {
            const raw = await view.get<Endorsement & Trusted>(kind, String(slot));
            if (!raw) fail("Missing lineage metadata page");
            const expected =
              id === 0
                ? await expectedEndorsement(
                    view,
                    endorsement(raw as unknown as Record<string, unknown>, slot),
                  )
                : await expectedTrusted(
                    view,
                    trusted(raw as unknown as Record<string, unknown>, slot),
                  );
            const leaf = await view.get<bigint>(nodeKind(id), nodeKey(0, slot));
            if (leaf === undefined || field(leaf) !== expected)
              fail("Global lineage metadata does not open its physical leaf");
          }
        },
        true,
      );
      pending = await store.writePending(pending, [], { [`verify:${kind}`]: end });
      start = end;
      progress("verify", Math.min(total, verified + start), total, resumed);
    }
    verified += totalRecords;
  }
  return pending;
}

type LogWrite = { treeId: number; index: number; leaf: bigint; root: bigint };
async function applyWrites(view: PublicStateReader, state: Data, events: LogWrite[]) {
  const dirty = new Map<string, PublicStateWrite>();
  const get = async (kind: string, key: string) =>
    (dirty.get(`${kind}/${key}`)?.value as bigint | undefined) ??
    (await view.get<bigint>(kind, key));
  const sizes = [...state.sizes],
    roots = state.roots.map(BigInt);
  for (const event of events) {
    const id = event.treeId,
      kind = nodeKind(id);
    if (id !== 0 && id !== 1) fail("Invalid lineage tree event");
    if (event.index > sizes[id]) fail("Lineage update omitted a leaf");
    if (event.index < sizes[id]) {
      // Authenticate the old local path before using any cached sibling in an update.
      await readPath(view, id, event.index, sizes[id], roots[id], get);
    }
    if (event.index === sizes[id]) sizes[id]++;
    let value = event.leaf,
      position = event.index,
      size = sizes[id],
      level = 0;
    for (;;) {
      const key = nodeKey(level, position);
      dirty.set(`${kind}/${key}`, { kind, key, value });
      if (size === 1) break;
      const siblingIndex = position % 2 === 1 ? position - 1 : position + 1;
      if (siblingIndex < size) {
        const sibling = await get(kind, nodeKey(level, siblingIndex));
        if (sibling === undefined) fail("A lineage update sibling is unavailable");
        value =
          position % 2 === 1
            ? hashLineageNodes(field(sibling), value)
            : hashLineageNodes(value, field(sibling));
      }
      position = Math.floor(position / 2);
      size = Math.ceil(size / 2);
      level++;
    }
    if (value !== event.root) fail("Lineage event root does not match its path update");
    roots[id] = value;
  }
  return { dirty, sizes, roots, get };
}

async function readPath(
  view: PublicStateReader,
  treeId: number,
  index: number,
  initialSize: number,
  root: bigint,
  lookup: (kind: string, key: string) => Promise<bigint | undefined> = (kind, key) =>
    view.get(kind, key),
) {
  if (index < 0 || index >= initialSize) fail("Lineage local slot is invalid");
  const kind = nodeKind(treeId);
  const leaf = await lookup(kind, nodeKey(0, index));
  if (leaf === undefined) fail("Lineage local leaf is unavailable");
  const siblings: bigint[] = [];
  let position = index,
    size = initialSize,
    compact = 0n,
    level = 0;
  while (size > 1) {
    const siblingIndex = position % 2 === 1 ? position - 1 : position + 1;
    if (siblingIndex < size) {
      const sibling = await lookup(kind, nodeKey(level, siblingIndex));
      if (sibling === undefined) fail("Lineage local path is incomplete");
      if (position % 2 === 1) compact |= 1n << BigInt(siblings.length);
      siblings.push(field(sibling));
    }
    position = Math.floor(position / 2);
    size = Math.ceil(size / 2);
    level++;
  }
  const proof = { root, leaf: field(leaf), index: compact, siblings };
  buildLineageMerkleProofFromPath(proof);
  return proof;
}

async function catchup(
  store: PublicStateStore,
  index: Contract,
  initial: PublicStateHead,
  target: number,
  validate: (head: PublicStateHead) => Promise<void>,
) {
  let head = initial;
  const provider = index.runner!.provider!;
  const chunk = Math.min(128, Math.max(1, uint(getEventScanConfig().blockChunk, "block chunk")));
  const address = await index.getAddress();
  const topics = ["LeafWritten", "VersionIndexed"].map(
    (name) => index.interface.getEvent(name)!.topicHash,
  );
  const first = head.blockNumber + 1,
    total = Math.max(0, target - head.blockNumber);
  progress("catchup", 0, total);
  for (let start = first; start <= target; start += chunk) {
    const end = Math.min(target, start + chunk - 1);
    const block = await provider.getBlock(end);
    if (!block?.hash) fail("Lineage incremental block is unavailable");
    const anchor = await current(index, end, block.hash, block.timestamp);
    const next = anchor.data as unknown as Data,
      previous = data(head);
    if (
      next.versions < previous.versions ||
      next.sizes.some((size, id) => size < previous.sizes[id])
    )
      fail("Lineage state moved backwards without a reorganization");
    const logs = await provider.getLogs({
      address,
      topics: [topics],
      fromBlock: start,
      toBlock: end,
    });
    if (logs.length > 4096) throw new GlobalSnapshotRequired();
    logs.sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index);
    const events: LogWrite[] = [];
    const changed = [new Set<number>(), new Set<number>()];
    for (const log of logs) {
      if (
        log.removed ||
        log.blockNumber < start ||
        log.blockNumber > end ||
        lower(log.address) !== lower(address)
      )
        fail("Invalid lineage incremental event range");
      const parsed = index.interface.parseLog(log);
      if (!parsed) fail("Invalid lineage incremental event");
      if (parsed.name === "LeafWritten") {
        const id = uint(parsed.args.treeId, "tree id", 1),
          slot = uint(parsed.args.leafIndex, "leaf slot");
        events.push({
          treeId: id,
          index: slot,
          leaf: field(parsed.args.leaf),
          root: field(parsed.args.root),
        });
        changed[id].add(Math.floor(slot / PAGE) * PAGE);
      }
    }
    // A range with many writes spread over different slots can require much
    // larger metadata pages than its event count. Bound that work before reads.
    const metadataRows = changed.reduce(
      (sum, pages, id) =>
        sum +
        [...pages].reduce((count, offset) => count + Math.min(PAGE, next.sizes[id] - offset), 0),
      0,
    );
    if (metadataRows > 4096) throw new GlobalSnapshotRequired();
    const versions: IndexedVersion[] = [];
    for (let offset = previous.versions; offset < next.versions; offset += PAGE) {
      const count = Math.min(PAGE, next.versions - offset);
      const page = await fetchPage(index, "getVersionPage", offset, count, end);
      versions.push(...page.map((entry) => version(entry as Record<string, unknown>)));
    }
    // Version events authenticate that the global metadata append wasn't skipped.
    const indexed = logs.flatMap((log) => {
      const parsed = index.interface.parseLog(log);
      return parsed?.name === "VersionIndexed"
        ? [version(parsed.args as unknown as Record<string, unknown>)]
        : [];
    });
    if (
      indexed.length !== versions.length ||
      indexed.some(
        (item, offset) =>
          JSON.stringify(item, (_, entry) =>
            typeof entry === "bigint" ? String(entry) : entry,
          ) !==
          JSON.stringify(versions[offset], (_, entry) =>
            typeof entry === "bigint" ? String(entry) : entry,
          ),
      )
    )
      fail("Global lineage version history is incomplete");
    const metadata: PublicStateWrite[] = versions.flatMap((item, offset) => [
      versionWrite(item, previous.versions + offset),
      {
        kind: "version-slot",
        key: String(previous.versions + offset),
        value: versionKey(item.personHash, item.versionIndex),
      },
    ]);
    for (let id = 0; id < 2; id++)
      for (const offset of [...changed[id]].sort((a, b) => a - b)) {
        const count = Math.min(PAGE, next.sizes[id] - offset);
        if (count <= 0) fail("Lineage event points outside the current tree");
        const page = await fetchPage(
          index,
          id === 0 ? "getEndorsementPage" : "getTrustedPage",
          offset,
          count,
          end,
        );
        metadata.push(
          ...page.map((entry, at) =>
            id === 0
              ? endorsementWrite(endorsement(entry as Record<string, unknown>, offset + at))
              : trustedWrite(trusted(entry as Record<string, unknown>, offset + at)),
          ),
        );
      }
    const writes = await store.read(head, async (view) => {
      const applied = await applyWrites(view, previous, events);
      if (
        applied.sizes.some((size, id) => size !== next.sizes[id]) ||
        applied.roots.some((root, id) => root !== BigInt(next.roots[id]))
      )
        fail("Incremental lineage state does not match the chain");
      const metadataByKey = new Map(metadata.map((item) => [`${item.kind}/${item.key}`, item]));
      const local: PublicStateReader = {
        get: async <T>(kind: string, key: string) =>
          (metadataByKey.get(`${kind}/${key}`)?.value as T | undefined) ?? view.get<T>(kind, key),
        query: (kind, lookup, limit) => view.query(kind, lookup, limit),
      };
      for (const write of metadata) {
        if (write.kind === "version-slot") continue;
        if (write.kind === "version") {
          if (await view.get("version", write.key)) fail("A lineage version was indexed twice");
          continue;
        }
        const id = write.kind === "endorsement" ? 0 : 1;
        const expected =
          id === 0
            ? await expectedEndorsement(local, write.value as Endorsement)
            : await expectedTrusted(local, write.value as Trusted);
        const leaf = await applied.get(nodeKind(id), nodeKey(0, (write.value as Trusted).slot));
        if (leaf === undefined || field(leaf) !== expected)
          fail("Updated lineage metadata does not open its current leaf");
      }
      return [...applied.dirty.values(), ...metadata];
    });
    await validate({ ...head, ...anchor });
    head = await store.commit(head, anchor, writes);
    progress("catchup", end - first + 1, total);
  }
  return head;
}

async function select(
  store: PublicStateStore,
  head: PublicStateHead,
  request: LocalLineageRequest,
): Promise<LineageSnapshot> {
  const state = data(head);
  const limit = uint(request.limits?.records ?? 2000, "record limit", 100_000);
  if (limit === 0) fail("Lineage local record limit is zero");
  return store.read(head, async (view) => {
    let remaining = limit;
    const charge = (count: number) => {
      remaining -= count;
      if (remaining < 0) throw new LineageSnapshotLimitError();
    };
    const versions = new Map<string, IndexedVersion[]>();
    const endorsements: LineageSnapshot["endorsements"] = new Map();
    const trustedEndorsers = new Map<string, Set<string>>();
    const trees = state.roots.map(
      (root, id) => new RequestedLineagePaths(BigInt(root), BigInt(state.sizes[id])),
    );
    const loadedTrusted = new Set<string>(),
      loadedEndorsements = new Set<string>();
    const loadVersions = async (hash: string) => {
      if (versions.has(hash)) return versions.get(hash)!;
      const records = await view.query<IndexedVersion>("version", `person:${hash}`, remaining + 1);
      charge(records.length);
      const found = records
        .map((record) => version(record as unknown as Record<string, unknown>))
        .sort((left, right) => left.versionIndex - right.versionIndex);
      if (found.some((record, at) => record.personHash !== hash || record.versionIndex !== at + 1))
        fail("Local lineage versions are incomplete");
      versions.set(hash, found);
      return found;
    };
    const loadTrusted = async (identity: bigint, versionIndex: number) => {
      const hash = person(identity),
        key = `${hash}:${versionIndex}`;
      if (loadedTrusted.has(key)) return;
      loadedTrusted.add(key);
      await loadVersions(hash);
      const records = await view.query<Trusted>("trusted", `version:${key}`, remaining + 1);
      charge(records.length);
      const accounts = new Set<string>();
      for (const record of records) {
        const item = trusted(record as unknown as Record<string, unknown>, record.slot);
        if (item.personHash !== hash || item.versionIndex !== versionIndex)
          fail("Local trust index is inconsistent");
        if (!item.active) continue;
        const path = await readPath(view, 1, item.slot, state.sizes[1], BigInt(state.roots[1]));
        if (path.leaf !== (await expectedTrusted(view, item)))
          fail("Local trusted opening is inconsistent");
        trees[1].add(BigInt(item.slot), path);
        accounts.add(item.account);
      }
      trustedEndorsers.set(key, accounts);
    };
    const loadEndorsements = async (identity: bigint) => {
      const hash = person(identity);
      if (loadedEndorsements.has(hash)) return;
      loadedEndorsements.add(hash);
      await loadVersions(hash);
      const records = await view.query<Endorsement>("endorsement", `person:${hash}`, remaining + 1);
      charge(records.length);
      const found = new Map<string, { versionIndex: number; timestamp: bigint }>();
      for (const record of records) {
        const item = endorsement(record as unknown as Record<string, unknown>, record.slot);
        if (item.personHash !== hash) fail("Local endorsement index is inconsistent");
        if (!item.active) continue;
        const path = await readPath(view, 0, item.slot, state.sizes[0], BigInt(state.roots[0]));
        if (path.leaf !== (await expectedEndorsement(view, item)))
          fail("Local endorsement opening is inconsistent");
        trees[0].add(BigInt(item.slot), path);
        found.set(item.endorser, { versionIndex: item.versionIndex, timestamp: item.writtenAt });
      }
      endorsements.set(hash, found);
    };
    for (const rawIdentity of request.parentIdentityCommitments ?? []) {
      const identity = field(rawIdentity),
        ownVersions = await loadVersions(person(identity));
      for (const record of ownVersions) await loadTrusted(identity, record.versionIndex);
      if (request.includeChildren === false) continue;
      const children = await view.query<IndexedVersion>(
        "version",
        `parent:${identity}`,
        remaining + 1,
      );
      charge(children.length);
      for (const child of children) {
        const record = version(child as unknown as Record<string, unknown>);
        if (
          record.fatherIdentityCommitment !== identity &&
          record.motherIdentityCommitment !== identity
        )
          fail("Local child index is inconsistent");
        await loadEndorsements(record.identityCommitment);
      }
    }
    for (const eligibility of request.publicEligibility ?? []) {
      const hash = lower(eligibility.heirPersonHash);
      if (!/^0x[0-9a-f]{64}$/.test(hash)) fail("Invalid local recipient person hash");
      const records = await loadVersions(hash);
      await loadTrusted(
        field(eligibility.rootIdentityCommitment),
        uint(eligibility.rootVersionIndex, "root version"),
      );
      if (records.length) await loadEndorsements(records[0].identityCommitment);
    }
    for (const eligibility of request.eligibility ?? []) {
      await loadTrusted(
        field(eligibility.rootIdentityCommitment),
        uint(eligibility.rootVersionIndex, "root version"),
      );
      await loadEndorsements(field(eligibility.heirIdentityCommitment));
    }
    return {
      blockNumber: head.blockNumber,
      blockHash: head.blockHash,
      timestamp: BigInt(state.timestamp),
      checkpointId: BigInt(state.checkpointId),
      checkpointCreatedAt: BigInt(state.createdAt),
      versions,
      endorsements,
      trustedEndorsers,
      endorsementTree: trees[0],
      trustedTree: trees[1],
    };
  });
}

/** All network reads are global pages/events. The request selects only browser-local records. */
export async function loadPersistedLineageSnapshot(
  index: Contract,
  family: Contract,
  request: LocalLineageRequest,
): Promise<LineageSnapshot> {
  const provider = index.runner?.provider,
    familyProvider = family.runner?.provider;
  if (!provider || !familyProvider) throw new Error("Lineage contracts have no provider");
  const [network, familyNetwork, indexAddress, familyAddress, genesis, latest] = await Promise.all([
    provider.getNetwork(),
    familyProvider === provider ? undefined : familyProvider.getNetwork(),
    index.getAddress(),
    family.getAddress(),
    provider.getBlock(0),
    provider.getBlockNumber(),
  ]);
  if (!genesis?.hash || (familyNetwork && familyNetwork.chainId !== network.chainId))
    fail("Lineage cache chain is inconsistent");
  const target = uint(request.blockNumber ?? latest, "snapshot block");
  if (target > latest) fail("Lineage snapshot is ahead of the provider");
  const [boundFamily, boundIndex] = await Promise.all([
    index.DEEP_FAMILY({ blockTag: target }),
    family.lineageIndex({ blockTag: target }),
  ]);
  if (lower(boundFamily) !== lower(familyAddress) || lower(boundIndex) !== lower(indexAddress))
    fail("Family and lineage index do not match");
  const code = await provider.getCode(indexAddress, target);
  if (code === "0x") fail("Lineage snapshot contract is unavailable");
  // Code identity prevents a reset development chain or another deployment reusing a namespace.
  const { keccak256 } = await import("ethers");
  const scope = `lineage:1:${network.chainId}:${genesis.hash}:${lower(indexAddress)}:${lower(familyAddress)}:${keccak256(code)}`;
  const store = await openPublicStateStore(scope);
  const validate = async (head: PublicStateHead) => {
    const [block, finalNetwork, finalFamilyNetwork, finalIndex, finalFamily] = await Promise.all([
      provider.getBlock(head.blockNumber),
      provider.getNetwork(),
      familyProvider === provider ? undefined : familyProvider.getNetwork(),
      index.getAddress(),
      family.getAddress(),
    ]);
    if (
      block?.hash !== head.blockHash ||
      finalNetwork.chainId !== network.chainId ||
      (finalFamilyNetwork && finalFamilyNetwork.chainId !== network.chainId) ||
      lower(finalIndex) !== lower(indexAddress) ||
      lower(finalFamily) !== lower(familyAddress)
    )
      fail("Lineage synchronization anchor or scope changed");
  };
  return withPublicStateLock(scope, async () => {
    let head = (await store.envelope()).head;
    if (head && head.blockNumber > target)
      fail("The local lineage snapshot is newer than this provider. Refresh recovery.");
    while (head) {
      const oldBlock = await provider.getBlock(head.blockNumber);
      if (!oldBlock?.hash) fail("The RPC cannot read the saved lineage anchor");
      if (oldBlock.hash === head.blockHash) {
        await validate(head);
        break;
      }
      head = await store.rollback(head);
    }
    if (head) {
      const savedBlock = await provider.getBlock(head.blockNumber);
      if (!savedBlock?.hash) fail("The RPC cannot read the saved lineage anchor");
      const savedAnchor = await current(
        index,
        head.blockNumber,
        savedBlock.hash,
        savedBlock.timestamp,
      );
      if (JSON.stringify(savedAnchor.data) !== JSON.stringify(head.data)) {
        await store.invalidateHead(head);
        fail("The saved lineage checkpoint is inconsistent. Retry global synchronization.");
      }
    }
    if (head && head.blockNumber < target) {
      const targetBlock = await provider.getBlock(target);
      if (!targetBlock?.hash) fail("The current lineage block is unavailable");
      const targetAnchor = await current(index, target, targetBlock.hash, targetBlock.timestamp);
      const targetState = data({ ...head, ...targetAnchor }),
        previous = data(head);
      const changes = BigInt(targetState.checkpointId) - BigInt(previous.checkpointId);
      if (
        changes === 0n &&
        targetState.versions === previous.versions &&
        targetState.sizes.every((size, id) => size === previous.sizes[id]) &&
        targetState.roots.every((root, id) => root === previous.roots[id])
      ) {
        // Counters and version counts are monotone. No changes need replaying,
        // even if many empty blocks elapsed while this device was offline.
        await validate(head);
        await validate({ ...head, ...targetAnchor });
        head = await store.commit(head, targetAnchor, []);
      } else if (changes > BigInt(Math.max(4096, targetState.sizes[0] + targetState.sizes[1])))
        head = await bootstrap(store, index, target, validate);
    }
    if (!head) head = await bootstrap(store, index, target, validate);
    try {
      head = await catchup(store, index, head, target, validate);
    } catch (error) {
      if (!(error instanceof GlobalSnapshotRequired)) throw error;
      // This remains the same global reconstruction mode. It never asks the
      // RPC for the selected person, slot or path.
      head = await bootstrap(store, index, target, validate);
    }
    await validate(head);
    const block = await provider.getBlock(head.blockNumber);
    const canonical = await current(index, head.blockNumber, head.blockHash, block!.timestamp);
    if (JSON.stringify(canonical.data) !== JSON.stringify(head.data)) {
      await store.invalidateHead(head);
      fail(
        "Cached lineage roots or checkpoint do not match the chain. Retry global synchronization.",
      );
    }
    let result: LineageSnapshot;
    try {
      result = await select(store, head, request);
    } catch (error) {
      if (
        !(error instanceof PublicStateConflictError) &&
        !(error instanceof LineageSnapshotLimitError) &&
        !(error instanceof DOMException)
      )
        await store.invalidateHead(head);
      throw error;
    }
    await validate(head);
    progress("complete", 1, 1);
    return result;
  });
}
