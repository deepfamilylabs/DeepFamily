/** Public chain data only. No credentials, receive codes, interests or decrypted notes belong here. */
export type PublicStateHead = {
  dataset: string;
  revision: number;
  blockNumber: number;
  blockHash: string;
  data: Record<string, unknown>;
};
export type PublicStatePending = PublicStateHead & {
  sequence: number;
  baseRevision: number;
  cursors: Record<string, number>;
};
export type PublicStateWrite = {
  kind: string;
  key: string;
  value: unknown;
  lookups?: string[];
  remove?: boolean;
};
type Row = PublicStateWrite & { scope: string; dataset: string; indexes: string[] };
type Envelope = { scope: string; head?: PublicStateHead; pending?: PublicStatePending };
type Journal = {
  scope: string;
  dataset: string;
  revision: number;
  previous: PublicStateHead;
  undo: PublicStateWrite[];
};
export type PublicStateReader = {
  get<T>(kind: string, key: string): Promise<T | undefined>;
  query<T>(kind: string, lookup: string, limit?: number): Promise<T[]>;
};
export class PublicStateConflictError extends Error {
  constructor() {
    super("Public synchronization changed in another task. Retry synchronization.");
  }
}
const DATABASE = "deepfamily-public-state-v1";
const HISTORY = 32;
let database: Promise<IDBDatabase> | undefined;
const queues = new Map<string, Promise<unknown>>();
const openedScopes = new Set<string>();
const cleanups = new Map<string, Promise<number>>();
function request<T>(item: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    item.onsuccess = () => resolve(item.result);
    item.onerror = () => reject(item.error ?? new Error("Public cache request failed"));
  });
}
function completion(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Public cache transaction aborted"));
    transaction.onerror = () => {
      /* onabort carries the final transaction error. */
    };
  });
  // A callback can still be unwinding when IDB reports an abort. Keep that
  // rejection handled while preserving it for the eventual await.
  void done.catch(() => undefined);
  return done;
}
function safeAbort(transaction: IDBTransaction) {
  try {
    transaction.abort();
  } catch {
    /* A completed transaction cannot be aborted. */
  }
}
async function openDatabase() {
  if (typeof indexedDB === "undefined")
    throw new Error("Persistent public synchronization requires browser storage");
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DATABASE, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore("heads", { keyPath: "scope" });
        const records = db.createObjectStore("records", {
          keyPath: ["scope", "dataset", "kind", "key"],
        });
        records.createIndex("lookup", "indexes", { multiEntry: true });
        db.createObjectStore("history", { keyPath: ["scope", "dataset", "revision"] });
      };
      opening.onsuccess = () => {
        const db = opening.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      opening.onerror = () => {
        database = undefined;
        reject(opening.error);
      };
      opening.onblocked = () => {
        database = undefined;
        reject(new Error("Public cache is blocked by another tab"));
      };
    });
  return database;
}
function row(scope: string, dataset: string, value: PublicStateWrite): Row {
  return {
    ...value,
    scope,
    dataset,
    indexes: (value.lookups ?? []).map((lookup) =>
      JSON.stringify([scope, dataset, value.kind, lookup]),
    ),
  };
}
function same(actual: PublicStateHead | undefined, expected: PublicStateHead | undefined) {
  return (
    actual?.dataset === expected?.dataset &&
    actual?.revision === expected?.revision &&
    actual?.blockNumber === expected?.blockNumber &&
    actual?.blockHash === expected?.blockHash &&
    JSON.stringify(actual?.data) === JSON.stringify(expected?.data)
  );
}
function reader(transaction: IDBTransaction, scope: string, dataset: string): PublicStateReader {
  const records = transaction.objectStore("records");
  return {
    async get<T>(kind: string, key: string) {
      return ((await request(records.get([scope, dataset, kind, key]))) as Row | undefined)
        ?.value as T | undefined;
    },
    async query<T>(kind: string, lookup: string, limit = 100_001) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_001)
        throw new Error("Invalid public cache lookup limit");
      const rows = (await request(
        records.index("lookup").getAll(JSON.stringify([scope, dataset, kind, lookup]), limit),
      )) as Row[];
      return rows.map((entry) => {
        if (
          entry.scope !== scope ||
          entry.dataset !== dataset ||
          entry.kind !== kind ||
          !entry.lookups?.includes(lookup)
        )
          throw new Error("Public cache lookup is inconsistent");
        return entry.value as T;
      });
    },
  };
}

export function hasPersistentPublicStateStorage(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Web Locks serialize cooperating tabs; revision CAS also protects browsers without Web Locks. */
export async function withPublicStateLock<T>(
  scope: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`deepfamily-public:${scope}`, callback);
  }
  const previous = queues.get(scope) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(callback);
  queues.set(scope, next);
  try {
    return await next;
  } finally {
    if (queues.get(scope) === next) queues.delete(scope);
  }
}

