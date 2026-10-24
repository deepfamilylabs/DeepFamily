import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBCursor, IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { PublicStateHead, PublicStateStore } from "./publicStateStore";

// Real IndexedDB scheduling and Poseidon fixtures also run under the parallel full suite.
vi.setConfig({ testTimeout: 30_000 });

let module: typeof import("./publicStateStore");
let stores: PublicStateStore[];
const anchor = (blockNumber: number, fork = "a") => ({
  blockNumber,
  blockHash: `${fork}-${blockNumber}`,
  data: { root: `${fork}-root-${blockNumber}` },
});
const write = (key: string, value: unknown, lookups = ["all"]) => ({
  kind: "nodes",
  key,
  value,
  lookups,
});
async function open(scope = "test") {
  const store = await module.openPublicStateStore(scope);
  stores.push(store);
  return store;
}
async function seed(store: PublicStateStore, value = 0) {
  let pending = await store.startPending(anchor(0));
  pending = await store.writePending(pending, [write("one", value)], { nodes: 1 });
  return store.finishPending(pending);
}
async function raw() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("deepfamily-public-state-v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rawRows(name: string) {
  const db = await raw();
  try {
    return await new Promise<any[]>((resolve, reject) => {
      const transaction = db.transaction(name, "readonly");
      const request = transaction.objectStore(name).getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  module = await import("./publicStateStore");
  stores = [];
});
afterEach(async () => {
  await Promise.allSettled(stores.map((store) => store.prune()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("persistent public state transactions", () => {
  it("atomically writes pages/cursors, resumes pending state after a module restart, and isolates returned objects", async () => {
    const first = await open();
    let pending = await first.startPending(anchor(10));
    const original = pending;
    pending = await first.writePending(pending, [write("one", { counter: 1n }, ["alias"])], {
      nodes: 1,
    });
    await expect(
      first.read(original, async (view) => view.get("nodes", "one"), true),
    ).rejects.toThrow("changed in another task");
    await expect(first.finishPending(original)).rejects.toThrow("changed in another task");
    vi.resetModules();
    module = await import("./publicStateStore");
    const restarted = await open();
    expect(await restarted.startPending(anchor(10))).toEqual(pending);
    expect(
      await restarted.read(pending, async (view) => view.query("nodes", "alias"), true),
    ).toEqual([{ counter: 1n }]);
    pending = await restarted.writePending(pending, [write("two", 2)], { nodes: 2, versions: 0 });
    const head = await restarted.finishPending(pending);
    const value = await restarted.read(head, async (view) =>
      view.get<{ counter: bigint }>("nodes", "one"),
    );
    value!.counter = 999n;
    expect(await restarted.read(head, async (view) => view.get("nodes", "one"))).toEqual({
      counter: 1n,
    });
    expect((await restarted.envelope()).pending).toBeUndefined();
    expect((await restarted.envelope()).head).toEqual(head);
  });

  it("rolls back every write and cursor when structured cloning fails midway through a page", async () => {
    const store = await open();
    const pending = await store.startPending(anchor(1));
    await expect(
      store.writePending(pending, [write("one", 1), write("bad", () => 2)], { nodes: 2 }),
    ).rejects.toMatchObject({ name: "DataCloneError" });
    expect((await store.envelope()).pending).toEqual(pending);
    expect(
      await store.read(pending, async (view) => view.get("nodes", "one"), true),
    ).toBeUndefined();
    expect((await rawRows("records")).length).toBe(0);
  });

  it("uses revision CAS across independent module/connection instances", async () => {
    const first = await open();
    const head = await seed(first);
    vi.resetModules();
    module = await import("./publicStateStore");
    const second = await open();
    const results = await Promise.allSettled([
      first.commit(head, anchor(1, "first"), [write("one", 1)]),
      second.commit(head, anchor(1, "second"), [write("one", 2)]),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason.message).toContain("changed in another task");
    const current = (await first.envelope()).head!;
    const value = await first.read(current, async (view) => view.get("nodes", "one"));
    expect(value).toBe(current.blockHash.startsWith("first") ? 1 : 2);
  });

  it("keeps a readonly view consistent while a concurrent writer waits", async () => {
    const store = await open();
    const other = await open();
    const head = await seed(store);
    let commit: Promise<PublicStateHead> | undefined;
    const values = await store.read(head, async (view) => {
      const first = await view.get("nodes", "one");
      commit = other.commit(head, anchor(1), [write("one", 1)]);
      const second = await view.get("nodes", "one");
      return [first, second];
    });
    expect(values).toEqual([0, 0]);
    const current = await commit!;
    expect(await store.read(current, async (view) => view.get("nodes", "one"))).toBe(1);
  });

  it("preserves the original callback error after the readonly transaction already completed", async () => {
    const store = await open();
    const head = await seed(store);
    const failure = new Error("original callback failure");
    await expect(
      store.read(head, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("retains exactly 32 rollback revisions and restores updates, removals and lookup indexes", async () => {
    const store = await open();
    let head = await seed(store);
    for (let index = 1; index <= 35; ++index) {
      head = await store.commit(head, anchor(index), [write("one", index, [`lookup-${index}`])]);
    }
    expect((await rawRows("history")).length).toBe(32);
    for (let index = 0; index < 32; ++index) head = (await store.rollback(head))!;
    expect(head.blockNumber).toBe(3);
    expect(await store.read(head, async (view) => view.get("nodes", "one"))).toBe(3);
    expect(await store.read(head, async (view) => view.query("nodes", "lookup-3"))).toEqual([3]);
    expect(await store.read(head, async (view) => view.query("nodes", "lookup-35"))).toEqual([]);
    expect(await store.rollback(head)).toBeUndefined();
    expect((await rawRows("history")).length).toBe(0);
    head = await store.commit(head, anchor(100), [
      write("one", undefined),
      { ...write("one", undefined), remove: true },
      write("new", 9),
    ]);
    expect(await store.read(head, async (view) => view.get("nodes", "one"))).toBeUndefined();
    const restored = (await store.rollback(head))!;
    expect(await store.read(restored, async (view) => view.get("nodes", "one"))).toBe(3);
    expect(await store.read(restored, async (view) => view.get("nodes", "new"))).toBeUndefined();
  });

  it("rejects a stale head when rollback and a different fork reuse its revision number", async () => {
    const store = await open();
    const original = await seed(store);
    const forkA = await store.commit(original, anchor(1, "a"), [write("one", 1)]);
    const restored = (await store.rollback(forkA))!;
    const forkB = await store.commit(restored, anchor(1, "b"), [write("one", 2)]);
    expect(forkA.revision).toBe(forkB.revision);
    await expect(store.commit(forkA, anchor(2), [write("one", 999)])).rejects.toThrow(
      "changed in another task",
    );
    expect(await store.read(forkB, async (view) => view.get("nodes", "one"))).toBe(2);
  });

  it("protects newer pending pages from stale discard and refreshes bootstrap whose base changed", async () => {
    const store = await open();
    const head = await seed(store);
    const old = await store.startPending(anchor(2));
    const current = await store.writePending(old, [write("new", 3)], { nodes: 1 });
    await expect(store.discardPending(old)).rejects.toThrow("changed in another task");
    expect((await store.envelope()).pending).toEqual(current);
    await store.commit(head, anchor(1), [write("one", 1)]);
    await expect(store.finishPending(current)).rejects.toThrow("changed in another task");
    const restarted = await store.startPending(anchor(2));
    expect(restarted.dataset).not.toBe(current.dataset);
    expect(restarted.baseRevision).toBe(2);
  });

  it("invalidates corrupt public state with CAS without deleting a newer head or another scope", async () => {
    const store = await open();
    const other = await open("other");
    const otherHead = await seed(other, 77);
    const old = await seed(store);
    const current = await store.commit(old, anchor(1), [write("one", 1)]);
    await expect(store.invalidateHead(old)).rejects.toThrow("changed in another task");
    expect((await store.envelope()).head).toEqual(current);
    let pending = await store.startPending(anchor(2));
    pending = await store.writePending(pending, [write("unused", 2)], { nodes: 1 });
    await store.invalidateHead(current);
    await store.prune();
    expect(await store.envelope()).toEqual({ scope: "test" });
    expect((await rawRows("records")).every((row) => row.scope === "other")).toBe(true);
    expect(await rawRows("history")).toEqual([]);
    expect(await other.read(otherHead, async (view) => view.get("nodes", "one"))).toBe(77);
    const fresh = await store.startPending(anchor(3));
    expect(fresh.baseRevision).toBe(0);
    expect(fresh.dataset).not.toBe(current.dataset);
    expect(fresh.dataset).not.toBe(pending.dataset);
  });
});

describe("public state cleanup and lookup integrity", () => {
  it("streams abandoned generations without visiting retained rows or deleting other scopes", async () => {
    const store = await open("scope");
    const other = await open("other");
    await seed(other, 77);
    let pending = await store.startPending(anchor(0));
    pending = await store.writePending(
      pending,
      Array.from({ length: 600 }, (_, index) => write(String(index), index)),
      { nodes: 600 },
    );
    const active = await store.finishPending(pending);
    let orphan = await store.startPending(anchor(1));
    orphan = await store.writePending(
      orphan,
      Array.from({ length: 1200 }, (_, index) => write(String(index), index)),
      { nodes: 1200 },
    );
    const seek = vi.spyOn(IDBCursor.prototype, "continue");
    let replacement = await store.startPending(anchor(2));
    replacement = await store.writePending(replacement, [write("new", 88)], { nodes: 1 });
    await store.prune();
    expect(seek).toHaveBeenCalledWith(["scope", active.dataset, []]);
    let rows = await rawRows("records");
    expect(rows.filter((row) => row.dataset === orphan.dataset)).toHaveLength(0);
    expect(rows.filter((row) => row.dataset === active.dataset)).toHaveLength(600);
    expect(rows.filter((row) => row.dataset === replacement.dataset)).toHaveLength(1);
    const head = await store.finishPending(replacement);
    await store.prune();
    rows = await rawRows("records");
    expect(rows.filter((row) => row.scope === "scope")).toHaveLength(1);
    expect(rows.filter((row) => row.scope === "other")).toHaveLength(1);
    expect(await store.read(head, async (view) => view.query("nodes", "all"))).toEqual([88]);
    let discarded = await store.startPending(anchor(3));
    discarded = await store.writePending(discarded, [write("unused", 99)], { nodes: 1 });
    await store.discardPending(discarded);
    await store.prune();
    expect((await rawRows("records")).some((row) => row.dataset === discarded.dataset)).toBe(false);
  });

  it("cleans abandoned journals when a new dataset replaces the active generation", async () => {
    const store = await open();
    const first = await seed(store);
    await store.commit(first, anchor(1), [write("one", 1)]);
    expect((await rawRows("history")).length).toBe(1);
    const pending = await store.startPending(anchor(2));
    await store.finishPending(pending);
    await store.prune();
    expect(await rawRows("history")).toEqual([]);
    expect(await rawRows("records")).toEqual([]);
  });

  it("scopes lookup indexes and rejects malformed lookup rows and unbounded limits", async () => {
    const store = await open("first");
    const other = await open("second");
    const head = await seed(store, 1);
    await seed(other, 2);
    expect(await store.read(head, async (view) => view.query("nodes", "all"))).toEqual([1]);
    for (const limit of [0, -1, 100_002, Infinity, 1.5])
      await expect(
        store.read(head, async (view) => view.query("nodes", "all", limit)),
      ).rejects.toThrow("Invalid public cache lookup limit");
    const db = await raw();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("records", "readwrite");
      transaction.objectStore("records").put({
        scope: "first",
        dataset: head.dataset,
        kind: "corrupt",
        key: "bad",
        value: 999,
        lookups: ["all"],
        indexes: [JSON.stringify(["first", head.dataset, "nodes", "all"])],
      });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    await expect(store.read(head, async (view) => view.query("nodes", "all"))).rejects.toThrow(
      "lookup is inconsistent",
    );
  });

  it("fails explicitly without persistent storage and never creates an in-memory fallback", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(module.hasPersistentPublicStateStorage()).toBe(false);
    await expect(module.openPublicStateStore("none")).rejects.toThrow("requires browser storage");
  });

  it("serializes fallback locks and releases them after failure", async () => {
    vi.stubGlobal("navigator", {});
    const order: number[] = [];
    const calls = [
      module.withPublicStateLock("scope", async () => {
        order.push(1);
        throw new Error("first");
      }),
      module.withPublicStateLock("scope", async () => {
        order.push(2);
        return 2;
      }),
    ];
    const results = await Promise.allSettled(calls);
    expect(order).toEqual([1, 2]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: 2 });
  });
});
