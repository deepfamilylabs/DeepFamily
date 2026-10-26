const DATABASE = "deepfamily-wallet-recovery";
const STORE = "encrypted-backups";
interface Scope { chainId: string; registryAddress: string }
interface SavedBackup { digest: string; scope: string; savedAt: number; bytes: Uint8Array }
const scopeKey = (scope: Scope) => `${scope.chainId}:${scope.registryAddress.toLowerCase()}`;
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "digest" });
      store.createIndex("scopeSavedAt", ["scope", "savedAt"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open encrypted wallet recovery storage"));
    request.onblocked = () => reject(new Error("Close other wallet tabs to update encrypted recovery storage"));
  });
}

/** Commit only ciphertext; a failed local write must stop the following chain transaction. */
export async function saveEncryptedWalletBackup(scope: Scope, bytes: Uint8Array): Promise<void> {
  const snapshot = new Uint8Array(bytes);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", snapshot)), value => value.toString(16).padStart(2, "0")).join("");
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite", { durability: "strict" });
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new Error("Could not save the encrypted wallet recovery copy. No further transaction was sent."));
      const store = transaction.objectStore(STORE), scopeId = scopeKey(scope);
      const cursor = store.index("scopeSavedAt").openCursor(IDBKeyRange.bound([scopeId, 0], [scopeId, Number.MAX_SAFE_INTEGER]), "prev");
      cursor.onsuccess = () => {
        const previous = cursor.result?.value as SavedBackup | undefined;
        store.put({ digest, scope: scopeId, savedAt: Math.max(Date.now(), (previous?.savedAt ?? 0) + 1), bytes: snapshot } satisfies SavedBackup);
      };
    });
  } finally { database.close(); }
}

/** A password is still required to restore this encrypted local recovery copy. */
export async function readLatestEncryptedWalletBackup(scope: Scope): Promise<Uint8Array | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).index("scopeSavedAt").openCursor(
        IDBKeyRange.bound([scopeKey(scope), 0], [scopeKey(scope), Number.MAX_SAFE_INTEGER]), "prev");
      request.onsuccess = () => resolve(request.result ? new Uint8Array((request.result.value as SavedBackup).bytes) : null);
      request.onerror = () => reject(new Error("Could not read the encrypted wallet recovery copy"));
    });
  } finally { database.close(); }
}
