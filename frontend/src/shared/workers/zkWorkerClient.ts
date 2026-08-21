import type { Groth16Proof } from "../zk/zk";
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

const rejectPending = (error: Error): void => {
  for (const [, entry] of pending) {
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    entry.reject(error);
  }
  pending.clear();
};

export function terminateZkWorker(
  reason: Error = new ZkWorkerTerminatedError(),
): void {
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
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    if (msg.ok) entry.resolve(msg.result);
    else
      entry.reject(
        Object.assign(new Error(msg.error?.message || "ZK worker error"), {
          name: msg.error?.name,
        }),
      );
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
  const timeoutMs = opts?.timeoutMs ?? 180_000;

  return new Promise<ZkWorkerCallMap[M]["result"]>((resolve, reject) => {
    const entry: PendingZkWorkerCall = { resolve, reject };
    if (timeoutMs > 0) {
      entry.timeoutId = setTimeout(() => {
        if (!pending.has(id)) return;
        terminateZkWorker(new Error(`ZK worker timeout (${String(method)})`));
      }, timeoutMs);
    }
    pending.set(id, entry);
    try {
      const request: ZkWorkerRequest = { id, method, params };
      worker.postMessage(request);
    } catch (error) {
      pending.delete(id);
      if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
