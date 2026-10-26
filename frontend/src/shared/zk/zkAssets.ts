type ZkAssetHost = {
  /** Empty when the files are served from same-origin /zk. */
  readonly baseUrl: string;
  readonly digests: Readonly<Record<string, string>>;
};

interface PinnedZkAsset {
  readonly url: string;
  readonly sha256: string;
}

const BUILD_ASSET_HOST: ZkAssetHost = {
  baseUrl: __ZK_ASSET_BASE_URL__,
  digests: __ZK_ASSET_DIGESTS__,
};

async function fetchAsset(path: string, host: ZkAssetHost, digest?: string): Promise<Uint8Array> {
  const url = host.baseUrl
    ? `${host.baseUrl.replace(/\/+$/u, "")}/${digest}/${path.slice(path.lastIndexOf("/") + 1)}.br`
    : path;
  const response = host.baseUrl ? await fetch(url) : await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (digest) {
    const actual = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== digest) throw new Error(`ZK asset digest mismatch: ${path}`);
  }
  return bytes;
}

/**
 * Proving WASM/zkey files exceed Cloudflare Pages' 25 MiB asset limit, so builds load them
 * from the R2 asset host as Brotli-encoded objects. HTTP Content-Encoding: br makes fetch
 * decode them before the original manifest digest is checked. The dev server serves raw copies.
 */
export async function fetchZkAsset(
  path: string,
  host: ZkAssetHost = BUILD_ASSET_HOST,
): Promise<Uint8Array> {
  const digest = host.baseUrl ? host.digests[path] : undefined;
  if (host.baseUrl && !/^[0-9a-f]{64}$/u.test(digest ?? ""))
    throw new Error(`No pinned digest for ZK asset ${path}`);
  return fetchAsset(path, host, digest);
}

/**
 * Receive artifacts carry pins from trusted deployment configuration. Use that digest and
 * basename for remote routing: exported boundary artifacts can live under /zk/protocol while
 * the build inventory lists their identical files under /zk/shielded. Never take pins from a code.
 * Explicit pins are checked for both local files and decoded remote objects.
 */
export async function fetchPinnedZkAsset(
  pin: PinnedZkAsset,
  host: ZkAssetHost = BUILD_ASSET_HOST,
): Promise<Uint8Array> {
  const { url, sha256 } = pin;
  if (!/^[0-9a-f]{64}$/iu.test(sha256)) throw new Error("Missing pinned receiving artifact digest");
  return fetchAsset(url, host, sha256.toLowerCase());
}
