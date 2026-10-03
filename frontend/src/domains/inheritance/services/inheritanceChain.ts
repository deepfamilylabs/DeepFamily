import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  replayLineageTree,
  type LineageTree,
} from "@deepfamily/protocol-core";
import type { ethers } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";
import { InheritanceError } from "../model/inheritanceErrors";

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
  /** Lowercase person hash → that person's versions. */
  versions: Map<string, IndexedVersion[]>;
  /** `${personHash}:${versionIndex}` → current trusted endorsers, lowercase. */
  trustedEndorsers: Map<string, Set<string>>;
  endorsementTree: LineageTree;
  trustedTree: LineageTree;
  /** Lowercase person hash → endorser → that endorser's latest endorsement of the person. */
  endorsements: Map<string, Map<string, LatestEndorsement>>;
};

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

function collectVersions(events: ScannedEvent[]): Map<string, IndexedVersion[]> {
  const versions = new Map<string, IndexedVersion[]>();
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

function collectTrustedEndorsers(events: ScannedEvent[]): Map<string, Set<string>> {
  const trusted = new Map<string, Set<string>>();
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

/**
 * Rebuilds both lineage trees from `LeafWritten`, the versions from `VersionIndexed`, and each
 * endorser's latest endorsement from DeepFamily, all up to one block, then checks the rebuilt
 * roots against the index at that block.
 */
export async function loadLineageSnapshot(
  lineageIndex: ethers.Contract,
  deepFamily: ethers.Contract,
  options: ScanOptions = {},
): Promise<LineageSnapshot> {
  const blockNumber = await providerOf(lineageIndex).getBlockNumber();
  const [indexEvents, familyEvents] = await Promise.all([
    scanEvents(lineageIndex, ["LeafWritten", "VersionIndexed"], blockNumber, options),
    scanEvents(
      deepFamily,
      ["PersonVersionEndorsed", "TrustedEndorserAdded", "TrustedEndorserRemoved"],
      blockNumber,
      options,
    ),
  ]);

  const writes: Array<Array<{ leafIndex: bigint; leaf: bigint }>> = [[], []];
  for (const event of indexEvents) {
    if (event.name !== "LeafWritten") continue;
    const treeId = Number(event.args.treeId);
    if (treeId !== ENDORSEMENT_TREE && treeId !== TRUSTED_TREE) continue;
    writes[treeId].push({ leafIndex: BigInt(event.args.leafIndex), leaf: BigInt(event.args.leaf) });
  }
  const endorsementTree = replayLineageTree(writes[ENDORSEMENT_TREE]);
  const trustedTree = replayLineageTree(writes[TRUSTED_TREE]);
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

  // A later endorsement by the same account replaces the earlier one, as the index's slot does.
  const endorsements = new Map<string, Map<string, LatestEndorsement>>();
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

  return {
    blockNumber,
    versions: collectVersions(indexEvents),
    trustedEndorsers: collectTrustedEndorsers(familyEvents),
    endorsementTree,
    trustedTree,
    endorsements,
  };
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
