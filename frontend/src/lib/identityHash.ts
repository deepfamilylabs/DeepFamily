import { ethers } from "ethers";
import { poseidon3, poseidon5 } from "poseidon-lite";
import { normalizeNameForHash, normalizePassphraseForHash } from "./passphraseStrength";

export type IdentityHashInput = {
  fullName: string;
  passphrase: string;
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
};

const textEncoder = new TextEncoder();

export function computePersonHash(input: IdentityHashInput): string {
  const { fullName, passphrase, isBirthBC, birthYear, birthMonth, birthDay, gender } = input;

  const normalizedFullName = normalizeNameForHash(fullName);
  const normalizedPassphrase =
    typeof passphrase === "string" ? normalizePassphraseForHash(passphrase) : "";

  const packedData =
    (BigInt(birthYear) << 24n) |
    (BigInt(birthMonth) << 16n) |
    (BigInt(birthDay) << 8n) |
    (BigInt(gender) << 1n) |
    (isBirthBC ? 1n : 0n);

  const fullNameHash = ethers.keccak256(textEncoder.encode(normalizedFullName));
  const saltHash =
    normalizedPassphrase.length > 0
      ? ethers.keccak256(textEncoder.encode(normalizedPassphrase))
      : ethers.ZeroHash;

  const fullNameHashBN = BigInt(fullNameHash);
  const limb0 = fullNameHashBN >> 128n;
  const limb1 = fullNameHashBN & ((1n << 128n) - 1n);

  const saltHashBN = BigInt(saltHash);
  const saltLimb0 = saltHashBN >> 128n;
  const saltLimb1 = saltHashBN & ((1n << 128n) - 1n);

  const saltedNamePoseidon = poseidon5([limb0, limb1, saltLimb0, saltLimb1, 0n]);
  const saltedNameBN = BigInt(saltedNamePoseidon);
  const saltedLimb0 = saltedNameBN >> 128n;
  const saltedLimb1 = saltedNameBN & ((1n << 128n) - 1n);

  const poseidonResult = poseidon3([saltedLimb0, saltedLimb1, packedData]);
  const poseidonHex = "0x" + poseidonResult.toString(16).padStart(64, "0");
  return ethers.keccak256(poseidonHex);
}

export const computeIdentityHash = computePersonHash;
