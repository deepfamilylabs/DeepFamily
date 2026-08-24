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
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class CryptoWorkerTerminatedError extends Error {
  constructor(message = "Crypto worker terminated") {
    super(message);
    this.name = "CryptoWorkerTerminatedError";
  }
}

let workerSingleton: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingCryptoWorkerCall>();

const rejectPending = (error: Error): void => {
  for (const [, entry] of pending) {
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    entry.reject(error);
  }
  pending.clear();
};

export function terminateCryptoWorker(reason: Error = new CryptoWorkerTerminatedError()): void {
  const worker = workerSingleton;
  workerSingleton = null;
  if (worker) worker.terminate();
  rejectPending(reason);
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
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }
    const error = Object.assign(new Error(message.error?.message || "Crypto worker error"), {
      name: message.error?.name,
      code: message.error?.code,
    });
    entry.reject(error);
  });
  worker.addEventListener("error", () => {
    if (workerSingleton !== worker) return;
    terminateCryptoWorker(new Error("Crypto worker crashed"));
  });
  return worker;
};

export function cryptoWorkerCall<M extends keyof CryptoWorkerCallMap>(
  method: M,
  params: CryptoWorkerCallMap[M]["params"],
  opts?: { timeoutMs?: number },
): Promise<CryptoWorkerCallMap[M]["result"]> {
  const worker = ensureWorker();
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  return new Promise<CryptoWorkerCallMap[M]["result"]>((resolve, reject) => {
    const entry: PendingCryptoWorkerCall = {
      resolve: (value) => resolve(value as CryptoWorkerCallMap[M]["result"]),
      reject,
    };
    if (timeoutMs > 0) {
      entry.timeoutId = setTimeout(() => {
        if (!pending.has(id)) return;
        terminateCryptoWorker(new Error(`Crypto worker timeout (${String(method)})`));
      }, timeoutMs);
    }
    pending.set(id, entry);
    const request: CryptoWorkerRequest = { id, method, params };
    try {
      worker.postMessage(request);
    } catch (error) {
      pending.delete(id);
      if (entry.timeoutId !== undefined) clearTimeout(entry.timeoutId);
      reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // postMessage performs a synchronous structured clone. Drop the caller-
      // realm reference immediately so a long-lived Worker wrapper, test
      // harness, or accidental message recorder cannot retain passphrases or
      // transient KDF material after dispatch.
      request.params = undefined;
    }
  });
}
