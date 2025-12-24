import type { Groth16Proof, PersonData } from "./zk";

type ZkWorkerCallMap = {
  generatePersonProof: {
    params: {
      person: PersonData;
      father: PersonData | null;
      mother: PersonData | null;
      submitterAddress: string;
    };
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyPersonProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
  generateNamePoseidonProof: {
    params: { fullName: string; passphrase: string; minterAddress: string };
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyNamePoseidonProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
};

type ZkWorkerRequest = { id: number; method: keyof ZkWorkerCallMap; params: any };
type ZkWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

let workerSingleton: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

const ensureWorker = (): Worker => {
  if (typeof window === "undefined") {
    throw new Error("ZK worker is not available (no window)");
  }
  if (workerSingleton) return workerSingleton;
  workerSingleton = new Worker(new URL("../workers/zk.worker.ts", import.meta.url), {
    type: "module",
  });
  workerSingleton.addEventListener("message", (event: MessageEvent<ZkWorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else
      entry.reject(
        Object.assign(new Error(msg.error?.message || "ZK worker error"), {
          name: msg.error?.name,
        }),
      );
  });
  workerSingleton.addEventListener("error", () => {
    for (const [, entry] of pending) entry.reject(new Error("ZK worker crashed"));
    pending.clear();
    workerSingleton = null;
  });
  return workerSingleton;
};

export async function zkWorkerCall<M extends keyof ZkWorkerCallMap>(
  method: M,
  params: ZkWorkerCallMap[M]["params"],
  opts?: { timeoutMs?: number },
): Promise<ZkWorkerCallMap[M]["result"]> {
  const worker = ensureWorker();
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs ?? 180_000;

  const promise = new Promise<ZkWorkerCallMap[M]["result"]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ZkWorkerRequest = { id, method, params };
    worker.postMessage(req);
  });

  if (!timeoutMs) return promise;
  return await Promise.race([
    promise,
    new Promise<ZkWorkerCallMap[M]["result"]>((_, reject) => {
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`ZK worker timeout (${String(method)})`));
        }
      }, timeoutMs);
    }),
  ]);
}
