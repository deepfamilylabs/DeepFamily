import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet, hexlify } from "ethers";
import {
  buildShieldedAssetSigningMessage,
  deriveShieldedAssetKeyMaterial,
  encryptShieldedAssetVault,
  deriveShieldedAssetRootFromSignature,
  decryptShieldedAssetVault,
} from "@deepfamily/protocol-core";
import { ShieldedAssetSession, shieldedAssetErrorMessage } from "./shieldedAssetSession";
import type { ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  receive: vi.fn(),
  identity: vi.fn(),
  lineage: "0x1111111111111111111111111111111111111111",
  verifier: "0x2222222222222222222222222222222222222222",
  pool: "0x3333333333333333333333333333333333333333",
  factory: "0x4444444444444444444444444444444444444444",
}));
vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    JsonRpcProvider: class {
      getNetwork = async () => ({ chainId: 31337n });
      getBlockNumber = async () => 12;
      getBlock = async () => ({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 });
    },
  };
});
vi.mock("@deepfamily/protocol-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@deepfamily/protocol-core")>()),
  deriveIdentityMaterial: mocks.identity,
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({ lineageIndex: async () => mocks.lineage }),
  createLineageIndexContract: () => ({}),
  createShieldedPoolFactoryContract: () => ({
    LINEAGE_INDEX: async () => mocks.lineage,
    VERIFIER: async () => mocks.verifier,
    poolFor: async () => mocks.pool,
  }),
  createShieldedErc20PoolContract: () => ({}),
  createShieldedNativePoolContract: () => ({
    protocolVersion: async () => 3n,
    LINEAGE_INDEX: async () => mocks.lineage,
    VERIFIER: async () => mocks.verifier,
    assetKind: async () => 1n,
  }),
}));
vi.mock("../shared/zk/shieldedReceiveCode", () => ({
  createShieldedReceiveCode: mocks.receive,
  verifyShieldedReceiveCode: vi.fn(),
}));
vi.mock("../shared/zk/shieldedZk", () => ({ generateShieldedProof: vi.fn() }));
vi.mock("../domains/inheritance/services/shieldedWalletRecovery", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../domains/inheritance/services/shieldedWalletRecovery")
  >()),
  recoverLocalShieldedWallet: mocks.recover,
}));
vi.mock("../domains/inheritance/services/inheritanceChain", () => ({
  loadLineageSnapshot: async () => null,
  findHeirLegitimacy: () => [],
}));

const context: ShieldedWorkerContext = {
  rpcUrl: "http://localhost:8545",
  chainId: "31337",
  factoryAddress: mocks.factory,
  factoryDeploymentBlock: 3,
  familyAddress: "0x5555555555555555555555555555555555555555",
  lineageIndexAddress: mocks.lineage,
  poolAddress: mocks.pool,
  poolDeploymentBlock: 2,
  assetKind: "native",
};
const discovery = [
  {
    chainId: context.chainId,
    factoryAddress: context.factoryAddress,
    factoryDeploymentBlock: 3,
    lineageIndexAddress: context.lineageIndexAddress,
    verifierAddress: mocks.verifier,
    protocolVersion: 3 as const,
  },
];
const identityParams = () => ({
  identity: {
    fullName: "Child Example",
    gender: 1,
    birthYear: 2001,
    birthMonth: 4,
    birthDay: 9,
    isBirthBC: false,
  },
  rawPassphrase: "private-identity-sentinel",
});
const unlockCredential = "separate-vault-credential";
const fixedRoot = new Uint8Array(32).fill(41);
// Exercise the production 64 MiB / 3-pass Argon2id profile even while contract
// compilation and other test workers compete for CPU and memory.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.receive.mockResolvedValue({ code: "public-code", fingerprint: "public-fingerprint" });
  mocks.identity.mockImplementation(async ({ identity }: { identity: object }) => ({
    identity,
    identitySuiteId: 1,
    derivedSecretField: 13n,
    nameField: 17n,
    packedBirthGenderField: 19n,
    suiteCommitment: 23n,
    nameSecretCommitment: 29n,
    identityCommitment: 31n,
    personHash: `0x${"00".repeat(31)}1f`,
    identitySalt: new Uint8Array(16).fill(1),
    derivedSecretBytes: new Uint8Array(32).fill(2),
  }));
  mocks.recover.mockImplementation(async (_pool, input, options) => ({
    poolAddress: context.poolAddress,
    chainId: 31337n,
    toBlock: options.toBlock,
    blockHash: `0x${"aa".repeat(32)}`,
    shards: new Map(),
    ownedNotes: new Map(),
    spentNullifiers: new Set(),
    walletOwnerCommitment: input.keyMaterial.ownerCommitment,
    walletIdentityCommitment: input.identityCommitment,
    walletKeyMode: input.keyMaterial.keyMode,
    pendingIdentityBudgets: new Map(),
    fundingTemplates: new Map(),
    shieldedPolicies: new Map(),
  }));
});

