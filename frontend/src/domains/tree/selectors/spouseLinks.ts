import type { NodeData, NodeId } from "../../../shared/model";
import { makeNodeId } from "../../../shared/model";
import type { TreeGraphData } from "./buildViewGraph";

// A co-parent / parent identity. versionIndex may be 0, the protocol's "unversioned" sentinel (a
// parent hash recorded without binding a concrete version); the data layer resolves those to a real
// version before fetching (see resolveBestSpouseVersion / pickBestVersionIndex).
export interface SpouseIdentity {
  personHash: string;
  versionIndex: number;
}

function sameHash(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function toSafeVersionIndex(value: number | string | undefined): number {
  if (value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

// A bytes32 hash that is present and not the all-zero sentinel ("no parent recorded").
export function isMeaningfulHash(hash?: string): hash is string {
  return Boolean(hash) && !/^0x0+$/i.test(hash as string);
}

// This protocol has no spouse field; the only way two people form a couple is by being the father
// and mother of the same child. So a person's spouses are the distinct "other parent" across their
// children, deduplicated by person hash (versions are alternative records of one individual, so
// different children referencing different versions of the same co-parent collapse to one spouse).
// Resolve which version of a co-parent to display given the concrete versions that child records
// pinned for them. No concrete version (all v0) → 0, the unversioned sentinel resolved later by
// async best-version resolution. Exactly one → trust that explicit, unambiguous pin. Two or more
// (a conflict between child/sibling records) → pick the best the same way the rest of the system
// does: most-endorsed, ties to the smallest versionIndex, using endorsement counts already fetched
// into nodesData (so it degrades to smallest before counts load, then self-corrects on the next
// render). Order-independent and consistent with chooseBestVersion / the v0 resolution path.
function chooseSpouseVersion(
  spouseHash: string,
  concreteVersions: Set<number>,
  nodesData: Record<string, NodeData>,
): number {
  if (concreteVersions.size === 0) return 0;
  if (concreteVersions.size === 1) return concreteVersions.values().next().value as number;
  const best = pickBestVersionIndex(
    Array.from(concreteVersions, (versionIndex) => ({
      versionIndex,
      endorsementCount: nodesData[makeNodeId(spouseHash, versionIndex)]?.endorsementCount ?? 0,
    })),
  );
  return best ?? 0;
}

function spouseRefsForPerson(
  personHash: string,
  childIds: NodeId[],
  nodesData: Record<string, NodeData>,
): SpouseIdentity[] {
  // Per co-parent hash: first-appearance order (for stable output ordering), the original hash
  // casing, and the set of distinct concrete versions any child pinned for them.
  const byKey = new Map<string, { order: number; hash: string; concreteVersions: Set<number> }>();
  let order = 0;
  for (const childId of childIds) {
    const child = nodesData[childId];
    if (!child) continue;
    let spouseHash: string | undefined;
    let spouseVersion: number | undefined;
    if (sameHash(child.fatherHash, personHash)) {
      spouseHash = child.motherHash;
      spouseVersion = toSafeVersionIndex(child.motherVersionIndex);
    } else if (sameHash(child.motherHash, personHash)) {
      spouseHash = child.fatherHash;
      spouseVersion = toSafeVersionIndex(child.fatherVersionIndex);
    } else {
      // Child carries no parent reference for this person (e.g. graph-only fixtures); co-parenthood
      // cannot be determined, so no spouse is inferred.
      continue;
    }
    if (!isMeaningfulHash(spouseHash)) continue;
    const key = spouseHash.toLowerCase();
    let entry = byKey.get(key);
    if (!entry) {
      entry = { order: order++, hash: spouseHash, concreteVersions: new Set() };
      byKey.set(key, entry);
    }
    const version = spouseVersion ?? 0;
    if (version > 0) entry.concreteVersions.add(version);
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({
      personHash: entry.hash,
      versionIndex: chooseSpouseVersion(entry.hash, entry.concreteVersions, nodesData),
    }));
}

// Pick the version with the highest endorsement count (tie → smallest versionIndex), matching the
// graph's chooseBestVersion rule. Used to resolve an unversioned (v0) co-parent reference to a
// concrete, fetchable version. Returns null when there are no versions.
export function pickBestVersionIndex(
  versions: Array<{ versionIndex: number; endorsementCount: number }>,
): number | null {
  let best: { versionIndex: number; endorsementCount: number } | null = null;
  for (const candidate of versions) {
    if (
      !best ||
      candidate.endorsementCount > best.endorsementCount ||
      (candidate.endorsementCount === best.endorsementCount &&
        candidate.versionIndex < best.versionIndex)
    ) {
      best = candidate;
    }
  }
  return best ? best.versionIndex : null;
}

// Per-person spouse links for views: each graph node id → its co-parent node ids. resolveVersion
// maps a co-parent (hash, rawVersion) to the version actually used for display — rawVersion > 0 is
// kept as-is; rawVersion 0 is mapped to the resolved best version once known (else left at 0, so the
// view falls back to a short-hash label until resolution lands). Pure: inject resolveVersion from
// the data layer's resolution cache.
export function buildSpouseLinks(params: {
  graph: TreeGraphData;
  nodesData: Record<string, NodeData>;
  resolveVersion?: (personHash: string, rawVersion: number) => number;
}): Map<NodeId, NodeId[]> {
  const { graph, nodesData, resolveVersion } = params;
  const links = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes) {
    const childIds = graph.childrenByParent[node.id] || [];
    const refs = spouseRefsForPerson(node.personHash, childIds, nodesData);
    if (!refs.length) continue;
    links.set(
      node.id,
      refs.map((ref) => {
        const version = resolveVersion
          ? resolveVersion(ref.personHash, ref.versionIndex)
          : ref.versionIndex;
        return makeNodeId(ref.personHash, version);
      }),
    );
  }
  return links;
}
