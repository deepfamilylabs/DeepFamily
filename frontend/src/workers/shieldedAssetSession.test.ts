import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet, hexlify } from "ethers";
import {
  buildShieldedAssetSigningMessage,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
  encodeShieldedAssetKey,
  encodeShieldedAssetMnemonic,
  computeShieldedSpendNullifier,
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
    protocolVersion: async () => 1n,
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
const fixedRoot = new Uint8Array(32).fill(41);
// Keep recovery/proof setup deterministic under parallel frontend test workers.
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

function recoveryHistory(
  ownerCommitment: bigint,
  options: { amount?: bigint; valueOwner?: bigint; budgetOnly?: boolean } = {},
) {
  const value = {
    commitment: 71n,
    note: {
      kind: "value",
      ownerCommitment: options.valueOwner ?? ownerCommitment,
      amount: options.amount ?? 100n,
      nonce: 97n,
    },
  };
  const budget = {
    commitment: 73n,
    note: {
      kind: "budget",
      binding: "owner",
      keyMode: 1n,
      heirOwnerCommitment: ownerCommitment,
      heirIdentityCommitment: 31n,
      remaining: 1200n,
      amountPerPeriod: 100n,
      periodDays: 30n,
      eligibleFrom: 123n,
      policySalt: 101n,
      enrollmentSalt: 103n,
      nonce: 107n,
    },
  };
  return {
    chainId: 31337n,
    poolAddress: context.poolAddress,
    toBlock: 12,
    blockHash: `0x${"aa".repeat(32)}`,
    shards: new Map(),
    spentNullifiers: new Set(),
    walletOwnerCommitment: ownerCommitment,
    walletKeyMode: 1,
    fundingTemplates: new Map(),
    shieldedPolicies: new Map(),
    ownedNotes: options.budgetOnly ? new Map() : new Map([[71n, value]]),
    pendingIdentityBudgets: options.budgetOnly ? new Map([[73n, budget]]) : new Map(),
  };
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

  it.each(["mnemonic", "shieldedKey"] as const)(
    "requires an actual %s restore before opening a new random root and never returns identity secrets",
    async (format) => {
      const session = new ShieldedAssetSession();
      const identity = identityParams();
      assertPublic(await session.call("unlockIdentity", identity));
      expect(identity.rawPassphrase).toBe("");
      const initial = await session.call("createFunds", {
        intent: "create",
        rootSource: "random",
        context,
      });
      expect(initial.funds).toMatchObject({
        rootSource: "random",
        recoveryVerified: false,
        backupRequired: true,
      });
      assertPublic(initial);
      const forgedPublicState = session.state();
      forgedPublicState.funds!.recoveryVerified = true;
      forgedPublicState.funds!.backupRequired = false;
      expect(session.state()).toEqual(initial);
      await expect(session.call("receiveCode", { slot: "asset" })).rejects.toThrow(
        "Verify recovery",
      );
      const exported = await session.call("exportRecoveryMaterial", { format, context });
      expect(exported).toMatchObject({
        format,
        version: 1,
        fundsFingerprint: initial.funds!.fundsFingerprint,
      });
      if (format === "mnemonic") expect(exported.material.split(" ")).toHaveLength(24);
      else expect(exported.material).toMatch(/^0x[0-9a-f]{64}$/);
      expect(session.state()).toEqual(initial);
      const notFresh = { format, material: exported.material, context };
      await expect(session.call("importRecoveryMaterial", notFresh)).rejects.toThrow(
        "Clear the original",
      );
      expect(notFresh.material).toBe("");
      expect(session.state()).toEqual(initial);
      const secretBytes = (session as unknown as { root: Uint8Array }).root;
      session.clear();
      expect(secretBytes.every((byte) => byte === 0)).toBe(true);
      expect(session.state()).toEqual({ identity: null, funds: null });
      const fresh = new ShieldedAssetSession();
      const params = {
        format,
        material: exported.material,
        expectedFingerprint: exported.fundsFingerprint,
        pendingBackupFingerprints: [exported.fundsFingerprint],
        context,
      };
      const restored = await fresh.call("importRecoveryMaterial", params);
      expect(params.material).toBe("");
      expect(restored.identity).toBeNull();
      expect(restored.funds).toMatchObject({
        fundsFingerprint: exported.fundsFingerprint,
        rootSource: "imported",
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      assertPublic(restored);
      await fresh.call("unlockIdentity", identityParams());
      assertPublic(await fresh.call("receiveCode", { slot: "asset" }));
      expect(mocks.receive).toHaveBeenCalledOnce();
    },
  );

  it.each(["mnemonic", "shieldedKey"] as const)(
    "rejects malformed %s and wrong fingerprints without installing or replacing funds",
    async (format) => {
      const session = new ShieldedAssetSession();
      const material =
        format === "mnemonic"
          ? encodeShieldedAssetMnemonic(fixedRoot)
          : encodeShieldedAssetKey(fixedRoot);
      const wrongFingerprint = {
        format,
        material,
        expectedFingerprint: `0x${"ff".repeat(32)}`,
        context,
      };
      await expect(session.call("importRecoveryMaterial", wrongFingerprint)).rejects.toThrow(
        "fingerprint differs",
      );
      expect(wrongFingerprint.material).toBe("");
      expect(session.state().funds).toBeNull();
      const invalid = {
        format,
        material:
          format === "mnemonic" ? `${"abandon ".repeat(23)}abandon` : `0x${"11".repeat(31)}`,
        context,
      };
      await expect(session.call("importRecoveryMaterial", invalid)).rejects.toThrow();
      expect(invalid.material).toBe("");
      expect(session.state().funds).toBeNull();
      const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
      const valid = await session.call("importRecoveryMaterial", {
        format,
        material,
        expectedFingerprint: keys.fundsFingerprint,
        context,
      });
      const replacement = {
        format,
        material:
          format === "mnemonic"
            ? encodeShieldedAssetMnemonic(new Uint8Array(32).fill(42))
            : encodeShieldedAssetKey(new Uint8Array(32).fill(42)),
        context,
      };
      await expect(session.call("importRecoveryMaterial", replacement)).rejects.toThrow(
        "Clear the original",
      );
      expect(replacement.material).toBe("");
      await expect(
        session.call("createFunds", { intent: "create", rootSource: "random", context }),
      ).rejects.toThrow("empty funds slot");
      await expect(
        session.call("restoreSignature", {
          signerAddress: mocks.lineage,
          signature: "bad-signature-sentinel",
          context,
        }),
      ).rejects.toThrow("Clear the original");
      expect(session.state()).toEqual(valid);
      expect(JSON.stringify(valid)).not.toContain(material);
      assertPublic(valid);
    },
  );

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
    expect(created.funds?.backupRequired).toBe(true);
    const exported = await first.call("exportRecoveryMaterial", { format: "shieldedKey", context });
    first.clear();
    const manual = new ShieldedAssetSession();
    const manualState = await manual.call("importRecoveryMaterial", {
      format: "shieldedKey",
      material: exported.material,
      expectedFingerprint: created.funds!.fundsFingerprint,
      pendingBackupFingerprints: [created.funds!.fundsFingerprint],
      context,
    });
    expect(manualState.funds).toMatchObject({
      rootSource: "imported",
      recoveryVerified: true,
      recoveryPath: "shieldedKey",
      fundsFingerprint: created.funds!.fundsFingerprint,
      backupRequired: false,
    });
    expect(manualState.funds?.signerAddress).toBeUndefined();
    manual.clear();
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

  it.each([true, false])(
    "never skips a new wallet's manual backup through re-signing or history (known fingerprint: %s)",
    async (hasOriginalFingerprint) => {
      const wallet = new Wallet(`0x${"11".repeat(32)}`);
      const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
      const generated = await deriveShieldedAssetRootFromSignature({
        signerAddress: wallet.address,
        signature,
      });
      const keys = await deriveShieldedAssetKeyMaterial(generated.assetRoot);
      const pendingBackupFingerprints = [keys.fundsFingerprint];
      const signatureSession = new ShieldedAssetSession();
      const restored = await signatureSession.call("restoreSignature", {
        signerAddress: wallet.address,
        signature,
        expectedFingerprint: hasOriginalFingerprint ? keys.fundsFingerprint : undefined,
        pendingBackupFingerprints,
        context,
      });
      expect(restored.funds).toMatchObject({ backupRequired: true, recoveryVerified: false });
      mocks.recover.mockResolvedValue(recoveryHistory(keys.ownerCommitment));
      await signatureSession.call("recover", { context });
      expect(signatureSession.state().funds).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });
      const knownOriginalExport = await signatureSession.call("exportRecoveryMaterial", {
        format: "shieldedKey",
        context,
      });
      expect(knownOriginalExport.material).toBe(encodeShieldedAssetKey(generated.assetRoot));
      expect(signatureSession.state()).toEqual(restored);
      expect(signatureSession.state().funds).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });

      const exportedWords = await signatureSession.call("exportRecoveryMaterial", {
        format: "mnemonic",
        context,
      });
      expect(exportedWords.material).toBe(encodeShieldedAssetMnemonic(generated.assetRoot));
      signatureSession.clear();
      const manualWithoutOriginalFingerprint = new ShieldedAssetSession();
      await manualWithoutOriginalFingerprint.call("importRecoveryMaterial", {
        format: "mnemonic",
        material: exportedWords.material,
        pendingBackupFingerprints,
        context,
      });
      await manualWithoutOriginalFingerprint.call("recover", { context });
      expect(manualWithoutOriginalFingerprint.state().funds).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });
      const knownManualExport = await manualWithoutOriginalFingerprint.call(
        "exportRecoveryMaterial",
        { format: "mnemonic", context },
      );
      expect(knownManualExport.material).toBe(exportedWords.material);
      expect(manualWithoutOriginalFingerprint.state().funds).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });
      manualWithoutOriginalFingerprint.clear();
      await manualWithoutOriginalFingerprint.call("importRecoveryMaterial", {
        format: "shieldedKey",
        material: encodeShieldedAssetKey(fixedRoot),
        pendingBackupFingerprints,
        context,
      });
      await expect(
        manualWithoutOriginalFingerprint.call("exportRecoveryMaterial", {
          format: "shieldedKey",
          context,
        }),
      ).rejects.toThrow();
      const manualVerified = new ShieldedAssetSession();
      const opened = await manualVerified.call("importRecoveryMaterial", {
        format: "mnemonic",
        material: exportedWords.material,
        expectedFingerprint: keys.fundsFingerprint,
        pendingBackupFingerprints,
        context,
      });
      expect(opened.funds).toMatchObject({
        backupRequired: false,
        recoveryVerified: true,
        recoveryPath: "mnemonic",
      });
    },
  );

  it.each(["signature", "mnemonic", "shieldedKey"] as const)(
    "refuses to export an unknown %s candidate when pending fingerprints do not match",
    async (format) => {
      const session = new ShieldedAssetSession();
      const pendingBackupFingerprints = [`0x${"ff".repeat(32)}`];
      if (format === "signature") {
        const wallet = new Wallet(`0x${"11".repeat(32)}`);
        await session.call("restoreSignature", {
          signerAddress: wallet.address,
          signature: await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address)),
          pendingBackupFingerprints,
          context,
        });
      } else {
        await session.call("importRecoveryMaterial", {
          format,
          material:
            format === "mnemonic"
              ? encodeShieldedAssetMnemonic(fixedRoot)
              : encodeShieldedAssetKey(fixedRoot),
          pendingBackupFingerprints,
          context,
        });
      }
      expect(session.state().funds?.recoveryVerified).toBe(false);
      expect(session.state().funds?.fundsFingerprint).not.toBe(pendingBackupFingerprints[0]);
      await expect(
        session.call("exportRecoveryMaterial", { format: "shieldedKey", context }),
      ).rejects.toThrow();
      await session.call("recover", { context });
      expect(session.state().funds?.recoveryVerified).toBe(false);
      await expect(
        session.call("exportRecoveryMaterial", { format: "mnemonic", context }),
      ).rejects.toThrow();
    },
  );

  it("restores the same funds root in a newly configured deployment without changing its backup", async () => {
    const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
    const material = encodeShieldedAssetKey(fixedRoot);
    const changedContext = {
      ...context,
      factoryAddress: "0x6666666666666666666666666666666666666666",
    };
    for (const currentContext of [context, changedContext]) {
      const session = new ShieldedAssetSession();
      const state = await session.call("importRecoveryMaterial", {
        format: "shieldedKey",
        material,
        expectedFingerprint: keys.fundsFingerprint,
        context: currentContext,
      });
      expect(state.funds).toMatchObject({
        fundsFingerprint: keys.fundsFingerprint,
        recoveryVerified: true,
        recoveryPath: "shieldedKey",
      });
      expect(
        (
          await session.call("exportRecoveryMaterial", {
            format: "shieldedKey",
            context: currentContext,
          })
        ).material,
      ).toBe(material);
      assertPublic(state);
    }
  });

  it("summarizes root-only VALUE and pending budgets without revealing openings or granting claims", async () => {
    const session = new ShieldedAssetSession();
    const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
    await session.call("importRecoveryMaterial", {
      format: "mnemonic",
      material: encodeShieldedAssetMnemonic(fixedRoot),
      expectedFingerprint: keys.fundsFingerprint,
      context,
    });
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
    await expect(
      session.call("preview", {
        context,
        slot: "asset",
        action: "claim",
        claimHandle: "73",
      }),
    ).rejects.toThrow("identity credentials");
  });

  it("does not let random creation bypass its backup gate by scanning a matching history", async () => {
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
    expect(session.state().funds?.backupRequired).toBe(true);
  });

  it.each(["mnemonic", "shieldedKey"] as const)(
    "keeps an uncorroborated %s restore pending until original fingerprint or owned positive VALUE history",
    async (format) => {
      const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
      const material =
        format === "mnemonic"
          ? encodeShieldedAssetMnemonic(fixedRoot)
          : encodeShieldedAssetKey(fixedRoot);
      const session = new ShieldedAssetSession();
      const params = { format, material, context };
      const candidate = await session.call("importRecoveryMaterial", params);
      expect(params.material).toBe("");
      expect(candidate.funds).toMatchObject({ rootSource: "imported", recoveryVerified: false });
      expect(candidate.funds?.signerAddress).toBeUndefined();
      expect(candidate.funds?.recoveryPath).toBeUndefined();
      await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow();
      await session.call("recover", { context });
      expect(session.state().funds?.recoveryVerified).toBe(false);
      const spent = recoveryHistory(keys.ownerCommitment);
      spent.spentNullifiers.add(
        computeShieldedSpendNullifier(
          { ownerSecret: keys.ownerSecret, noteCommitment: 71n },
          { chainId: 31337n, poolAddress: context.poolAddress },
        ),
      );
      for (const insufficient of [
        recoveryHistory(keys.ownerCommitment, { amount: 0n }),
        recoveryHistory(keys.ownerCommitment, { budgetOnly: true }),
        recoveryHistory(keys.ownerCommitment, { valueOwner: keys.ownerCommitment + 1n }),
        spent,
      ]) {
        mocks.recover.mockResolvedValue(insufficient);
        await session.call("recover", { context });
        expect(session.state().funds?.recoveryVerified).toBe(false);
        await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow();
      }
      mocks.recover.mockResolvedValue(recoveryHistory(keys.ownerCommitment));
      const corroborated = await session.call("recover", { context });
      expect(session.state().funds).toMatchObject({
        recoveryVerified: true,
        recoveryPath: "history",
      });
      expect(corroborated.sessionState?.funds).toMatchObject({
        recoveryVerified: true,
        recoveryPath: "history",
      });
      const exported = await session.call("exportRecoveryMaterial", { format, context });
      expect(exported.material).toBe(material);
      assertPublic(session.state());
      assertPublic(corroborated);
      session.clear();
      expect(session.state()).toEqual({ identity: null, funds: null });
      await expect(session.call("recover", { context })).rejects.toThrow("Unlock");
      await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow();
    },
  );

  it("clears pasted recovery secrets before an asynchronous context validation can fail", async () => {
    const session = new ShieldedAssetSession();
    const params = {
      format: "shieldedKey" as const,
      material: encodeShieldedAssetKey(fixedRoot),
      context: { ...context, chainId: "1" },
    };
    const failed = session.call("importRecoveryMaterial", params);
    expect(params.material).toBe("");
    await expect(failed).rejects.toThrow("RPC chain");
    expect(session.state().funds).toBeNull();
    assertPublic(session.state());
    const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
    const recovered = await session.call("importRecoveryMaterial", {
      format: "shieldedKey",
      material: encodeShieldedAssetKey(fixedRoot),
      expectedFingerprint: keys.fundsFingerprint,
      context,
    });
    expect(recovered.funds).toMatchObject({ recoveryVerified: true, recoveryPath: "shieldedKey" });
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
    expect(corroborated.sessionState?.funds).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "history",
    });
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
