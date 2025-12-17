import { poseidon5 } from "poseidon-lite";
import { keccak256 } from "ethers";
import { TextEncoder } from "node:util";

export const MASK_128 = (1n << 128n) - 1n;
export const ZERO_BYTES32 = "0x" + "00".repeat(32);
const textEncoder = new TextEncoder();

export function normalizeNameForHash(value) {
  if (value === undefined || value === null) return "";
  const str = String(value).trim();
  return typeof str.normalize === "function" ? str.normalize("NFC") : str;
}

export function normalizePassphraseForHash(value) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return typeof str.normalize === "function" ? str.normalize("NFKD") : str;
}

export function keccakHex(value) {
  return keccak256(textEncoder.encode(value));
}

export function keccakHexOrZero(value) {
  if (value.length > 0) {
    return keccakHex(value);
  }
  return ZERO_BYTES32;
}

function hexToBigInt(hex) {
  if (typeof hex !== "string") {
    throw new Error("hex string required");
  }
  return BigInt(hex);
}

export function splitToLimbs(hex) {
  const value = hexToBigInt(hex);
  return {
    hi: value >> 128n,
    lo: value & MASK_128,
  };
}

export function limbsToHex(hi, lo) {
  const combined = (BigInt(hi) << 128n) | BigInt(lo);
  return `0x${combined.toString(16).padStart(64, "0")}`;
}

export function computePoseidonDigest(fullName, passphrase = "") {
  const normalizedName = normalizeNameForHash(fullName);
  const normalizedPassphrase = normalizePassphraseForHash(passphrase);

  if (typeof fullName !== "string" || normalizedName.length === 0) {
    throw new Error("fullName must be a non-empty string");
  }

  const nameHex = keccakHex(normalizedName);
  const saltHex = keccakHexOrZero(normalizedPassphrase);

  const nameLimbs = splitToLimbs(nameHex);
  const saltLimbs = splitToLimbs(saltHex);

  const digest = poseidon5([
    nameLimbs.hi,
    nameLimbs.lo,
    saltLimbs.hi,
    saltLimbs.lo,
    0n,
  ]);

  const digestHex = `0x${digest.toString(16).padStart(64, "0")}`;
  const digestLimbs = splitToLimbs(digestHex);

  return {
    digest,
    digestHex,
    digestLimbs,
    nameHex,
    saltHex,
    nameLimbs,
    saltLimbs,
  };
}

export function buildBasicInfo({
  fullName,
  passphrase = "",
  isBirthBC = false,
  birthYear = 0,
  birthMonth = 0,
  birthDay = 0,
  gender = 0,
}) {
  const { digestHex } = computePoseidonDigest(fullName, passphrase);
  return {
    fullNameCommitment: digestHex,
    isBirthBC: Boolean(isBirthBC),
    birthYear: Number(birthYear),
    birthMonth: Number(birthMonth),
    birthDay: Number(birthDay),
    gender: Number(gender),
  };
}

export default {
  MASK_128,
  ZERO_BYTES32,
  keccakHex,
  keccakHexOrZero,
  normalizeNameForHash,
  normalizePassphraseForHash,
  splitToLimbs,
  limbsToHex,
  computePoseidonDigest,
  buildBasicInfo,
};
