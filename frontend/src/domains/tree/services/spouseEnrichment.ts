import { makeNodeId, type NodeData } from "../../../shared/model";
import type { VersionEndorsement } from "../api/treeReadGateway";
import { isMeaningfulHash, pickBestVersionIndex, type SpouseIdentity } from "../selectors";

export interface ResolvedSpouseVersion {
  versionIndex: number;
  tokenId: string;
}

// Distinct parent references (father/mother) recorded by the given nodes, as (hash, rawVersion).
// nodeIds is normally the reachable descendant set, so this yields exactly the co-parents (spouses)
// of the traversed people — one layer, not the married-in ancestor chain (scanning all of nodesData
// would recurse into spouses-of-spouses as they get fetched). rawVersion may be 0 (the unversioned
// sentinel). Deduped by hash+version.
export function collectParentRefs(
  nodesData: Record<string, NodeData>,
  nodeIds: Iterable<string>,
): SpouseIdentity[] {
  const seen = new Set<string>();
  const refs: SpouseIdentity[] = [];
  const add = (hash: string | undefined, version: number | undefined) => {
    if (!isMeaningfulHash(hash)) return;
    const versionIndex = version ?? 0;
    const key = `${hash.toLowerCase()}-v-${versionIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ personHash: hash, versionIndex });
  };
  for (const id of nodeIds) {
    const node = nodesData[id];
    if (!node) continue;
    add(node.fatherHash, node.fatherVersionIndex);
    add(node.motherHash, node.motherVersionIndex);
  }
  return refs;
}

// Resolve an unversioned (v0) co-parent reference to a concrete, fetchable version: the highest-
// endorsed version of that person (ties → smallest version, matching the graph's chooseBestVersion
// rule). Returns the version + its tokenId, or null when the person has no on-chain versions.
export async function resolveBestSpouseVersion(
  personHash: string,
  listVersionEndorsements: (personHash: string) => Promise<VersionEndorsement[]>,
): Promise<ResolvedSpouseVersion | null> {
  const versions = await listVersionEndorsements(personHash);
  const best = pickBestVersionIndex(versions);
  if (best == null) return null;
  const match = versions.find((version) => version.versionIndex === best);
  return match ? { versionIndex: match.versionIndex, tokenId: match.tokenId } : null;
}

export interface SpouseEnrichmentPlan {
  // Concrete (personHash, versionIndex) pairs that still need fetching.
  targets: SpouseIdentity[];
  // hashLower → resolved version, to fold into the resolution cache so views can map v0 → version.
  newResolutions: Array<[string, number]>;
  // hashLower with no fetchable version, to remember and stop re-resolving.
  newUnresolvable: string[];
}

// Turn raw parent references into a concrete fetch plan: resolve v0 references to a best version
// (consulting/extending the resolution cache, skipping ones already known unresolvable), drop
// already-fetched targets, and dedupe. Pure aside from the injected resolveBestVersion RPC, so the
// effect can stay thin and this stays unit-testable.
export async function planSpouseEnrichment(params: {
  parentRefs: SpouseIdentity[];
  isFetched: (personHash: string, versionIndex: number) => boolean;
  resolution: ReadonlyMap<string, number>;
  unresolvable: ReadonlySet<string>;
  resolveBestVersion: (personHash: string) => Promise<ResolvedSpouseVersion | null>;
}): Promise<SpouseEnrichmentPlan> {
  const { parentRefs, isFetched, resolution, unresolvable, resolveBestVersion } = params;
  const targets: SpouseIdentity[] = [];
  const targetSeen = new Set<string>();
  const newResolutions: Array<[string, number]> = [];
  const newUnresolvable: string[] = [];
  const resolvedThisRun = new Map<string, number>();
  const failedThisRun = new Set<string>();

  for (const ref of parentRefs) {
    const hashLower = ref.personHash.toLowerCase();
    let version = ref.versionIndex;
    if (version === 0) {
      const known = resolution.get(hashLower) ?? resolvedThisRun.get(hashLower);
      if (known != null) {
        version = known;
      } else if (unresolvable.has(hashLower) || failedThisRun.has(hashLower)) {
        continue;
      } else {
        const resolved = await resolveBestVersion(ref.personHash);
        if (!resolved) {
          failedThisRun.add(hashLower);
          newUnresolvable.push(hashLower);
          continue;
        }
        version = resolved.versionIndex;
        resolvedThisRun.set(hashLower, version);
        newResolutions.push([hashLower, version]);
      }
    }
    if (isFetched(ref.personHash, version)) continue;
    const id = `${hashLower}-v-${version}`;
    if (targetSeen.has(id)) continue;
    targetSeen.add(id);
    targets.push({ personHash: ref.personHash, versionIndex: version });
  }

  return { targets, newResolutions, newUnresolvable };
}

// Stages reported back to the host so it can dedupe/log each failure mode once.
export type SpouseEnrichmentStage = "spouse_resolution" | "spouse_enrichment_batch";

// Orchestrate one spouse-enrichment pass: build the fetch plan (resolving v0 refs), fold new
// resolutions/unresolvable marks back into the caller's caches, then fetch the concrete targets in
// batches. Kept out of the React effect (deps injected) so it stays unit-testable and so both
// failure paths — the planning RPC and the batch fetch — report through `reportError` instead of
// surfacing as unhandled promise rejections. `unresolvable` and `inflight` are mutated in place to
// mirror the long-lived refs the host keeps across re-runs.
export async function runSpouseEnrichment<TPatch>(params: {
  parentRefs: SpouseIdentity[];
  isFetched: (personHash: string, versionIndex: number) => boolean;
  resolution: ReadonlyMap<string, number>;
  unresolvable: Set<string>;
  inflight: Set<string>;
  resolveBestVersion: (personHash: string) => Promise<ResolvedSpouseVersion | null>;
  fetchBatch: (targets: SpouseIdentity[]) => Promise<TPatch[]>;
  applyResolutions: (newResolutions: Array<[string, number]>) => void;
  applyPatches: (patches: TPatch[]) => void;
  reportError: (error: unknown, stage: SpouseEnrichmentStage) => void;
  isCancelled?: () => boolean;
  batchSize?: number;
}): Promise<void> {
  const {
    parentRefs,
    isFetched,
    resolution,
    unresolvable,
    inflight,
    resolveBestVersion,
    fetchBatch,
    applyResolutions,
    applyPatches,
    reportError,
    isCancelled = () => false,
    batchSize = 40,
  } = params;

  if (parentRefs.length === 0) return;

  let plan: SpouseEnrichmentPlan;
  try {
    plan = await planSpouseEnrichment({
      parentRefs,
      isFetched,
      resolution,
      unresolvable,
      resolveBestVersion,
    });
  } catch (error) {
    // A version-resolution RPC rejected; report it instead of leaking an unhandled rejection.
    reportError(error, "spouse_resolution");
    return;
  }
  if (isCancelled()) return;

  for (const hashLower of plan.newUnresolvable) unresolvable.add(hashLower);
  if (plan.newResolutions.length > 0) applyResolutions(plan.newResolutions);

  const targets = plan.targets.filter(
    (ref) => !inflight.has(makeNodeId(ref.personHash, ref.versionIndex)),
  );
  if (targets.length === 0) return;

  for (let i = 0; i < targets.length && !isCancelled(); i += batchSize) {
    const slice = targets.slice(i, i + batchSize);
    const sliceIds = slice.map((ref) => makeNodeId(ref.personHash, ref.versionIndex));
    sliceIds.forEach((id) => inflight.add(id));
    try {
      const patches = await fetchBatch(slice);
      if (!isCancelled() && patches.length > 0) applyPatches(patches);
    } catch (error) {
      reportError(error, "spouse_enrichment_batch");
    } finally {
      sliceIds.forEach((id) => inflight.delete(id));
    }
  }
}
