// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import type { NodeData } from "../../../shared/model";
import { clearTreeMetadataUnlocks } from "../services/treeNodesPersistence";
import { buildTreeStorageNamespace } from "./treeStorageScope";
import { useTreeGraphState } from "./useTreeGraphState";

const persistenceMocks = vi.hoisted(() => ({
  blobs: new Map<string, unknown>(),
  readBlob: vi.fn(),
  writeBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock("../../../shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/config/env")>();
  return { ...actual, isIndexedDbCacheEnabled: () => true };
});

vi.mock("../../../shared/cache/persistence", () => ({
  isIndexedDBSupported: () => true,
  readBlob: (...args: unknown[]) => persistenceMocks.readBlob(...args),
  writeBlob: (...args: unknown[]) => persistenceMocks.writeBlob(...args),
  deleteBlob: (...args: unknown[]) => persistenceMocks.deleteBlob(...args),
}));

const proxyA = "0x00000000000000000000000000000000000000aa";
const proxyB = "0x00000000000000000000000000000000000000bb";
const personHash = `0x${"12".repeat(32)}`;
const nodeId = `${personHash}-v-1`;

const unlockedNode: NodeData = {
  id: nodeId,
  personHash,
  versionIndex: 1,
  versionCommitment: "123456789",
  metadataPointer: `0x${"34".repeat(20)}`,
  metadataPayloadHash: `0x${"56".repeat(32)}`,
  metadataPayloadLength: 256,
  metadataUnlockValidated: true,
  metadataProtocolGeneration: "df-onchain-biography-v1",
  metadataFormatVersion: 1,
  identitySuiteId: 1,
  metadataPerson: {
    fullName: "Scope Alice",
    gender: 2,
    birthYear: 1980,
    birthMonth: 1,
    birthDay: 2,
    isBirthBC: false,
    personHash,
  },
  metadataParents: { father: null, mother: null },
  fullName: "Scope Alice",
  tag: "scope-private-tag",
  biography: "scope-private-biography",
  tokenId: "0",
};

describe("tree plaintext IndexedDB scope", () => {
  beforeEach(() => {
    persistenceMocks.blobs.clear();
    persistenceMocks.readBlob.mockReset();
    persistenceMocks.writeBlob.mockReset();
    persistenceMocks.deleteBlob.mockReset();
    persistenceMocks.readBlob.mockImplementation(async (key: string) => {
      return persistenceMocks.blobs.get(key) ?? null;
    });
    persistenceMocks.writeBlob.mockResolvedValue(undefined);
    persistenceMocks.deleteBlob.mockImplementation(async (key: string) => {
      persistenceMocks.blobs.delete(key);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates only an exact protocol-generation + chain + proxy namespace", async () => {
    const sourceScope = buildTreeStorageNamespace({
      protocolGeneration: "df-onchain-biography-v1",
      chainId: 71,
      contractAddress: proxyA,
    });
    const isolatedScopes = [
      buildTreeStorageNamespace({
        protocolGeneration: "df-onchain-biography-v1",
        chainId: 71,
        contractAddress: proxyB,
      }),
      buildTreeStorageNamespace({
        protocolGeneration: "df-onchain-biography-v1",
        chainId: 1,
        contractAddress: proxyA,
      }),
      buildTreeStorageNamespace({
        protocolGeneration: "df-onchain-biography-v2",
        chainId: 71,
        contractAddress: proxyA,
      }),
    ];
    expect(new Set([sourceScope, ...isolatedScopes])).toHaveProperty("size", 4);
    persistenceMocks.blobs.set(`${sourceScope}::nodesData`, { [nodeId]: unlockedNode });

    const queryCacheRef = { current: new QueryCache() };
    const { result, rerender } = renderHook(
      ({ storageNS }: { storageNS: string }) =>
        useTreeGraphState({
          rootId: null,
          rootHash: null,
          rootVersionIndex: null,
          provider: null,
          contract: null,
          api: null,
          queryCacheRef,
          storageNS,
          edgesUnionKey: `${storageNS}::edges.union.v1`,
          edgesStrictKey: `${storageNS}::edges.strict.v1`,
          refreshTick: 0,
          traversal: "dfs",
          childrenMode: "strict",
          strictIncludeUnversionedChildren: false,
          trustedSourceFilterEnabled: false,
          edgeTtlMs: 60_000,
          totalVersionsTtlMs: 60_000,
          versionDetailsTtlMs: 60_000,
          nftDetailsTtlMs: 60_000,
          childrenPageLimit: 200,
          t: (key: string) => key,
          push: vi.fn(),
        }),
      { initialProps: { storageNS: sourceScope } },
    );

    await waitFor(() => expect(result.current.idbHydrated).toBe(true));
    await waitFor(() => expect(result.current.nodesData[nodeId]?.tag).toBe("scope-private-tag"));

    for (const isolatedScope of isolatedScopes) {
      persistenceMocks.readBlob.mockClear();
      rerender({ storageNS: isolatedScope });
      await waitFor(() =>
        expect(persistenceMocks.readBlob).toHaveBeenCalledWith(`${isolatedScope}::nodesData`),
      );
      await waitFor(() => expect(result.current.nodesData[nodeId]).toBeUndefined());
      expect(persistenceMocks.readBlob).not.toHaveBeenCalledWith(`${sourceScope}::nodesData`);
    }

    persistenceMocks.readBlob.mockClear();
    rerender({ storageNS: sourceScope });
    await waitFor(() =>
      expect(persistenceMocks.readBlob).toHaveBeenCalledWith(`${sourceScope}::nodesData`),
    );
    await waitFor(() => expect(result.current.nodesData[nodeId]?.tag).toBe("scope-private-tag"));
  });

  it("drops a deferred plaintext snapshot when storage scope changes before backfill", async () => {
    const sourceScope = "deferred-snapshot-scope-a";
    const targetScope = "deferred-snapshot-scope-b";
    const freshUnlockedNode: NodeData = {
      ...unlockedNode,
      endorsementCount: 1,
      tokenId: "0",
      versionDetailsFetchedAt: Date.now(),
    };
    let deferSourceRead = false;
    let resolveSourceRead!: (value: unknown) => void;
    persistenceMocks.readBlob.mockImplementation((key: string) => {
      if (deferSourceRead && key === `${sourceScope}::nodesData`) {
        deferSourceRead = false;
        return new Promise((resolve) => {
          resolveSourceRead = resolve;
        });
      }
      return Promise.resolve(persistenceMocks.blobs.get(key) ?? null);
    });
    const queryCacheRef = { current: new QueryCache() };
    const api = { getVersionDetails: vi.fn(), getNFTDetails: vi.fn() };
    const contract = { getStoryMetadata: vi.fn() };
    const { result, rerender } = renderHook(
      ({ storageNS, enabled }: { storageNS: string; enabled: boolean }) =>
        useTreeGraphState({
          rootId: null,
          rootHash: null,
          rootVersionIndex: null,
          provider: null,
          contract: enabled ? contract : null,
          api: enabled ? api : null,
          queryCacheRef,
          storageNS,
          edgesUnionKey: `${storageNS}::edges.union.v1`,
          edgesStrictKey: `${storageNS}::edges.strict.v1`,
          refreshTick: 0,
          traversal: "dfs",
          childrenMode: "strict",
          strictIncludeUnversionedChildren: false,
          trustedSourceFilterEnabled: false,
          edgeTtlMs: 60_000,
          totalVersionsTtlMs: 60_000,
          versionDetailsTtlMs: 60_000,
          nftDetailsTtlMs: 60_000,
          childrenPageLimit: 200,
          t: (key: string) => key,
          push: vi.fn(),
        }),
      { initialProps: { storageNS: sourceScope, enabled: true } },
    );
    await waitFor(() => expect(result.current.idbHydrated).toBe(true));

    deferSourceRead = true;
    act(() => {
      result.current.setNodesData({
        [nodeId]: { id: nodeId, personHash, versionIndex: 1 },
      });
      result.current.setReachableNodeIds([nodeId]);
    });
    await waitFor(() => expect(resolveSourceRead).toBeTypeOf("function"));

    rerender({ storageNS: targetScope, enabled: false });
    await waitFor(() => expect(result.current.nodesData[nodeId]).toBeUndefined());
    await act(async () => {
      resolveSourceRead({ [nodeId]: freshUnlockedNode });
      await Promise.resolve();
    });

    expect(result.current.nodesData[nodeId]).toBeUndefined();
    expect(JSON.stringify(result.current.nodesData)).not.toContain("scope-private-tag");
    expect(JSON.stringify(result.current.nodesData)).not.toContain("scope-private-biography");
  });

  it("rehydrates fail-closed after delete succeeds and the public-only rewrite fails", async () => {
    const storageNS = "clear-rewrite-failure-scope";
    const storageKey = `${storageNS}::nodesData`;
    persistenceMocks.blobs.set(storageKey, { [nodeId]: unlockedNode });
    persistenceMocks.writeBlob.mockRejectedValueOnce(new Error("IndexedDB quota exceeded"));

    await clearTreeMetadataUnlocks(storageKey, { [nodeId]: unlockedNode });
    const queryCacheRef = { current: new QueryCache() };
    const { result } = renderHook(() =>
      useTreeGraphState({
        rootId: null,
        rootHash: null,
        rootVersionIndex: null,
        provider: null,
        contract: null,
        api: null,
        queryCacheRef,
        storageNS,
        edgesUnionKey: `${storageNS}::edges.union.v1`,
        edgesStrictKey: `${storageNS}::edges.strict.v1`,
        refreshTick: 0,
        traversal: "dfs",
        childrenMode: "strict",
        strictIncludeUnversionedChildren: false,
        trustedSourceFilterEnabled: false,
        edgeTtlMs: 60_000,
        totalVersionsTtlMs: 60_000,
        versionDetailsTtlMs: 60_000,
        nftDetailsTtlMs: 60_000,
        childrenPageLimit: 200,
        t: (key: string) => key,
        push: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.idbHydrated).toBe(true));
    expect(result.current.nodesData[nodeId]).toBeUndefined();
    expect(JSON.stringify(result.current.nodesData)).not.toContain("scope-private");
  });

  it("drops deferred enrichment patches carrying old-scope plaintext after a scope switch", async () => {
    const sourceScope = "deferred-fetch-scope-a";
    const targetScope = "deferred-fetch-scope-b";
    let resolveNft!: (value: unknown) => void;
    const api = {
      getVersionDetails: vi.fn(async () => ({
        version: { versionCommitment: unlockedNode.versionCommitment },
        metadata: {
          pointer: unlockedNode.metadataPointer,
          payloadHash: unlockedNode.metadataPayloadHash,
          payloadLength: unlockedNode.metadataPayloadLength,
        },
        endorsementCount: 2,
        tokenId: "42",
      })),
      getNFTDetails: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveNft = resolve;
          }),
      ),
    };
    const contract = {
      getStoryMetadata: vi.fn(async () => ({
        totalChunks: 0,
        totalLength: 0,
        isSealed: false,
        lastUpdateTime: 0,
        fullStoryHash: `0x${"00".repeat(32)}`,
      })),
    };
    const queryCacheRef = { current: new QueryCache() };
    const { result, rerender } = renderHook(
      ({ storageNS, enabled }: { storageNS: string; enabled: boolean }) =>
        useTreeGraphState({
          rootId: null,
          rootHash: null,
          rootVersionIndex: null,
          provider: null,
          contract: enabled ? contract : null,
          api: enabled ? api : null,
          queryCacheRef,
          storageNS,
          edgesUnionKey: `${storageNS}::edges.union.v1`,
          edgesStrictKey: `${storageNS}::edges.strict.v1`,
          refreshTick: 0,
          traversal: "dfs",
          childrenMode: "strict",
          strictIncludeUnversionedChildren: false,
          trustedSourceFilterEnabled: false,
          edgeTtlMs: 60_000,
          totalVersionsTtlMs: 60_000,
          versionDetailsTtlMs: 60_000,
          nftDetailsTtlMs: 60_000,
          childrenPageLimit: 200,
          t: (key: string) => key,
          push: vi.fn(),
        }),
      { initialProps: { storageNS: sourceScope, enabled: true } },
    );
    await waitFor(() => expect(result.current.idbHydrated).toBe(true));

    act(() => {
      result.current.setNodesData({
        [nodeId]: {
          ...unlockedNode,
          fullName: undefined,
          endorsementCount: 1,
          tokenId: "0",
          versionDetailsFetchedAt: 0,
        },
      });
      result.current.setReachableNodeIds([nodeId]);
    });
    await waitFor(() => expect(api.getNFTDetails).toHaveBeenCalledOnce());

    rerender({ storageNS: targetScope, enabled: false });
    await waitFor(() => expect(result.current.nodesData[nodeId]).toBeUndefined());
    await act(async () => {
      resolveNft({
        personHash,
        versionIndex: 1,
        version: {},
        metadata: {},
        core: { fullName: "Public NFT Name" },
        endorsementCount: 2,
        nftTokenURI: "ipfs://public-token",
      });
      await Promise.resolve();
    });

    expect(result.current.nodesData[nodeId]).toBeUndefined();
    expect(JSON.stringify(result.current.nodesData)).not.toContain("scope-private-tag");
    expect(JSON.stringify(result.current.nodesData)).not.toContain("scope-private-biography");
  });
});
