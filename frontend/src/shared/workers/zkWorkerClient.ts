import type { Groth16Proof } from "../zk/zk";
import { serializeWorkerError } from "./workerErrors";
import {
  isPublicStateSyncProgress,
  publishPublicStateSyncProgress,
  type PublicStateSyncProgress,
} from "./publicStateSyncProgress";
import type {
  DisclosureBindingProofParameters,
  PersonRelationProofParameters,
} from "../zk/zkSnark";

type ZkWorkerCallMap = {
  generatePersonRelationProof: {
    params: PersonRelationProofParameters;
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyPersonRelationProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
  generateDisclosureBindingProof: {
    params: DisclosureBindingProofParameters;
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyDisclosureBindingProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
};

type ZkWorkerRequest = { id: number; method: keyof ZkWorkerCallMap; params: any };
type ZkWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

interface PendingZkWorkerCall {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  renewTimeout?: () => void;
}

export class ZkWorkerTerminatedError extends Error {
  constructor(message = "ZK worker terminated") {
    super(message);
    this.name = "ZkWorkerTerminatedError";
  }
}

let workerSingleton: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingZkWorkerCall>();
const DEFAULT_TIMEOUT_MS = 180_000;
const progressWatermarks = new Map<string, { completed: number; finished: boolean }>();

const rejectPending = (error: Error): void => {
  for (const [, entry] of pending) {
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    entry.reject(error);
  }
  pending.clear();
  progressWatermarks.clear();
};

function publishProgress(progress: PublicStateSyncProgress) {
  const key = `${progress.domain}:${progress.phase}`;
  const previous = progressWatermarks.get(key);
  const finished = progress.completed === progress.total || progress.phase === "complete";
  const advanced =
    progress.completed > (previous?.completed ?? 0) || (finished && !previous?.finished);
  progressWatermarks.set(key, {
    completed: Math.max(previous?.completed ?? 0, progress.completed),
    finished: finished || !!previous?.finished,
  });
  if (advanced) for (const entry of pending.values()) entry.renewTimeout?.();
  publishPublicStateSyncProgress(progress);
}

export function terminateZkWorker(reason: Error = new ZkWorkerTerminatedError()): void {
  const worker = workerSingleton;
  workerSingleton = null;
  if (worker) worker.terminate();
  rejectPending(reason);
}

export function terminateZkWorkerIfIdle(): boolean {
  if (pending.size > 0) return false;
  terminateZkWorker();
  return true;
}

const ensureWorker = (): Worker => {
  if (typeof window === "undefined") {
    throw new Error("ZK worker is not available (no window)");
  }
  if (workerSingleton) return workerSingleton;
  const worker = new Worker(new URL("../../workers/zk.worker.ts", import.meta.url), {
    type: "module",
  });
  workerSingleton = worker;
  worker.addEventListener("message", (event: MessageEvent<ZkWorkerResponse>) => {
    if (workerSingleton !== worker) return;
    const progressMessage = event.data as { type?: unknown; progress?: unknown } | null;
    if (progressMessage?.type === "publicStateSyncProgress") {
      if (isPublicStateSyncProgress(progressMessage.progress))
        publishProgress(progressMessage.progress);
      return;
    }
    const msg = event.data;
    const entry = pending.get(msg?.id);
    if (!entry) return;
    pending.delete(msg.id);
    progressWatermarks.clear();
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    if (msg.ok) entry.resolve(msg.result);
    else
      entry.reject(
        Object.assign(new Error(msg.error?.message || "ZK worker error"), {
          name: msg.error?.name,
        }),
      );
    // Keep an immediately chained proof working; otherwise release private
    // witnesses and any library/Wasm working memory as soon as the queue drains.
    queueMicrotask(() => terminateZkWorkerIfIdle());
  });
  worker.addEventListener("error", () => {
    if (workerSingleton !== worker) return;
    terminateZkWorker(new Error("ZK worker crashed"));
  });
  return worker;
};

export function zkWorkerCall<M extends keyof ZkWorkerCallMap>(
  method: M,
  params: ZkWorkerCallMap[M]["params"],
  opts?: { timeoutMs?: number },
): Promise<ZkWorkerCallMap[M]["result"]> {
  const worker = ensureWorker();
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ZkWorkerCallMap[M]["result"]>((resolve, reject) => {
    if (pending.size === 0) progressWatermarks.clear();
    const entry: PendingZkWorkerCall = { resolve, reject };
    if (timeoutMs > 0) {
      const startTimeout = () => {
        if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
        entry.timeoutId = setTimeout(() => {
          if (!pending.has(id)) return;
          terminateZkWorker(new Error(`ZK worker timeout (${String(method)})`));
        }, timeoutMs);
      };
      if (opts?.timeoutMs === undefined) entry.renewTimeout = startTimeout;
      startTimeout();
    }
    pending.set(id, entry);
    const request: ZkWorkerRequest = { id, method, params };
    try {
      worker.postMessage(request);
    } catch (error) {
      pending.delete(id);
      if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
      const diagnostic = serializeWorkerError(error);
      reject(Object.assign(new Error(diagnostic.message), diagnostic));
    } finally {
      // The Worker receives a structured clone. Clear the main-thread request
      // envelope immediately so role witnesses and digest limbs cannot linger
      // in an instrumentation/message buffer after dispatch.
      request.params = undefined;
      terminateZkWorkerIfIdle();
    }
  });
}
