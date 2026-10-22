import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeIdentityFromDerivedSecret,
  computeShieldedAuthorizationAlias,
  buildShieldedIdentityAuthorizationState,
  decodeShieldedReceiveCredential,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedReceiveCredential,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { hexlify } from "ethers";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShieldedReceiveCode,
  createShieldedReceiveCodeFromCredentials,
  isInG2Subgroup,
  verifyShieldedReceiveCode,
} from "./shieldedReceiveCode";

const mocks = vi.hoisted(() => ({ deriveIdentityMaterial: vi.fn(), authorizationState: vi.fn(), providerDestroy: vi.fn() }));
vi.mock("@deepfamily/protocol-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@deepfamily/protocol-core")>()),
  deriveIdentityMaterial: mocks.deriveIdentityMaterial,
}));
vi.mock("ethers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ethers")>()),
  JsonRpcProvider: class {
    getNetwork = async () => ({ chainId: 31337n });
    destroy = mocks.providerDestroy;
  },
}));
vi.mock("../clients/contractFactory", () => ({
  createShieldedPoolFactoryContract: () => ({ AUTHORIZATION_STATE: async () => "0x2222222222222222222222222222222222222222" }),
}));
vi.mock("../clients/shieldedIdentityAuthorizationChain", () => ({
  createIdentityAuthorizationContract: () => ({}),
  loadShieldedIdentityAuthorizationState: mocks.authorizationState,
}));

const receiveOptions = { context: { rpcUrl: "http://localhost:8545", chainId: "31337", factoryAddress: "0x1111111111111111111111111111111111111111" }, expiresAt: "2000000000" };

const PUBLIC_DIRECTORY = fileURLToPath(new URL("../../../public", import.meta.url));

const identity = {
  identity: {
    fullName: "Ada Example",
    gender: 2,
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
  },
  identitySuiteId: 1,
  derivedSecretField: 123456789n,
  keyMode: 0 as const,
  disclosure: "fund" as const, authorizationCounter: 0n, expiresAt: 2_000_000_000n,
  keyMaterial: deriveShieldedHeirKeyMaterial(123456789n),
};


describe("explicit receive-code spending material", () => {
  it.each([
    ["missing authorization mode", { ...identity, keyMode: undefined }, "Unsupported receive authorization mode"],
    ["missing spending material", { ...identity, keyMaterial: undefined }, "requires explicit spending material"],
  ])("rejects %s instead of deriving fallback keys", async (_label, input, message) => {
    await expect(createShieldedReceiveCode(
      input as unknown as Parameters<typeof createShieldedReceiveCode>[0],
    )).rejects.toThrow(message);
  });
});

describe("recipient empty-passphrase protection inside the ZK worker", () => {
  beforeEach(() => mocks.deriveIdentityMaterial.mockReset());

  it.each([
    ["empty", "", "passphraseRequired"],
    ["ASCII spaces", "   ", "passphraseRequired"],
    ["Unicode spaces", "\u00a0\u3000", "passphraseRequired"],
    ["control character", "\t", "passphraseDisallowed"],
  ])("rejects %s before deriving identity material", async (_label, rawPassphrase, code) => {
    await expect(
      createShieldedReceiveCodeFromCredentials({ identity: identity.identity, rawPassphrase, ...receiveOptions }),
    ).rejects.toThrow(code);
    expect(mocks.deriveIdentityMaterial).not.toHaveBeenCalled();
  });

  it.each([
    ["weak", "password"],
    ["medium", "M7!kP2@vZ8#s"],
    ["repeated", "A".repeat(32)],
    ["sequential", "1234567890123456"],
    ["strong ASCII with spaces", "  Tr0ub4dor&3-xkcd-horse\u00a0a\u030a "],
    ["strong Chinese", "家族秘密要够长才安全一二三"],
  ])(
    "accepts %s nonempty credentials and preserves the original passphrase",
    async (_label, rawPassphrase) => {
      mocks.deriveIdentityMaterial.mockRejectedValueOnce(new Error("KDF unavailable"));
      const credentials = {
        identity: { ...identity.identity, fullName: "\u3000Ａｄａ\u0085Example\u00a0" },
        rawPassphrase,
        ...receiveOptions,
      };
      await expect(createShieldedReceiveCodeFromCredentials(credentials)).rejects.toThrow(
        "Receive code could not be created",
      );
      expect(credentials.rawPassphrase).toBe("");
      expect(mocks.deriveIdentityMaterial).toHaveBeenCalledExactlyOnceWith({
        identity: identity.identity,
        rawPassphrase,
        identitySuiteId: 1,
      });
    },
  );
});

