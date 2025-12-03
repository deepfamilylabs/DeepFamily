/**
 * CID Generation Utilities
 * 
 * Provides two methods to generate CIDv1 (raw, sha2-256):
 * - Method 1: Manual implementation (multiformats + @noble/hashes) - Fast & lightweight
 * - Method 2: ipfs-only-hash - For IPFS standard validation
 */

import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { create as createDigest } from 'multiformats/hashes/digest'
import { sha256 } from '@noble/hashes/sha2'
import IpfsHash from 'ipfs-only-hash'

/**
 * Method 1: Manual implementation
 * Advantages: Fast (~0.02ms), lightweight, transparent
 */
export function generateCIDManual(jsonString: string): string {
  const metadataBytes = new TextEncoder().encode(jsonString)
  const digestBytes = sha256(metadataBytes)
  const digest = createDigest(0x12, digestBytes) // 0x12 = sha2-256
  const cid = CID.create(1, raw.code, digest) // CIDv1, raw codec
  return cid.toString()
}

/**
 * Method 2: Using ipfs-only-hash
 * Advantages: 100% compatible with IPFS standard tools
 */
export async function generateCIDIpfs(jsonString: string): Promise<string> {
  const cid = await IpfsHash.of(jsonString, {
    cidVersion: 1,
    rawLeaves: true
  })
  return cid
}

/**
 * Default method - Choose which method to use via configuration
 * 
 * Configuration:
 * - 'manual': Use manual implementation (recommended for production, better performance)
 * - 'ipfs': Use ipfs-only-hash (for validation or full IPFS compatibility)
 */
const CID_METHOD: 'manual' | 'ipfs' = 'manual' // 👈 Switch here to choose method

export async function generateMetadataCID(jsonString: string): Promise<string> {
  if (CID_METHOD === 'manual') {
    console.log('🔧 Using Method 1: Manual (multiformats + @noble/hashes)')
    return generateCIDManual(jsonString)
  } else {
    console.log('🔧 Using Method 2: ipfs-only-hash')
    return await generateCIDIpfs(jsonString)
  }
}

/**
 * Verify consistency between two methods
 * For development and testing
 */
export async function verifyCIDConsistency(jsonString: string): Promise<{
  consistent: boolean
  manual: string
  ipfs: string
  timeDiff: number
}> {
  const startManual = performance.now()
  const manualCID = generateCIDManual(jsonString)
  const manualTime = performance.now() - startManual

  const startIpfs = performance.now()
  const ipfsCID = await generateCIDIpfs(jsonString)
  const ipfsTime = performance.now() - startIpfs

  return {
    consistent: manualCID === ipfsCID,
    manual: manualCID,
    ipfs: ipfsCID,
    timeDiff: ipfsTime - manualTime
  }
}

