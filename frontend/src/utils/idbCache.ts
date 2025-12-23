/**
 * Minimal IndexedDB helper for caching large tree stores without blocking the main thread.
 * Falls back to rejecting when IndexedDB is unavailable; callers should handle failures gracefully.
 */
const DB_NAME = 'deepfamily-tree-cache'
const DB_VERSION = 1
const STORE = 'blobs'

export function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBSupported()) {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      const err = req.error
      if ((err as any)?.name === 'VersionError') {
        const del = indexedDB.deleteDatabase(DB_NAME)
        del.onsuccess = () => { openDb().then(resolve).catch(reject) }
        del.onerror = () => reject(del.error || err || new Error('Failed to delete IndexedDB'))
        return
      }
      reject(err || new Error('Failed to open IndexedDB'))
    }
  })
}

async function withStore<T>(mode: IDBTransactionMode, cb: (store: IDBObjectStore, resolve: (v: T) => void, reject: (e: any) => void) => void): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    cb(store, resolve, reject)
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
  })
}

export async function readBlob<T>(key: string): Promise<T | null> {
  return withStore<T | null>('readonly', (store, resolve, reject) => {
    const req = store.get(key)
    req.onsuccess = () => resolve((req.result as T) ?? null)
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'))
  })
}

export async function writeBlob<T>(key: string, value: T): Promise<void> {
  return withStore<void>('readwrite', (store, resolve, reject) => {
    const req = store.put(value as any, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error || new Error('IndexedDB put failed'))
  })
}

export async function deleteBlob(key: string): Promise<void> {
  return withStore<void>('readwrite', (store, resolve, reject) => {
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'))
  })
}
