import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, Wallet, getBytes, hexlify, type Contract } from "ethers";
import {
  buildShieldedAssetSigningMessage,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
  encodeShieldedAssetKey,
  encodeShieldedAssetMnemonic,
  computeShieldedSpendNullifier,
  computeShieldedCiphertextHashField,
  computeShieldedNoteCommitmentFromPayload,
  createLineageTree,
  encodeShieldedBudgetNotePayload,
  encryptShieldedNote,
} from "@deepfamily/protocol-core";
import { ShieldedAssetSession, shieldedAssetErrorMessage } from "./shieldedAssetSession";
import type { ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  receive: vi.fn(),
  identity: vi.fn(),
  discoverPools: vi.fn(),
  loadLineage: vi.fn(),
  lineage: "0x1111111111111111111111111111111111111111",
  verifier: "0x2222222222222222222222222222222222222222",
  pool: "0x3333333333333333333333333333333333333333",
  factory: "0x4444444444444444444444444444444444444444",
  // The canonical pool the factory reports for the asset being validated.
  canonicalPool: "0x3333333333333333333333333333333333333333",
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
    poolFor: async () => mocks.canonicalPool,
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
vi.mock("../domains/inheritance/services/shieldedAssetRegistry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../domains/inheritance/services/shieldedAssetRegistry")
  >()),
  discoverShieldedFactoryPools: mocks.discoverPools,
}));
vi.mock("../domains/inheritance/services/shieldedWalletRecovery", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../domains/inheritance/services/shieldedWalletRecovery")
  >()),
  recoverLocalShieldedWallet: mocks.recover,
}));
vi.mock("../domains/inheritance/services/inheritanceChain", () => ({
  loadLineageSnapshot: mocks.loadLineage,
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
  mocks.loadLineage.mockReset().mockResolvedValue(null);
  mocks.canonicalPool = mocks.pool;
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

/** Exercise authenticated opening and chain replay, rather than injecting an owned-note summary. */
async function authenticatedBudgetHistory(
  keys: Awaited<ReturnType<typeof deriveShieldedAssetKeyMaterial>>,
  options: { heirIdentity?: bigint; heirOwner?: bigint; keyMode?: bigint; spent?: boolean } = {},
) {
  const scope = { chainId: 31337n, poolAddress: context.poolAddress };
  const payload = encodeShieldedBudgetNotePayload(
    {
      binding: "owner",
      keyMode: options.keyMode ?? 1n,
      rootIdentityCommitment: 11n,
      rootVersionIndex: 2n,
      policySalt: 17n,
      allocationKeyCommitment: 19n,
      heirIdentityCommitment: options.heirIdentity ?? 31n,
      eligibleFrom: 123n,
      enrollmentSalt: 23n,
      heirOwnerCommitment: options.heirOwner ?? keys.ownerCommitment,
      amountPerPeriod: 100n,
      periodDays: 30n,
      remaining: 1200n,
      nonce: 29n,
    },
    scope,
  );
  const ciphertext = await encryptShieldedNote({
    payload,
    recipientPublicKey: keys.viewPublicKey,
    ...scope,
  });
  const commitment = computeShieldedNoteCommitmentFromPayload(
    { payload, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
    scope,
  ).noteCommitment;
  const tree = createLineageTree();
  tree.insert(commitment);
  const iface = new Interface([
    "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
    "event NullifierSpent(uint256 nullifier)",
    "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
  ]);
  const log = (event: string, values: unknown[], index: number) => ({
    ...iface.encodeEventLog(iface.getEvent(event)!, values),
    address: context.poolAddress,
    blockNumber: 2,
    transactionHash: `0x${"01".repeat(32)}`,
    index,
  });
  const logs = [
    log("ActionExecuted", [1n, 0n, 0n], 0),
    log("NoteAppended", [0n, 0n, commitment, tree.root, ciphertext], 1),
  ];
  if (options.spent)
    logs.push(
      log(
        "NullifierSpent",
        [
          computeShieldedSpendNullifier(
            { ownerSecret: keys.ownerSecret, noteCommitment: commitment },
            scope,
          ),
        ],
        2,
      ),
    );
  const pool = {
    interface: iface,
    runner: {
      provider: {
        getNetwork: async () => ({ chainId: 31337n }),
        getBlock: async () => ({ hash: `0x${"aa".repeat(32)}` }),
        getLogs: async () => [...logs],
      },
    },
    getAddress: async () => context.poolAddress,
    protocolVersion: async () => 1n,
    currentShardId: async () => 0n,
    noteShard: async () => ({ size: 1n, root: tree.root }),
    nullifierCount: async () => (options.spent ? 1n : 0n),
  } as unknown as Contract;
  const actual = await vi.importActual<
    typeof import("../domains/inheritance/services/shieldedWalletRecovery")
  >("../domains/inheritance/services/shieldedWalletRecovery");
  mocks.recover.mockImplementation((_pool, input, scan) =>
    actual.recoverLocalShieldedWallet(pool, input, scan),
  );
  return commitment;
}

/** Words or Key open at once; only a re-signed root can remain an unconfirmed candidate. */
async function signatureCandidate(session: ShieldedAssetSession) {
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
  await session.call("restoreSignature", { signerAddress: wallet.address, signature, context });
  const { assetRoot } = await deriveShieldedAssetRootFromSignature({
    signerAddress: wallet.address,
    signature,
  });
  return { root: assetRoot, keys: await deriveShieldedAssetKeyMaterial(assetRoot.slice()) };
}

describe("ephemeral asset Worker funds lifecycle", () => {
  it("keeps VALUE recovery available when family records fail and restores parent versions on retry", async () => {
    const session = new ShieldedAssetSession();
    const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
    const emptyRecovery = mocks.recover.getMockImplementation()!;
    mocks.recover.mockImplementation(async (pool, input, options) =>
      input.keyMaterial.keyMode === 1
        ? recoveryHistory(keys.ownerCommitment)
        : emptyRecovery(pool, input, options),
    );
    await session.call("importRecoveryMaterial", {
      format: "shieldedKey",
      material: encodeShieldedAssetKey(fixedRoot),
      context,
    });
    const rootOnly = await session.call("recover", { context });
    expect(rootOnly.familyRecordsAvailable).toBeUndefined();
    expect(mocks.loadLineage).not.toHaveBeenCalled();

    await session.call("unlockIdentity", identityParams());
    mocks.loadLineage.mockRejectedValueOnce(new Error("private-lineage-error-sentinel"));
    const failed = await session.call("recover", { context });
    expect(failed.familyRecordsAvailable).toBe(false);
    expect(failed.notes).toMatchObject([{ slot: "asset", kind: "value", amount: "100" }]);
    expect(failed.parentVersions).toEqual([]);
    expect(failed.claims).toEqual([]);
    expect(failed.sessionState?.funds).toMatchObject({ recoveryVerified: true });
    expect(JSON.stringify(failed)).not.toContain("private-lineage-error-sentinel");
    assertPublic(failed);

    mocks.loadLineage.mockResolvedValueOnce({
      blockNumber: 12,
      versions: new Map([
        [
          session.state().identity!.personHash,
          [1, 3].map((versionIndex) => ({
            personHash: session.state().identity!.personHash,
            versionIndex,
            identityCommitment: 31n,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
          })),
        ],
      ]),
      trustedEndorsers: new Map(),
      endorsements: new Map(),
      endorsementTree: createLineageTree(),
      trustedTree: createLineageTree(),
    });
    const recovered = await session.call("recover", { context });
    expect(recovered.familyRecordsAvailable).toBe(true);
    expect(recovered.parentVersions).toEqual([3, 1]);
    expect(recovered.notes).toEqual(failed.notes);
    expect(mocks.loadLineage).toHaveBeenCalledTimes(2);
    assertPublic(recovered);
  });

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
    "runs the %s backup drill by clearing only the funds root, keeping the unlocked identity",
    async (format) => {
      const session = new ShieldedAssetSession();
      const identity = await session.call("unlockIdentity", identityParams());
      const created = await session.call("createFunds", {
        intent: "create",
        rootSource: "random",
        context,
      });
      const exported = await session.call("exportRecoveryMaterial", { format, context });
      const secretBytes = (session as unknown as { root: Uint8Array }).root;

      const cleared = await session.call("clearFunds", {});
      expect(secretBytes.every((byte) => byte === 0)).toBe(true);
      expect(cleared).toEqual({ identity: identity.identity, funds: null });
      await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow(
        "Unlock the existing funds root",
      );
      await expect(session.call("receiveCode", { slot: "asset" })).rejects.toThrow(
        "Restore the original funds",
      );

      // Manually re-entering the saved material completes the drill, even when the
      // original fingerprint is no longer at hand.
      const reentered = await session.call("importRecoveryMaterial", {
        format,
        material: exported.material,
        context,
      });
      expect(reentered.funds).toMatchObject({
        fundsFingerprint: created.funds!.fundsFingerprint,
        backupRequired: false,
        recoveryVerified: true,
        recoveryPath: format,
      });
      await session.call("clearFunds", {});

      const params = {
        format,
        material: exported.material,
        expectedFingerprint: exported.fundsFingerprint,
        context,
      };
      const verified = await session.call("importRecoveryMaterial", params);
      expect(params.material).toBe("");
      expect(verified.identity).toEqual(identity.identity);
      expect(verified.funds).toMatchObject({
        fundsFingerprint: created.funds!.fundsFingerprint,
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      // The identity unlocked before the drill proves the code without a second unlock.
      assertPublic(await session.call("receiveCode", { slot: "asset" }));
      expect(mocks.identity).toHaveBeenCalledOnce();
      assertPublic(cleared);
      assertPublic(verified);
    },
  );

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
      // Manually re-entering the exported words is the drill itself.
      const manual = new ShieldedAssetSession();
      const opened = await manual.call("importRecoveryMaterial", {
        format: "mnemonic",
        material: exportedWords.material,
        ...(hasOriginalFingerprint ? { expectedFingerprint: keys.fundsFingerprint } : {}),
        context,
      });
      expect(opened.funds).toMatchObject({
        backupRequired: false,
        recoveryVerified: true,
        recoveryPath: "mnemonic",
      });
    },
  );

  it("refuses to export an unknown re-signed candidate when pending fingerprints do not match", async () => {
    const session = new ShieldedAssetSession();
    const pendingBackupFingerprints = [`0x${"ff".repeat(32)}`];
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    await session.call("restoreSignature", {
      signerAddress: wallet.address,
      signature: await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address)),
      pendingBackupFingerprints,
      context,
    });
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
  });

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

  it("confirms a re-signed candidate from an authenticated independent budget only after the original identity is unlocked", async () => {
    const session = new ShieldedAssetSession();
    const { keys, root } = await signatureCandidate(session);
    const commitment = await authenticatedBudgetHistory(keys);

    const rootOnly = await session.call("recover", { context });
    expect(rootOnly.notes).toMatchObject([
      { commitment: String(commitment), kind: "budget", keyMode: 1, pendingIdentity: true },
    ]);
    expect(session.state().funds?.recoveryVerified).toBe(false);
    expect(rootOnly.claims).toEqual([]);
    await expect(
      session.call("exportRecoveryMaterial", { format: "shieldedKey", context }),
    ).rejects.toThrow();

    await session.call("unlockIdentity", identityParams());
    const authenticated = await session.call("recover", { context });
    expect(authenticated.notes).toMatchObject([
      { commitment: String(commitment), kind: "budget", keyMode: 1, pendingIdentity: false },
    ]);
    expect(authenticated.sessionState?.funds).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "history",
    });
    expect(authenticated.sessionState?.funds?.backupRequired).toBeFalsy();
    // Recovering ownership does not grant lineage eligibility or create a claim.
    expect(authenticated.claims).toEqual([]);
    expect(
      (await session.call("exportRecoveryMaterial", { format: "shieldedKey", context })).material,
    ).toBe(encodeShieldedAssetKey(root));
    assertPublic(authenticated);
  });

  it.each(["identity", "owner", "mode", "spent"] as const)(
    "does not confirm a candidate root from a budget with a mismatching %s or spent history",
    async (invalid) => {
      const session = new ShieldedAssetSession();
      const { keys } = await signatureCandidate(session);
      await session.call("unlockIdentity", identityParams());
      await authenticatedBudgetHistory(keys, {
        ...(invalid === "identity" ? { heirIdentity: 99n } : {}),
        ...(invalid === "owner" ? { heirOwner: keys.ownerCommitment + 1n } : {}),
        ...(invalid === "mode" ? { keyMode: 0n } : {}),
        ...(invalid === "spent" ? { spent: true } : {}),
      });
      const summary = await session.call("recover", { context });
      expect(summary.notes).toEqual([]);
      expect(session.state().funds?.recoveryVerified).toBe(false);
      expect(session.state().funds?.recoveryPath).toBeUndefined();
      await expect(
        session.call("exportRecoveryMaterial", { format: "shieldedKey", context }),
      ).rejects.toThrow();
      assertPublic(summary);
    },
  );

  it.each(["random", "walletSignature"] as const)(
    "never uses authenticated budget history to skip a new %s root's required backup verification",
    async (rootSource) => {
      const session = new ShieldedAssetSession();
      await session.call("unlockIdentity", identityParams());
      const signer = new Wallet(`0x${"11".repeat(32)}`);
      await session.call("createFunds", {
        intent: "create",
        rootSource,
        ...(rootSource === "walletSignature"
          ? {
              signerAddress: signer.address,
              signature: await signer.signMessage(buildShieldedAssetSigningMessage(signer.address)),
            }
          : {}),
        context,
      });
      const backup = await session.call("exportRecoveryMaterial", {
        format: "shieldedKey",
        context,
      });
      const keys = await deriveShieldedAssetKeyMaterial(getBytes(backup.material));
      await authenticatedBudgetHistory(keys);
      const summary = await session.call("recover", { context });
      expect(summary.notes).toMatchObject([{ kind: "budget", keyMode: 1, pendingIdentity: false }]);
      expect(summary.sessionState?.funds).toMatchObject({
        recoveryVerified: false,
        backupRequired: true,
      });
      await expect(session.call("receiveCode", { slot: "asset" })).rejects.toThrow(
        "Verify recovery",
      );
      assertPublic(summary);
    },
  );

  it.each(["mnemonic", "shieldedKey"] as const)(
    "opens a %s restore at once, since the entered material is the backup",
    async (format) => {
      const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
      const material =
        format === "mnemonic"
          ? encodeShieldedAssetMnemonic(fixedRoot)
          : encodeShieldedAssetKey(fixedRoot);
      const session = new ShieldedAssetSession();
      const params = { format, material, context };
      const restored = await session.call("importRecoveryMaterial", params);
      expect(params.material).toBe("");
      expect(restored.funds).toMatchObject({
        fundsFingerprint: keys.fundsFingerprint,
        rootSource: "imported",
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      expect(restored.funds?.signerAddress).toBeUndefined();
      // An empty scan neither blocks nor downgrades it.
      await session.call("recover", { context });
      expect(session.state().funds).toMatchObject({ recoveryVerified: true, recoveryPath: format });
      expect((await session.call("exportRecoveryMaterial", { format, context })).material).toBe(
        material,
      );
      await session.call("unlockIdentity", identityParams());
      assertPublic(await session.call("receiveCode", { slot: "asset" }));
      assertPublic(session.state());
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

  it("keeps a re-signed candidate pending on empty or insufficient history and confirms it from owned positive VALUE", async () => {
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
      await expect(
        session.call("exportRecoveryMaterial", { format: "shieldedKey", context }),
      ).rejects.toThrow();
    }
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

  describe("factory discovery", () => {
    const otherPool = { name: "other-verified-pool" } as unknown as Contract;
    const unverifiedPool = { name: "unverified-pool" } as unknown as Contract;
    const discovered = (blockHash = `0x${"aa".repeat(32)}`) => ({
      chainId: 31337n,
      toBlock: 12,
      blockHash,
      enumerationComplete: true,
      pools: [
        {
          assetAddress: "0x7777777777777777777777777777777777777777",
          poolAddress: "0x8888888888888888888888888888888888888888",
          creationEventBlock: 5,
          pool: otherPool,
          poolDeploymentBlock: 5,
          configurationVerified: true,
        },
        {
          assetAddress: "0x9999999999999999999999999999999999999999",
          poolAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          creationEventBlock: 6,
          pool: unverifiedPool,
          poolDeploymentBlock: 6,
          configurationVerified: false,
        },
      ],
    });
    async function candidateSession() {
      const session = new ShieldedAssetSession();
      return { session, ...(await signatureCandidate(session)) };
    }

    it("confirms a candidate root from positive VALUE in another verified factory pool", async () => {
      const { session, keys, root } = await candidateSession();
      await session.call("recover", { context });
      expect(session.state().funds?.recoveryVerified).toBe(false);
      mocks.discoverPools.mockResolvedValue(discovered());
      mocks.recover.mockImplementation(async (pool) =>
        pool === otherPool
          ? recoveryHistory(keys.ownerCommitment)
          : recoveryHistory(keys.ownerCommitment, { amount: 0n }),
      );
      const result = await session.call("discover", { context });
      expect(result.complete).toBe(false);
      expect(result.pools).toMatchObject([
        { status: "recovered", rawValueBalance: "100", rawBudgetBalance: "0" },
        { status: "failed" },
      ]);
      expect(result.sessionState?.funds).toMatchObject({
        recoveryVerified: true,
        recoveryPath: "history",
      });
      // The unverified pool is never scanned, so its history cannot confirm anything.
      expect(mocks.recover.mock.calls.some(([pool]) => pool === unverifiedPool)).toBe(false);
      expect(
        (await session.call("exportRecoveryMaterial", { format: "shieldedKey", context })).material,
      ).toBe(encodeShieldedAssetKey(root));
      assertPublic(result);
    });

    it.each(["zeroValue", "reorganized"] as const)(
      "keeps the candidate unconfirmed after discovery with %s history",
      async (failure) => {
        const { session, keys } = await candidateSession();
        mocks.discoverPools.mockResolvedValue(
          discovered(failure === "reorganized" ? `0x${"bb".repeat(32)}` : undefined),
        );
        mocks.recover.mockResolvedValue(
          recoveryHistory(keys.ownerCommitment, failure === "zeroValue" ? { amount: 0n } : {}),
        );
        const discovery = session.call("discover", { context });
        if (failure === "reorganized") await expect(discovery).rejects.toThrow("reorganized");
        else expect((await discovery).sessionState?.funds?.recoveryVerified).toBe(false);
        expect(session.state().funds).toMatchObject({ recoveryVerified: false });
        expect(session.state().funds?.recoveryPath).toBeUndefined();
      },
    );
  });

  describe("pool changes", () => {
    const otherPoolContext: ShieldedWorkerContext = {
      ...context,
      poolAddress: "0x6666666666666666666666666666666666666666",
      poolDeploymentBlock: 4,
    };
    const internals = (session: ShieldedAssetSession) =>
      session as unknown as { summary: unknown; wallets: Map<string, unknown> };

    it("keeps identity and the funds root but drops the previous pool's history", async () => {
      const session = new ShieldedAssetSession();
      const keys = await deriveShieldedAssetKeyMaterial(fixedRoot);
      await session.call("unlockIdentity", identityParams());
      await session.call("importRecoveryMaterial", {
        format: "shieldedKey",
        material: encodeShieldedAssetKey(fixedRoot),
        expectedFingerprint: keys.fundsFingerprint,
        context,
      });
      await session.call("recover", { context });
      expect(internals(session).summary).not.toBeNull();
      const before = session.state();

      mocks.canonicalPool = otherPoolContext.poolAddress;
      const exported = await session.call("exportRecoveryMaterial", {
        format: "shieldedKey",
        context: otherPoolContext,
      });
      expect(exported.material).toBe(encodeShieldedAssetKey(fixedRoot));
      expect(internals(session).summary).toBeNull();
      expect(internals(session).wallets.size).toBe(0);
      expect(session.state()).toEqual(before);
      assertPublic(await session.call("receiveCode", { slot: "asset" }));
      const summary = await session.call("recover", { context: otherPoolContext });
      expect(summary.sessionState).toEqual(before);
      expect(mocks.identity).toHaveBeenCalledOnce();
    });

    it("rejects another factory scope or an unverified pool without dropping the current pool", async () => {
      const session = new ShieldedAssetSession();
      await session.call("unlockIdentity", identityParams());
      await session.call("recover", { context });
      const summary = internals(session).summary;
      await expect(
        session.call("recover", {
          context: { ...context, factoryAddress: "0x7777777777777777777777777777777777777777" },
        }),
      ).rejects.toThrow("Protocol context changed");
      // The factory reports a different canonical pool for this asset.
      await expect(session.call("recover", { context: otherPoolContext })).rejects.toThrow(
        "Pool does not belong",
      );
      expect(internals(session).summary).toBe(summary);
      expect(session.state().identity).not.toBeNull();
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
