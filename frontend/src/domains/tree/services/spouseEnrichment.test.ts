import { describe, expect, it, vi } from "vitest";
import { makeNodeId, type NodeData } from "../../../shared/model";
import type { VersionEndorsement } from "../api/treeReadGateway";
import type { SpouseIdentity } from "../selectors";
import {
  collectParentRefs,
  planSpouseEnrichment,
  resolveBestSpouseVersion,
  runSpouseEnrichment,
  type ResolvedSpouseVersion,
} from "./spouseEnrichment";

describe("collectParentRefs", () => {
  it("collects distinct father/mother refs from the given nodes, keeping v0", () => {
    const nodesData: Record<string, NodeData> = {
      a: {
        id: "a",
        personHash: "0xa",
        versionIndex: 1,
        fatherHash: "0xdad",
        fatherVersionIndex: 2,
        motherHash: "0xmom",
        motherVersionIndex: 0,
      },
      b: { id: "b", personHash: "0xb", versionIndex: 1, fatherHash: "0xdad", fatherVersionIndex: 2 },
    };
    expect(collectParentRefs(nodesData, ["a", "b"])).toEqual([
      { personHash: "0xdad", versionIndex: 2 },
      { personHash: "0xmom", versionIndex: 0 },
    ]);
  });

  it("only scans the given nodeIds, so a spouse's own parents are not collected (no recursion)", () => {
    const nodesData: Record<string, NodeData> = {
      a: { id: "a", personHash: "0xa", versionIndex: 1, motherHash: "0xmom", motherVersionIndex: 1 },
      spouseNode: {
        id: "spouseNode",
        personHash: "0xmom",
        versionIndex: 1,
        fatherHash: "0xgrandpa",
        fatherVersionIndex: 1,
      },
    };
    expect(collectParentRefs(nodesData, ["a"])).toEqual([{ personHash: "0xmom", versionIndex: 1 }]);
  });

  it("skips the all-zero parent hash (no parent recorded)", () => {
    const nodesData: Record<string, NodeData> = {
      a: {
        id: "a",
        personHash: "0xa",
        versionIndex: 1,
        fatherHash: `0x${"0".repeat(64)}`,
        fatherVersionIndex: 0,
        motherHash: "0xmom",
        motherVersionIndex: 1,
      },
    };
    expect(collectParentRefs(nodesData, ["a"])).toEqual([{ personHash: "0xmom", versionIndex: 1 }]);
  });
});

describe("planSpouseEnrichment", () => {
  const empty = { resolution: new Map<string, number>(), unresolvable: new Set<string>() };

  it("targets concrete versions that aren't fetched yet", async () => {
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 2 }],
      isFetched: () => false,
      ...empty,
      resolveBestVersion: async () => null,
    });
    expect(plan.targets).toEqual([{ personHash: "0xmom", versionIndex: 2 }]);
  });

  it("skips already-fetched targets", async () => {
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 2 }],
      isFetched: () => true,
      ...empty,
      resolveBestVersion: async () => null,
    });
    expect(plan.targets).toEqual([]);
  });

  it("resolves a v0 reference and records the resolution", async () => {
    const resolveBestVersion = vi.fn(
      async (): Promise<ResolvedSpouseVersion> => ({ versionIndex: 3, tokenId: "30" }),
    );
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xMom", versionIndex: 0 }],
      isFetched: () => false,
      resolution: new Map(),
      unresolvable: new Set(),
      resolveBestVersion,
    });
    expect(plan.targets).toEqual([{ personHash: "0xMom", versionIndex: 3 }]);
    expect(plan.newResolutions).toEqual([["0xmom", 3]]);
    expect(resolveBestVersion).toHaveBeenCalledWith("0xMom");
  });

  it("marks a v0 reference unresolvable when it has no versions, without targeting", async () => {
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 0 }],
      isFetched: () => false,
      resolution: new Map(),
      unresolvable: new Set(),
      resolveBestVersion: async () => null,
    });
    expect(plan.targets).toEqual([]);
    expect(plan.newUnresolvable).toEqual(["0xmom"]);
  });

  it("uses a cached resolution instead of re-resolving", async () => {
    const resolveBestVersion = vi.fn(async (): Promise<ResolvedSpouseVersion | null> => null);
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 0 }],
      isFetched: () => false,
      resolution: new Map([["0xmom", 4]]),
      unresolvable: new Set(),
      resolveBestVersion,
    });
    expect(plan.targets).toEqual([{ personHash: "0xmom", versionIndex: 4 }]);
    expect(resolveBestVersion).not.toHaveBeenCalled();
  });

  it("skips a v0 reference already known unresolvable", async () => {
    const resolveBestVersion = vi.fn(async (): Promise<ResolvedSpouseVersion | null> => null);
    const plan = await planSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 0 }],
      isFetched: () => false,
      resolution: new Map(),
      unresolvable: new Set(["0xmom"]),
      resolveBestVersion,
    });
    expect(plan.targets).toEqual([]);
    expect(resolveBestVersion).not.toHaveBeenCalled();
  });
});

