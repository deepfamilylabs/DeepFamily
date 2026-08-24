import { deleteBlob, readBlob, writeBlob } from "../../../shared/cache/persistence";
import {
  clearAllMetadataUnlocks,
  sanitizeHydratedMetadataUnlocks,
  type NodeData,
} from "../../../shared/model";

type TreeNodesSnapshot = Record<string, NodeData>;

const queueTails = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
const failClosedReads = new Map<string, "empty" | "locked">();

function enqueue<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = queueTails.get(storageKey) ?? Promise.resolve();
  const task = previous.then(operation);
  const tail = task.then(
    () => undefined,
    () => undefined,
  );
  queueTails.set(storageKey, tail);
  void tail.then(() => {
    if (queueTails.get(storageKey) === tail) queueTails.delete(storageKey);
  });
  return task;
}

function currentRevision(storageKey: string): number {
  return revisions.get(storageKey) ?? 0;
}

function advanceRevision(storageKey: string): number {
  const next = currentRevision(storageKey) + 1;
  revisions.set(storageKey, next);
  return next;
}

function invalidateTreeNodesPersistence(
  storageKey: string,
  readPolicy: "empty" | "locked",
): number {
  const revision = advanceRevision(storageKey);
  failClosedReads.set(storageKey, readPolicy);
  return revision;
}

function applyReadPolicy(
  storageKey: string,
  snapshot: TreeNodesSnapshot,
): TreeNodesSnapshot | null {
  const policy = failClosedReads.get(storageKey);
  if (policy === "empty") return null;
  const sanitized = sanitizeHydratedMetadataUnlocks(snapshot);
  return policy === "locked" ? clearAllMetadataUnlocks(sanitized) : sanitized;
}

/** Capture this when scheduling a delayed write so a later clear can invalidate it. */
export function captureTreeNodesPersistenceRevision(storageKey: string): number {
  return currentRevision(storageKey);
}

/** Tests whether an async plaintext-producing task still predates no clear fence. */
export function isTreeNodesPersistenceRevisionCurrent(
  storageKey: string,
  expectedRevision: number,
): boolean {
  return expectedRevision === currentRevision(storageKey);
}

/** Advances the in-memory fence when IndexedDB persistence is disabled or unavailable. */
export function invalidateTreeNodesPlaintextWrites(storageKey: string): void {
  invalidateTreeNodesPersistence(storageKey, "locked");
}

/** Advances the full-cache fence when IndexedDB persistence is disabled or unavailable. */
export function invalidateAllTreeNodesWrites(storageKey: string): void {
  invalidateTreeNodesPersistence(storageKey, "empty");
}

/** Reads wait for every earlier same-scope mutation and honor any fail-closed tombstone. */
export function readTreeNodesSnapshot(storageKey: string): Promise<TreeNodesSnapshot | null> {
  return enqueue(storageKey, async () => {
    if (failClosedReads.get(storageKey) === "empty") return null;
    const persisted = await readBlob<TreeNodesSnapshot>(storageKey);
    return persisted ? applyReadPolicy(storageKey, persisted) : null;
  });
}

/**
 * Serializes a complete snapshot write. `expectedRevision` is required for delayed
 * writers: a clear advances the revision synchronously, so an old timer cannot put
 * plaintext back after the clear operation.
 */
export function writeTreeNodesSnapshot(
  storageKey: string,
  snapshot: TreeNodesSnapshot,
  expectedRevision: number = currentRevision(storageKey),
): Promise<void> {
  return enqueue(storageKey, async () => {
    if (expectedRevision !== currentRevision(storageKey)) return;
    await writeBlob(storageKey, snapshot);
    if (expectedRevision === currentRevision(storageKey)) failClosedReads.delete(storageKey);
  });
}

/** Performs a same-scope read/modify/write as one serialized operation. */
export function updateTreeNodesSnapshot(
  storageKey: string,
  update: (persisted: TreeNodesSnapshot) => TreeNodesSnapshot,
  expectedRevision: number,
): Promise<void> {
  return enqueue(storageKey, async () => {
    if (expectedRevision !== currentRevision(storageKey)) return;
    const persistedRaw = (await readBlob<TreeNodesSnapshot>(storageKey)) ?? {};
    if (expectedRevision !== currentRevision(storageKey)) return;
    const persisted = applyReadPolicy(storageKey, persistedRaw) ?? {};
    const next = update(persisted);
    if (expectedRevision !== currentRevision(storageKey)) return;
    await writeBlob(storageKey, next);
    if (expectedRevision === currentRevision(storageKey)) failClosedReads.delete(storageKey);
  });
}

/**
 * Removes every decrypted field while retaining public anchors. Deletion happens
 * before the best-effort public-only rewrite, so a rewrite failure leaves no old
 * plaintext to hydrate. If IndexedDB rejects both operations, reads remain locked
 * for the lifetime of this page instead of returning the stale plaintext.
 */
export function clearTreeMetadataUnlocks(
  storageKey: string,
  currentSnapshot: TreeNodesSnapshot,
): Promise<void> {
  const clearRevision = invalidateTreeNodesPersistence(storageKey, "locked");
  const lockedSnapshot = clearAllMetadataUnlocks(currentSnapshot);

  return enqueue(storageKey, async () => {
    let deleted = false;
    try {
      await deleteBlob(storageKey);
      deleted = true;
    } catch {
      // A public-only replacement below is an equivalent fail-closed outcome.
    }

    try {
      await writeBlob(storageKey, lockedSnapshot);
      if (clearRevision === currentRevision(storageKey)) failClosedReads.delete(storageKey);
    } catch {
      // A successful delete is already durable and safe. Otherwise retain the
      // in-page locked read policy so a remount cannot hydrate the stale record.
      if (deleted && clearRevision === currentRevision(storageKey)) {
        failClosedReads.delete(storageKey);
      }
    }
  });
}

/** Serializes full-cache deletion and invalidates already scheduled snapshot writes. */
export function deleteTreeNodesSnapshot(storageKey: string): Promise<void> {
  const deleteRevision = invalidateTreeNodesPersistence(storageKey, "empty");
  return enqueue(storageKey, async () => {
    try {
      await deleteBlob(storageKey);
      if (deleteRevision === currentRevision(storageKey)) failClosedReads.delete(storageKey);
    } catch {
      // Keep the in-page empty tombstone if durable deletion failed.
    }
  });
}
