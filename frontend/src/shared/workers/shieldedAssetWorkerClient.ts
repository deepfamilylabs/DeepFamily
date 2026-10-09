import type { ShieldedAssetWorkerCallMap } from "./shieldedAssetWorkerTypes";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
let worker: Worker | null = null;
let sequence = 0;
let generation = 0;
const pending = new Map<number, Pending>();
const lockListeners = new Set<() => void>();

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
  for (const listener of lockListeners) listener();
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
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
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
    const abort = () => terminateShieldedAssetWorker();
    options?.signal?.addEventListener("abort", abort, { once: true });
    const finish = () => options?.signal?.removeEventListener("abort", abort);
    pending.set(id, {
      resolve: (value) => {
        finish();
        resolve(value as ShieldedAssetWorkerCallMap[M]["result"]);
      },
      reject: (error) => {
        finish();
        reject(error);
      },
      timer: setTimeout(terminateShieldedAssetWorker, options?.timeoutMs ?? 240_000),
    });
    const request = { id, method, params: params as unknown };
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
