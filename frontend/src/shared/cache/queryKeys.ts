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
 * - Story data: `story:${tokenId}`
 * - NFT owner: `owner:${tokenId}`
 * - Trusted endorsers: `te:${hashLower}:${versionIndex}`
 * - Trusted endorsement visibility: `tev:${hashLower}:${versionIndex}:${accountsKey}`
 * - Endorse fee: `endorseFee`
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

/** Story data cache key (per tokenId). */
export function storyKey(tokenId: string | number | bigint): string {
  return `story:${String(tokenId)}`;
}

/** NFT owner cache key (per tokenId). */
export function ownerKey(tokenId: string | number | bigint): string {
  return `owner:${String(tokenId)}`;
}

/** Trusted endorser list cache key (per person hash + version index). */
export function trustedEndorsersKey(personHash: string, versionIndex: number): string {
  return `te:${normalizeHashKey(personHash)}:${Number(versionIndex)}`;
}

/** Visibility check key for a fixed trusted-source account set. */
export function trustedEndorsementVisibilityKey(
  personHash: string,
  versionIndex: number,
  accounts: string[],
): string {
  return `${trustedEndorsementVisibilityPrefix(personHash, versionIndex)}${accounts
    .map((account) => String(account || "").toLowerCase())
    .join(",")}`;
}

/**
 * Prefix matching every visibility cache key for a person hash + version index,
 * across all trusted-source account sets. Used to invalidate `tev:` entries when
 * an endorsement changes a version's visibility.
 */
export function trustedEndorsementVisibilityPrefix(
  personHash: string,
  versionIndex: number,
): string {
  return `tev:${normalizeHashKey(personHash)}:${Number(versionIndex)}:`;
}

/** Endorsement fee cache key (singleton). */
export function endorseFeeKey(): string {
  return "endorseFee";
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
