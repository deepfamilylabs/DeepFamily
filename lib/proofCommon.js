import fs from "node:fs";
import path from "node:path";
import { getAddress } from "ethers";
import {
  PROOF_SYSTEM_ID_GROTH16_BN254_V1,
  PROOF_ENCODING_ID_ABI_GROTH16_ABC,
  DEFAULT_PROOF_SYSTEM_ID,
  DEFAULT_PROOF_ENCODING_ID,
  normalizeGroth16Proof,
  encodeGroth16AbcProofData,
  packGroth16ProofEnvelope,
} from "./proofEnvelopeCodec.js";

export const DEFAULT_SCHEMA_VERSION = 1;
export const DEFAULT_CRYPTO_SUITE_VERSION = 1;
export const DEFAULT_HASH_ALGO_ID = 1;

export {
  PROOF_SYSTEM_ID_GROTH16_BN254_V1,
  PROOF_ENCODING_ID_ABI_GROTH16_ABC,
  DEFAULT_PROOF_SYSTEM_ID,
  DEFAULT_PROOF_ENCODING_ID,
  normalizeGroth16Proof,
  encodeGroth16AbcProofData,
};

export function resolveArtifactFile(label, explicitPath, candidates) {
  if (explicitPath && String(explicitPath).trim().length > 0) {
    const resolved = path.resolve(process.cwd(), explicitPath);
    if (fs.existsSync(resolved)) return resolved;
    throw new Error(`${label} not found at: ${resolved}`);
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `${label} not found in any of these locations:\n${candidates.filter(Boolean).join("\n")}`,
  );
}

export function resolveDescriptorNodeArtifactCandidates(baseDir, descriptor, fileKind) {
  const candidates = descriptor?.files?.node?.[fileKind];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(
      `Descriptor ${descriptor?.key ?? descriptor?.purpose ?? "unknown"} is missing node ${fileKind} candidates`,
    );
  }
  return candidates.map((relativePath) => path.resolve(baseDir, "..", relativePath));
}

export function normalizeAddressDecimal(value, label = "address") {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    throw new Error(`${label} is required`);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      return BigInt(getAddress(trimmed)).toString();
    }
    return BigInt(trimmed).toString();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer, decimal string, or hex string`);
    }
    return BigInt(value).toString();
  }

  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    return value.toString();
  }

  throw new Error(`${label} must be provided as string, number, or bigint`);
}

export function formatProofEnvelope(proof, opts = {}) {
  return packGroth16ProofEnvelope(proof, opts);
}
