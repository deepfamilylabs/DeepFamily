interface TreeRootCheckApi {
  getVersionDetails: (
    personHash: string,
    versionIndex: number,
    options?: { ttlMs?: number },
  ) => Promise<unknown>;
}

export async function ensureTreeProviderReady(provider: any): Promise<void> {
  await provider?.send?.("eth_chainId", []);
}

export async function ensureTreeRootExists(options: {
  api: TreeRootCheckApi;
  rootHash: string;
  rootVersionIndex: number;
  versionDetailsTtlMs: number;
}): Promise<void> {
  await options.api.getVersionDetails(options.rootHash, Number(options.rootVersionIndex), {
    ttlMs: options.versionDetailsTtlMs,
  });
}
