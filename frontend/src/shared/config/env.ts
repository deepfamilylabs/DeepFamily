export function getViteEnv(): Record<string, unknown> {
  return (import.meta.env || {}) as Record<string, unknown>;
}

export function readStringEnv(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function readNumberEnv(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readPositiveNumberEnv(value: unknown, fallback: number): number {
  const parsed = readNumberEnv(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function readBooleanEnv(value: unknown, defaultValue = false): boolean {
  if (value == null) return defaultValue;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return defaultValue;
}

export function readListEnv(value: unknown): string[] {
  return readStringEnv(value)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getStringEnv(key: string, fallback = ""): string {
  return readStringEnv(getViteEnv()[key], fallback);
}

export function getNumberEnv(key: string, fallback: number): number {
  return readNumberEnv(getViteEnv()[key], fallback);
}

export function getPositiveNumberEnv(key: string, fallback: number): number {
  return readPositiveNumberEnv(getViteEnv()[key], fallback);
}

export function getBooleanEnv(key: string, defaultValue = false): boolean {
  return readBooleanEnv(getViteEnv()[key], defaultValue);
}

export function isDevMode(): boolean {
  return getBooleanEnv("DEV");
}

export function shouldPreferFlatTree(): boolean {
  return getBooleanEnv("VITE_USE_FLAT_TREE");
}

export function isForceEnvConfigSyncEnabled(): boolean {
  return getBooleanEnv("VITE_FORCE_ENV_CONFIG_SYNC");
}

export function isTreeDebugEnabled(): boolean {
  return getBooleanEnv("VITE_SHOW_DEBUG");
}

export function shouldShowDeduplicateToggle(): boolean {
  return getBooleanEnv("VITE_SHOW_DEDUPLICATE_TOGGLE");
}

export function shouldShowNodeModeToggle(): boolean {
  return getBooleanEnv("VITE_SHOW_NODE_MODE_TOGGLE");
}

export function shouldShowTrustedSourceFilterToggle(): boolean {
  return getBooleanEnv("VITE_SHOW_TRUSTED_SOURCE_FILTER_TOGGLE", true);
}

export function isIndexedDbCacheEnabled(): boolean {
  return getBooleanEnv("VITE_USE_INDEXEDDB_CACHE", true);
}

export function getTreeQueryPageLimit(): number {
  return getPositiveNumberEnv("VITE_DF_QUERY_PAGE_LIMIT", 200);
}

export function getHardNodeLimit(): number {
  return getPositiveNumberEnv("VITE_DF_HARD_NODE_LIMIT", 20_000);
}

export function getCacheTtlEnv() {
  return {
    versionDetails: getPositiveNumberEnv("VITE_DF_VD_TTL_MS", 300_000),
    nftDetails: getPositiveNumberEnv("VITE_DF_NFT_TTL_MS", 86_400_000),
    totalVersions: getPositiveNumberEnv("VITE_DF_TV_TTL_MS", 60_000),
    edges: getPositiveNumberEnv("VITE_DF_EDGE_TTL_MS", 120_000),
    story: getPositiveNumberEnv("VITE_DF_STORY_TTL_MS", 300_000),
  } as const;
}

export function getIpfsGatewayBaseUrlEnvList(): string[] {
  return readListEnv(getViteEnv().VITE_IPFS_GATEWAY_BASE_URLS);
}

export function getBrandBadgeEnv(): string {
  return getStringEnv("VITE_BRAND_BADGE", "none").toLowerCase();
}

export function getDefaultRpcUrl(): string {
  return getStringEnv("VITE_RPC_URL");
}

export function getDefaultEntryReaderAddress(): string {
  return getStringEnv("VITE_CONTRACT_ADDRESS") || getStringEnv("VITE_READER_ADDRESS");
}

export function getDefaultContractAddress(): string {
  return getDefaultEntryReaderAddress();
}

export function getDefaultReaderAddress(): string {
  return getDefaultEntryReaderAddress();
}

/**
 * The reader deployed on one specific chain — `VITE_READER_ADDRESS_31337=0x…`.
 *
 * The unsuffixed pair above names a single deployment, so it only fits whichever
 * chain `VITE_RPC_URL` points at. These let a build carry an address book, so
 * switching networks can bring the entry contract with it. Same suffix shape as
 * the localized roots, and the same precedence as the unsuffixed pair.
 */
export function getChainEntryReaderAddress(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return "";
  return (
    getStringEnv(`VITE_CONTRACT_ADDRESS_${chainId}`) ||
    getStringEnv(`VITE_READER_ADDRESS_${chainId}`)
  );
}

export function getDefaultRootHash(): string {
  return getStringEnv("VITE_ROOT_PERSON_HASH");
}

export function getDefaultRootVersionIndex(): number {
  return getPositiveNumberEnv("VITE_ROOT_VERSION_INDEX", 1);
}

export function getLocalizedRootHash(suffix: string): string {
  return getStringEnv(`VITE_ROOT_PERSON_HASH_${suffix}`);
}

export function getLocalizedRootVersionIndex(suffix: string): number {
  return getPositiveNumberEnv(`VITE_ROOT_VERSION_INDEX_${suffix}`, NaN);
}

/**
 * Block-range settings for account-scoped event scans (`PersonVersionAdded`
 * filtered by creator). There is no on-chain reverse index by creator, so the
 * creator facet reads logs; public RPCs cap `eth_getLogs` ranges, hence the
 * chunked backward scan. Deployments should set `VITE_DF_EVENT_FROM_BLOCK` to
 * the deployment block so the scan terminates instead of walking to genesis.
 */
export function getEventScanConfig() {
  return {
    fromBlock: Math.max(0, getNumberEnv("VITE_DF_EVENT_FROM_BLOCK", 0)),
    blockChunk: getPositiveNumberEnv("VITE_DF_EVENT_BLOCK_CHUNK", 10_000),
    maxChunks: getPositiveNumberEnv("VITE_DF_EVENT_MAX_CHUNKS", 50),
    maxResults: getPositiveNumberEnv("VITE_DF_EVENT_MAX_RESULTS", 1_000),
  };
}
