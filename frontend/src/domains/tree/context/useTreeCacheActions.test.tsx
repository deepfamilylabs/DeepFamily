// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import {
  trustedEndorsementVisibilityKey,
  trustedEndorsersKey,
} from "../../../shared/cache/queryKeys";
import { makeNodeId, type NodeData, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { readTreeNodesSnapshot } from "../services/treeNodesPersistence";
import { useTreeCacheActions } from "./useTreeCacheActions";

const persistenceMocks = vi.hoisted(() => ({
  blobs: new Map<string, unknown>(),
  readBlob: vi.fn(),
  writeBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock("../../../shared/cache/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/cache/persistence")>();
  return {
    ...actual,
    isIndexedDBSupported: () => true,
    readBlob: (...args: unknown[]) => persistenceMocks.readBlob(...args),
    writeBlob: (...args: unknown[]) => persistenceMocks.writeBlob(...args),
    deleteBlob: (...args: unknown[]) => persistenceMocks.deleteBlob(...args),
  };
});

function createTreeCacheActionsHarness(
  initialNodes: Record<string, NodeData> = {},
  options: { useIndexedDbCache?: boolean; storageNS?: string } = {},
) {
  let nodesData = initialNodes;
  let edgesUnion: EdgeStoreUnion = {};
  let edgesStrict: EdgeStoreStrict = {};
  let reachableNodeIds: NodeId[] = [];
  const nodesDataRef = { current: nodesData };

  const queryCache = new QueryCache();
  const refresh = vi.fn();

  const setNodesData = vi.fn((updater: React.SetStateAction<Record<string, NodeData>>) => {
    nodesData = typeof updater === "function" ? updater(nodesData) : updater;
    nodesDataRef.current = nodesData;
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
      nodesDataRef,
      edgesStrictRef: { current: edgesStrict },
      reachableNodeIdsRef: { current: reachableNodeIds },
      setNodesData,
      setEdgesUnion,
      setEdgesStrict,
      setReachableNodeIds,
      setProgress: vi.fn(),
      refresh,
      storageNS: options.storageNS ?? "test-tree",
      edgesUnionKey: "test-tree::edges.union.v1",
      edgesStrictKey: "test-tree::edges.strict.v1",
      useIndexedDbCache: options.useIndexedDbCache ?? false,
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
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.blobs.clear();
    persistenceMocks.readBlob.mockImplementation(async (key: string) => {
      return persistenceMocks.blobs.get(key) ?? null;
    });
    persistenceMocks.writeBlob.mockImplementation(async (key: string, value: unknown) => {
      persistenceMocks.blobs.set(key, value);
    });
    persistenceMocks.deleteBlob.mockImplementation(async (key: string) => {
      persistenceMocks.blobs.delete(key);
    });
    localStorage.clear();
    sessionStorage.clear();
  });

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
    harness.queryCache.set(trustedEndorsementVisibilityKey(personHash, 1, ["0xsource"]), true);

    act(() => {
      harness.hook.result.current.clearAllCaches();
    });

    expect(harness.queryCache.get(trustedEndorsersKey(personHash, 1), 0)).toBeUndefined();
    expect(
      harness.queryCache.get(trustedEndorsementVisibilityKey(personHash, 1, ["0xsource"]), 0),
    ).toBeUndefined();
  });

  it("clears only decrypted metadata while preserving public version anchors", () => {
    const personHash = `0x${"12".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const harness = createTreeCacheActionsHarness({
      [id]: {
        id,
        personHash,
        versionIndex: 1,
        versionCommitment: "123",
        metadataPointer: `0x${"34".repeat(20)}`,
        metadataPayloadHash: `0x${"56".repeat(32)}`,
        metadataPayloadLength: 256,
        metadataUnlockValidated: true,
        metadataProtocolGeneration: "df-onchain-biography-v1",
        metadataFormatVersion: 1,
        identitySuiteId: 1,
        metadataPerson: {
          fullName: "Alice",
          gender: 2,
          birthYear: 1980,
          birthMonth: 1,
          birthDay: 2,
          isBirthBC: false,
          personHash,
        },
        metadataParents: { father: null, mother: null },
        tag: "revision",
        biography: "private biography",
      },
    });

    act(() => {
      harness.hook.result.current.clearMetadataUnlockCache();
    });

    expect(harness.nodesData[id]).toMatchObject({
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "123",
      metadataPayloadLength: 256,
      metadataUnlockValidated: false,
    });
    expect(harness.nodesData[id]?.tag).toBeUndefined();
    expect(harness.nodesData[id]?.biography).toBeUndefined();
    expect(harness.nodesData[id]?.metadataPerson).toBeUndefined();
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
    expect(harness.queryCache.get(trustedEndorsementVisibilityKey(personHash, 4, sources), 0)).toBe(
      true,
    );
  });

  it("projects a validated unlock before writing NodeData to IndexedDB", async () => {
    const personHash = `0x${"78".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const baseNode: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "123456789",
      metadataPointer: `0x${"34".repeat(20)}`,
      metadataPayloadHash: `0x${"56".repeat(32)}`,
      metadataPayloadLength: 256,
      tokenId: "0",
    };
    const sentinels = {
      rawPassphrase: "raw-passphrase-indexeddb-sentinel",
      normalizedPassphrase: "nfkd-passphrase-indexeddb-sentinel",
      identityPasswordInputHex: "identity-input-indexeddb-sentinel",
      filePasswordInputHex: "file-input-indexeddb-sentinel",
      identitySaltHex: "identity-salt-indexeddb-sentinel",
      fileSaltHex: "file-salt-indexeddb-sentinel",
      derivedSecretHex: "derived-secret-indexeddb-sentinel",
      derivedSecretField: "918273645546372819",
      proverWitness: "prover-witness-indexeddb-sentinel",
      kekHex: "kek-indexeddb-sentinel",
      dekHex: "dek-indexeddb-sentinel",
      contentDigest: "content-digest-indexeddb-sentinel",
    };
    const contaminatedWorkerResult = {
      ...baseNode,
      fullName: "Ada Lovelace",
      tag: "private revision",
      biography: "encrypted biography",
      metadataPerson: {
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataUnlockValidated: true,
      ...sentinels,
    } as NodeData;
    const harness = createTreeCacheActionsHarness(
      { [id]: baseNode },
      { useIndexedDbCache: true, storageNS: "secret-boundary" },
    );

    await act(async () => {
      await harness.hook.result.current.persistValidatedPersonVersion(
        contaminatedWorkerResult,
        harness.hook.result.current.captureMetadataCacheRevision(),
      );
    });

    expect(persistenceMocks.writeBlob).toHaveBeenCalledOnce();
    expect(persistenceMocks.writeBlob.mock.calls[0][0]).toBe("secret-boundary::nodesData");
    const serialized = JSON.stringify(persistenceMocks.writeBlob.mock.calls[0][1]);
    for (const [name, sentinel] of Object.entries(sentinels)) {
      expect(serialized, `persisted ${name}`).not.toContain(sentinel);
      expect(serialized, `persisted key ${name}`).not.toContain(`"${name}"`);
    }
    expect(JSON.parse(serialized)[id]).toMatchObject({
      personHash,
      versionIndex: 1,
      metadataUnlockValidated: true,
      tag: "private revision",
      biography: "encrypted biography",
    });
  });

  it("does not fall back to Web Storage when an IndexedDB unlock write fails", async () => {
    const personHash = `0x${"79".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const node: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "987654321",
      metadataPointer: `0x${"35".repeat(20)}`,
      metadataPayloadHash: `0x${"57".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataPerson: {
        fullName: "Grace Hopper",
        gender: 2,
        birthYear: 1906,
        birthMonth: 12,
        birthDay: 9,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataUnlockValidated: true,
      tag: "private revision",
      biography: "session-only plaintext",
    };
    persistenceMocks.writeBlob.mockRejectedValueOnce(new Error("IndexedDB quota exceeded"));
    const harness = createTreeCacheActionsHarness(
      { [id]: node },
      { useIndexedDbCache: true, storageNS: "quota-boundary" },
    );

    await expect(
      harness.hook.result.current.persistValidatedPersonVersion(
        node,
        harness.hook.result.current.captureMetadataCacheRevision(),
      ),
    ).rejects.toThrow("IndexedDB quota exceeded");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(harness.nodesData[id]).toEqual(node);
  });

  it("durably clears plaintext even when the component unmounts immediately", async () => {
    const personHash = `0x${"81".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const node: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "123",
      metadataPointer: `0x${"82".repeat(20)}`,
      metadataPayloadHash: `0x${"83".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Unmount Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "private-unmount-tag",
      biography: "private-unmount-biography",
      tokenId: "0",
    };
    const storageKey = "immediate-unmount::nodesData";
    persistenceMocks.blobs.set(storageKey, { [id]: node });
    const harness = createTreeCacheActionsHarness(
      { [id]: node },
      { useIndexedDbCache: true, storageNS: "immediate-unmount" },
    );

    let clearing!: Promise<void>;
    act(() => {
      clearing = harness.hook.result.current.clearMetadataUnlockCache();
      harness.hook.unmount();
    });
    await clearing;

    const serialized = JSON.stringify(persistenceMocks.blobs.get(storageKey));
    expect(serialized).not.toContain("private-unmount-tag");
    expect(serialized).not.toContain("private-unmount-biography");
    expect(persistenceMocks.blobs.get(storageKey)).toMatchObject({
      [id]: {
        personHash,
        versionCommitment: "123",
        metadataPayloadLength: 256,
        metadataUnlockValidated: false,
      },
    });
  });

  it("cannot hydrate old plaintext when the public-only rewrite fails", async () => {
    const personHash = `0x${"84".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const node: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "456",
      metadataPointer: `0x${"85".repeat(20)}`,
      metadataPayloadHash: `0x${"86".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Failure Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "private-failure-tag",
      biography: "private-failure-biography",
      tokenId: "0",
    };
    const storageKey = "rewrite-failure::nodesData";
    persistenceMocks.blobs.set(storageKey, { [id]: node });
    persistenceMocks.writeBlob.mockRejectedValueOnce(new Error("IndexedDB quota exceeded"));
    const harness = createTreeCacheActionsHarness(
      { [id]: node },
      { useIndexedDbCache: true, storageNS: "rewrite-failure" },
    );

    await act(async () => {
      await harness.hook.result.current.clearMetadataUnlockCache();
    });
    harness.hook.unmount();

    const hydrated = await readTreeNodesSnapshot(storageKey);
    expect(hydrated).toBeNull();
    expect(JSON.stringify(hydrated)).not.toContain("private-failure");
  });

  it("serializes an old in-flight put before clear so it cannot restore plaintext", async () => {
    const personHash = `0x${"87".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const node: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "789",
      metadataPointer: `0x${"88".repeat(20)}`,
      metadataPayloadHash: `0x${"89".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Racing Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "private-race-tag",
      biography: "private-race-biography",
      tokenId: "0",
    };
    const storageKey = "inflight-race::nodesData";
    persistenceMocks.blobs.set(storageKey, {
      [id]: { ...node, tag: undefined, biography: undefined },
    });
    let finishOldWrite!: () => void;
    persistenceMocks.writeBlob.mockImplementationOnce(
      (key: string, value: unknown) =>
        new Promise<void>((resolve) => {
          finishOldWrite = () => {
            persistenceMocks.blobs.set(key, value);
            resolve();
          };
        }),
    );
    const harness = createTreeCacheActionsHarness(
      { [id]: node },
      { useIndexedDbCache: true, storageNS: "inflight-race" },
    );

    const oldWrite = harness.hook.result.current.persistValidatedPersonVersion(
      node,
      harness.hook.result.current.captureMetadataCacheRevision(),
    );
    await waitFor(() => expect(persistenceMocks.writeBlob).toHaveBeenCalledTimes(1));
    const clearing = harness.hook.result.current.clearMetadataUnlockCache();
    finishOldWrite();
    await Promise.all([oldWrite, clearing]);

    const serialized = JSON.stringify(persistenceMocks.blobs.get(storageKey));
    expect(serialized).not.toContain("private-race-tag");
    expect(serialized).not.toContain("private-race-biography");
    expect(persistenceMocks.blobs.get(storageKey)).toMatchObject({
      [id]: { versionCommitment: "789", metadataUnlockValidated: false },
    });
  });

  it("uses a dedicated confirmed-version path to insert and persist a missing node", async () => {
    const personHash = `0x${"8a".repeat(32)}`;
    const id = makeNodeId(personHash, 2);
    const confirmed = {
      id,
      personHash,
      versionIndex: 2,
      versionCommitment: "987654321",
      metadataPointer: `0x${"8b".repeat(20)}`,
      metadataPayloadHash: `0x${"8c".repeat(32)}`,
      metadataPayloadLength: 512,
      fatherHash: `0x${"8d".repeat(32)}`,
      fatherVersionIndex: 1,
      addedBy: `0x${"8e".repeat(20)}`,
      timestamp: 1234,
      tokenId: "0",
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Confirmed Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "confirmed-private-tag",
      biography: "confirmed-private-biography",
      rawPassphrase: "must-never-persist",
    } as NodeData;
    const harness = createTreeCacheActionsHarness(
      {},
      { useIndexedDbCache: true, storageNS: "confirmed-insert" },
    );

    const persistence = harness.hook.result.current.cacheConfirmedPersonVersion(
      confirmed,
      harness.hook.result.current.captureMetadataCacheRevision(),
    );
    expect(harness.nodesData[id]).toMatchObject({
      personHash,
      versionIndex: 2,
      versionCommitment: "987654321",
      tag: "confirmed-private-tag",
      metadataUnlockValidated: true,
    });
    await persistence;

    const durable = persistenceMocks.blobs.get("confirmed-insert::nodesData") as Record<
      string,
      NodeData
    >;
    expect(durable[id]).toMatchObject({
      personHash,
      versionIndex: 2,
      metadataUnlockValidated: true,
      biography: "confirmed-private-biography",
    });
    expect(JSON.stringify(durable)).not.toContain("must-never-persist");
  });

  it("keeps ordinary unlock cache and persistence closed to missing nodes", async () => {
    const personHash = `0x${"8f".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const unlocked: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "12345",
      metadataPointer: `0x${"90".repeat(20)}`,
      metadataPayloadHash: `0x${"91".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Missing Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "missing-private-tag",
      biography: "missing-private-biography",
    };
    const harness = createTreeCacheActionsHarness(
      {},
      { useIndexedDbCache: true, storageNS: "ordinary-missing" },
    );

    const revision = harness.hook.result.current.captureMetadataCacheRevision();
    expect(() =>
      harness.hook.result.current.cacheValidatedPersonVersion(unlocked, revision),
    ).toThrow(/no longer loaded/);
    await expect(
      harness.hook.result.current.persistValidatedPersonVersion(unlocked, revision),
    ).rejects.toThrow(/no longer loaded/);
    expect(harness.nodesData).toEqual({});
    expect(persistenceMocks.blobs.has("ordinary-missing::nodesData")).toBe(false);
  });

  it("fences a metadata-unlock batch that started before clear, even without IndexedDB", async () => {
    const personHash = `0x${"92".repeat(32)}`;
    const id = makeNodeId(personHash, 1);
    const unlocked: NodeData = {
      id,
      personHash,
      versionIndex: 1,
      versionCommitment: "22222",
      metadataPointer: `0x${"93".repeat(20)}`,
      metadataPayloadHash: `0x${"94".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Fenced Unlock",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "fenced-unlock-tag",
      biography: "fenced-unlock-biography",
      tokenId: "0",
    };
    const harness = createTreeCacheActionsHarness({ [id]: unlocked });
    const runRevision = harness.hook.result.current.captureMetadataCacheRevision();

    await harness.hook.result.current.clearMetadataUnlockCache();
    harness.hook.result.current.cacheValidatedPersonVersion(unlocked, runRevision);
    await harness.hook.result.current.persistValidatedPersonVersion(unlocked, runRevision);

    expect(harness.nodesData[id]).toMatchObject({ metadataUnlockValidated: false });
    expect(JSON.stringify(harness.nodesData)).not.toContain("fenced-unlock-tag");
    expect(JSON.stringify(harness.nodesData)).not.toContain("fenced-unlock-biography");
    expect(persistenceMocks.writeBlob).not.toHaveBeenCalled();
  });

  it("fences an AddVersion confirmation that finishes after clear", async () => {
    const personHash = `0x${"95".repeat(32)}`;
    const id = makeNodeId(personHash, 3);
    const confirmed: NodeData = {
      id,
      personHash,
      versionIndex: 3,
      versionCommitment: "33333",
      metadataPointer: `0x${"96".repeat(20)}`,
      metadataPayloadHash: `0x${"97".repeat(32)}`,
      metadataPayloadLength: 512,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Fenced Confirmation",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      tag: "fenced-confirmation-tag",
      biography: "fenced-confirmation-biography",
      tokenId: "0",
    };
    const harness = createTreeCacheActionsHarness(
      {},
      { useIndexedDbCache: true, storageNS: "fenced-confirmation" },
    );
    const submissionRevision = harness.hook.result.current.captureMetadataCacheRevision();

    await harness.hook.result.current.clearMetadataUnlockCache();
    await harness.hook.result.current.cacheConfirmedPersonVersion(confirmed, submissionRevision);

    expect(harness.nodesData[id]).toBeUndefined();
    const durable = persistenceMocks.blobs.get("fenced-confirmation::nodesData");
    expect(JSON.stringify(durable)).not.toContain("fenced-confirmation-tag");
    expect(JSON.stringify(durable)).not.toContain("fenced-confirmation-biography");
  });
});
