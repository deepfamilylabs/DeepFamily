import {
  SNARK_SCALAR_FIELD,
  buildLineageMerkleProofFromPath,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  wrapIdentityCommitmentAsPersonHash,
  type LineageTree,
} from "@deepfamily/protocol-core";
import { getAddress, isError, type BigNumberish, type ethers } from "ethers";
import { InheritanceError } from "../model/inheritanceErrors";
import type { IndexedVersion, LineageSnapshot } from "./inheritanceChain";

export type TargetedLineageRequest = {
  /** Load this parent's versions for the funding selector. No other people's versions are enumerated. */
  parentIdentityCommitments?: readonly bigint[];
  /** Include the selected parents' children; false for an already-selected funding destination. */
  includeChildren?: boolean;
  /** Explicit budget or funding qualifications, without enumerating unrelated children. */
  eligibility?: readonly {
    heirIdentityCommitment: bigint;
    rootIdentityCommitment: bigint;
    rootVersionIndex: number;
  }[];
  blockNumber?: number;
  limits?: { records?: number };
};

export class LineageSnapshotLimitError extends Error {
  readonly code = "lineageSnapshotLimit";
  constructor() {
    super(
      "The selected family records exceed this scan's limit. Narrow the family or increase the explicit scan limit.",
    );
    this.name = "LineageSnapshotLimitError";
  }
}

type Path = { root: bigint; leaf: bigint; index: bigint; siblings: bigint[] };
const lower = (value: unknown) => String(value).toLowerCase();
function fail(message: string): never {
  throw new InheritanceError("snapshotMismatch", message);
}
const field = (value: unknown) => {
  const result = BigInt(value as bigint);
  if (result < 0n || result >= SNARK_SCALAR_FIELD) fail("Invalid lineage field element");
  return result;
};
const boundedInteger = (value: unknown, maximum: number, label: string, minimum = 0) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    fail(`Invalid lineage ${label}`);
  return result;
};
const copyPath = (path: Path): Path => ({ ...path, siblings: [...path.siblings] });

