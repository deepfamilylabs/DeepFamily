import { keccak256, toBeHex, zeroPadValue } from "ethers";
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import { asUint8Array, bigintFrom, bytesToHex } from "./bytes.js";
import {
  SECONDS_PER_DAY,
  MAX_UINT32,
  MAX_UINT64,
  MAX_UINT128,
  SNARK_SCALAR_FIELD,
} from "./constants.js";
import { protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";

/**
 * Shielded domains are disjoint from identity and lineage domains. They are part of the
 * proof/contract ABI and must match the corresponding Circom constants.
 */
export const SHIELDED_INHERITANCE_DOMAINS = Object.freeze({
  policy: 1010n,
  enrollment: 1011n,
  ownerSecret: 1012n,
  ownerCommitment: 1013n,
  valueNote: 1014n,
  budgetNote: 1015n,
  spendNullifier: 1016n,
  periodNullifier: 1017n,
  viewSeed: 1018n,
  dummyPeriodNullifier: 1019n,
  dummyInputNullifier: 1021n,
  budgetUseNullifier: 1026n,
  enrollmentNullifier: 1027n,
  allocationKeyCommitment: 1028n,
  identityBudgetTerms: 1029n,
  identityBudgetNote: 1030n,
  poolScope: 1031n,
  scopedPurpose: 1032n,
});

export const SHIELDED_POOL_PROTOCOL_VERSION = 2;
export const SHIELDED_MAX_BATCH_PERIODS = 12;
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

function periodDays(value) {
  const days = bigintFrom(value, "periodDays", MAX_UINT32);
  protocolAssert(days !== 0n, "INVALID_SHIELDED_PERIOD", "periodDays must be a positive integer");
  return days;
}

function nonzeroAmount(value, label) {
  const result = uint128(value, label);
  protocolAssert(result !== 0n, "ZERO_SHIELDED_AMOUNT", `${label} must be nonzero`);
  return result;
}

/**
 * Return a uniformly sampled, nonzero BN254 field element. Use independent
 * samples for every policy salt, funding key, enrollment salt, and note nonce. A bare
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

/** One unpredictable policy salt separates policies with the same public family/rate. */
export function computeShieldedPolicyCommitment(input, scope) {
  return poseidon7([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.policy, scope),
    nonzeroField(input.rootIdentityCommitment, "rootIdentityCommitment"),
    uint64(input.rootVersionIndex, "rootVersionIndex"),
    nonzeroAmount(input.amountPerPeriod, "amountPerPeriod"),
    nonzeroField(input.policySalt, "policySalt"),
    nonzeroField(input.allocationKeyCommitment, "allocationKeyCommitment"),
    periodDays(input.periodDays),
  ]);
}

/** Commitment to a policy-specific key kept only by the initial donor. */
export function computeShieldedAllocationKeyCommitment(allocationKey, scope) {
  return poseidon2([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.allocationKeyCommitment, scope),
    nonzeroField(allocationKey, "allocationKey"),
  ]);
}

/** One initial funding per policy and heir; the key is never in child notes. */
export function computeShieldedEnrollmentNullifier(input, scope) {
  return poseidon4([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.enrollmentNullifier, scope),
    nonzeroField(input.allocationKey, "allocationKey"),
    nonzeroField(input.policyCommitment, "policyCommitment"),
    nonzeroField(input.heirIdentityCommitment, "heirIdentityCommitment"),
  ]);
}

/** A randomized, one-time read authorization for the original child budget. */
export function computeShieldedBudgetUseNullifier(input, scope) {
  return poseidon4([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.budgetUseNullifier, scope),
    nonzeroField(input.policySalt, "policySalt"),
    nonzeroField(input.budgetNoteCommitment, "budgetNoteCommitment"),
    nonzeroField(input.useNonce, "useNonce"),
  ]);
}

/** First enrollment binds the child and their eligibility timestamp privately. */
export function computeShieldedEnrollmentCommitment(input, scope) {
  return poseidon5([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.enrollment, scope),
    nonzeroField(input.policyCommitment, "policyCommitment"),
    nonzeroField(input.heirIdentityCommitment, "heirIdentityCommitment"),
    uint64(input.eligibleFrom, "eligibleFrom"),
    nonzeroField(input.enrollmentSalt, "enrollmentSalt"),
  ]);
}

