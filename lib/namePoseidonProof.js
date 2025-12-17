import path from "node:path";
import fs from "node:fs";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import { getAddress, getBytes, keccak256 } from "ethers";
import * as snarkjs from "snarkjs";
import namePoseidon from "./namePoseidon.js";

const { normalizeNameForHash, normalizePassphraseForHash } = namePoseidon;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const textEncoder = new TextEncoder();
const ZERO_BYTES32 = Object.freeze(new Array(32).fill(0));

const FRONTEND_WASM = path.join(__dirname, "../frontend/public/zk/name_poseidon_zk.wasm");
const FRONTEND_ZKEY = path.join(__dirname, "../frontend/public/zk/name_poseidon_zk_final.zkey");

const ARTIFACTS_WASM = path.join(
  __dirname,
  "../artifacts/circuits/name_poseidon_zk_js/name_poseidon_zk.wasm",
);
const ARTIFACTS_ZKEY = path.join(__dirname, "../artifacts/circuits/name_poseidon_zk_final.zkey");

const DEFAULT_WASM_CANDIDATES = [FRONTEND_WASM, ARTIFACTS_WASM];
const DEFAULT_ZKEY_CANDIDATES = [FRONTEND_ZKEY, ARTIFACTS_ZKEY];

function resolveExistingFile(label, explicitPath, candidates) {
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

function keccakUtf8Bytes(value) {
  const bytes = getBytes(keccak256(textEncoder.encode(value)));
  return Array.from(bytes);
}

function zeroBytes32() {
  return ZERO_BYTES32.slice();
}

const ADDRESS_BIT_LIMIT = 160n;
const ADDRESS_MAX = 1n << ADDRESS_BIT_LIMIT;

function normalizeMinterDecimal(minter) {
  if (minter === undefined || minter === null || String(minter).trim().length === 0) {
    throw new Error("minter is required");
  }

  let bigintValue;
  if (typeof minter === "string") {
    const trimmed = minter.trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      const checksummed = getAddress(trimmed);
      bigintValue = BigInt(checksummed);
    } else {
      bigintValue = BigInt(trimmed);
    }
  } else if (typeof minter === "number") {
    if (!Number.isSafeInteger(minter) || minter < 0) {
      throw new Error("minter must be a non-negative safe integer, decimal string, or hex string");
    }
    bigintValue = BigInt(minter);
  } else if (typeof minter === "bigint") {
    bigintValue = minter;
  } else {
    throw new Error("minter must be provided as string/number/bigint");
  }

  if (bigintValue < 0n || bigintValue >= ADDRESS_MAX) {
    throw new Error("minter must fit within 160 bits (Ethereum address range)");
  }

  return bigintValue.toString();
}

function buildNamePoseidonInput(fullName, passphrase, minter) {
  const normalizedName = normalizeNameForHash(fullName);
  const normalizedPassphrase = normalizePassphraseForHash(
    typeof passphrase === "string" ? passphrase : "",
  );

  if (typeof fullName !== "string" || normalizedName.length === 0) {
    throw new Error("Full name must be a non-empty string");
  }

  return {
    fullNameHash: keccakUtf8Bytes(normalizedName),
    saltHash:
      normalizedPassphrase.length > 0 ? keccakUtf8Bytes(normalizedPassphrase) : zeroBytes32(),
    minter: normalizeMinterDecimal(minter),
  };
}

function normalizeProof(proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error("Invalid proof structure returned by snarkjs");
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

function normalizePublicSignals(publicSignals) {
  if (!Array.isArray(publicSignals) || publicSignals.length < 5) {
    throw new Error(
      `Name poseidon public signals length mismatch (expected >=5, got ${publicSignals?.length})`,
    );
  }

  return publicSignals.slice(0, 5).map((value) => BigInt(value));
}

export async function generateNamePoseidonProof(fullName, passphrase = "", options = {}) {
  const minter = options.minter ?? options.minterAddress;
  if (!minter) {
    throw new Error("generateNamePoseidonProof requires a minter address in options.minter");
  }

  const wasmPath = resolveExistingFile(
    "Poseidon circuit wasm",
    options.wasm,
    DEFAULT_WASM_CANDIDATES,
  );
  const zkeyPath = resolveExistingFile(
    "Poseidon circuit zkey",
    options.zkey,
    DEFAULT_ZKEY_CANDIDATES,
  );

  const input = buildNamePoseidonInput(fullName, passphrase, minter);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath,
  );

  return {
    proof: normalizeProof(proof),
    publicSignals: normalizePublicSignals(publicSignals),
    input,
    artifacts: {
      wasm: wasmPath,
      zkey: zkeyPath,
    },
  };
}

export default {
  generateNamePoseidonProof,
};
