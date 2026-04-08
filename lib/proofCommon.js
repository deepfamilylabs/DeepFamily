import fs from "node:fs";
import path from "node:path";
import { getAddress } from "ethers";

export const DEFAULT_SCHEMA_VERSION = 1;
export const DEFAULT_CRYPTO_SUITE_VERSION = 1;
export const DEFAULT_HASH_ALGO_ID = 1;
export const DEFAULT_PROOF_SYSTEM_ID = 0;

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

export function normalizeGroth16Proof(proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error("Invalid Groth16 proof structure returned by snarkjs");
  }

  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

export function formatProofEnvelope(proof, opts = {}) {
  return {
    proofSystemId: opts.proofSystemId ?? DEFAULT_PROOF_SYSTEM_ID,
    a: proof.a,
    b: proof.b,
    c: proof.c,
  };
}