/**
 * Deterministic child material from the existing Argon2-derived identity field.
 * hpkeIkm is input key material for RFC 9180 DeriveKeyPair, not an HPKE key.
 * Never publish these secrets or send them to an RPC/proof service.
 */
export function deriveShieldedHeirKeyMaterial(derivedSecretField) {
  const secret = nonzeroField(derivedSecretField, "derivedSecretField");
  const ownerSecret = poseidon2([SHIELDED_INHERITANCE_DOMAINS.ownerSecret, secret]);
  const ownerCommitment = poseidon2([SHIELDED_INHERITANCE_DOMAINS.ownerCommitment, ownerSecret]);
  const viewSeedField = poseidon2([SHIELDED_INHERITANCE_DOMAINS.viewSeed, secret]);
  return {
    ownerSecret,
    ownerCommitment,
    hpkeIkm: zeroPadValue(toBeHex(viewSeedField), 32),
  };
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

/** A separate budget note per child allows a private, irreversible funding. */
export function computeShieldedBudgetNoteCommitment(input, scope) {
  const rate = nonzeroAmount(input.amountPerPeriod, "amountPerPeriod");
  // A claim that exactly exhausts a budget emits a zero-value continuation
  // note, keeping all claim transactions the same public output shape.
  const remaining = uint128(input.remaining, "remaining");
  protocolAssert(
    remaining % rate === 0n,
    "FRACTIONAL_SHIELDED_BUDGET",
    "remaining must be a whole number of periods",
  );
  protocolAssert(
    remaining / rate <= MAX_UINT64,
    "SHIELDED_PERIOD_COUNT_OVERFLOW",
    "remaining exceeds the circuit's 64-bit period count",
  );
  return poseidon8([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.budgetNote, scope),
    nonzeroField(input.policyCommitment, "policyCommitment"),
    nonzeroField(input.enrollmentCommitment, "enrollmentCommitment"),
    nonzeroField(input.heirOwnerCommitment, "heirOwnerCommitment"),
    rate,
    remaining,
    nonzeroField(input.nonce, "nonce"),
    field(input.ciphertextHashField, "ciphertextHashField"),
  ]);
}

/** Public addressing binds the recipient and terms without revealing private rule openings. */
export function computeShieldedIdentityBudgetTermsCommitment(input, scope) {
  return poseidon7([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.identityBudgetTerms, scope),
    nonzeroField(input.rootIdentityCommitment, "rootIdentityCommitment"),
    uint64(input.rootVersionIndex, "rootVersionIndex"),
    nonzeroField(input.heirIdentityCommitment, "heirIdentityCommitment"),
    uint64(input.eligibleFrom, "eligibleFrom"),
    nonzeroAmount(input.amountPerPeriod, "amountPerPeriod"),
    periodDays(input.periodDays),
  ]);
}

/** An identity-bound budget uses a distinct domain from owner-bound budgets. */
export function computeShieldedIdentityBudgetNoteCommitment(input, scope) {
  const rate = nonzeroAmount(input.amountPerPeriod, "amountPerPeriod");
  const remaining = uint128(input.remaining, "remaining");
  protocolAssert(
    remaining % rate === 0n,
    "FRACTIONAL_SHIELDED_BUDGET",
    "remaining must be a whole number of periods",
  );
  protocolAssert(
    remaining / rate <= MAX_UINT64,
    "SHIELDED_PERIOD_COUNT_OVERFLOW",
    "remaining exceeds the circuit's 64-bit period count",
  );
  return poseidon8([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.identityBudgetNote, scope),
    nonzeroField(input.policyCommitment, "policyCommitment"),
    nonzeroField(input.enrollmentCommitment, "enrollmentCommitment"),
    nonzeroField(input.termsCommitment, "termsCommitment"),
    rate,
    remaining,
    nonzeroField(input.nonce, "nonce"),
    field(input.ciphertextHashField, "ciphertextHashField"),
  ]);
}

