import type {
  IdentityFields,
  MetadataContextInput,
  PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import type { IdentityHashInput } from "../crypto/identityHash";
import type { DerivedKey, KeyPurpose, KDFPreset } from "../crypto/secureKeyDerivation";

export interface IdentityMaterialV1Result {
  identitySuiteId: number;
  identity: {
    fullName: string;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isBirthBC: boolean;
  };
  derivedSecretField: string;
  nameField: string;
  packedBirthGenderField: string;
  suiteCommitment: string;
  nameSecretCommitment: string;
  identityCommitment: string;
  personHash: string;
}

export interface PreparedPersonVersionContentV1Result {
  canonicalJsonLength: number;
  contentDigestLo: string;
  contentDigestHi: string;
  versionCommitment: string;
}

export interface PersonVersionEnvelopeSizePreflightV1Result {
  canonicalJsonLength: number;
  compressedPlaintextLength: number;
  envelopeLength: number;
}

export interface EncryptedPersonVersionEnvelopeV1Result {
  envelopeHex: string;
  payloadHash: string;
  formatVersion: 1;
  identitySuiteId: number;
  envelopeLength: number;
  canonicalJsonLength: number;
  compressedPlaintextLength: number;
}

export interface ValidatedPersonVersionV1Result {
  metadata: {
    schema: "deepfamily/person-version@1.0";
    person: {
      fullName: string;
      gender: number;
      birthYear: number;
      birthMonth: number;
      birthDay: number;
      isBirthBC: boolean;
      personHash: string;
    };
    parents: {
      father: null | {
        fullName: string;
        gender: number;
        birthYear: number;
        birthMonth: number;
        birthDay: number;
        isBirthBC: boolean;
        personHash: string;
        versionIndex: string;
      };
      mother: null | {
        fullName: string;
        gender: number;
        birthYear: number;
        birthMonth: number;
        birthDay: number;
        isBirthBC: boolean;
        personHash: string;
        versionIndex: string;
      };
    };
    tag: string;
    biography: string;
  };
  formatVersion: 1;
  identitySuiteId: number;
  payloadHash: string;
  versionCommitment: string;
  metadataUnlockValidated: true;
  protocolGeneration: string;
}

export type CryptoWorkerCallMap = {
  computeIdentityHash: { params: { input: IdentityHashInput }; result: { identityHash: string } };
  deriveKey: {
    params: { input: IdentityHashInput; purpose?: KeyPurpose; preset?: KDFPreset };
    result: DerivedKey;
  };
  deriveIdentityMaterialV1: {
    params: {
      identity: IdentityFields;
      rawPassphrase: string;
      identitySuiteId?: number | string | bigint;
    };
    result: IdentityMaterialV1Result;
  };
  preparePersonVersionContentV1: {
    params: {
      metadata: PersonVersionMetadataInput;
      derivedSecretField: number | string | bigint;
    };
    result: PreparedPersonVersionContentV1Result;
  };
  preflightPersonVersionEnvelopeSizeV1: {
    params: { metadata: PersonVersionMetadataInput };
    result: PersonVersionEnvelopeSizePreflightV1Result;
  };
  encryptPersonVersionEnvelopeV1: {
    params: {
      metadata: PersonVersionMetadataInput;
      rawPassphrase: string;
      identitySuiteId?: number | string | bigint;
      context: MetadataContextInput;
    };
    result: EncryptedPersonVersionEnvelopeV1Result;
  };
  roundTripPersonVersionEnvelopeV1: {
    params: {
      envelopeHex: string;
      rawPassphrase: string;
      context: MetadataContextInput;
      expectedMetadata: PersonVersionMetadataInput;
      submitterAndSelfSuiteId?: number | string | bigint;
      expectedSubmitter?: string;
    };
    result: ValidatedPersonVersionV1Result;
  };
  decryptPersonVersionEnvelopeV1: {
    params: {
      envelopeHex: string;
      rawPassphrase: string;
      context: MetadataContextInput;
    };
    result: ValidatedPersonVersionV1Result;
  };
};

type CryptoWorkerRequest = { id: number; method: keyof CryptoWorkerCallMap; params: unknown };
type CryptoWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; name?: string; code?: string } };

interface PendingCryptoWorkerCall {
  request: CryptoWorkerRequest;
  priority: CryptoWorkerPriority;
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export type CryptoWorkerPriority = "foreground" | "background";

export interface CryptoWorkerCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  priority?: CryptoWorkerPriority;
}

export class CryptoWorkerTerminatedError extends Error {
  constructor(message = "Crypto worker terminated") {
    super(message);
    this.name = "CryptoWorkerTerminatedError";
  }
}

