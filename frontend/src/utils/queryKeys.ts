/**
 * QueryCache key helpers.
 *
 * All hash-based keys are normalized to lowercase to avoid cache misses caused by
 * mixed-case hex strings.
 *
 * Key formats:
 * - Total versions: `tv:${hashLower}`
 * - Children strict: `cs:${hashLower}:${parentVersionIndex}`
 * - Children union: `cu:${hashLower}`
 * - Version details: `vd:${hashLower}:${versionIndex}`
 * - NFT details: `nft:${tokenId}`
 */
export function normalizeHashKey(hash: string): string {
  return String(hash || "").toLowerCase();
}

/** Total versions cache key (per person hash). */
export function tvKey(personHash: string): string {
  return `tv:${normalizeHashKey(personHash)}`;
}

/** Strict children cache key (per parent hash + parent version). */
export function csKey(parentHash: string, parentVersionIndex: number): string {
  return `cs:${normalizeHashKey(parentHash)}:${Number(parentVersionIndex)}`;
}

/** Union children cache key (per parent hash, across all versions). */
export function cuKey(parentHash: string): string {
  return `cu:${normalizeHashKey(parentHash)}`;
}

/** Version details cache key (per person hash + version index). */
export function vdKey(personHash: string, versionIndex: number): string {
  return `vd:${normalizeHashKey(personHash)}:${Number(versionIndex)}`;
}

/** NFT details cache key (per tokenId). */
export function nftKey(tokenId: string | number | bigint): string {
  return `nft:${String(tokenId)}`;
}

/**
 * Parse a version-details key back into its components.
 * Returns null if the key is not a valid `vd:` key.
 */
export function parseVdKey(key: string): { hashLower: string; versionIndex: number } | null {
  const parts = String(key || "").split(":");
  if (parts.length !== 3) return null;
  if (parts[0] !== "vd") return null;
  const hashLower = String(parts[1] || "").toLowerCase();
  const versionIndex = Number(parts[2]);
  if (!hashLower || !Number.isFinite(versionIndex) || versionIndex <= 0) return null;
  return { hashLower, versionIndex };
}
