import { keccak256 } from "ethers";
import { poseidon2, poseidon3, poseidon5 } from "poseidon-lite";
import { asUint8Array, bigintFrom, bytesToHex } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";

/**
 * Shielded domains are disjoint from identity and lineage domains. They are part of the
 * proof/contract ABI and must match the corresponding Circom constants.
 */
export const SHIELDED_INHERITANCE_DOMAINS = Object.freeze({
  ownerCommitment: 1013n,
  valueNote: 1014n,
  spendNullifier: 1016n,
  periodNullifier: 1017n,
  dummyInputNullifier: 1021n,
  allocationKeyCommitment: 1028n,
  poolScope: 1031n,
  scopedPurpose: 1032n,
});

export const SHIELDED_POOL_PROTOCOL_VERSION = 1;
export const SHIELDED_CIPHERTEXT_BYTES = 512;
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);
const uint64 = (value, label) => bigintFrom(value, label, MAX_UINT64);
const uint128 = (value, label) => bigintFrom(value, label, MAX_UINT128);

/** Pool context is mandatory and stays outside encrypted note payloads. */
export function normalizeShieldedScope(scope) {
  protocolAssert(
    scope !== null && typeof scope === "object",
    "MISSING_SHIELDED_SCOPE",
    "A chain and pool context is required",
  );
  const chainId = uint64(scope.chainId, "chainId");
  protocolAssert(chainId > 0n, "INVALID_CHAIN_ID", "chainId must be nonzero");
  const poolAddress = assertAddress(scope.poolAddress, "poolAddress");
  protocolAssert(BigInt(poolAddress) !== 0n, "INVALID_POOL_ADDRESS", "poolAddress must be nonzero");
  return { chainId, poolAddress };
}

export function computeShieldedPoolDomain(scope) {
  const { chainId, poolAddress } = normalizeShieldedScope(scope);
  return poseidon3([SHIELDED_INHERITANCE_DOMAINS.poolScope, chainId, BigInt(poolAddress)]);
}

export function computeShieldedScopedPurpose(purpose, scope) {
  return poseidon3([
    SHIELDED_INHERITANCE_DOMAINS.scopedPurpose,
    computeShieldedPoolDomain(scope),
    field(purpose, "purpose"),
  ]);
}

function nonzeroField(value, label) {
  const result = field(value, label);
  protocolAssert(result !== 0n, "ZERO_SHIELDED_SECRET", `${label} must be nonzero`);
  return result;
}

/**
 * Return a uniformly sampled, nonzero BN254 field element. Use independent
 * samples for every policy salt, allocation key and note nonce. A bare
 * deterministic commitment is not a substitute for an unpredictable nonce.
 */
export function generateShieldedRandomField() {
  protocolAssert(
    typeof globalThis.crypto?.getRandomValues === "function",
    "SECURE_RANDOM_UNAVAILABLE",
    "A cryptographic random source is required",
  );
  const bytes = new Uint8Array(32);
  while (true) {
    globalThis.crypto.getRandomValues(bytes);
    bytes[0] &= 0x3f;
    const candidate = BigInt(bytesToHex(bytes));
    if (candidate > 0n && candidate < SNARK_SCALAR_FIELD) {
      bytes.fill(0);
      return candidate;
    }
  }
}

/** A field representation of the hash of the exact ciphertext emitted on chain. */
export function computeShieldedCiphertextHashField(ciphertext) {
  const bytes = asUint8Array(ciphertext, "ciphertext");
  protocolAssert(
    bytes.length === SHIELDED_CIPHERTEXT_BYTES,
    "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
    `ciphertext must be exactly ${SHIELDED_CIPHERTEXT_BYTES} bytes`,
  );
  return BigInt(keccak256(bytes)) % SNARK_SCALAR_FIELD;
}

/** Commitment to a policy-specific key kept only by the initial donor. */
export function computeShieldedAllocationKeyCommitment(allocationKey, scope) {
  return poseidon2([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.allocationKeyCommitment, scope),
    nonzeroField(allocationKey, "allocationKey"),
  ]);
}

export function computeShieldedOwnerCommitment(ownerSecret) {
  return poseidon2([
    SHIELDED_INHERITANCE_DOMAINS.ownerCommitment,
    nonzeroField(ownerSecret, "ownerSecret"),
  ]);
}

/** The caller must independently encrypt the full note to its recipient. */
export function computeShieldedValueNoteCommitment(input, scope) {
  return poseidon5([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.valueNote, scope),
    nonzeroField(input.ownerCommitment, "ownerCommitment"),
    // A zero-value dummy note keeps all private actions at two public outputs.
    uint128(input.amount, "amount"),
    nonzeroField(input.nonce, "nonce"),
    field(input.ciphertextHashField, "ciphertextHashField"),
  ]);
}

/** The note issuer cannot derive this from note preimages without ownerSecret. */
export function computeShieldedSpendNullifier(input, scope) {
  return poseidon3([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.spendNullifier, scope),
    nonzeroField(input.ownerSecret, "ownerSecret"),
    nonzeroField(input.noteCommitment, "noteCommitment"),
  ]);
}
