import type {
  ShieldedAssetWorkerCallMap,
  ShieldedAssetSessionState,
} from "./shieldedAssetWorkerTypes";
import { isPublicStateSyncProgress, publishPublicStateSyncProgress, type PublicStateSyncProgress } from "./publicStateSyncProgress";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  defaultTimeout: boolean;
};
let worker: Worker | null = null;
let sequence = 0;
let generation = 0;
const pending = new Map<number, Pending>();
const DEFAULT_TIMEOUT_MS = 240_000;
const progressWatermarks = new Map<string, { completed: number; finished: boolean }>();
const lockListeners = new Set<() => void>();
const BACKUP_CHALLENGES_KEY = "deepfamily:pending-independent-key-backups:v1";
function readBackupChallenges(): Set<string> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(BACKUP_CHALLENGES_KEY) ?? "[]");
    if (Array.isArray(stored))
      return new Set(
        stored.filter(
          (value): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value),
        ),
      );
  } catch {
    // Private browsing may disable storage. In-memory protection still applies.
  }
  return new Set();
}
// Only public fingerprints persist for this tab, including reloads. No key,
// words, signature, source metadata or secret Worker state is stored here.
const pendingBackupFingerprints = readBackupChallenges();
function saveBackupChallenges(): void {
  try {
    if (pendingBackupFingerprints.size)
      sessionStorage.setItem(BACKUP_CHALLENGES_KEY, JSON.stringify([...pendingBackupFingerprints]));
    else sessionStorage.removeItem(BACKUP_CHALLENGES_KEY);
  } catch {
    // A storage failure must not discard the current in-memory challenge.
  }
}

export function subscribeShieldedAssetWorkerLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

export function getShieldedAssetWorkerGeneration(): number {
  return generation;
}

/** Locking destroys the whole secret realm, including its proving threads. */
export function terminateShieldedAssetWorker(): void {
  generation += 1;
  const previous = worker;
  worker = null;
  previous?.terminate();
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Asset session locked. Unlock before continuing."));
  }
  pending.clear();
  progressWatermarks.clear();
  for (const listener of lockListeners) listener();
}

function publishProgress(progress: PublicStateSyncProgress) {
  const key = `${progress.domain}:${progress.phase}`;
  const previous = progressWatermarks.get(key);
  const finished = progress.completed === progress.total || progress.phase === "complete";
  const advanced = progress.completed > (previous?.completed ?? 0) || (finished && !previous?.finished);
  progressWatermarks.set(key, { completed: Math.max(previous?.completed ?? 0, progress.completed),
    finished: finished || !!previous?.finished });
  if (advanced) {
    // A serial Worker may be making progress for the request ahead of queued
    // calls. Renew all default liveness deadlines, preserving explicit limits.
    for (const entry of pending.values()) if (entry.defaultTimeout) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(terminateShieldedAssetWorker, DEFAULT_TIMEOUT_MS);
    }
  }
  publishPublicStateSyncProgress(progress);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL("../../workers/shieldedAsset.worker.ts", import.meta.url), {
    type: "module",
  });
  worker = instance;
  instance.addEventListener("message", (event: MessageEvent) => {
    if (worker !== instance) return;
    const message = event.data;
    if (message?.type === "publicStateSyncProgress") {
      if (isPublicStateSyncProgress(message.progress)) publishProgress(message.progress);
      return;
    }
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    progressWatermarks.clear();
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error?.message ?? "Asset operation failed"));
  });
  instance.addEventListener("error", () => {
    if (worker === instance) terminateShieldedAssetWorker();
  });
  return instance;
}

export function cancelShieldedAssetPreview(): Promise<unknown> {
  return worker ? shieldedAssetWorkerCall("cancelPreview", {}) : Promise.resolve();
}

export function shieldedAssetWorkerCall<M extends keyof ShieldedAssetWorkerCallMap>(
  method: M,
  params: ShieldedAssetWorkerCallMap[M]["params"],
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ShieldedAssetWorkerCallMap[M]["result"]> {
  if (options?.signal?.aborted) return Promise.reject(new Error("Asset operation cancelled"));
  let instance: Worker;
  try {
    instance = ensureWorker();
  } catch (error) {
    return Promise.reject(error);
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    if (pending.size === 0) progressWatermarks.clear();
    const abort = () => terminateShieldedAssetWorker();
    options?.signal?.addEventListener("abort", abort, { once: true });
    const finish = () => options?.signal?.removeEventListener("abort", abort);
    pending.set(id, {
      resolve: (value) => {
        finish();
        if (
          method === "createIndependentKey" ||
          method === "restoreSignature" ||
          method === "importRecoveryMaterial"
        ) {
          const independentKey = (value as ShieldedAssetSessionState).independentKey;
          if (independentKey?.backupRequired) pendingBackupFingerprints.add(independentKey.keyFingerprint);
          else if (method === "importRecoveryMaterial" && independentKey?.recoveryVerified)
            pendingBackupFingerprints.delete(independentKey.keyFingerprint);
          saveBackupChallenges();
        }
        resolve(value as ShieldedAssetWorkerCallMap[M]["result"]);
      },
      reject: (error) => {
        finish();
        reject(error);
      },
      timer: setTimeout(terminateShieldedAssetWorker, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      defaultTimeout: options?.timeoutMs === undefined,
    });
    const request = {
      id,
      method,
      params:
        method === "restoreSignature" || method === "importRecoveryMaterial"
          ? { ...params, pendingBackupFingerprints: [...pendingBackupFingerprints] }
          : (params as unknown),
    };
    try {
      instance.postMessage(request);
    } catch {
      terminateShieldedAssetWorker();
    } finally {
      // Structured cloning has completed. Do not retain passwords or signatures.
      request.params = undefined;
    }
  });
}
