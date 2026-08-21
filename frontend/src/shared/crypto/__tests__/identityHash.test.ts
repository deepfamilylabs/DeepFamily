import { describe, expect, it } from "vitest";
import {
  computeIdentityHashMaterial,
  computeIdentitySaltHex,
  computePersonHash,
} from "../identityHash";

const identity = {
  fullName: "Alice Smith",
  passphrase: "correct horse battery staple",
  isBirthBC: false,
  birthYear: 1990,
  birthMonth: 5,
  birthDay: 15,
  gender: 1,
};

describe("fresh-v1 identityHash integration", () => {
  it("canonicalizes names and derives a stable deterministic identity", async () => {
    const raw = await computeIdentityHashMaterial({
      ...identity,
      fullName: "  Alice\u3000Smith  ",
    });
    const canonical = await computeIdentityHashMaterial(identity);

    expect(raw.canonicalFullName).toBe("Alice Smith");
    expect(raw.personHash).toBe(canonical.personHash);
    expect(raw.identityCommitment).toBe(canonical.identityCommitment);
    expect(raw.identitySuiteId).toBe(1);
  });

  it("runs the same Argon2id path for an empty passphrase", async () => {
    const empty = await computeIdentityHashMaterial({ ...identity, passphrase: "" });
    const protectedHash = await computePersonHash(identity);

    expect(empty.derivedSecretField).not.toBe(0n);
    expect(empty.personHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(empty.personHash).not.toBe(protectedHash);
  });

  it("derives the salt only from canonical identity fields and suite 1", () => {
    const rawSalt = computeIdentitySaltHex({ ...identity, fullName: "  Alice\u3000Smith  " });
    const canonicalSalt = computeIdentitySaltHex(identity);

    expect(rawSalt).toBe(canonicalSalt);
    expect(rawSalt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("fails closed for an unsupported identity suite", async () => {
    await expect(computeIdentityHashMaterial({ ...identity, identitySuiteId: 999 })).rejects.toMatchObject({
      code: "UNSUPPORTED_IDENTITY_SUITE",
    });
    await expect(computePersonHash({ ...identity, identitySuiteId: 999 })).resolves.toBe("");
  });
});
