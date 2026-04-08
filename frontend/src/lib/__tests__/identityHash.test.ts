import { describe, expect, it } from "vitest";
import {
  computeIdentityHashMaterial,
  computePersonHash,
  normalizeIdentitySaltHex,
} from "../identityHash";
import { computePersonHashFromData } from "../zk";

describe("identityHash integration", () => {
  it("computes the same personHash for raw and canonicalized names", async () => {
    const rawInput = {
      fullName: "  Alice\u3000Smith  ",
      passphrase: "",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    };

    const canonicalInput = {
      ...rawInput,
      fullName: "Alice Smith",
    };

    expect(await computePersonHash(rawInput)).toBe(await computePersonHash(canonicalInput));
  });

  it("changes personHash when a non-empty passphrase is supplied", async () => {
    const baseInput = {
      fullName: "Alice Smith",
      passphrase: "",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    };

    const withPassphrase = {
      ...baseInput,
      passphrase: "strong passphrase",
    };

    expect(await computePersonHash(baseInput)).not.toBe(await computePersonHash(withPassphrase));
  });

  it("canonicalizes inside computePersonHashFromData", () => {
    const raw = computePersonHashFromData({
      fullName: "  Alice\u3000Smith  ",
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    });

    const canonical = computePersonHashFromData({
      fullName: "Alice Smith",
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    });

    expect(raw.identityCommitment).toBe(canonical.identityCommitment);
    expect(raw.personHash).toBe(canonical.personHash);
    expect(raw.nameField).toBe(canonical.nameField);
  });

  it("reuses the same random identity salt to reproduce the same personHash", async () => {
    const baseInput = {
      fullName: "Alice Smith",
      passphrase: "strong passphrase",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
      identityMode: "random" as const,
      identitySaltHex: normalizeIdentitySaltHex("00112233445566778899aabbccddeeff"),
    };

    const first = await computeIdentityHashMaterial(baseInput);
    const second = await computeIdentityHashMaterial(baseInput);

    expect(first.personHash).toBe(second.personHash);
    expect(first.identitySaltHex).toBe(second.identitySaltHex);
  });

  it("changes personHash when random identity salt changes", async () => {
    const baseInput = {
      fullName: "Alice Smith",
      passphrase: "strong passphrase",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
      identityMode: "random" as const,
    };

    const first = await computeIdentityHashMaterial({
      ...baseInput,
      identitySaltHex: "00112233445566778899aabbccddeeff",
    });
    const second = await computeIdentityHashMaterial({
      ...baseInput,
      identitySaltHex: "ffeeddccbbaa99887766554433221100",
    });

    expect(first.personHash).not.toBe(second.personHash);
  });
});
