type ZkAssetHost = {
  /** Empty when the files are served from same-origin /zk. */
  readonly baseUrl: string;
  readonly digests: Readonly<Record<string, string>>;
  /** Paths whose Brotli copies this site serves itself, tried before the asset host. */
  readonly sameOrigin?: readonly string[];
};

const BUILD_ASSET_HOST: ZkAssetHost = {
  baseUrl: __ZK_ASSET_BASE_URL__,
  digests: __ZK_ASSET_DIGESTS__,
  sameOrigin: __ZK_SAME_ORIGIN_ASSETS__,
};

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The build declares Content-Encoding: br for each served copy, so fetch returns the decoded file.
 * Browsers lack a Brotli DecompressionStream, so a copy that arrives still encoded is not decoded
 * here; it fails the digest check like a stale copy.
 */
async function fetchSameOriginCopy(path: string, digest: string): Promise<Uint8Array> {
  const response = await fetch(`${path}.br`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to load ${path}.br: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== digest) throw new Error(`ZK asset digest mismatch: ${path}`);
  return bytes;
}

/**
 * Proving WASM/zkey files exceed Cloudflare Pages' 25 MiB asset limit, but their Brotli copies
 * fit. A build serves each committed copy that decodes to its pinned digest from its own /zk and
 * loads the rest from the R2 asset host as Brotli-encoded objects; HTTP Content-Encoding: br
 * makes fetch decode them before the original manifest digest is checked. The dev server serves
 * raw copies.
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
  if (host.sameOrigin?.includes(path)) {
    try {
      return await fetchSameOriginCopy(path, digest);
    } catch {
      // A missing, stale or still-encoded copy costs one more request: R2 holds every pinned file.
    }
  }
  const url = `${host.baseUrl}/${digest}/${path.slice(path.lastIndexOf("/") + 1)}.br`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== digest) throw new Error(`ZK asset digest mismatch: ${path}`);
  return bytes;
}
