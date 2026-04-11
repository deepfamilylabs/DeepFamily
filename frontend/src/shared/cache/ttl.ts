/**
 * Centralized TTL constants for QueryCache.
 *
 * All cache TTL values are defined here. Individual contexts and hooks must
 * import from this module instead of defining their own constants.
 *
 * Each value can be overridden via `VITE_DF_*` environment variables for
 * debugging or per-deployment tuning.
 */

const env = typeof import.meta !== "undefined" ? (import.meta as any).env ?? {} : {};

export const TTL = {
  /** Version details (per person hash + version index). Default: 5 min */
  versionDetails: Number(env.VITE_DF_VD_TTL_MS || 300_000),

  /** NFT details (per tokenId). Default: 24 h */
  nftDetails: Number(env.VITE_DF_NFT_TTL_MS || 86_400_000),

  /** Total versions count (per person hash). Default: 1 min */
  totalVersions: Number(env.VITE_DF_TV_TTL_MS || 60_000),

  /** Edge data (children union/strict). Default: 2 min */
  edges: Number(env.VITE_DF_EDGE_TTL_MS || 120_000),

  /** Story metadata + chunks. Default: 5 min */
  story: Number(env.VITE_DF_STORY_TTL_MS || 300_000),
} as const;
