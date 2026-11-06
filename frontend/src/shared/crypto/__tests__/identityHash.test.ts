import { describe, expect, it } from "vitest";
import {
  computeIdentityHashMaterial,
  computeIdentitySaltHex,
  computeIdentityHash,
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
  it("trims surrounding whitespace from both inputs and derives a stable deterministic identity", async () => {
    const raw = await computeIdentityHashMaterial({
      ...identity,
      fullName: "\u0085  Alice Smith\u3000 ",
      passphrase: `\u00a0 ${identity.passphrase}\u0085 `,
    });
    const canonical = await computeIdentityHashMaterial(identity);

    expect(raw.canonicalFullName).toBe("Alice Smith");
    expect(raw.personHash).toBe(canonical.personHash);
    expect(raw.identityCommitment).toBe(canonical.identityCommitment);
    expect(raw.identitySuiteId).toBe(1);
  });

  it("keeps internal whitespace, compatibility forms and Unicode composition distinct", async () => {
    const original = await computeIdentityHash(identity);
    const variants = [
      { fullName: "Alice\u3000Smith" },
      { fullName: "Alice  Smith" },
      { fullName: "Ａlice Smith" },
      { passphrase: "correct\u00a0horse battery staple" },
      { passphrase: "correct  horse battery staple" },
      { passphrase: "\u00e5-secret" },
      { passphrase: "a\u030a-secret" },
    ];
    const hashes = await Promise.all(
      variants.map((variant) => computeIdentityHash({ ...identity, ...variant })),
    );
    expect(hashes.every((hash) => /^0x[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(new Set([original, ...hashes]).size).toBe(variants.length + 1);
  });

  it("runs the same Argon2id path for an empty passphrase", async () => {
    const empty = await computeIdentityHashMaterial({ ...identity, passphrase: "" });
    const protectedHash = await computeIdentityHash(identity);

    expect(empty.derivedSecretField).not.toBe(0n);
    expect(empty.personHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(empty.personHash).not.toBe(protectedHash);
  });

  it("derives the salt only from canonical identity fields and suite 1", () => {
    const rawSalt = computeIdentitySaltHex({ ...identity, fullName: "  Alice Smith\u3000 " });
    const canonicalSalt = computeIdentitySaltHex(identity);

    expect(rawSalt).toBe(canonicalSalt);
    expect(rawSalt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("fails closed for an unsupported identity suite", async () => {
    await expect(
      computeIdentityHashMaterial({ ...identity, identitySuiteId: 999 }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_IDENTITY_SUITE",
    });
    await expect(computeIdentityHash({ ...identity, identitySuiteId: 999 })).resolves.toBe("");
  });
});
