/**
 * CID Generation Utilities
 *
 * Generates CIDv1 (raw, sha2-256) from canonical metadata JSON using
 * multiformats primitives. This avoids a vulnerable IPFS hashing dependency
 * chain while preserving the same raw-leaf CID format.
 */

import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";
import { sha256 } from "@noble/hashes/sha2";

/**
 * Generate a CIDv1 using the raw codec and sha2-256 multihash.
 */
export function generateRawSha256CID(jsonString: string): string {
  const metadataBytes = new TextEncoder().encode(jsonString);
  const digestBytes = sha256(metadataBytes);
  const digest = createDigest(0x12, digestBytes); // 0x12 = sha2-256
  const cid = CID.create(1, raw.code, digest); // CIDv1, raw codec
  return cid.toString();
}

export async function generateMetadataCID(jsonString: string): Promise<string> {
  return generateRawSha256CID(jsonString);
}