/** Recover common policy/enrollment commitments without opening an identity budget's rule. */
export function getShieldedBudgetCommitments(note, scope) {
  if (note.binding === "identity") {
    return {
      policyCommitment: nonzeroField(note.policyCommitment, "policyCommitment"),
      enrollmentCommitment: nonzeroField(note.enrollmentCommitment, "enrollmentCommitment"),
      termsCommitment: computeShieldedIdentityBudgetTermsCommitment(note, scope),
    };
  }
  protocolAssert(
    note.binding === undefined || note.binding === "owner",
    "INVALID_SHIELDED_BUDGET_BINDING",
    "Unsupported budget binding",
  );
  const policyCommitment = computeShieldedPolicyCommitment(note, scope);
  return {
    policyCommitment,
    enrollmentCommitment: computeShieldedEnrollmentCommitment(
      {
        policyCommitment,
        heirIdentityCommitment: note.heirIdentityCommitment,
        eligibleFrom: note.eligibleFrom,
        enrollmentSalt: note.enrollmentSalt,
      },
      scope,
    ),
  };
}

/** The note issuer cannot derive this from note preimages without ownerSecret. */
export function computeShieldedSpendNullifier(input, scope) {
  return poseidon3([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.spendNullifier, scope),
    nonzeroField(input.ownerSecret, "ownerSecret"),
    nonzeroField(input.noteCommitment, "noteCommitment"),
  ]);
}

/**
 * Period indices start at zero from the unique initial funding for a policy
 * and heir. Additional funding carries that enrollment, so the tag cannot reset after refill.
 */
export function computeShieldedPeriodNullifier(input, scope) {
  return poseidon4([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.periodNullifier, scope),
    nonzeroField(input.derivedSecretField, "derivedSecretField"),
    nonzeroField(input.policyCommitment, "policyCommitment"),
    uint64(input.periodIndex, "periodIndex"),
  ]);
}

/** Fill unused public batch slots without revealing which slots are padding. */
export function computeShieldedDummyPeriodNullifier(input, scope) {
  const slotIndex = bigintFrom(input.slotIndex, "slotIndex", 11n);
  return poseidon4([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.dummyPeriodNullifier, scope),
    nonzeroField(input.ownerSecret, "ownerSecret"),
    nonzeroField(input.budgetNoteCommitment, "budgetNoteCommitment"),
    slotIndex,
  ]);
}

/** A distinct nullifier for the absent second input in a fixed-shape claim. */
export function computeShieldedDummyInputNullifier(input, scope) {
  return poseidon3([
    computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.dummyInputNullifier, scope),
    nonzeroField(input.ownerSecret, "ownerSecret"),
    nonzeroField(input.noteCommitment, "noteCommitment"),
  ]);
}

/** Validate a 1–12 period all-or-nothing claim before witness construction. */
export function computeShieldedClaimBatch(input) {
  const rate = nonzeroAmount(input.amountPerPeriod, "amountPerPeriod");
  const remaining = uint128(input.remaining, "remaining");
  protocolAssert(
    remaining % rate === 0n,
    "FRACTIONAL_SHIELDED_BUDGET",
    "remaining must be a whole number of periods",
  );
  protocolAssert(
    remaining / rate <= MAX_UINT64,
    "SHIELDED_PERIOD_COUNT_OVERFLOW",
    "remaining exceeds the circuit's 64-bit period count",
  );
  const duration = periodDays(input.periodDays) * SECONDS_PER_DAY;
  const now = uint64(input.now, "now");
  const eligibleFrom = uint64(input.eligibleFrom, "eligibleFrom");
  protocolAssert(
    Array.isArray(input.periodIndices) &&
      input.periodIndices.length >= 1 &&
      input.periodIndices.length <= SHIELDED_MAX_BATCH_PERIODS,
    "INVALID_SHIELDED_BATCH_SIZE",
    "Claim batch must contain 1 to 12 periods",
  );
  const periods = input.periodIndices.map((value, index) =>
    uint64(value, `periodIndices[${index}]`),
  );
  for (let index = 0; index < periods.length; index += 1) {
    protocolAssert(
      eligibleFrom + (periods[index] + 1n) * duration <= now,
      "SHIELDED_PERIOD_NOT_DUE",
      "Claim period is not yet due",
    );
    if (index > 0) {
      protocolAssert(
        periods[index] > periods[index - 1],
        "SHIELDED_PERIOD_ORDER",
        "Claim periods must be strictly increasing",
      );
    }
  }
  const amount = rate * BigInt(periods.length);
  protocolAssert(amount <= MAX_UINT128, "SHIELDED_AMOUNT_OVERFLOW", "Claim amount exceeds uint128");
  protocolAssert(
    amount <= remaining,
    "INSUFFICIENT_SHIELDED_BUDGET",
    "Budget does not cover every requested period",
  );
  return { periodIndices: periods, amount, remaining: remaining - amount };
}
