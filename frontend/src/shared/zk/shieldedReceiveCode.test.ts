import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeIdentityFromDerivedSecret,
  computeShieldedAuthorizationAlias,
  buildShieldedIdentityAuthorizationState,
  computeShieldedBudgetNoteCommitment,
  prepareShieldedReceivePresentation,
  verifyLinkedGroth16Proof,
  decodeShieldedReceiveCredential,
  decodeShieldedBudgetReceiveCode,
  encodeShieldedBudgetReceiveCode,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedReceiveCredential,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { hexlify, keccak256 } from "ethers";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { proveShieldedReceivePresentation } from "./shieldedReceivePresentation";
import { SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS, SHIELDED_RECEIVE_LINK_KEYS } from "./shieldedZk";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShieldedReceiveCode,
  createShieldedReceiveCodeFromCredentials,
  isInG2Subgroup,
  verifyShieldedReceiveCode,
} from "./shieldedReceiveCode";

const mocks = vi.hoisted(() => ({
  deriveIdentityMaterial: vi.fn(),
  authorizationState: vi.fn(),
  authorizationMode: vi.fn(),
  providerDestroy: vi.fn(),
}));
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
  createShieldedPoolFactoryContract: () => ({
    AUTHORIZATION_STATE: async () => "0x2222222222222222222222222222222222222222",
  }),
}));
vi.mock("../clients/shieldedIdentityAuthorizationChain", () => ({
  createIdentityAuthorizationContract: () => ({}),
  loadShieldedIdentityAuthorizationWitnessForMode: async (
    _contract: unknown,
    alias: bigint,
    mode: unknown,
    scope: unknown,
  ) => {
    mocks.authorizationMode(mode, scope);
    const { getShieldedIdentityAuthorizationWitness } = await vi.importActual<
      typeof import("@deepfamily/protocol-core")
    >("@deepfamily/protocol-core");
    const result = await mocks.authorizationState();
    return {
      ...result,
      stateRoot: result.state.root,
      witness: getShieldedIdentityAuthorizationWitness(result.state, alias),
    };
  },
}));

const receiveOptions = {
  context: {
    rpcUrl: "http://localhost:8545",
    chainId: "31337",
    factoryAddress: "0x1111111111111111111111111111111111111111",
  },
  expiresAt: "2000000000",
};

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
  disclosure: "fund" as const,
  authorizationCounter: 0n,
  expiresAt: 2_000_000_000n,
  keyMaterial: deriveShieldedHeirKeyMaterial(123456789n),
};