describe("receive code proofs", () => {
  let code = "";

  beforeAll(async () => {
    // The worker fetches same-origin artifacts; serve the synchronized public files.
    vi.stubGlobal(
      "fetch",
      async (url: string) => new Response(fs.readFileSync(path.join(PUBLIC_DIRECTORY, url))),
    );
    ({ code } = await createShieldedReceiveCode(identity));
  }, 120_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("verifies the identity's own keys", async () => {
    const material = computeIdentityFromDerivedSecret(identity);
    const keys = deriveShieldedHeirKeyMaterial(identity.derivedSecretField);
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    await expect(verifyShieldedReceiveCode(code)).resolves.toEqual({
      ok: true,
      disclosure: "fund",
      authorizationAlias: String(decodeShieldedReceiveCredential(code).authorizationAlias),
      authorizationCounter: "0", expiresAt: "2000000000",
      identityCommitment: material.identityCommitment.toString(),
      ownerCommitment: keys.ownerCommitment.toString(),
      viewingKey: hexlify(viewingKey),
      personHash: wrapIdentityCommitmentAsPersonHash(material.identityCommitment),
      keyMode: 0,
      identitySuiteId: 1,
      independentKeySuiteId: 1,
      independentKeyDerivationVersion: 1,
      fingerprint: decodeShieldedReceiveCredential(code).fingerprint,
    });
  }, 60_000);

  it("creates a recipient code using the current nonzero chain counter", async () => {
    const material = computeIdentityFromDerivedSecret(identity);
    mocks.deriveIdentityMaterial.mockResolvedValueOnce(material);
    const alias = computeShieldedAuthorizationAlias(material);
    mocks.authorizationState.mockResolvedValueOnce({ state: buildShieldedIdentityAuthorizationState([[alias, 5n]]) });
    const result = await createShieldedReceiveCodeFromCredentials({ identity: identity.identity, rawPassphrase: "recipient passphrase", ...receiveOptions });
    expect(decodeShieldedReceiveCredential(result.code).authorizationCounter).toBe(5n);
    expect(mocks.providerDestroy).toHaveBeenCalled();
  }, 60_000);

  it("does not substitute counter zero when a recipient's chain state cannot be read", async () => {
    mocks.deriveIdentityMaterial.mockResolvedValueOnce(computeIdentityFromDerivedSecret(identity));
    mocks.authorizationState.mockRejectedValueOnce(new Error("RPC unavailable"));
    const credentials = { identity: identity.identity, rawPassphrase: "recipient passphrase", ...receiveOptions };
    await expect(createShieldedReceiveCodeFromCredentials(credentials)).rejects.toThrow("Receive code could not be created");
    expect(credentials.rawPassphrase).toBe("");
    expect(mocks.providerDestroy).toHaveBeenCalled();
  });

  it("proves independent root keys and rejects a mode downgrade using the same proof", async () => {
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(32).fill(23),
      independentKeyIdentitySecret: new Uint8Array(32).fill(91),
    });
    const independent = await createShieldedReceiveCode({
      ...identity,
      keyMode: 1,
      keyMaterial: keys,
    });
    await expect(verifyShieldedReceiveCode(independent.code)).resolves.toMatchObject({
      ok: true,
      keyMode: 1,
      ownerCommitment: String(keys.ownerCommitment),
      viewingKey: hexlify(keys.viewPublicKey),
      fingerprint: independent.fingerprint,
    });
    const decoded = decodeShieldedReceiveCredential(independent.code);
    const downgraded = encodeShieldedReceiveCredential({ ...decoded, keyMode: 0 });
    await expect(verifyShieldedReceiveCode(downgraded)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(
      createShieldedReceiveCode({ ...identity, keyMode: 0, keyMaterial: keys }),
    ).rejects.toThrow();
  }, 120_000);

  it("rejects a well-formed code whose identity was swapped", async () => {
    const decoded = decodeShieldedReceiveCredential(code);
    const otherIdentity = encodeShieldedReceiveCredential({ ...decoded, identityCommitment: decoded.identityCommitment! + 1n });
    await expect(verifyShieldedReceiveCode(otherIdentity)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  }, 60_000);

  it("rejects a well-formed code whose owner key was swapped", async () => {
    const decoded = decodeShieldedReceiveCredential(code);
    const otherOwner = encodeShieldedReceiveCredential({ ...decoded, ownerCommitment: decoded.ownerCommitment + 1n });
    await expect(verifyShieldedReceiveCode(otherOwner)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  }, 60_000);

  it.each([
    ["viewKeyLo", 16],
    ["viewKeyHi", 0],
  ] as const)(
    "rejects a well-formed code with only %s changed",
    async (_name, byteIndex) => {
      const decoded = decodeShieldedReceiveCredential(code);
      const viewingKey = decoded.viewingKey.slice();
      viewingKey[byteIndex] ^= 1;
      // Keep the identity, owner and proof intact and regenerate the checksum.
      const otherViewingKey = encodeShieldedReceiveCredential({ ...decoded, viewingKey });
      await expect(verifyShieldedReceiveCode(otherViewingKey)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    },
    60_000,
  );

  it("reports a copying mistake separately from tampering", async () => {
    const typo = `${code.slice(0, 30)}${code[30] === "q" ? "p" : "q"}${code.slice(31)}`;
    await expect(verifyShieldedReceiveCode(typo)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    await expect(verifyShieldedReceiveCode("")).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a G2 point that is on the curve but outside the subgroup", async () => {
    const curve = await snarkjs.curves.getCurveFromName("bn128");
    const F2 = curve.G2.F;
    let outside: string[][] | undefined;
    for (let seed = 1n; !outside; seed += 1n) {
      const x = F2.fromObject([seed, 1n]);
      const rhs = F2.add(F2.mul(F2.square(x), x), curve.G2.b);
      if (!F2.isSquare(rhs)) continue;
      const y = F2.sqrt(rhs);
      outside = [F2.toObject(x).map(String), F2.toObject(y).map(String)];
    }
    const point = curve.G2.fromObject([outside[0].map(BigInt), outside[1].map(BigInt), [1n, 0n]]);
    expect(curve.G2.isValid(point)).toBe(true);
    expect(await isInG2Subgroup(outside)).toBe(false);
    expect(await isInG2Subgroup(decodeShieldedReceiveCredential(code).proof.pi_b)).toBe(true);
  }, 60_000);
});