export async function openPublicStateStore(scope: string) {
  if (!scope || scope.length > 1024) throw new Error("Invalid public cache scope");
  const db = await openDatabase();
  const envelope = async () => {
    const transaction = db.transaction("heads", "readonly");
    const done = completion(transaction);
    try {
      const value = (await request(transaction.objectStore("heads").get(scope))) as
        | Envelope
        | undefined;
      await done;
      return value ?? { scope };
    } catch (error) {
      safeAbort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  };
  const read = async <T>(
    head: PublicStateHead,
    callback: (view: PublicStateReader) => Promise<T>,
    pending = false,
  ) => {
    const transaction = db.transaction(["heads", "records"], "readonly");
    const done = completion(transaction);
    try {
      const current = (await request(transaction.objectStore("heads").get(scope))) as
        | Envelope
        | undefined;
      if (
        !same(pending ? current?.pending : current?.head, head) ||
        (pending && current?.pending?.sequence !== (head as PublicStatePending).sequence)
      )
        throw new PublicStateConflictError();
      // The callback may await only this view's IDB requests, never network or timers.
      const value = await callback(reader(transaction, scope, head.dataset));
      await done;
      return value;
    } catch (error) {
      safeAbort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  };
  const putWrites = (
    transaction: IDBTransaction,
    dataset: string,
    writes: readonly PublicStateWrite[],
  ) => {
    const records = transaction.objectStore("records");
    for (const write of writes) {
      if (write.remove) records.delete([scope, dataset, write.kind, write.key]);
      else records.put(row(scope, dataset, write));
    }
  };
  const pruneBatch = async () => {
    const transaction = db.transaction(["heads", "records", "history"], "readwrite");
    const done = completion(transaction);
    try {
      const current = (await request(transaction.objectStore("heads").get(scope))) as
        | Envelope
        | undefined;
      const retained = new Set([current?.head?.dataset, current?.pending?.dataset]);
      let removed = 0;
      let more = false;
      for (const name of ["records", "history"]) {
        await new Promise<void>((resolve, reject) => {
          const cursor = transaction
            .objectStore(name)
            .openKeyCursor(IDBKeyRange.bound([scope], [scope, []]));
          cursor.onerror = () => reject(cursor.error ?? new Error("Public cache cleanup failed"));
          cursor.onsuccess = () => {
            try {
              const item = cursor.result;
              if (!item) {
                resolve();
                return;
              }
              const dataset = (item.primaryKey as string[])[1];
              if (retained.has(dataset)) {
                // Jump over the entire active dataset without visiting its rows.
                item.continue([scope, dataset, []]);
              } else if (removed >= 512) {
                more = true;
                resolve();
              } else {
                // A key-only cursor cannot delete directly in every IDB implementation.
                transaction.objectStore(name).delete(item.primaryKey);
                removed += 1;
                item.continue();
              }
            } catch (error) {
              reject(error);
            }
          };
        });
        if (more) break;
      }
      await done;
      return { removed, more };
    } catch (error) {
      safeAbort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  };
  const prune = (): Promise<number> => {
    const previous = cleanups.get(scope);
    if (previous) return previous;
    const cleanup = (async () => {
      let total = 0;
      let more;
      do {
        const batch = await pruneBatch();
        total += batch.removed;
        more = batch.more;
        if (more) await new Promise((resolve) => setTimeout(resolve, 0));
      } while (more);
      return total;
    })();
    cleanups.set(scope, cleanup);
    void cleanup
      .finally(() => {
        if (cleanups.get(scope) === cleanup) cleanups.delete(scope);
      })
      .catch(() => undefined);
    return cleanup;
  };
  const schedulePrune = () => {
    void prune().catch(() => undefined);
  };
  // A page may have closed during the previous bounded cleanup. Resume it once
  // per scope/realm; the cursor jumps over retained generations without scanning
  // their rows, and normal path reads never perform a global cleanup scan.
  if (!openedScopes.has(scope)) {
    openedScopes.add(scope);
    schedulePrune();
  }
  return {
    envelope,
    read,
    /** Stream abandoned generations in bounded transactions; never scan active rows. */
    prune,
    async startPending(
      anchor: Omit<PublicStateHead, "dataset" | "revision">,
    ): Promise<PublicStatePending> {
      const transaction = db.transaction("heads", "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        const old = current?.pending;
        if (
          old &&
          old.baseRevision === (current?.head?.revision ?? 0) &&
          old.blockNumber === anchor.blockNumber &&
          old.blockHash === anchor.blockHash &&
          JSON.stringify(old.data) === JSON.stringify(anchor.data)
        ) {
          await done;
          return old;
        }
        const pending: PublicStatePending = {
          ...anchor,
          dataset: crypto.randomUUID(),
          revision: 0,
          sequence: 0,
          baseRevision: current?.head?.revision ?? 0,
          cursors: {},
        };
        heads.put({ ...current, scope, pending });
        await done;
        if (old) schedulePrune();
        return pending;
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    async writePending(
      pending: PublicStatePending,
      writes: readonly PublicStateWrite[],
      cursors: Record<string, number>,
    ) {
      const transaction = db.transaction(["heads", "records"], "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (!same(current?.pending, pending) || current?.pending?.sequence !== pending.sequence)
          throw new PublicStateConflictError();
        const next = {
          ...pending,
          sequence: pending.sequence + 1,
          cursors: { ...pending.cursors, ...cursors },
        };
        putWrites(transaction, pending.dataset, writes);
        heads.put({ ...current, scope, pending: next });
        await done;
        return next;
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    async finishPending(pending: PublicStatePending) {
      const transaction = db.transaction("heads", "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (
          !same(current?.pending, pending) ||
          current?.pending?.sequence !== pending.sequence ||
          (current.head?.revision ?? 0) !== pending.baseRevision
        )
          throw new PublicStateConflictError();
        const head: PublicStateHead = {
          dataset: pending.dataset,
          revision: pending.baseRevision + 1,
          blockNumber: pending.blockNumber,
          blockHash: pending.blockHash,
          data: pending.data,
        };
        heads.put({ scope, head });
        await done;
        schedulePrune();
        return head;
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    async commit(
      expected: PublicStateHead,
      anchor: Omit<PublicStateHead, "dataset" | "revision">,
      writes: readonly PublicStateWrite[],
    ) {
      const transaction = db.transaction(["heads", "records", "history"], "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (!same(current?.head, expected)) throw new PublicStateConflictError();
        const undo: PublicStateWrite[] = [];
        const seen = new Set<string>();
        for (const write of writes) {
          const key = JSON.stringify([write.kind, write.key]);
          if (seen.has(key)) continue;
          seen.add(key);
          const previous = (await request(
            transaction
              .objectStore("records")
              .get([scope, expected.dataset, write.kind, write.key]),
          )) as Row | undefined;
          undo.push(
            previous
              ? {
                  kind: previous.kind,
                  key: previous.key,
                  value: previous.value,
                  lookups: previous.lookups,
                }
              : { kind: write.kind, key: write.key, value: undefined, remove: true },
          );
        }
        const next: PublicStateHead = {
          ...anchor,
          dataset: expected.dataset,
          revision: expected.revision + 1,
        };
        putWrites(transaction, expected.dataset, writes);
        const history = transaction.objectStore("history");
        history.put({
          scope,
          dataset: expected.dataset,
          revision: next.revision,
          previous: expected,
          undo,
        } satisfies Journal);
        history.delete([scope, expected.dataset, next.revision - HISTORY]);
        heads.put({ ...current, scope, head: next });
        await done;
        return next;
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    async rollback(expected: PublicStateHead) {
      const transaction = db.transaction(["heads", "records", "history"], "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (!same(current?.head, expected)) throw new PublicStateConflictError();
        const history = transaction.objectStore("history");
        const journal = (await request(
          history.get([scope, expected.dataset, expected.revision]),
        )) as Journal | undefined;
        if (!journal) {
          await done;
          return undefined;
        }
        putWrites(transaction, expected.dataset, journal.undo);
        heads.put({ scope, head: journal.previous });
        history.delete([scope, expected.dataset, expected.revision]);
        await done;
        if (current?.pending) schedulePrune();
        return journal.previous;
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    async discardPending(expected?: PublicStatePending) {
      const transaction = db.transaction("heads", "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (
          expected &&
          (!same(current?.pending, expected) || current?.pending?.sequence !== expected.sequence)
        )
          throw new PublicStateConflictError();
        if (current) heads.put({ scope, head: current.head });
        await done;
        if (current?.pending) schedulePrune();
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
    /** Discard only the verified generation that the failed local read actually used. */
    async invalidateHead(expected: PublicStateHead) {
      const transaction = db.transaction("heads", "readwrite");
      const done = completion(transaction);
      try {
        const heads = transaction.objectStore("heads");
        const current = (await request(heads.get(scope))) as Envelope | undefined;
        if (!same(current?.head, expected)) throw new PublicStateConflictError();
        heads.delete(scope);
        await done;
        schedulePrune();
      } catch (error) {
        safeAbort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    },
  };
}
export type PublicStateStore = Awaited<ReturnType<typeof openPublicStateStore>>;
