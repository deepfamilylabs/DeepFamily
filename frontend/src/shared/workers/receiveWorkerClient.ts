import type { WalletCalls } from "./walletWorkerTypes";
import type { ReceiveDeployment, DepositSubmission, ClaimSubmission, TransferSubmission } from "../clients/receiveChain";
import type { ReceiveService, PinnedManifest } from "../zk/receiveProtocol";

export interface ReceiveWorkerContext {
  rpcUrl: string;
  deployment: ReceiveDeployment;
  /** Supplied by trusted application configuration, never by a scanned receive code. */
  manifest: PinnedManifest;
}
export interface ReceiveWorkerCalls extends WalletCalls {
  prepareRevocationScans: { input: Parameters<ReceiveService["prepareRevocationScans"]>[0]; result: { revocationScans: Awaited<ReturnType<ReceiveService["prepareRevocationScans"]>> } };
  proveIssue: { input: Parameters<ReceiveService["proveIssue"]>[0]; result: Awaited<ReturnType<ReceiveService["proveIssue"]>> };
  proveQualification: { input: Parameters<ReceiveService["proveQualification"]>[0]; result: Awaited<ReturnType<ReceiveService["proveQualification"]>> };
  createCode: { input: Parameters<ReceiveService["createCode"]>[0]; result: Awaited<ReturnType<ReceiveService["createCode"]>> };
  verifyCode: { input: { code: string; asOf?: string | bigint }; result: Awaited<ReturnType<ReceiveService["verifyCode"]>> };
  prepareDeposit: { input: Parameters<ReceiveService["prepareDeposit"]>[0]; result: DepositSubmission };
  prepareClaim: { input: Parameters<ReceiveService["prepareClaim"]>[0]; result: ClaimSubmission };
  prepareTransfer: { input: Parameters<ReceiveService["prepareTransfer"]>[0]; result: TransferSubmission };
  prepareLetter: { input: Parameters<ReceiveService["prepareLetter"]>[0]; result: Awaited<ReturnType<ReceiveService["prepareLetter"]>> };
}
export type ReceiveWorkerMethod = keyof ReceiveWorkerCalls;
export type ReceiveWorkerRequest = {
  [M in ReceiveWorkerMethod]: { id: number; method: M; context: ReceiveWorkerContext; input: ReceiveWorkerCalls[M]["input"] }
}[ReceiveWorkerMethod];

/** Cancel/close destroys the secret realm and any active proof; all pending operations reject. */
export class ReceiveWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>();
  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../../workers/receive.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent) => {
      if (this.worker !== worker) return;
      const entry = this.pending.get(event.data?.id);
      if (!entry) return;
      this.pending.delete(event.data.id); entry.cleanup();
      if (event.data.ok === true) entry.resolve(event.data.result);
      else {
        const error = new Error(event.data.error?.message ?? "Receive operation failed");
        if (event.data.error?.code === "QUALIFICATION_REVOKED") Object.assign(error, { code: "QUALIFICATION_REVOKED" });
        entry.reject(error);
      }
    });
    worker.addEventListener("error", () => { if (this.worker === worker) this.cancel("Receive proof worker stopped"); });
    this.worker = worker;
    return worker;
  }
  call<M extends ReceiveWorkerMethod>(method: M, input: ReceiveWorkerCalls[M]["input"], context: ReceiveWorkerContext,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReceiveWorkerCalls[M]["result"]> {
    if (options.signal?.aborted) return Promise.reject(new Error("Receive operation cancelled"));
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      const id = ++this.sequence;
      const abort = () => this.cancel("Receive operation cancelled");
      const timer = setTimeout(() => this.cancel("Receive proof timed out"), options.timeoutMs ?? 300_000);
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve: value => resolve(value as ReceiveWorkerCalls[M]["result"]), reject,
        cleanup: () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); } });
      const request: { id: number; method: M; input?: ReceiveWorkerCalls[M]["input"]; context: ReceiveWorkerContext } = { id, method, input, context };
      try { worker.postMessage(request); }
      catch { this.cancel("Could not start receiving proof operation"); }
      finally { delete request.input; }
    });
  }
  cancel(message = "Receive operation cancelled") {
    this.worker?.terminate(); this.worker = null;
    for (const entry of this.pending.values()) { entry.cleanup(); entry.reject(new Error(message)); }
    this.pending.clear();
  }
  close() { this.cancel("Wallet worker closed"); }
}
