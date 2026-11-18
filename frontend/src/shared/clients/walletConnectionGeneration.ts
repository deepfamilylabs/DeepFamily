// Changes synchronously on wallet events, before React or asynchronous signer
// refreshes can expose the new connection. A later return never revives a snapshot.
let generation = 0;
const listeners = new Set<() => void>();

export function getWalletConnectionGeneration(): number {
  return generation;
}

export function subscribeWalletConnectionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Wallet lifecycle internals; consumers capture or subscribe to the generation. */
export function invalidateWalletConnection(): void {
  generation += 1;
  for (const listener of listeners) listener();
}
