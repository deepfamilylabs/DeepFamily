import { describe, expect, it, vi } from "vitest";
import {
  applyTreeBuildNodeSnapshots,
  applyTreeBuildStrictSnapshots,
  applyTreeBuildUnionSnapshots,
  runTreeBuildSession,
} from "./treeTraversalOrchestrator";

describe("treeBuildSession", () => {
  it("runs a strict traversal and emits node/edge snapshots", async () => {
    const strictEntries: Record<string, { childIds: string[]; fetchedAt: number }> = {
      "0xaaa-v-1": { childIds: ["0xbbb-v-1", "0xccc-v-1"], fetchedAt: Date.now() },
      "0xbbb-v-1": { childIds: [], fetchedAt: Date.now() },
      "0xccc-v-1": { childIds: [], fetchedAt: Date.now() },
    };
    const nodeSnapshots: Array<Record<string, any>> = [];
    const strictSnapshots: Array<Record<string, any>> = [];
    const progress = vi.fn();

    const result = await runTreeBuildSession({
      rootId: "0xaaa-v-1",
      traversal: "bfs",
      childrenMode: "strict",
      strictIncludeUnversionedChildren: false,
      hardNodeLimit: 10,
      edgeTtlMs: 60_000,
      getCurrentNodes: () => ({}),
      getCurrentEdgesStrict: () => ({}),
      getCurrentEdgesUnion: () => ({}),
      loadChildrenStrict: vi.fn(async (nodeId: string) => strictEntries[nodeId] ?? { childIds: [], fetchedAt: Date.now() }),
      loadChildrenUnion: vi.fn(),
      checkAbort: vi.fn(),
      onCommitNodes: (snapshot) => nodeSnapshots.push(snapshot),
      onCommitEdgesStrict: (snapshot) => strictSnapshots.push(snapshot),
      onProgress: progress,
      flushBatchSize: 2,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 100;
          return tick;
        };
      })(),
    });

    expect(result.visitedIds).toEqual(["0xaaa-v-1", "0xbbb-v-1", "0xccc-v-1"]);
    expect(result.progress).toEqual({ created: 3, visited: 3, depth: 2 });
    expect(progress).toHaveBeenCalled();

    const mergedNodes = nodeSnapshots.reduce(applyTreeBuildNodeSnapshots, {});
    expect(Object.keys(mergedNodes)).toEqual(["0xaaa-v-1", "0xbbb-v-1", "0xccc-v-1"]);

    const mergedStrict = strictSnapshots.reduce(applyTreeBuildStrictSnapshots, {});
    expect(mergedStrict["0xaaa-v-1"]?.childIds).toEqual(["0xbbb-v-1", "0xccc-v-1"]);
  });

  it("applies union edge snapshots", () => {
    expect(
      applyTreeBuildUnionSnapshots(
        { "0xaaa": { childIds: ["0xbbb-v-1"], fetchedAt: 1 } },
        { "0xccc": { childIds: ["0xddd-v-1"], fetchedAt: 2 } },
      ),
    ).toEqual({
      "0xaaa": { childIds: ["0xbbb-v-1"], fetchedAt: 1 },
      "0xccc": { childIds: ["0xddd-v-1"], fetchedAt: 2 },
    });
  });
});
