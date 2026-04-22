/**
 * Centralized TTL constants for QueryCache.
 *
 * All cache TTL values are defined here. Individual contexts and hooks must
 * import from this module instead of defining their own constants.
 *
 * Each value can be overridden via `VITE_DF_*` environment variables for
 * debugging or per-deployment tuning.
 */

import { getCacheTtlEnv } from "../config/env";

const ttlEnv = getCacheTtlEnv();

export const TTL = {
  /** Version details (per person hash + version index). Default: 5 min */
  versionDetails: ttlEnv.versionDetails,

  /** NFT details (per tokenId). Default: 24 h */
  nftDetails: ttlEnv.nftDetails,

  /** Total versions count (per person hash). Default: 1 min */
  totalVersions: ttlEnv.totalVersions,

  /** Edge data (children union/strict). Default: 2 min */
  edges: ttlEnv.edges,

  /** Story metadata + chunks. Default: 5 min */
  story: ttlEnv.story,
} as const;
