import { getAddress } from "ethers";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import {
  computeShieldedCiphertextHashField,
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationSalt,
  computeShieldedRegistrationTag,
} from "./shielded-inheritance.js";
import { splitShieldedViewPublicKey } from "./shielded-hpke.js";

export const SHIELDED_POOL_ACTION = Object.freeze({
  Shield: 0,
  CreatePolicy: 1,
  Allocate: 2,
  TopUp: 3,
  MergeBudget: 4,
  Claim: 5,
  PrivateTransfer: 6,
  Unshield: 7,
});
export const SHIELDED_POOL_PUBLIC_SIGNAL_COUNT = 32;
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);

function pair(values, label) {
  protocolAssert(
    Array.isArray(values) && values.length === 2,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    `${label} must have 2 values`,
  );
  return values.map((value, index) => field(value, `${label}[${index}]`));
}

/** Mirrors ShieldedDeepPool._execute's exact 32-field proof ABI. */
export function buildShieldedPoolPublicSignals(input) {
  const action = bigintFrom(input.action, "action", 7n);
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const pool = BigInt(getAddress(input.poolAddress));
  const inputShardIds = pair(input.inputShardIds, "inputShardIds");
  const inputRoots = pair(input.inputRoots, "inputRoots");
  const inputNullifiers = pair(input.inputNullifiers, "inputNullifiers");
  const outputCommitments = pair(input.outputCommitments, "outputCommitments");
  protocolAssert(
    Array.isArray(input.periodNullifiers) && input.periodNullifiers.length === 12,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "periodNullifiers must have 12 values",
  );
  protocolAssert(
    Array.isArray(input.outputCiphertexts) && input.outputCiphertexts.length === 2,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "outputCiphertexts must have 2 values",
  );
  const periodNullifiers = input.periodNullifiers.map((value, index) =>
    field(value, `periodNullifiers[${index}]`),
  );
  const ciphertextHashes = input.outputCiphertexts.map(computeShieldedCiphertextHashField);
  const amount = bigintFrom(input.amount ?? 0n, "amount", MAX_UINT128);
  const recipient = input.recipient === undefined ? 0n : BigInt(getAddress(input.recipient));
  const relation0 = field(input.relation0 ?? 0n, "relation0");
  const relation1 = field(input.relation1 ?? 0n, "relation1");
  const asOf = bigintFrom(input.asOf ?? 0n, "asOf", MAX_UINT64);
  const registryRoot = field(input.registryRoot ?? 0n, "registryRoot");
  const registryShardId = field(input.registryShardId ?? 0n, "registryShardId");
  return [
    action,
    chainId,
    pool,
    inputShardIds[0],
    inputRoots[0],
    inputShardIds[1],
    inputRoots[1],
    inputNullifiers[0],
    inputNullifiers[1],
    ...periodNullifiers,
    outputCommitments[0],
    outputCommitments[1],
    ciphertextHashes[0],
    ciphertextHashes[1],
    amount,
    recipient,
    relation0,
    relation1,
    asOf,
    registryRoot,
    registryShardId,
  ];
}

/** The identity holder signs these seven public registration signals with a real proof. */
export function buildShieldedKeyRegistrationPublicSignals(input) {
  const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(input.viewingKey);
  const identityCommitment = field(input.identityCommitment, "identityCommitment");
  const ownerCommitment = field(input.ownerCommitment, "ownerCommitment");
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const registryAddress = getAddress(input.registryAddress);
  const registrationTag = computeShieldedRegistrationTag({
    derivedSecretField: input.derivedSecretField,
    identityCommitment,
    chainId,
    registryAddress,
  });
  const salt = computeShieldedRegistrationSalt({
    derivedSecretField: input.derivedSecretField,
    identityCommitment,
    chainId,
    registryAddress,
  });
  const registrationLeaf = computeShieldedRegistrationLeaf({
    identityCommitment,
    ownerCommitment,
    viewKeyHi,
    viewKeyLo,
    salt,
  });
  return [
    ownerCommitment,
    viewKeyLo,
    viewKeyHi,
    chainId,
    BigInt(registryAddress),
    registrationTag,
    registrationLeaf,
  ];
}
