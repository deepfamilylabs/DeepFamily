import type { EncryptedMetadataPayloadV2 } from "./metadataCrypto";
import type { IdentityHashInput } from "./identityHash";
import type {
  DerivedSecretBundle,
  FileEncryptionKdfConfig,
  IdentityKdfConfig,
} from "./secretDerivation";
import type { DerivedKey, KeyPurpose, KDFPreset } from "./secureKeyDerivation";

type CryptoWorkerCallMap = {
  computeIdentityHash: { params: { input: IdentityHashInput }; result: { identityHash: string } };
  passwordFingerprint: { params: { password: string }; result: { passwordFingerprint: string } };
  deriveKey: {
    params: { input: IdentityHashInput; purpose?: KeyPurpose; preset?: KDFPreset };
    result: DerivedKey;
  };
  deriveIdentitySecret: {
    params: { passphrase: string; saltHex?: string; config?: IdentityKdfConfig };
    result: DerivedSecretBundle;
  };
  encryptMetadataBundleV2: {
    params: {
      plaintextJson: string;
      password: string;
      aad?: string;
      schema?: string;
      version?: string;
      fileKdfConfig?: FileEncryptionKdfConfig;
    };
    result: {
      encryptedJson: string;
      cid: string;
      plainHash: string;
      passwordFingerprint: string;
      payload: EncryptedMetadataPayloadV2;
    };
  };
  decryptMetadataBundleV2: {
    params: { payloadOrJson: string; password: string };
    result: { plaintext: string; data: any; hash: string; payload: EncryptedMetadataPayloadV2 };
  };
};

type CryptoWorkerRequest = { id: number; method: keyof CryptoWorkerCallMap; params: any };
type CryptoWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

let workerSingleton: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

const ensureWorker = (): Worker => {
  if (typeof window === "undefined") {
    throw new Error("Crypto worker is not available (no window)");
  }
  if (workerSingleton) return workerSingleton;
  workerSingleton = new Worker(new URL("../workers/crypto.worker.ts", import.meta.url), {
    type: "module",
  });
  workerSingleton.addEventListener("message", (event: MessageEvent<CryptoWorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else
      entry.reject(
        Object.assign(new Error(msg.error?.message || "Crypto worker error"), {
          name: msg.error?.name,
        }),
      );
  });
  workerSingleton.addEventListener("error", () => {
    for (const [, entry] of pending) entry.reject(new Error("Crypto worker crashed"));
    pending.clear();
    workerSingleton = null;
  });
  return workerSingleton;
};

export async function cryptoWorkerCall<M extends keyof CryptoWorkerCallMap>(
  method: M,
  params: CryptoWorkerCallMap[M]["params"],
  opts?: { timeoutMs?: number },
): Promise<CryptoWorkerCallMap[M]["result"]> {
  const worker = ensureWorker();
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  const promise = new Promise<CryptoWorkerCallMap[M]["result"]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: CryptoWorkerRequest = { id, method, params };
    worker.postMessage(req);
  });

  if (!timeoutMs) return promise;
  return await Promise.race([
    promise,
    new Promise<CryptoWorkerCallMap[M]["result"]>((_, reject) => {
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Crypto worker timeout (${String(method)})`));
        }
      }, timeoutMs);
    }),
  ]);
}
