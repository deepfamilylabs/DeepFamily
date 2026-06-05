// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import {
  trustedEndorsementVisibilityKey,
  trustedEndorsersKey,
} from "../../../shared/cache/queryKeys";
import { makeNodeId, type NodeData, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { useTreeCacheActions } from "./useTreeCacheActions";

function createTreeCacheActionsHarness(initialNodes: Record<string, NodeData> = {}) {
  let nodesData = initialNodes;
  let edgesUnion: EdgeStoreUnion = {};
  let edgesStrict: EdgeStoreStrict = {};
  let reachableNodeIds: NodeId[] = [];

  const queryCache = new QueryCache();
  const refresh = vi.fn();

  const setNodesData = vi.fn((updater: React.SetStateAction<Record<string, NodeData>>) => {
    nodesData = typeof updater === "function" ? updater(nodesData) : updater;
  });
  const setEdgesUnion = vi.fn((updater: React.SetStateAction<EdgeStoreUnion>) => {
    edgesUnion = typeof updater === "function" ? updater(edgesUnion) : updater;
  });
  const setEdgesStrict = vi.fn((updater: React.SetStateAction<EdgeStoreStrict>) => {
    edgesStrict = typeof updater === "function" ? updater(edgesStrict) : updater;
  });
  const setReachableNodeIds = vi.fn((updater: React.SetStateAction<NodeId[]>) => {
    reachableNodeIds = typeof updater === "function" ? updater(reachableNodeIds) : updater;
  });

  const hook = renderHook(() =>
    useTreeCacheActions({
      api: null,
      contract: null,
      contractAddress: null,
      eventInterfaceRef: { current: null },
      queryCacheRef: { current: queryCache },
      nodesDataRef: { current: nodesData },
      edgesStrictRef: { current: edgesStrict },
      reachableNodeIdsRef: { current: reachableNodeIds },
      setNodesData,
      setEdgesUnion,
      setEdgesStrict,
      setReachableNodeIds,
      setProgress: vi.fn(),
      refresh,
      storageNS: "test-tree",
      edgesUnionKey: "test-tree::edges.union.v1",
      edgesStrictKey: "test-tree::edges.strict.v1",
      useIndexedDbCache: false,
      childrenPageLimit: 200,
      totalVersionsTtlMs: 60_000,
    }),
  );

  return {
    hook,
    queryCache,
    refresh,
    get nodesData() {
      return nodesData;
    },
  };
}

describe("useTreeCacheActions", () => {
  it("markVersionMinted upserts a minted node when tree data has not loaded it yet", () => {
    const personHash = `0x${"ab".repeat(32)}`;
    const harness = createTreeCacheActionsHarness();

    act(() => {
      harness.hook.result.current.markVersionMinted({
        personHash,
        versionIndex: 2,
        tokenId: "77",
        tokenURI: "ipfs://token",
        receipt: { hash: "0xmint" },
      });
    });

    expect(harness.nodesData[makeNodeId(personHash, 2)]).toMatchObject({
      personHash,
      versionIndex: 2,
      id: makeNodeId(personHash, 2),
      tokenId: "77",
      nftTokenURI: "ipfs://token",
    });
  });

  it("clearAllCaches drops trusted-source list and visibility caches", () => {
    const personHash = `0x${"cd".repeat(32)}`;
    const harness = createTreeCacheActionsHarness();
    harness.queryCache.set(trustedEndorsersKey(personHash, 1), ["0xsource"]);
    harness.queryCache.set(
      trustedEndorsementVisibilityKey(personHash, 1, ["0xsource"]),
      true,
    );

    act(() => {
      harness.hook.result.current.clearAllCaches();
    });

    expect(harness.queryCache.get(trustedEndorsersKey(personHash, 1), 0)).toBeUndefined();
    expect(
      harness.queryCache.get(trustedEndorsementVisibilityKey(personHash, 1, ["0xsource"]), 0),
    ).toBeUndefined();
  });

  it("invalidateByTx clears trusted visibility cache for an endorsed version", () => {
    const personHash = `0x${"ef".repeat(32)}`;
    const sources = ["0xsource"];
    const harness = createTreeCacheActionsHarness();
    harness.queryCache.set(trustedEndorsementVisibilityKey(personHash, 3, sources), false);
    // A different version's visibility must survive a same-person endorsement.
    harness.queryCache.set(trustedEndorsementVisibilityKey(personHash, 4, sources), true);

    act(() => {
      harness.hook.result.current.invalidateByTx({ hints: { personHash, versionIndex: 3 } });
    });

    expect(
      harness.queryCache.get(trustedEndorsementVisibilityKey(personHash, 3, sources), 0),
    ).toBeUndefined();
    expect(
      harness.queryCache.get(trustedEndorsementVisibilityKey(personHash, 4, sources), 0),
    ).toBe(true);
  });
});
