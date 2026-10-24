import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  type LineageTree,
} from "@deepfamily/protocol-core";
import { isError, type ethers } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";
import { InheritanceError } from "../model/inheritanceErrors";

export { loadTargetedLineageSnapshot, LineageSnapshotLimitError } from "./targetedInheritanceChain";
export type { TargetedLineageRequest } from "./targetedInheritanceChain";

export const ENDORSEMENT_TREE = 0;
export const TRUSTED_TREE = 1;

type ScanOptions = { fromBlock?: number; blockChunk?: number };

type ScannedEvent = {
  name: string;
  args: ethers.Result;
  blockNumber: number;
  index: number;
};

/** One DeepFamily version as the lineage index recorded it. */
export type IndexedVersion = {
  personHash: string;
  versionIndex: number;
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
};

type LatestEndorsement = { versionIndex: number; timestamp: bigint };

/** Everything funding and claiming need, rebuilt from events and checked against the chain. */
export type LineageSnapshot = {
  blockNumber: number;
  blockHash: string;
  timestamp: bigint;
  checkpointId: bigint;
  checkpointCreatedAt: bigint;
  /** Lowercase person hash → that person's versions. */
  versions: Map<string, IndexedVersion[]>;
  /** `${personHash}:${versionIndex}` → current trusted endorsers, lowercase. */
  trustedEndorsers: Map<string, Set<string>>;
  endorsementTree: LineageTree;
  trustedTree: LineageTree;
  /** Lowercase person hash → endorser → that endorser's latest endorsement of the person. */
  endorsements: Map<string, Map<string, LatestEndorsement>>;
};

type VerifiedSnapshot = { snapshot: LineageSnapshot; requestId: number };
const snapshotCache = new WeakMap<
  ethers.Provider,
  WeakMap<ethers.Provider, Map<string, VerifiedSnapshot>>
>();
let nextRequestId = 0;

/** Copies contain no mutable tree, map, set, version or endorsement owned by the cache. */
function copySnapshot(snapshot: LineageSnapshot): LineageSnapshot {
  return {
    ...snapshot,
    versions: new Map(
      [...snapshot.versions].map(([person, versions]) => [
        person,
        versions.map((version) => ({ ...version })),
      ]),
    ),
    trustedEndorsers: new Map(
      [...snapshot.trustedEndorsers].map(([version, accounts]) => [version, new Set(accounts)]),
    ),
    endorsements: new Map(
      [...snapshot.endorsements].map(([person, endorsements]) => [
        person,
        new Map([...endorsements].map(([account, endorsement]) => [account, { ...endorsement }])),
      ]),
    ),
    endorsementTree: snapshot.endorsementTree.clone(),
    trustedTree: snapshot.trustedTree.clone(),
  };
}

function providerOf(contract: ethers.Contract): ethers.Provider {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Contract has no provider for event scans");
  return provider;
}

/**
 * Every log of the named events, oldest first. The filter names only the contract and event
 * types, never a person, so the RPC node cannot tell whose records the page is after. There is
 * no chunk budget: a skipped write would rebuild a tree whose root the contract never had.
 */