function assertPublic(value: unknown) {
  const json = JSON.stringify(value);
  for (const forbidden of [
    "assetRoot",
    "ownerSecret",
    "hpkeIkm",
    "derivedSecretField",
    "derivedSecretBytes",
    "identitySalt",
    "rawPassphrase",
    "private-identity-sentinel",
    "policySalt",
    "enrollmentSalt",
    "nonce",
    "witness",
  ])
    expect(json).not.toContain(forbidden);
}

describe("ephemeral asset Worker funds lifecycle", () => {
  it("creates only on explicit intent and refuses private method dispatch or recovery fallback", async () => {
    const session = new ShieldedAssetSession();
    await expect(
      session.call("createFunds", { intent: "restore" as "create", rootSource: "random", context }),
    ).rejects.toThrow("explicit");
    await expect(session.call("recover", { context })).rejects.toThrow("Unlock");
    await expect(session.call("keys" as "receiveCode", { slot: "asset" })).rejects.toThrow(
      "Unsupported",
    );
    await expect(
      session.call("createFunds", {
        intent: "create",
        rootSource: "walletSignature",
        signature: "bad-secret",
        signerAddress: mocks.lineage,
        context,
      }),
    ).rejects.toThrow();
    expect(session.state().funds).toBeNull();
    assertPublic(session.state());
  });

  it("requires fresh file import before opening a new random root and never returns identity secrets", async () => {
    const session = new ShieldedAssetSession();
    const identity = identityParams();
    assertPublic(await session.call("unlockIdentity", identity));
    expect(identity.rawPassphrase).toBe("");
    const initial = await session.call("createFunds", {
      intent: "create",
      rootSource: "random",
      context,
    });
    expect(initial.funds).toMatchObject({ rootSource: "random", recoveryVerified: false });
    assertPublic(initial);
    await expect(session.call("receiveCode", { slot: "asset" })).rejects.toThrow("Verify recovery");
    await expect(
      session.call("exportFunds", { context, unlockCredential: "aaaaaaaaaaaaaaaa" }),
    ).rejects.toThrow("strong separate vault");
    const exported = await session.call("exportFunds", { context });
    expect(exported.unlockCredential).toMatch(/^0x[0-9a-f]{32}$/);
    await expect(
      session.call("importFunds", {
        file: exported.file,
        unlockCredential: exported.unlockCredential,
        context,
      }),
    ).rejects.toThrow("Clear the original");
    const inspect = await decryptShieldedAssetVault({
      file: exported.file,
      unlockCredential: exported.unlockCredential,
    });
    expect("identity" in inspect).toBe(false);
    expect(inspect.signatureMetadata).toBeUndefined();
    session.clear();
    const fresh = new ShieldedAssetSession();
    const params = {
      file: exported.file,
      unlockCredential: exported.unlockCredential,
      expectedFingerprint: exported.fundsFingerprint,
      context,
    };
    const restored = await fresh.call("importFunds", params);
    expect(params.unlockCredential).toBe("");
    expect(restored.identity).toBeNull();
    expect(restored.funds).toMatchObject({
      fundsFingerprint: exported.fundsFingerprint,
      recoveryVerified: true,
      recoveryPath: "file",
    });
    assertPublic(restored);
    await fresh.call("unlockIdentity", identityParams());
    assertPublic(await fresh.call("receiveCode", { slot: "asset" }));
    expect(mocks.receive).toHaveBeenCalledOnce();
  });

  it("rejects wrong fingerprint/password and another root without replacing the original funds", async () => {
    const file = await encryptShieldedAssetVault({
      assetRoot: fixedRoot,
      rootSource: "random",
      discovery,
      unlockCredential,
    });
    const session = new ShieldedAssetSession();
    await expect(
      session.call("importFunds", {
        file,
        unlockCredential,
        expectedFingerprint: `0x${"ff".repeat(32)}`,
        context,
      }),
    ).rejects.toThrow();
    expect(session.state().funds).toBeNull();
    await expect(
      session.call("importFunds", { file, unlockCredential: "wrong-credential-sentinel", context }),
    ).rejects.toThrow();
    expect(session.state().funds).toBeNull();
    const original = await session.call("importFunds", { file, unlockCredential, context });
    await expect(
      session.call("createFunds", { intent: "create", rootSource: "random", context }),
    ).rejects.toThrow("empty funds slot");
    await expect(
      session.call("restoreSignature", { signerAddress: mocks.lineage, signature: "bad", context }),
    ).rejects.toThrow("Clear the original");
    await expect(session.call("importFunds", { file, unlockCredential, context })).rejects.toThrow(
      "Clear the original",
    );
    expect(session.state()).toEqual(original);
  });

  it("verifies a real repeated signature against the old fingerprint and rejects a different signer", async () => {
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
    const first = new ShieldedAssetSession();
    const created = await first.call("createFunds", {
      intent: "create",
      rootSource: "walletSignature",
      signerAddress: wallet.address,
      signature,
      context,
    });
    expect(created.funds?.recoveryVerified).toBe(false);
    first.clear();
    const fresh = new ShieldedAssetSession();
    const params = {
      signerAddress: wallet.address,
      signature: await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address)),
      expectedFingerprint: created.funds!.fundsFingerprint,
      context,
    };
    const restored = await fresh.call("restoreSignature", params);
    expect(params.signature).toBe("");
    expect(restored.funds).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "signature",
      fundsFingerprint: created.funds!.fundsFingerprint,
    });
    assertPublic(restored);
    const other = new Wallet(`0x${"22".repeat(32)}`);
    const wrong = new ShieldedAssetSession();
    await expect(
      wrong.call("restoreSignature", {
        signerAddress: other.address,
        signature: await other.signMessage(buildShieldedAssetSigningMessage(other.address)),
        expectedFingerprint: created.funds!.fundsFingerprint,
        context,
      }),
    ).rejects.toThrow("fingerprint differs");
    expect(wrong.state().funds).toBeNull();
  });

  it("loads an old backup root to update a new scope but keeps operations gated until reimport", async () => {
    const file = await encryptShieldedAssetVault({
      assetRoot: fixedRoot,
      rootSource: "random",
      discovery,
      unlockCredential,
    });
    const changedContext = {
      ...context,
      factoryAddress: "0x6666666666666666666666666666666666666666",
    };
    const session = new ShieldedAssetSession();
    const old = await session.call("importFunds", {
      file,
      unlockCredential,
      context: changedContext,
    });
    expect(old.funds?.recoveryVerified).toBe(false);
    await session.call("unlockIdentity", identityParams());
    await expect(session.call("receiveCode", { slot: "asset" })).rejects.toThrow("Verify recovery");
    const updated = await session.call("exportFunds", { context: changedContext });
    session.clear();
    const fresh = new ShieldedAssetSession();
    const restored = await fresh.call("importFunds", {
      file: updated.file,
      unlockCredential: updated.unlockCredential,
      expectedFingerprint: old.funds!.fundsFingerprint,
      context: changedContext,
    });
    expect(restored.funds?.recoveryVerified).toBe(true);
  });

  it("summarizes root-only VALUE and pending budgets without revealing openings or granting claims", async () => {
    const file = await encryptShieldedAssetVault({
      assetRoot: fixedRoot,
      rootSource: "random",
      discovery,
      unlockCredential,
    });
    const session = new ShieldedAssetSession();
    await session.call("importFunds", { file, unlockCredential, context });
    mocks.recover.mockImplementation(async (_pool, input, options) => ({
      chainId: 31337n,
      poolAddress: context.poolAddress,
      toBlock: options.toBlock,
      blockHash: `0x${"aa".repeat(32)}`,
      shards: new Map(),
      spentNullifiers: new Set(),
      walletOwnerCommitment: input.keyMaterial.ownerCommitment,
      walletKeyMode: 1,
      fundingTemplates: new Map(),
      shieldedPolicies: new Map(),
      ownedNotes: new Map([
        [
          71n,
          {
            commitment: 71n,
            note: {
              kind: "value",
              ownerCommitment: input.keyMaterial.ownerCommitment,
              amount: 100n,
              nonce: 97n,
            },
          },
        ],
      ]),
      pendingIdentityBudgets: new Map([
        [
          73n,
          {
            commitment: 73n,
            note: {
              kind: "budget",
              binding: "owner",
              keyMode: 1n,
              heirOwnerCommitment: input.keyMaterial.ownerCommitment,
              heirIdentityCommitment: 31n,
              remaining: 1200n,
              amountPerPeriod: 100n,
              periodDays: 30n,
              eligibleFrom: 123n,
              policySalt: 101n,
              enrollmentSalt: 103n,
              nonce: 107n,
            },
          },
        ],
      ]),
    }));
    const summary = await session.call("recover", { context });
    expect(summary.notes).toMatchObject([
      { kind: "value", amount: "100" },
      { kind: "budget", pendingIdentity: true, keyMode: 1 },
    ]);
    expect(summary.claims).toEqual([]);
    assertPublic(summary);
  });

  it("does not let random creation bypass its file gate by scanning a matching history", async () => {
    const session = new ShieldedAssetSession();
    await session.call("createFunds", { intent: "create", rootSource: "random", context });
    mocks.recover.mockImplementation(async (_pool, input, options) => ({
      chainId: 31337n,
      poolAddress: context.poolAddress,
      toBlock: options.toBlock,
      blockHash: `0x${"aa".repeat(32)}`,
      shards: new Map(),
      spentNullifiers: new Set(),
      walletOwnerCommitment: input.keyMaterial.ownerCommitment,
      walletKeyMode: 1,
      fundingTemplates: new Map(),
      shieldedPolicies: new Map(),
      ownedNotes: new Map([
        [
          71n,
          {
            commitment: 71n,
            note: {
              kind: "value",
              ownerCommitment: input.keyMaterial.ownerCommitment,
              amount: 100n,
              nonce: 97n,
            },
          },
        ],
      ]),
    }));
    await session.call("recover", { context });
    expect(session.state().funds?.recoveryVerified).toBe(false);
  });

  it("keeps uncorroborated signature restores pending on an empty scan and accepts authenticated value history", async () => {
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
    const session = new ShieldedAssetSession();
    await session.call("restoreSignature", { signerAddress: wallet.address, signature, context });
    await session.call("recover", { context });
    expect(session.state().funds?.recoveryVerified).toBe(false);
    const generated = await deriveShieldedAssetRootFromSignature({
      signerAddress: wallet.address,
      signature,
    });
    const keys = await deriveShieldedAssetKeyMaterial(generated.assetRoot);
    mocks.recover.mockResolvedValue({
      chainId: 31337n,
      poolAddress: context.poolAddress,
      toBlock: 12,
      blockHash: `0x${"aa".repeat(32)}`,
      shards: new Map(),
      spentNullifiers: new Set(),
      walletOwnerCommitment: keys.ownerCommitment,
      ownedNotes: new Map([
        [
          71n,
          {
            commitment: 71n,
            note: { kind: "value", ownerCommitment: keys.ownerCommitment, amount: 100n },
          },
        ],
      ]),
    });
    const corroborated = await session.call("recover", { context });
    expect(session.state().funds).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "history",
    });
    expect(corroborated.sessionState?.funds).toMatchObject({ recoveryVerified: true, recoveryPath: "history" });
  });

  it("serializes failures without cryptographic input or nested library errors", () => {
    const secret = "signature-secret-identity-password-root-sentinel";
    const error = Object.assign(new Error(secret), {
      cause: { assetRoot: secret, witness: secret },
    });
    expect(shieldedAssetErrorMessage(error)).not.toContain(secret);
    expect(shieldedAssetErrorMessage({ message: secret })).not.toContain(secret);
    expect(hexlify(fixedRoot)).not.toContain("password");
  });
});
