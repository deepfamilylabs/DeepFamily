// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeValidatedMetadataUnlock,
  type MetadataUnlockAnchors,
  type NodeData,
} from "../../../shared/model";
import type { UnlockPersonVersionNodeInput } from "../../../shared/metadata/metadataArchiveService";
import {
  getAutomaticMetadataUnlockIssues,
  hasAutomaticMetadataUnlockAttempt,
  pauseAutomaticMetadataUnlock,
  setMetadataUnlockPreference,
} from "../../../shared/metadata/metadataUnlockSession";
import { CryptoWorkerPreemptedError } from "../../../shared/workers/cryptoWorkerClient";
import { buildTreeStorageNamespace } from "../context/treeStorageScope";
import {
  automaticMetadataUnlockKey,
  useAutomaticMetadataUnlock as useScopedAutomaticMetadataUnlock,
} from "./useAutomaticMetadataUnlock";

const mocks = vi.hoisted(() => ({
  visibleIds: null as string[] | null,
  config: { rpcUrl: "https://rpc.example", chainId: 0, contractAddress: `0x${"a1".repeat(20)}` },
  graph: {
    nodesData: {} as Record<string, NodeData>,
    reachableNodeIds: [] as string[],
    rootId: undefined as string | undefined,
    idbHydrated: true,
  },
  unlock: vi.fn<(input: UnlockPersonVersionNodeInput) => Promise<NodeData>>(),
  provider: { getCode: vi.fn() },
  cache: vi.fn(),
  persist: vi.fn(),
  revision: 7,
}));

function useAutomaticMetadataUnlock(
  options: { suspended?: boolean; priorityNodeId?: string } = {},
) {
  const ids = mocks.visibleIds ?? Object.keys(mocks.graph.nodesData);
  const rootId = mocks.graph.rootId ?? null;
  return useScopedAutomaticMetadataUnlock({
    ...options,
    viewScope: { rootId, key: JSON.stringify([rootId, [...ids].sort()]), nodeIds: new Set(ids) },
  });
}

vi.mock("../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../context", () => ({
  useTreeGraphData: () => mocks.graph,
  useTreeMutations: () => ({
    cacheValidatedPersonVersion: mocks.cache,
    persistValidatedPersonVersion: mocks.persist,
    captureMetadataCacheRevision: () => mocks.revision,
  }),
}));
vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => mocks.provider,
}));
vi.mock("../../../shared/metadata/metadataArchiveService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/metadata/metadataArchiveService")>()),
  unlockPersonVersionNode: (input: UnlockPersonVersionNodeInput) => mocks.unlock(input),
}));

function node(digit = "1"): NodeData {
  const personHash = `0x${digit.repeat(64)}`;
  return {
    id: `${personHash}-v-1`,
    personHash,
    versionIndex: 1,
    versionCommitment: "123",
    metadataPointer: `0x${"ab".repeat(20)}`,
    metadataPayloadHash: `0x${"cd".repeat(32)}`,
    metadataPayloadLength: 512,
    metadataSegmentCount: 1,
  };
}