async function scanEvents(
  contract: ethers.Contract,
  names: string[],
  toBlock: number,
  options: ScanOptions = {},
): Promise<ScannedEvent[]> {
  const provider = providerOf(contract);
  const address = await contract.getAddress();
  const topics = names.map((name) => {
    const event = contract.interface.getEvent(name);
    if (!event) throw new Error(`Unknown event ${name}`);
    return event.topicHash;
  });
  const config = getEventScanConfig();
  const fromBlock = Math.max(0, options.fromBlock ?? config.fromBlock);
  const blockChunk = Math.max(1, options.blockChunk ?? config.blockChunk);
  const events: ScannedEvent[] = [];
  for (let start = fromBlock; start <= toBlock; start += blockChunk) {
    const end = Math.min(toBlock, start + blockChunk - 1);
    const logs = await provider.getLogs({
      address,
      topics: [topics],
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      if (log.removed || log.blockNumber < start || log.blockNumber > end) {
        throw new InheritanceError(
          "snapshotMismatch",
          "Lineage event scan returned an invalid range",
        );
      }
      const parsed = contract.interface.parseLog(log);
      if (!parsed) continue;
      events.push({
        name: parsed.name,
        args: parsed.args,
        blockNumber: log.blockNumber,
        index: log.index,
      });
    }
  }
  return events.sort(
    (left, right) => left.blockNumber - right.blockNumber || left.index - right.index,
  );
}

const lower = (value: unknown) => String(value).toLowerCase();
const trustedKey = (personHash: string, versionIndex: number) =>
  `${lower(personHash)}:${versionIndex}`;

function collectVersions(events: ScannedEvent[], versions = new Map<string, IndexedVersion[]>()) {
  for (const event of events) {
    if (event.name !== "VersionIndexed") continue;
    const personHash = lower(event.args.personHash);
    const list = versions.get(personHash) ?? [];
    list.push({
      personHash,
      versionIndex: Number(event.args.versionIndex),
      identityCommitment: BigInt(event.args.identityCommitment),
      fatherIdentityCommitment: BigInt(event.args.fatherIdentityCommitment),
      motherIdentityCommitment: BigInt(event.args.motherIdentityCommitment),
    });
    versions.set(personHash, list);
  }
  return versions;
}

function collectTrustedEndorsers(events: ScannedEvent[], trusted = new Map<string, Set<string>>()) {
  for (const event of events) {
    if (event.name !== "TrustedEndorserAdded" && event.name !== "TrustedEndorserRemoved") continue;
    const key = trustedKey(String(event.args.personHash), Number(event.args.versionIndex));
    const accounts = trusted.get(key) ?? new Set<string>();
    if (event.name === "TrustedEndorserAdded") accounts.add(lower(event.args.account));
    else accounts.delete(lower(event.args.account));
    trusted.set(key, accounts);
  }
  return trusted;
}

async function loadLineageCheckpoint(lineageIndex: ethers.Contract, blockNumber: number) {
  try {
    const checkpointId = BigInt(await lineageIndex.currentCheckpointId({ blockTag: blockNumber }));
    const checkpoint = await lineageIndex.getCheckpoint(checkpointId, { blockTag: blockNumber });
    return { checkpointId, checkpoint };
  } catch (cause) {
    // Older deployments have roots but no paired-checkpoint interface. Retrying
    // cannot add that interface, and using roots alone would weaken verification.
    if (
      (isError(cause, "CALL_EXCEPTION") && (cause.data === null || cause.data === "0x")) ||
      (isError(cause, "BAD_DATA") && cause.value === "0x")
    ) {
      throw new InheritanceError(
        "lineageIncompatible",
        "The lineage index does not support paired checkpoints.",
      );
    }
    throw cause;
  }
}

/**
 * Reuses an isolated verified snapshot and applies every subsequent event. A changed anchor
 * or a backwards-moving head triggers a full replay. Roots and the paired checkpoint are
 * authenticated at one block before any new snapshot is published to the memory cache.
 */
export async function loadLineageSnapshot(
  lineageIndex: ethers.Contract,
  deepFamily: ethers.Contract,
  options: ScanOptions = {},
): Promise<LineageSnapshot> {
  const provider = providerOf(lineageIndex);
  const familyProvider = providerOf(deepFamily);
  const requestId = ++nextRequestId;
  const fromBlock = Math.max(0, options.fromBlock ?? getEventScanConfig().fromBlock);
  const [network, familyNetwork, indexAddress, familyAddress, blockNumber] = await Promise.all([
    provider.getNetwork(),
    familyProvider === provider ? undefined : familyProvider.getNetwork(),
    lineageIndex.getAddress(),
    deepFamily.getAddress(),
    provider.getBlockNumber(),
  ]);
  if (familyNetwork && familyNetwork.chainId !== network.chainId) {
    throw new InheritanceError("snapshotMismatch", "Family history provider uses another chain");
  }
  const key = `${network.chainId}:${lower(indexAddress)}:${lower(familyAddress)}:${fromBlock}`;
  let families = snapshotCache.get(provider);
  if (!families) {
    families = new WeakMap();
    snapshotCache.set(provider, families);
  }
  let cache = families.get(familyProvider);
  if (!cache) {
    cache = new Map();
    families.set(familyProvider, cache);
  }
  const previous = cache.get(key);
  const anchor = await provider.getBlock(blockNumber);
  if (!anchor?.hash) throw new Error("Lineage snapshot block is unavailable");
  let base = previous?.snapshot;
  if (base) {
    const unchanged =
      blockNumber >= base.blockNumber &&
      (await provider.getBlock(base.blockNumber))?.hash === base.blockHash;
    if (!unchanged) {
      // A concurrent request may already have installed a newer, verified snapshot.
      if (cache.get(key) === previous) cache.delete(key);
      base = undefined;
    }
  }
  const working = base ? copySnapshot(base) : undefined;
  const scanOptions = {
    ...options,
    fromBlock: base ? Math.max(fromBlock, base.blockNumber + 1) : fromBlock,
  };
  const { checkpointId, checkpoint } = await loadLineageCheckpoint(lineageIndex, blockNumber);
  const [indexEvents, familyEvents] = await Promise.all([
    scanEvents(lineageIndex, ["LeafWritten", "VersionIndexed"], blockNumber, scanOptions),
    scanEvents(
      deepFamily,
      ["PersonVersionEndorsed", "TrustedEndorserAdded", "TrustedEndorserRemoved"],
      blockNumber,
      scanOptions,
    ),
  ]);

  const endorsementTree = working?.endorsementTree ?? createLineageTree();
  const trustedTree = working?.trustedTree ?? createLineageTree();
  for (const event of indexEvents) {
    if (event.name !== "LeafWritten") continue;
    const treeId = Number(event.args.treeId);
    if (treeId !== ENDORSEMENT_TREE && treeId !== TRUSTED_TREE) continue;
    const tree = treeId === ENDORSEMENT_TREE ? endorsementTree : trustedTree;
    const leafIndex = BigInt(event.args.leafIndex);
    const leaf = BigInt(event.args.leaf);
    if (leafIndex === tree.sizeBigInt) tree.insert(leaf);
    else tree.update(leafIndex, leaf);
  }
  for (const [treeId, tree] of [
    [ENDORSEMENT_TREE, endorsementTree],
    [TRUSTED_TREE, trustedTree],
  ] as const) {
    const onChain = BigInt(await lineageIndex.root(treeId, { blockTag: blockNumber }));
    const rebuilt = tree.sizeBigInt === 0n ? 0n : tree.root;
    if (onChain !== rebuilt) {
      throw new InheritanceError(
        "snapshotMismatch",
        `Rebuilt lineage tree ${treeId} does not match the on-chain root`,
      );
    }
  }

  const roots = [
    endorsementTree.sizeBigInt === 0n ? 0n : endorsementTree.root,
    trustedTree.sizeBigInt === 0n ? 0n : trustedTree.root,
  ];
  if (
    BigInt(checkpoint.endorsementRoot) !== roots[0] ||
    BigInt(checkpoint.trustedRoot) !== roots[1] ||
    BigInt(checkpoint.createdAt) > BigInt(anchor.timestamp) ||
    BigInt(checkpoint.retiredAt) !== 0n
  ) {
    throw new InheritanceError(
      "snapshotMismatch",
      "Family eligibility snapshot does not match the replayed history",
    );
  }
  const finalAnchor = await provider.getBlock(blockNumber);
  if (finalAnchor?.hash !== anchor.hash)
    throw new InheritanceError("snapshotMismatch", "Lineage snapshot block was reorganized");

  // A later endorsement by the same account replaces the earlier one, as the index's slot does.
  const endorsements = working?.endorsements ?? new Map<string, Map<string, LatestEndorsement>>();
  for (const event of familyEvents) {
    if (event.name !== "PersonVersionEndorsed") continue;
    const personHash = lower(event.args.personHash);
    const byEndorser = endorsements.get(personHash) ?? new Map<string, LatestEndorsement>();
    byEndorser.set(lower(event.args.endorser), {
      versionIndex: Number(event.args.versionIndex),
      timestamp: BigInt(event.args.timestamp),
    });
    endorsements.set(personHash, byEndorser);
  }

  const snapshot: LineageSnapshot = {
    blockNumber,
    blockHash: anchor.hash,
    timestamp: BigInt(anchor.timestamp),
    checkpointId,
    checkpointCreatedAt: BigInt(checkpoint.createdAt),
    versions: collectVersions(indexEvents, working?.versions),
    trustedEndorsers: collectTrustedEndorsers(familyEvents, working?.trustedEndorsers),
    endorsementTree,
    trustedTree,
    endorsements,
  };
  const latest = cache.get(key);
  if (
    !latest ||
    latest.snapshot.blockNumber < blockNumber ||
    (latest.snapshot.blockNumber === blockNumber && latest.requestId < requestId)
  ) {
    cache.set(key, { snapshot, requestId });
  }
  return copySnapshot(snapshot);
}

/** One way the heir is a legit child of the root: an endorsement by a trusted endorser. */
export type HeirLegitimacy = {
  versionIndex: number;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  rootIsMother: boolean;
  endorser: string;
  endorsementLeafIndex: bigint;
  trustedLeafIndex: bigint;
  writtenAt: bigint;
};

type FindHeirLegitimacyInput = {
  snapshot: LineageSnapshot;
  heir: { personHash: string; identityCommitment: string | bigint };
  root: { identityCommitment: string | bigint };
  rootVersionIndex: number;
};

/**
 * Every (version, endorser) pair that makes the heir a legit child of the root version, oldest
 * endorsement first, since an older endorsement opens an earlier period. Nothing is fetched:
 * each candidate leaf is rebuilt locally and looked up in the replayed trees, so a cancelled
 * endorsement or a removed trusted endorser, both zeroed leaves, simply do not match.
 */
export function findHeirLegitimacy({
  snapshot,
  heir,
  root,
  rootVersionIndex,
}: FindHeirLegitimacyInput): HeirLegitimacy[] {
  const heirHash = lower(heir.personHash);
  const heirCommitment = BigInt(heir.identityCommitment);
  const rootCommitment = BigInt(root.identityCommitment);
  const versions = snapshot.versions.get(heirHash) ?? [];
  const found: HeirLegitimacy[] = [];

  for (const [endorser, endorsement] of snapshot.endorsements.get(heirHash) ?? []) {
    const version = versions.find(
      (candidate) => candidate.versionIndex === endorsement.versionIndex,
    );
    if (!version) continue;
    const fatherIsRoot = version.fatherIdentityCommitment === rootCommitment;
    const motherIsRoot = version.motherIdentityCommitment === rootCommitment;
    if (!fatherIsRoot && !motherIsRoot) continue;

    const endorsementLeaf = computeLineageEndorsementLeaf({
      identityCommitment: heirCommitment,
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: version.fatherIdentityCommitment,
        motherIdentityCommitment: version.motherIdentityCommitment,
      }),
      versionIndex: version.versionIndex,
      endorser,
      writtenAt: endorsement.timestamp,
    });
    const endorsementLeafIndex = snapshot.endorsementTree.indexOf(endorsementLeaf);
    if (endorsementLeafIndex < 0) continue;

    const trustedLeaf = computeLineageTrustedLeaf({
      rootIdentityCommitment: rootCommitment,
      rootVersionIndex,
      account: endorser,
    });
    const trustedLeafIndex = snapshot.trustedTree.indexOf(trustedLeaf);
    if (trustedLeafIndex < 0) continue;

    found.push({
      versionIndex: version.versionIndex,
      fatherIdentityCommitment: version.fatherIdentityCommitment,
      motherIdentityCommitment: version.motherIdentityCommitment,
      rootIsMother: !fatherIsRoot,
      endorser,
      endorsementLeafIndex: BigInt(endorsementLeafIndex),
      trustedLeafIndex: BigInt(trustedLeafIndex),
      writtenAt: endorsement.timestamp,
    });
  }
  return found.sort((left, right) => Number(left.writtenAt - right.writtenAt));
}