export class CryptoWorkerPreemptedError extends CryptoWorkerTerminatedError {
  constructor() {
    super("Background crypto work interrupted by a foreground request");
    this.name = "CryptoWorkerPreemptedError";
  }
}

let workerSingleton: Worker | null = null;
let nextId = 1;
let activeId: number | null = null;
const pending = new Map<number, PendingCryptoWorkerCall>();

const removePending = (id: number): PendingCryptoWorkerCall | undefined => {
  const entry = pending.get(id);
  if (!entry) return undefined;
  pending.delete(id);
  if (activeId === id) activeId = null;
  if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
  if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
  // Queued calls may still contain a passphrase when cancelled.
  entry.request.params = undefined;
  return entry;
};

const stopWorker = (): void => {
  const worker = workerSingleton;
  workerSingleton = null;
  if (worker) worker.terminate();
};

export function terminateCryptoWorker(reason: Error = new CryptoWorkerTerminatedError()): void {
  stopWorker();
  for (const id of pending.keys()) removePending(id)?.reject(reason);
}

export function terminateCryptoWorkerIfIdle(): boolean {
  if (pending.size > 0) return false;
  terminateCryptoWorker();
  return true;
}

const ensureWorker = (): Worker => {
  if (typeof window === "undefined") {
    throw new Error("Crypto worker is not available (no window)");
  }
  if (workerSingleton) return workerSingleton;
  const worker = new Worker(new URL("../../workers/crypto.worker.ts", import.meta.url), {
    type: "module",
  });
  workerSingleton = worker;
  worker.addEventListener("message", (event: MessageEvent<CryptoWorkerResponse>) => {
    if (workerSingleton !== worker) return;
    const message = event.data;
    if (message.id !== activeId) return;
    const entry = removePending(message.id);
    if (!entry) return;
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      const error = Object.assign(new Error(message.error?.message || "Crypto worker error"), {
        name: message.error?.name,
        code: message.error?.code,
      });
      entry.reject(error);
    }
    // Give a foreground operation's continuation a chance to enqueue its next
    // step before starting another background KDF.
    queueMicrotask(dispatchNext);
  });
  worker.addEventListener("error", () => {
    if (workerSingleton !== worker) return;
    rejectActive(new Error("Crypto worker crashed"));
    dispatchNext();
  });
  return worker;
};

const rejectActive = (reason: Error): void => {
  stopWorker();
  if (activeId !== null) removePending(activeId)?.reject(reason);
};

const dispatchNext = (): void => {
  // postMessage starts an asynchronous worker handler. Serializing here also
  // protects callers outside metadata unlock from concurrent Argon2 memory use.
  while (activeId === null && pending.size > 0) {
    const entries = [...pending.values()];
    const entry = entries.find((candidate) => candidate.priority === "foreground") ?? entries[0];
    const { request } = entry;
    try {
      const worker = ensureWorker();
      activeId = request.id;
      if (entry.timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          if (activeId !== request.id) return;
          rejectActive(new Error(`Crypto worker timeout (${String(request.method)})`));
          dispatchNext();
        }, entry.timeoutMs);
      }
      worker.postMessage(request);
    } catch (error) {
      removePending(request.id)?.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // postMessage performs a synchronous structured clone. Do not retain
      // secrets in caller-realm request objects after dispatch.
      request.params = undefined;
    }
  }
};

const abortError = (): Error =>
  Object.assign(new Error("Crypto worker request cancelled"), {
    name: "AbortError",
  });

export function cryptoWorkerCall<M extends keyof CryptoWorkerCallMap>(
  method: M,
  params: CryptoWorkerCallMap[M]["params"],
  opts?: CryptoWorkerCallOptions,
): Promise<CryptoWorkerCallMap[M]["result"]> {
  if (opts?.signal?.aborted) return Promise.reject(abortError());
  const id = nextId++;

  return new Promise<CryptoWorkerCallMap[M]["result"]>((resolve, reject) => {
    const entry: PendingCryptoWorkerCall = {
      request: { id, method, params },
      priority: opts?.priority ?? "foreground",
      timeoutMs: opts?.timeoutMs ?? 120_000,
      signal: opts?.signal,
      resolve: (value) => resolve(value as CryptoWorkerCallMap[M]["result"]),
      reject,
    };
    pending.set(id, entry);
    if (entry.signal) {
      entry.onAbort = () => {
        if (!pending.has(id)) return;
        if (activeId === id) stopWorker();
        removePending(id)?.reject(abortError());
        dispatchNext();
      };
      entry.signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    if (
      entry.priority === "foreground" &&
      activeId !== null &&
      pending.get(activeId)?.priority === "background"
    ) {
      rejectActive(new CryptoWorkerPreemptedError());
    }
    dispatchNext();
  });
}