function validated(current: NodeData): NodeData {
  return mergeValidatedMetadataUnlock(current, current as MetadataUnlockAnchors, {
    person: {
      personHash: current.personHash,
      fullName: "Alice",
      gender: 2,
      birthYear: 1980,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
    },
    parents: { father: null, mother: null },
    tag: "Family record",
    biography: "Private biography",
    formatVersion: 1,
    identitySuiteId: 1,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const scope = () => buildTreeStorageNamespace(mocks.config);
const authenticationFailure = () =>
  Object.assign(new Error("Authentication failed"), {
    code: "AES_GCM_AUTHENTICATION_FAILED",
  });
const advance = async (milliseconds = 300) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};
let nextChainId = 1000;

describe("automatic empty-passphrase metadata unlock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.visibleIds = null;
    localStorage.clear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    mocks.config.chainId = ++nextChainId;
    mocks.config.rpcUrl = "https://rpc.example";
    mocks.config.contractAddress = `0x${"a1".repeat(20)}`;
    const first = node();
    mocks.graph = {
      nodesData: { [first.id]: first },
      reachableNodeIds: [first.id],
      rootId: first.id,
      idbHydrated: true,
    };
    mocks.revision = 7;
    mocks.unlock.mockRejectedValue(authenticationFailure());
    mocks.persist.mockResolvedValue(undefined);
    mocks.provider.getCode.mockResolvedValue("0x00");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("attempts each scope and envelope once across rerenders, navigation and simultaneous surfaces", async () => {
    const first = renderHook(() => useAutomaticMetadataUnlock());
    const second = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    expect(mocks.unlock).toHaveBeenCalledOnce();
    mocks.graph.nodesData = { ...mocks.graph.nodesData };
    first.rerender();
    second.rerender();
    await advance(1500);
    expect(mocks.unlock).toHaveBeenCalledOnce();
    first.unmount();
    second.unmount();
    renderHook(() => useAutomaticMetadataUnlock());
    await advance(1500);
    expect(mocks.unlock).toHaveBeenCalledOnce();
  });

  it("tries changed public anchors while keeping the previous attempt deduplicated", async () => {
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const previous = mocks.graph.nodesData[node().id];
    const changed = { ...previous, metadataPayloadHash: `0x${"ef".repeat(32)}` };
    mocks.graph.nodesData = { [changed.id]: changed };
    rerender();
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
    expect(mocks.unlock.mock.calls[1][0].node).toEqual(changed);
    expect(automaticMetadataUnlockKey({ ...previous, personHash: node("2").personHash })).not.toBe(
      automaticMetadataUnlockKey(previous),
    );
    expect(automaticMetadataUnlockKey({ ...previous, versionIndex: 2 })).not.toBe(
      automaticMetadataUnlockKey(previous),
    );
  });

  it.each([false, true])(
    "uses device by default and session only after opting out (remember=%s)",
    async (remember) => {
      if (!remember) setMetadataUnlockPreference(scope(), false);
      mocks.unlock.mockImplementation(async ({ node: current }) => validated(current));
      renderHook(() => useAutomaticMetadataUnlock());
      await advance();
      expect(mocks.unlock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          rawPassphrase: "",
          priority: "background",
          signal: expect.any(AbortSignal),
        }),
      );
      expect(mocks.cache).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          metadataUnlockPersistence: remember ? "device" : "session",
          biography: "Private biography",
          metadataUnlockValidated: true,
        }),
        7,
      );
      if (remember) expect(mocks.persist).toHaveBeenCalledWith(mocks.cache.mock.calls[0][0], 7);
      else expect(mocks.persist).not.toHaveBeenCalled();
    },
  );

  it("keeps authentication misses silent while separating read and validation failures", async () => {
    const authenticationNode = node("1");
    const readNode = node("2");
    const validationNode = node("3");
    mocks.graph.nodesData = {
      [authenticationNode.id]: authenticationNode,
      [readNode.id]: readNode,
      [validationNode.id]: validationNode,
    };
    mocks.provider.getCode.mockRejectedValue(new Error("RPC unavailable"));
    mocks.unlock.mockImplementation(async (input) => {
      if (input.node.id === authenticationNode.id) throw authenticationFailure();
      if (input.node.id === readNode.id) await input.getCode(input.node.metadataPointer!, "latest");
      throw Object.assign(new Error("Invalid archive"), { code: "PAYLOAD_HASH_MISMATCH" });
    });
    const { result } = renderHook(() => useAutomaticMetadataUnlock());
    await advance(1000);
    expect(mocks.unlock).toHaveBeenCalledTimes(3);
    expect(result.current.issues).toEqual([
      { key: automaticMetadataUnlockKey(readNode), kind: "read" },
      { key: automaticMetadataUnlockKey(validationNode), kind: "validation" },
    ]);
    expect(mocks.cache).not.toHaveBeenCalled();
    await advance(2000);
    expect(mocks.unlock).toHaveBeenCalledTimes(3);
  });

  it("reports a remembered-cache failure without discarding the successful memory unlock", async () => {
    mocks.unlock.mockImplementation(async ({ node: current }) => validated(current));
    mocks.persist.mockRejectedValue(new Error("Quota exceeded"));
    const { result } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    expect(mocks.cache).toHaveBeenCalledOnce();
    expect(result.current.issues).toEqual([
      { key: automaticMetadataUnlockKey(node()), kind: "persistence" },
    ]);
  });

  it("waits for hydration and for a foreground dialog to close", async () => {
    mocks.graph.idbHydrated = false;
    const { rerender } = renderHook(({ suspended }) => useAutomaticMetadataUnlock({ suspended }), {
      initialProps: { suspended: false },
    });
    await advance(2000);
    expect(mocks.unlock).not.toHaveBeenCalled();
    mocks.graph.idbHydrated = true;
    rerender({ suspended: true });
    await advance(2000);
    expect(mocks.unlock).not.toHaveBeenCalled();
    rerender({ suspended: false });
    await advance();
    expect(mocks.unlock).toHaveBeenCalledOnce();
  });

  it("aborts on dialog open and rejects late plaintext, then retries after the dialog closes", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(({ suspended }) => useAutomaticMetadataUnlock({ suspended }), {
      initialProps: { suspended: false },
    });
    await advance();
    const input = mocks.unlock.mock.calls[0][0];
    rerender({ suspended: true });
    expect(input.signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(validated(input.node));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    await advance(2000);
    expect(mocks.unlock).toHaveBeenCalledOnce();
    rerender({ suspended: false });
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
  });

  it("clear aborts active work, prevents late commits and remains paused after remount", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const input = mocks.unlock.mock.calls[0][0];
    act(() => {
      pauseAutomaticMetadataUnlock(scope());
      mocks.revision += 1;
    });
    expect(input.signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(validated(input.node));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(hook.result.current.paused).toBe(true);
    hook.unmount();
    const remounted = renderHook(() => useAutomaticMetadataUnlock());
    await advance(2000);
    expect(remounted.result.current.paused).toBe(true);
    expect(mocks.unlock).toHaveBeenCalledOnce();
  });

  it("never commits a result from the old chain or contract scope", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const oldInput = mocks.unlock.mock.calls[0][0];
    const oldScope = scope();
    mocks.config.chainId = ++nextChainId;
    mocks.config.contractAddress = `0x${"b2".repeat(20)}`;
    rerender();
    expect(oldInput.signal!.aborted).toBe(true);
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve(validated(oldInput.node));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(getAutomaticMetadataUnlockIssues(oldScope)).toEqual([]);
  });

  it("retries foreground preemption without treating it as an invalid envelope", async () => {
    mocks.unlock.mockRejectedValueOnce(new CryptoWorkerPreemptedError());
    const { result } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    expect(result.current.issues).toEqual([]);
    expect(hasAutomaticMetadataUnlockAttempt(scope(), automaticMetadataUnlockKey(node())!)).toBe(
      false,
    );
    await advance(1100);
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
    expect(result.current.issues).toEqual([]);
  });

  it("lets a successful foreground unlock win a background completion race", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const unlocked = { ...validated(node()), metadataUnlockPersistence: "device" as const };
    mocks.graph.nodesData = { [unlocked.id]: unlocked };
    rerender();
    await act(async () => {
      pending.resolve(validated(node()));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("drops outdated plaintext when the public envelope changes during an attempt", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender, result } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const changed = { ...node(), metadataPayloadHash: `0x${"ef".repeat(32)}` };
    mocks.graph.nodesData = { [changed.id]: changed };
    rerender();
    await act(async () => {
      pending.resolve(validated(node()));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(result.current.issues).toEqual([]);
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
    expect(mocks.unlock.mock.calls[1][0].node).toEqual(changed);
  });

  it("aborts hidden-tab work without committing plaintext and retries when visible", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const input = mocks.unlock.mock.calls[0][0];
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(input.signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(validated(input.node));
      await pending.promise;
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    await advance(2000);
    expect(mocks.unlock).toHaveBeenCalledOnce();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
  });

  it("prioritizes the selected person before the root and skips incomplete or already-unlocked nodes", async () => {
    const root = node("1");
    const selected = node("2");
    const incomplete = { ...node("3"), metadataPayloadHash: undefined };
    const unlocked = validated(node("4"));
    mocks.graph.nodesData = {
      [root.id]: root,
      [incomplete.id]: incomplete,
      [selected.id]: selected,
      [unlocked.id]: unlocked,
    };
    renderHook(() => useAutomaticMetadataUnlock({ priorityNodeId: selected.id }));
    await advance(1000);
    expect(mocks.unlock.mock.calls.map(([input]) => input.node.id)).toEqual([selected.id, root.id]);
  });

  it("only tries projected family versions, even when an unrelated cached version has priority", async () => {
    const root = node("1");
    const child = node("2");
    const outside = node("3");
    mocks.graph.nodesData = { [root.id]: root, [child.id]: child, [outside.id]: outside };
    mocks.visibleIds = [root.id, child.id];
    renderHook(() => useAutomaticMetadataUnlock({ priorityNodeId: outside.id }));
    await advance(1500);
    expect(mocks.unlock.mock.calls.map(([input]) => input.node.id)).toEqual([root.id, child.id]);
    expect(hasAutomaticMetadataUnlockAttempt(scope(), automaticMetadataUnlockKey(outside)!)).toBe(
      false,
    );
  });

  it("does not fall back to cached nodes when the current view is empty", async () => {
    mocks.visibleIds = [];
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance(1000);
    expect(mocks.unlock).not.toHaveBeenCalled();
    mocks.visibleIds = [node().id];
    rerender();
    await advance();
    expect(mocks.unlock).toHaveBeenCalledOnce();
  });

  it("cancels a previous root's work and rejects its late plaintext while retaining shared caches", async () => {
    const oldRoot = node("1");
    const newRoot = node("2");
    mocks.graph.nodesData = { [oldRoot.id]: oldRoot, [newRoot.id]: newRoot };
    mocks.visibleIds = [oldRoot.id];
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const oldInput = mocks.unlock.mock.calls[0][0];
    mocks.graph.rootId = newRoot.id;
    mocks.visibleIds = [newRoot.id];
    rerender();
    expect(oldInput.signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(validated(oldRoot));
      await pending.promise;
    });
    await advance();
    expect(mocks.unlock.mock.calls.map(([input]) => input.node.id)).toEqual([
      oldRoot.id,
      newRoot.id,
    ]);
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("cancels a filtered-out version and retries only after it returns to the view", async () => {
    const pending = deferred<NodeData>();
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender, result } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const input = mocks.unlock.mock.calls[0][0];
    mocks.visibleIds = [];
    rerender();
    expect(input.signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(validated(input.node));
      await pending.promise;
    });
    await advance(1500);
    expect(mocks.unlock).toHaveBeenCalledOnce();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(result.current.issues).toEqual([]);
    mocks.visibleIds = [node().id];
    rerender();
    await advance();
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
  });

  it("keeps current work running as more descendants load, then tries the newly visible nodes", async () => {
    const child = node("2");
    const pending = deferred<NodeData>();
    mocks.visibleIds = [node().id];
    mocks.unlock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(() => useAutomaticMetadataUnlock());
    await advance();
    const input = mocks.unlock.mock.calls[0][0];
    mocks.graph.nodesData = { ...mocks.graph.nodesData, [child.id]: child };
    mocks.visibleIds = [node().id, child.id];
    rerender();
    expect(input.signal!.aborted).toBe(false);
    await act(async () => {
      pending.resolve(validated(input.node));
      await pending.promise;
    });
    await advance();
    expect(mocks.cache).toHaveBeenCalledOnce();
    expect(mocks.unlock.mock.calls.map(([item]) => item.node.id)).toEqual([node().id, child.id]);
  });
});
