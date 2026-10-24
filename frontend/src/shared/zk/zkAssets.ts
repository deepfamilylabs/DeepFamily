type ZkAssetHost = {
  /** Empty when the files are served from same-origin /zk. */
  readonly baseUrl: string;
  readonly digests: Readonly<Record<string, string>>;
};

const BUILD_ASSET_HOST: ZkAssetHost = {
  baseUrl: __ZK_ASSET_BASE_URL__,
  digests: __ZK_ASSET_DIGESTS__,
};

/**
 * Proving WASM/zkey files exceed Cloudflare Pages' 25 MiB asset limit, so builds load them
 * from the R2 asset host as Brotli-encoded objects. HTTP Content-Encoding: br makes fetch
 * decode them before the original manifest digest is checked. The dev server serves raw copies.
 */
export async function fetchZkAsset(
  path: string,
  host: ZkAssetHost = BUILD_ASSET_HOST,
): Promise<Uint8Array> {
  if (!host.baseUrl) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const digest = host.digests[path];
  if (!digest) throw new Error(`No pinned digest for ZK asset ${path}`);
  const url = `${host.baseUrl}/${digest}/${path.slice(path.lastIndexOf("/") + 1)}.br`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== digest) throw new Error(`ZK asset digest mismatch: ${path}`);
  return bytes;
}
