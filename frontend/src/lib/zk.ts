import { keccak256 } from "ethers";
import { normalizeNameForHash, normalizePassphraseForHash } from "./passphraseStrength";

export type Groth16Proof = {
  pi_a: [string | bigint, string | bigint, string | bigint];
  pi_b: [
    [string | bigint, string | bigint],
    [string | bigint, string | bigint],
    [string | bigint, string | bigint],
  ];
  pi_c: [string | bigint, string | bigint, string | bigint];
  protocol: string;
  curve: string;
};

const textEncoder = new TextEncoder();

function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    if (v.startsWith("0x") || v.startsWith("0X")) return BigInt(v);
    return BigInt(v);
  }
  throw new Error("unsupported type");
}

/**
 * Validates public signals shape for ZK proof
 * Used for pre-validation before calling addPersonZK
 */
export function ensurePublicSignalsShape(publicSignals: Array<string | number | bigint>) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
    throw new Error("publicSignals length must be 7");
  }
  const TWO_POW_128 = 1n << 128n;
  for (let i = 0; i < 6; i++) {
    const limb = toBigInt(publicSignals[i]);
    if (limb < 0n || limb >= TWO_POW_128) throw new Error(`publicSignals[${i}] not in [0,2^128)`);
  }
  const submitter = toBigInt(publicSignals[6]);
  const TWO_POW_160 = 1n << 160n;
  if (submitter < 0n || submitter >= TWO_POW_160) throw new Error("submitter out of uint160 range");
}

// Person data input interface
export interface PersonData {
  fullName: string;
  passphrase: string;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
  gender: number; // 1=male, 2=female
}

// Hash helpers convert UTF-8 string to keccak bytes array (32 elements)
function keccakStringToBytes(value: string): number[] {
  const hash = keccak256(textEncoder.encode(value || ""));
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hash.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return Array.from(bytes);
}

export function hashFullName(fullName: string): number[] {
  const normalized = normalizeNameForHash(fullName);
  return keccakStringToBytes(normalized);
}

type PassphraseInput =
  | string
  | number
  | bigint
  | Array<string | number | bigint>
  | undefined
  | null;

export function hashPassphrase(passphrase: PassphraseInput): number[] {
  if (Array.isArray(passphrase)) {
    return passphrase.slice(0, 32).map((v) => Number(v) & 0xff);
  }
  const normalized = passphrase == null ? "" : normalizePassphraseForHash(String(passphrase));
  if (normalized.length === 0) {
    return Array(32).fill(0);
  }
  return keccakStringToBytes(normalized);
}

export function formatGroth16ProofForContract(proof: Groth16Proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error("Invalid proof structure");
  }

  if (!Array.isArray(proof.pi_a) || proof.pi_a.length < 2) {
    throw new Error("Invalid proof.pi_a length");
  }

  if (!Array.isArray(proof.pi_b) || proof.pi_b.length < 2) {
    throw new Error("Invalid proof.pi_b length");
  }

  if (!Array.isArray(proof.pi_c) || proof.pi_c.length < 2) {
    throw new Error("Invalid proof.pi_c length");
  }

  const a: [bigint, bigint] = [toBigInt(proof.pi_a[0]), toBigInt(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [toBigInt(proof.pi_b[0][1]), toBigInt(proof.pi_b[0][0])],
    [toBigInt(proof.pi_b[1][1]), toBigInt(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])];

  return { a, b, c };
}

export function toBigIntArray(values: Array<string | number | bigint>): bigint[] {
  return values.map(toBigInt);
}
