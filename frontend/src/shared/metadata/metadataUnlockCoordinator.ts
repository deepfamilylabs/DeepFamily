import { normalizePassphrase, type BigNumberish } from "@deepfamily/protocol-core";
import type { NodeData } from "../model/graph";
import { isMetadataUnlockUsable, rebaseValidatedMetadataUnlock } from "../model/metadataUnlock";
import { CryptoWorkerTerminatedError, terminateCryptoWorker } from "../workers/cryptoWorkerClient";
import {
  MetadataUnlockCancelledError,
  unlockPersonVersionNode,
  type MetadataCodeReader,
} from "./metadataArchiveService";

export type MetadataUnlockBatchStatus = "running" | "cancelling" | "completed" | "cancelled";

export interface MetadataUnlockBatchProgress {
  status: MetadataUnlockBatchStatus;
  total: number;
  processed: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  persistenceFailed: number;
  currentNodeId?: string;
}

export interface MetadataUnlockFailure {
  nodeId: string;
  code?: string;
  name: string;
  message: string;
}

export interface MetadataUnlockPersistenceFailure extends MetadataUnlockFailure {}

export interface MetadataUnlockBatchReport extends MetadataUnlockBatchProgress {
  failures: MetadataUnlockFailure[];
  persistenceFailures: MetadataUnlockPersistenceFailure[];
}

export interface MetadataUnlockBatchItemInput {
  node: NodeData;
  chainId: BigNumberish;
  deepFamilyProxy: string;
  getCode: MetadataCodeReader;
  rawPassphrase: string;
  signal?: AbortSignal;
}

export type MetadataNodeUnlocker = (input: MetadataUnlockBatchItemInput) => Promise<NodeData>;

export interface MetadataUnlockBatchOptions {
  nodes: readonly NodeData[];
  chainId: BigNumberish;
  deepFamilyProxy: string;
  getCode: MetadataCodeReader;
  rawPassphrase: string;
  cacheValidatedPersonVersion: (node: NodeData) => void;
  getCurrentNode?: (nodeId: string) => NodeData | undefined;
  persistUnlocked?: (node: NodeData) => Promise<void> | void;
  onProgress?: (progress: MetadataUnlockBatchProgress) => void;
  onPersistenceError?: (failure: MetadataUnlockPersistenceFailure) => void;
  unlockNode?: MetadataNodeUnlocker;
  isAlreadyUnlocked?: (node: NodeData) => boolean;
}

interface ActiveRun {
  controller: AbortController;
  notifyCancelling?: () => void;
}

const defaultUnlockNode: MetadataNodeUnlocker = (input) => unlockPersonVersionNode(input);

const redactSecret = (message: string, rawPassphrase: string): string => {
  let redacted = message;
  const candidates = new Set([rawPassphrase]);
  try {
    candidates.add(normalizePassphrase(rawPassphrase));
  } catch {
    // Raw input remains a redaction candidate when normalization rejects a
    // malformed programmatic string.
  }
  for (const candidate of candidates) {
    if (candidate.length > 0) redacted = redacted.split(candidate).join("[REDACTED]");
  }
  return redacted.slice(0, 500);
};

const safeFailure = (
  nodeId: string,
  error: unknown,
  rawPassphrase: string,
): MetadataUnlockFailure => {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
  const name = typeof record?.name === "string" ? record.name : "MetadataUnlockError";
  const code = typeof record?.code === "string" ? record.code : undefined;
  const rawMessage =
    typeof record?.message === "string"
      ? record.message
      : "This metadata version could not be unlocked";
  return { nodeId, name, code, message: redactSecret(rawMessage, rawPassphrase) };
};

const isCancellation = (error: unknown): boolean =>
  error instanceof MetadataUnlockCancelledError || error instanceof CryptoWorkerTerminatedError;

/**
 * Owns one user-initiated batch at a time. The loop deliberately awaits each
 * version before starting the next, so only one heavy KDF job can exist at the
 * application layer. It never stores the passphrase on the coordinator.
 */
export class MetadataUnlockCoordinator {
  private activeRun: ActiveRun | null = null;

  get running(): boolean {
    return this.activeRun !== null;
  }

  cancel(): boolean {
    const active = this.activeRun;
    if (!active || active.controller.signal.aborted) return false;
    active.controller.abort();
    active.notifyCancelling?.();
    // AbortSignal stops reads/commits; termination is what actually stops an
    // Argon2 invocation already executing inside the Worker realm.
    terminateCryptoWorker(new CryptoWorkerTerminatedError("Metadata unlock cancelled"));
    return true;
  }

  async run(options: MetadataUnlockBatchOptions): Promise<MetadataUnlockBatchReport> {
    if (this.activeRun) throw new Error("A metadata unlock batch is already running");

    const active: ActiveRun = { controller: new AbortController() };
    this.activeRun = active;
    const progress: MetadataUnlockBatchProgress = {
      status: "running",
      total: options.nodes.length,
      processed: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      persistenceFailed: 0,
    };
    const failures: MetadataUnlockFailure[] = [];
    const persistenceFailures: MetadataUnlockPersistenceFailure[] = [];
    const unlockNode = options.unlockNode ?? defaultUnlockNode;
    const isAlreadyUnlocked = options.isAlreadyUnlocked ?? isMetadataUnlockUsable;
    const emit = () => options.onProgress?.({ ...progress });
    active.notifyCancelling = () => {
      progress.status = "cancelling";
      emit();
    };

    emit();
    try {
      for (const node of options.nodes) {
        if (active.controller.signal.aborted) break;
        if (isAlreadyUnlocked(node)) {
          progress.skipped += 1;
          progress.processed += 1;
          progress.currentNodeId = node.id;
          emit();
          continue;
        }

        progress.currentNodeId = node.id;
        progress.attempted += 1;
        emit();
        try {
          const unlocked = await unlockNode({
            node,
            chainId: options.chainId,
            deepFamilyProxy: options.deepFamilyProxy,
            getCode: options.getCode,
            rawPassphrase: options.rawPassphrase,
            signal: active.controller.signal,
          });
          if (active.controller.signal.aborted) break;

          // unlockPersonVersionNode has already completed every cryptographic
          // and semantic check before this callback receives plaintext. Rebase
          // only the private fields onto the latest public snapshot so a chain
          // refresh racing the Worker cannot be overwritten by stale anchors.
          const current = options.getCurrentNode?.(node.id) ?? node;
          const committed = rebaseValidatedMetadataUnlock(current, unlocked);
          options.cacheValidatedPersonVersion(committed);
          progress.succeeded += 1;
          progress.processed += 1;

          if (options.persistUnlocked) {
            try {
              await options.persistUnlocked(committed);
            } catch (error) {
              const failure = safeFailure(node.id, error, options.rawPassphrase);
              persistenceFailures.push(failure);
              progress.persistenceFailed += 1;
              options.onPersistenceError?.(failure);
            }
          }
          emit();
        } catch (error) {
          if (active.controller.signal.aborted || isCancellation(error)) break;
          failures.push(safeFailure(node.id, error, options.rawPassphrase));
          progress.failed += 1;
          progress.processed += 1;
          emit();
        }
      }

      progress.currentNodeId = undefined;
      progress.status = active.controller.signal.aborted ? "cancelled" : "completed";
      emit();
      return { ...progress, failures, persistenceFailures };
    } finally {
      if (this.activeRun === active) this.activeRun = null;
    }
  }
}