/** Only authenticated, explicitly requested leaves exist in this local view of the global tree. */
export class RequestedLineagePaths implements LineageTree {
  readonly #paths = new Map<bigint, Path>();
  readonly #indices = new Map<bigint, bigint>();
  constructor(
    readonly root: bigint,
    readonly sizeBigInt: bigint,
  ) {}
  get size() {
    return this.sizeBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(this.sizeBigInt)
      : this.sizeBigInt;
  }
  get depth() {
    return this.sizeBigInt <= 1n ? 0 : (this.sizeBigInt - 1n).toString(2).length;
  }
  get leaves() {
    return [...this.#paths.values()].map((path) => path.leaf);
  }
  clone() {
    const clone = new RequestedLineagePaths(this.root, this.sizeBigInt);
    for (const [index, path] of this.#paths) clone.add(index, path);
    return clone;
  }
  insert(): never {
    throw new Error("A requested lineage path snapshot is read-only");
  }
  update(): never {
    throw new Error("A requested lineage path snapshot is read-only");
  }
  indexOf(leaf: bigint) {
    return this.#indices.get(leaf) ?? -1;
  }
  getNode(): never {
    throw new Error("A requested lineage snapshot does not expose a complete node store");
  }
  exportNodes(): never {
    throw new Error("A requested lineage snapshot cannot export a complete tree");
  }
  generateProof(index: BigNumberish): Path {
    const path = this.#paths.get(BigInt(index.toString()));
    if (!path) throw new Error("This lineage path was not requested or authenticated");
    return copyPath(path);
  }
  add(index: bigint, path: Path) {
    const previous = this.#paths.get(index);
    if (previous && previous.leaf !== path.leaf) throw new Error("Conflicting authenticated lineage paths");
    this.#paths.set(index, copyPath(path));
    const found = this.#indices.get(path.leaf);
    if (found === undefined || index < found) this.#indices.set(path.leaf, index);
  }
}

/**
 * Reads only selected family metadata and current on-chain Merkle paths. RPC operators can see
 * the queried people and endorsers. No global LeafWritten or VersionIndexed replay is used.
 * Endorsement version and timestamp are read from the index at that same block.
 */
export async function loadTargetedLineageSnapshot(
  lineageIndex: ethers.Contract,
  deepFamily: ethers.Contract,
  request: TargetedLineageRequest,
): Promise<LineageSnapshot> {
  const provider = lineageIndex.runner?.provider;
  const familyProvider = deepFamily.runner?.provider;
  if (!provider || !familyProvider) throw new Error("Lineage contracts have no provider");
  const [network, familyNetwork, head, indexAddress, familyAddress] = await Promise.all([
    provider.getNetwork(),
    familyProvider === provider ? undefined : familyProvider.getNetwork(),
    provider.getBlockNumber(),
    lineageIndex.getAddress(),
    deepFamily.getAddress(),
  ]);
  if (familyNetwork && familyNetwork.chainId !== network.chainId)
    fail("Family history provider uses another chain");
  const blockNumber = boundedInteger(
    request.blockNumber ?? head,
    Number.MAX_SAFE_INTEGER,
    "block number",
  );
  if (blockNumber > head) fail("Lineage snapshot is ahead of the chain");
  const anchor = await provider.getBlock(blockNumber);
  if (!anchor?.hash) fail("Lineage snapshot block is unavailable");
  const overrides = { blockTag: blockNumber };
  const recordLimit = boundedInteger(request.limits?.records ?? 2000, 100_000, "record limit", 1);
  if (
    typeof lineageIndex.getEndorsementMetadata !== "function" ||
    typeof lineageIndex.versionParents !== "function"
  ) {
    throw new InheritanceError(
      "lineageIncompatible",
      "The lineage index does not support current endorsement metadata and parent openings.",
    );
  }
  let remaining = recordLimit;
  const charge = (count = 1) => {
    if (count > remaining) throw new LineageSnapshotLimitError();
    remaining -= count;
  };
  const [boundFamily, boundIndex, roots, sizes] = await Promise.all([
    lineageIndex.DEEP_FAMILY(overrides),
    deepFamily.lineageIndex(overrides),
    Promise.all([0, 1].map((id) => lineageIndex.root(id, overrides).then(field))),
    Promise.all(
      [0, 1].map((id) =>
        lineageIndex.size(id, overrides).then((value: unknown) => {
          const size = BigInt(value as bigint);
          if (size < 0n || size > 1n << 64n) fail("Invalid lineage tree size");
          return size;
        }),
      ),
    ),
  ]);
  if (lower(boundFamily) !== lower(familyAddress) || lower(boundIndex) !== lower(indexAddress))
    fail("Family and lineage index do not match");
  let checkpointId: bigint;
  let checkpoint: ethers.Result;
  try {
    checkpointId = BigInt(await lineageIndex.currentCheckpointId(overrides));
    checkpoint = await lineageIndex.getCheckpoint(checkpointId, overrides);
  } catch (cause) {
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
  if (
    checkpointId < 0n ||
    (checkpointId === 0n && sizes.some((size) => size !== 0n)) ||
    field(checkpoint.endorsementRoot) !== roots[0] ||
    field(checkpoint.trustedRoot) !== roots[1] ||
    BigInt(checkpoint.createdAt) < 0n ||
    BigInt(checkpoint.createdAt) > BigInt(anchor.timestamp) ||
    BigInt(checkpoint.retiredAt) !== 0n
  ) {
    fail("Family eligibility checkpoint does not match the current tree roots");
  }
  const trees = roots.map((root, id) => new RequestedLineagePaths(root, sizes[id]));
  const versions = new Map<string, IndexedVersion[]>();
  const trustedEndorsers = new Map<string, Set<string>>();
  const endorsements: LineageSnapshot["endorsements"] = new Map();
  const identities = new Map<string, bigint>();
  const counts = new Map<string, number>();
  const identityOf = async (personHash: string) => {
    const key = lower(personHash);
    if (identities.has(key)) return identities.get(key)!;
    charge();
    const identity = field(await lineageIndex.identityCommitmentOf(key, overrides));
    if (identity !== 0n && lower(wrapIdentityCommitmentAsPersonHash(identity)) !== key)
      fail("Indexed identity does not match its person hash");
    identities.set(key, identity);
    return identity;
  };
  const countVersions = async (personHash: string) => {
    if (counts.has(personHash)) return counts.get(personHash)!;
    const count = boundedInteger(
      await deepFamily.personVersionsCount(personHash, overrides),
      Number.MAX_SAFE_INTEGER,
      "version count",
    );
    counts.set(personHash, count);
    return count;
  };
  const readVersion = async (personHash: string, versionIndex: number): Promise<IndexedVersion> => {
    const key = lower(personHash);
    const existing = versions.get(key)?.find((version) => version.versionIndex === versionIndex);
    if (existing) return existing;
    boundedInteger(versionIndex, Number.MAX_SAFE_INTEGER, "version index", 1);
    if (versionIndex > (await countVersions(key))) fail("Requested family version does not exist");
    charge();
    const [record, identity] = await Promise.all([
      deepFamily.personVersionAt(key, versionIndex - 1, overrides),
      identityOf(key),
    ]);
    if (
      lower(record.personHash) !== key ||
      BigInt(record.versionIndex) !== BigInt(versionIndex) ||
      identity === 0n
    )
      fail("Family version metadata is inconsistent");
    let parentOpening: { fatherIdentityCommitment: bigint; motherIdentityCommitment: bigint };
    try {
      parentOpening = await lineageIndex.versionParents(key, versionIndex, overrides);
    } catch (cause) {
      if (
        (isError(cause, "CALL_EXCEPTION") && (cause.data === null || cause.data === "0x")) ||
        (isError(cause, "BAD_DATA") && cause.value === "0x")
      ) {
        throw new InheritanceError(
          "lineageIncompatible",
          "The lineage index does not support current parent openings.",
        );
      }
      throw cause;
    }
    const father = field(parentOpening.fatherIdentityCommitment);
    const mother = field(parentOpening.motherIdentityCommitment);
    const parentHash = (identity: bigint) =>
      identity === 0n
        ? `0x${"00".repeat(32)}`
        : lower(wrapIdentityCommitmentAsPersonHash(identity));
    if (
      parentHash(father) !== lower(record.fatherHash) ||
      parentHash(mother) !== lower(record.motherHash)
    )
      fail("Indexed parent openings do not match the family version");
    const digest = computeLineageParentsDigest({
      fatherIdentityCommitment: father,
      motherIdentityCommitment: mother,
    });
    if (field(await lineageIndex.parentsDigestOf(key, versionIndex, overrides)) !== digest)
      fail("Family parent metadata does not match its indexed digest");
    const version = {
      personHash: key,
      versionIndex,
      identityCommitment: identity,
      fatherIdentityCommitment: father,
      motherIdentityCommitment: mother,
    };
    const list = versions.get(key) ?? [];
    list.push(version);
    list.sort((left, right) => left.versionIndex - right.versionIndex);
    versions.set(key, list);
    return version;
  };
  const readPath = async (treeId: number, index: bigint, expectedLeaf?: bigint) => {
    if (index < 0n || index >= sizes[treeId]) fail("Lineage slot is outside its tree");
    const raw = await lineageIndex.getMerkleProof(treeId, index, overrides);
    if (!Array.isArray(raw.siblings) || raw.siblings.length > 64)
      fail("Lineage proof exceeds the supported path depth");
    const siblings = Array.from(raw.siblings as Iterable<bigint>, field);
    const path = {
      root: field(raw.proofRoot),
      leaf: field(raw.leaf),
      index: BigInt(raw.proofIndex),
      siblings,
    };
    if (path.root !== roots[treeId] || (expectedLeaf !== undefined && path.leaf !== expectedLeaf))
      fail("Lineage proof has the wrong root or leaf");
    let position = index,
      levelSize = sizes[treeId],
      compactIndex = 0n,
      depth = 0;
    while (levelSize > 1n) {
      if ((position & 1n) === 1n || position + 1n < levelSize) {
        if (position & 1n) compactIndex |= 1n << BigInt(depth);
        depth++;
      }
      position >>= 1n;
      levelSize = (levelSize + 1n) >> 1n;
    }
    if (
      BigInt(raw.proofDepth) !== BigInt(depth) ||
      siblings.length !== depth ||
      path.index !== compactIndex
    )
      fail("Lineage proof does not match its physical slot");
    buildLineageMerkleProofFromPath(path);
    trees[treeId].add(index, path);
    return path;
  };
  const trustedCache = new Map<string, string[]>();
  const readTrusted = async (rootIdentity: bigint, versionIndex: number) => {
    const personHash = lower(wrapIdentityCommitmentAsPersonHash(rootIdentity));
    const key = `${personHash}:${versionIndex}`;
    if (trustedCache.has(key)) return trustedCache.get(key)!;
    await readVersion(personHash, versionIndex);
    const count = boundedInteger(
      await deepFamily.trustedEndorsersCount(personHash, versionIndex, overrides),
      Number.MAX_SAFE_INTEGER,
      "trusted endorser count",
    );
    charge(count);
    const accounts: string[] = [];
    for (let offset = 0; offset < count; offset++) {
      const account = lower(
        getAddress(await deepFamily.trustedEndorserAt(personHash, versionIndex, offset, overrides)),
      );
      if (BigInt(account) === 0n || accounts.includes(account))
        fail("Trusted endorser list is inconsistent");
      const slot = await lineageIndex.trustedLeafIndex(
        personHash,
        versionIndex,
        account,
        overrides,
      );
      if (!slot.exists) fail("Trusted endorser is absent from its indexed tree");
      await readPath(
        1,
        BigInt(slot.leafIndex),
        computeLineageTrustedLeaf({
          rootIdentityCommitment: rootIdentity,
          rootVersionIndex: versionIndex,
          account,
        }),
      );
      accounts.push(account);
    }
    trustedCache.set(key, accounts);
    trustedEndorsers.set(key, new Set(accounts));
    return accounts;
  };
  const endorsementCache = new Set<string>();
  const readEndorsement = async (heir: bigint, account: string) => {
    const personHash = lower(wrapIdentityCommitmentAsPersonHash(heir));
    const key = `${personHash}:${account}`;
    if (endorsementCache.has(key)) return;
    charge();
    let metadata: { versionIndex: bigint; writtenAt: bigint };
    try {
      metadata = await lineageIndex.getEndorsementMetadata(personHash, account, overrides);
    } catch (cause) {
      if (
        (isError(cause, "CALL_EXCEPTION") && (cause.data === null || cause.data === "0x")) ||
        (isError(cause, "BAD_DATA") && cause.value === "0x")
      ) {
        throw new InheritanceError(
          "lineageIncompatible",
          "The lineage index does not support current endorsement metadata and parent openings.",
        );
      }
      throw cause;
    }
    const versionIndex = boundedInteger(
      metadata.versionIndex,
      Number.MAX_SAFE_INTEGER,
      "endorsed version",
    );
    const familyVersion = BigInt(
      await deepFamily.endorsedVersionIndex(personHash, account, overrides),
    );
    if (familyVersion !== BigInt(versionIndex))
      fail("Family and index endorsement versions do not match");
    const timestamp = BigInt(metadata.writtenAt);
    if (timestamp < 0n || timestamp >= 1n << 64n || timestamp > BigInt(anchor.timestamp))
      fail("Invalid endorsement time");
    if (versionIndex === 0) {
      if (timestamp !== 0n) fail("Cancelled endorsement metadata was not cleared");
      endorsementCache.add(key);
      return;
    }
    const version = await readVersion(personHash, versionIndex);
    const slot = await lineageIndex.endorsementLeafIndex(personHash, account, overrides);
    if (!slot.exists) fail("Endorsed version has no indexed slot");
    const expected = computeLineageEndorsementLeaf({
      identityCommitment: heir,
      parentsDigest: computeLineageParentsDigest(version),
      versionIndex,
      endorser: account,
      writtenAt: timestamp,
    });
    await readPath(0, BigInt(slot.leafIndex), expected);
    const byEndorser = endorsements.get(personHash) ?? new Map();
    byEndorser.set(account, { versionIndex, timestamp });
    endorsements.set(personHash, byEndorser);
    endorsementCache.add(key);
  };
  const qualify = async (heirIdentity: bigint, rootIdentity: bigint, versionIndex: number) => {
    for (const account of await readTrusted(rootIdentity, versionIndex))
      await readEndorsement(heirIdentity, account);
  };
  const parents = [
    ...new Set((request.parentIdentityCommitments ?? []).map((value) => field(value))),
  ];
  const eligibility = request.eligibility ?? [];
  if (parents.length + eligibility.length > recordLimit) throw new LineageSnapshotLimitError();
  for (const parent of parents) {
    if (parent === 0n) fail("Parent identity must be nonzero");
    const personHash = lower(wrapIdentityCommitmentAsPersonHash(parent));
    const count = await countVersions(personHash);
    if (count > remaining) throw new LineageSnapshotLimitError();
    for (let versionIndex = 1; versionIndex <= count; versionIndex++) {
      await readVersion(personHash, versionIndex);
      await readTrusted(parent, versionIndex);
    }
    if (request.includeChildren === false || count === 0) continue;
    const childIdentities = new Set<bigint>();
    // A child's parent-version hint is optional and does not restrict the budget's
    // root version. Include the unspecified bucket and every known version bucket.
    for (let parentVersion = 0; parentVersion <= count; parentVersion++) {
      const children = boundedInteger(
        await deepFamily.childrenCount(personHash, parentVersion, overrides),
        Number.MAX_SAFE_INTEGER,
        "child count",
      );
      charge(children);
      for (let childIndex = 0; childIndex < children; childIndex++) {
        const child = await deepFamily.childrenOf(personHash, parentVersion, childIndex, overrides);
        const childHash = lower(child.childHash);
        const childVersion = boundedInteger(
          child.childVersionIndex,
          Number.MAX_SAFE_INTEGER,
          "child version",
          1,
        );
        const childRecord = await readVersion(childHash, childVersion);
        if (
          childRecord.fatherIdentityCommitment !== parent &&
          childRecord.motherIdentityCommitment !== parent
        )
          fail("Child listing does not refer to its requested parent");
        childIdentities.add(childRecord.identityCommitment);
      }
    }
    for (const childIdentity of childIdentities) {
      for (let versionIndex = 1; versionIndex <= count; versionIndex++)
        await qualify(childIdentity, parent, versionIndex);
    }
  }
  for (const item of eligibility) {
    const heir = field(item.heirIdentityCommitment),
      root = field(item.rootIdentityCommitment);
    if (heir === 0n || root === 0n) fail("Qualification identities must be nonzero");
    await qualify(
      heir,
      root,
      boundedInteger(item.rootVersionIndex, Number.MAX_SAFE_INTEGER, "root version", 1),
    );
  }
  const finalAnchor = await provider.getBlock(blockNumber);
  if (finalAnchor?.hash !== anchor.hash) fail("Lineage snapshot block was reorganized");
  if (
    familyProvider !== provider &&
    (await familyProvider.getBlock(blockNumber))?.hash !== anchor.hash
  )
    fail("Family history does not share the lineage block anchor");
  return {
    blockNumber,
    blockHash: anchor.hash!,
    timestamp: BigInt(anchor.timestamp),
    checkpointId,
    checkpointCreatedAt: BigInt(checkpoint.createdAt),
    versions,
    trustedEndorsers,
    endorsementTree: trees[0],
    trustedTree: trees[1],
    endorsements,
  };
}