describe("explicit receive-code spending material", () => {
  it.each([
    [
      "missing authorization mode",
      { ...identity, keyMode: undefined },
      "Unsupported receive authorization mode",
    ],
    [
      "missing spending material",
      { ...identity, keyMaterial: undefined },
      "requires explicit spending material",
    ],
  ])("rejects %s instead of deriving fallback keys", async (_label, input, message) => {
    await expect(
      createShieldedReceiveCode(
        input as unknown as Parameters<typeof createShieldedReceiveCode>[0],
      ),
    ).rejects.toThrow(message);
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
      createShieldedReceiveCodeFromCredentials({
        identity: identity.identity,
        rawPassphrase,
        ...receiveOptions,
      }),
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
      authorizationAlias: String(decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode).authorizationAlias),
      authorizationCounter: "0",
      expiresAt: "2000000000",
      identityCommitment: material.identityCommitment.toString(),
      ownerCommitment: keys.ownerCommitment.toString(),
      viewingKey: hexlify(viewingKey),
      personHash: wrapIdentityCommitmentAsPersonHash(material.identityCommitment),
      keyMode: 0,
      identitySuiteId: 1,
      independentKeySuiteId: 1,
      independentKeyDerivationVersion: 1,
      fingerprint: decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode).fingerprint,
    });
  }, 60_000);

  it("verifies both independent issuer proofs in one budget code and selects the anonymous letter credential", async () => {
    const bundle = decodeShieldedBudgetReceiveCode(code);
    const anonymous = decodeShieldedReceiveCredential(bundle.anonymousCode);
    expect(bundle.fundCode.startsWith("dffund1")).toBe(true);
    expect(bundle.anonymousCode.startsWith("dfrecv1")).toBe(true);
    await expect(verifyShieldedReceiveCode(code, "anonymous")).resolves.toMatchObject({
      ok: true, disclosure: "anonymous", fingerprint: anonymous.fingerprint,
      ownerCommitment: anonymous.ownerCommitment.toString(),
    });
    expect((await verifyShieldedReceiveCode(code, "anonymous"))).not.toHaveProperty("identityCommitment");
  }, 60_000);

  it("rejects a package with a valid Fund proof but a forged anonymous issuer proof", async () => {
    const bundle = decodeShieldedBudgetReceiveCode(code);
    const anonymous = decodeShieldedReceiveCredential(bundle.anonymousCode);
    const fund = decodeShieldedReceiveCredential(bundle.fundCode);
    const forged = encodeShieldedBudgetReceiveCode({
      fundCode: bundle.fundCode,
      anonymousCode: encodeShieldedReceiveCredential({ ...anonymous, proof: fund.proof }),
    });
    await expect(verifyShieldedReceiveCode(forged)).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(verifyShieldedReceiveCode(forged, "anonymous")).resolves.toEqual({ ok: false, reason: "invalid" });
  }, 60_000);

  it.each([0, 1] as const)("uses a combined code for real Fund and attached-letter presentation proofs in key mode %s", async keyMode => {
    const keys = keyMode === 0 ? identity.keyMaterial : await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(32).fill(53),
      independentKeyIdentitySecret: new Uint8Array(32).fill(71),
    });
    const packageCode = keyMode === 0 ? code : (await createShieldedReceiveCode({ ...identity, keyMode, keyMaterial: keys })).code;
    const bundle = decodeShieldedBudgetReceiveCode(packageCode);
    const fund = decodeShieldedReceiveCredential(bundle.fundCode);
    const anonymous = decodeShieldedReceiveCredential(bundle.anonymousCode);
    const scope = { chainId: 31337n, poolAddress: "0x2222222222222222222222222222222222222222" };
    const common = {
      chainId: scope.chainId, consumer: scope.poolAddress, messageId: 0n,
      payloadHash: keccak256("0x123456"), checkpointId: 1n, asOf: 1800000000n,
      state: buildShieldedIdentityAuthorizationState(), salt: 4321n,
    };
    const fundPresentation = prepareShieldedReceivePresentation({ ...common, credential: fund, action: 3n });
    const attachmentPresentation = prepareShieldedReceivePresentation({ ...common, credential: anonymous, action: 2n, messageId: 42n });
    const leaf = computeShieldedBudgetNoteCommitment({
      budgetOrigin: "fund", policyCommitment: 31n, enrollmentCommitment: 32n,
      heirOwnerCommitment: keys.ownerCommitment, viewingKey: anonymous.viewingKey, keyMode,
      amountPerPeriod: 5n, remaining: 15n, nonce: 33n, ciphertextHashField: 34n,
    }, scope);
    let noteRoot = leaf;
    for (let level = 0; level < 32; level++) noteRoot = poseidon2([noteRoot, 0n]);
    const attachment = {
      budgetPool: String(BigInt(scope.poolAddress)), budgetRoot: String(noteRoot),
      relation: String(poseidon3([poseidon3([202610210401n, BigInt(scope.poolAddress), leaf]), attachmentPresentation.recipientBinding, 4321n])),
      policy: "31", enrollment: "32", rate: "5", remaining: "15", nonce: "33", ciphertextHash: "34",
      depth: "32", index: "0", siblings: Array(32).fill("0"),
    };
    for (const [kind, presentation] of [["fund", fundPresentation], ["attachment", attachmentPresentation]] as const) {
      const expected = [...presentation.publicSignals, ...(kind === "attachment" ? [BigInt(scope.poolAddress), noteRoot, BigInt(attachment.relation)] : [])];
      const request = kind === "attachment" ? { ...presentation.request, attachment } : presentation.request;
      const result = await proveShieldedReceivePresentation(request, expected);
      const linkKeys = SHIELDED_RECEIVE_LINK_KEYS?.[kind];
      if (!linkKeys) throw new Error("Receive link keys are missing");
      await expect(verifyLinkedGroth16Proof({
        proof: result.proof, publicInputs: expected,
        issuer: { verificationKey: SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS[kind === "fund" ? "fund" : "anonymous"], deltaG1: linkKeys.issuerDeltaG1 },
        presentation: { verificationKey: linkKeys.verificationKey, deltaG1: linkKeys.deltaG1 },
      })).resolves.toBe(true);
    }
    expect(() => prepareShieldedReceivePresentation({ ...common, credential: anonymous, action: 3n })).toThrow("credential disclosure");
    expect(() => prepareShieldedReceivePresentation({ ...common, credential: fund, action: 2n })).toThrow("credential disclosure");
  }, 120_000);

  it("creates a recipient code using the current nonzero chain counter", async () => {
    const material = computeIdentityFromDerivedSecret(identity);
    mocks.deriveIdentityMaterial.mockResolvedValueOnce(material);
    const alias = computeShieldedAuthorizationAlias(material);
    mocks.authorizationState.mockResolvedValueOnce({
      state: buildShieldedIdentityAuthorizationState([[alias, 5n]]),
    });
    const result = await createShieldedReceiveCodeFromCredentials({
      identity: identity.identity,
      rawPassphrase: "recipient passphrase",
      ...receiveOptions,
    });
    expect(decodeShieldedReceiveCredential(result.code).authorizationCounter).toBe(5n);
    expect(mocks.authorizationMode).toHaveBeenLastCalledWith("rebuild", {
      chainId: "31337",
      authorizationStateAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(mocks.providerDestroy).toHaveBeenCalled();
  }, 60_000);

  it("passes only an explicitly selected chain mode to recipient state reading", async () => {
    mocks.deriveIdentityMaterial.mockResolvedValueOnce(computeIdentityFromDerivedSecret(identity));
    mocks.authorizationState.mockRejectedValueOnce(new Error("Stop before proving"));
    await expect(
      createShieldedReceiveCodeFromCredentials({
        identity: identity.identity,
        rawPassphrase: "recipient passphrase",
        ...receiveOptions,
        context: { ...receiveOptions.context, stateReadMode: "chain" },
      }),
    ).rejects.toThrow("could not be created");
    expect(mocks.authorizationMode).toHaveBeenLastCalledWith("chain", {
      chainId: "31337",
      authorizationStateAddress: "0x2222222222222222222222222222222222222222",
    });
  });

  it("rejects an unknown read mode before deriving credentials or querying state", async () => {
    const derivations = mocks.deriveIdentityMaterial.mock.calls.length;
    const queries = mocks.authorizationMode.mock.calls.length;
    await expect(
      createShieldedReceiveCodeFromCredentials({
        identity: identity.identity,
        rawPassphrase: "recipient passphrase",
        ...receiveOptions,
        context: { ...receiveOptions.context, stateReadMode: "unknown" as "chain" },
      }),
    ).rejects.toThrow("could not be created");
    expect(mocks.deriveIdentityMaterial.mock.calls.length).toBe(derivations);
    expect(mocks.authorizationMode.mock.calls.length).toBe(queries);
  });

  it("does not substitute counter zero when a recipient's chain state cannot be read", async () => {
    mocks.deriveIdentityMaterial.mockResolvedValueOnce(computeIdentityFromDerivedSecret(identity));
    mocks.authorizationState.mockRejectedValueOnce(new Error("RPC unavailable"));
    const credentials = {
      identity: identity.identity,
      rawPassphrase: "recipient passphrase",
      ...receiveOptions,
    };
    await expect(createShieldedReceiveCodeFromCredentials(credentials)).rejects.toThrow(
      "Receive code could not be created",
    );
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
    const decoded = decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(independent.code).fundCode);
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
    const decoded = decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode);
    const otherIdentity = encodeShieldedReceiveCredential({
      ...decoded,
      identityCommitment: decoded.identityCommitment! + 1n,
    });
    await expect(verifyShieldedReceiveCode(otherIdentity)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  }, 60_000);

  it("rejects a well-formed code whose owner key was swapped", async () => {
    const decoded = decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode);
    const otherOwner = encodeShieldedReceiveCredential({
      ...decoded,
      ownerCommitment: decoded.ownerCommitment + 1n,
    });
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
      const decoded = decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode);
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
    expect(await isInG2Subgroup(decodeShieldedReceiveCredential(decodeShieldedBudgetReceiveCode(code).fundCode).proof.pi_b)).toBe(true);
  }, 60_000);
});