describe("resolveBestSpouseVersion", () => {
  it("resolves to the highest-endorsed version and returns its tokenId", async () => {
    const list = vi.fn(
      async (): Promise<VersionEndorsement[]> => [
        { versionIndex: 1, endorsementCount: 2, tokenId: "10" },
        { versionIndex: 2, endorsementCount: 5, tokenId: "20" },
      ],
    );
    await expect(resolveBestSpouseVersion("0xspouse", list)).resolves.toEqual({
      versionIndex: 2,
      tokenId: "20",
    });
    expect(list).toHaveBeenCalledWith("0xspouse");
  });

  it("breaks ties on endorsement count by smallest version", async () => {
    const list = async (): Promise<VersionEndorsement[]> => [
      { versionIndex: 3, endorsementCount: 5, tokenId: "30" },
      { versionIndex: 1, endorsementCount: 5, tokenId: "10" },
    ];
    await expect(resolveBestSpouseVersion("0xspouse", list)).resolves.toEqual({
      versionIndex: 1,
      tokenId: "10",
    });
  });

  it("returns null when the person has no versions on-chain", async () => {
    const list = async (): Promise<VersionEndorsement[]> => [];
    await expect(resolveBestSpouseVersion("0xspouse", list)).resolves.toBeNull();
  });
});

describe("runSpouseEnrichment", () => {
  const caches = () => ({
    resolution: new Map<string, number>(),
    unresolvable: new Set<string>(),
    inflight: new Set<string>(),
  });

  it("reports a planning RPC rejection through reportError instead of leaking a rejection", async () => {
    const reportError = vi.fn();
    const fetchBatch = vi.fn(async () => [] as Array<{ id: string }>);
    await expect(
      runSpouseEnrichment({
        parentRefs: [{ personHash: "0xmom", versionIndex: 0 }],
        isFetched: () => false,
        ...caches(),
        resolveBestVersion: async () => {
          throw new Error("rpc down");
        },
        fetchBatch,
        applyResolutions: vi.fn(),
        applyPatches: vi.fn(),
        reportError,
      }),
    ).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalledTimes(1);
    const [error, stage] = reportError.mock.calls[0];
    expect((error as Error).message).toBe("rpc down");
    expect(stage).toBe("spouse_resolution");
    // The plan never produced targets, so no batch fetch should have been attempted.
    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("folds new resolutions into the host cache and applies fetched patches", async () => {
    const c = caches();
    const applyResolutions = vi.fn();
    const applyPatches = vi.fn();
    const fetchBatch = vi.fn(async (targets: SpouseIdentity[]) =>
      targets.map((t) => ({ id: t.personHash })),
    );

    await runSpouseEnrichment({
      parentRefs: [{ personHash: "0xMom", versionIndex: 0 }],
      isFetched: () => false,
      ...c,
      resolveBestVersion: async () => ({ versionIndex: 3, tokenId: "30" }),
      fetchBatch,
      applyResolutions,
      applyPatches,
      reportError: vi.fn(),
    });

    expect(applyResolutions).toHaveBeenCalledWith([["0xmom", 3]]);
    expect(fetchBatch).toHaveBeenCalledWith([{ personHash: "0xMom", versionIndex: 3 }]);
    expect(applyPatches).toHaveBeenCalledWith([{ id: "0xMom" }]);
    // Inflight markers are released once the batch settles.
    expect(c.inflight.size).toBe(0);
  });

  it("reports a batch fetch rejection and still clears inflight markers", async () => {
    const c = caches();
    const reportError = vi.fn();
    const applyPatches = vi.fn();

    await runSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 2 }],
      isFetched: () => false,
      ...c,
      resolveBestVersion: async () => null,
      fetchBatch: async () => {
        throw new Error("batch boom");
      },
      applyResolutions: vi.fn(),
      applyPatches,
      reportError,
    });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toBe("spouse_enrichment_batch");
    expect(applyPatches).not.toHaveBeenCalled();
    expect(c.inflight.size).toBe(0);
  });

  it("skips targets already inflight", async () => {
    const c = caches();
    c.inflight.add(makeNodeId("0xmom", 2));
    const fetchBatch = vi.fn(async () => [] as Array<{ id: string }>);

    await runSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 2 }],
      isFetched: () => false,
      ...c,
      resolveBestVersion: async () => null,
      fetchBatch,
      applyResolutions: vi.fn(),
      applyPatches: vi.fn(),
      reportError: vi.fn(),
    });

    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("does not fetch when cancelled after planning", async () => {
    const fetchBatch = vi.fn(async () => [] as Array<{ id: string }>);

    await runSpouseEnrichment({
      parentRefs: [{ personHash: "0xmom", versionIndex: 2 }],
      isFetched: () => false,
      ...caches(),
      resolveBestVersion: async () => null,
      fetchBatch,
      applyResolutions: vi.fn(),
      applyPatches: vi.fn(),
      reportError: vi.fn(),
      isCancelled: () => true,
    });

    expect(fetchBatch).not.toHaveBeenCalled();
  });
});
