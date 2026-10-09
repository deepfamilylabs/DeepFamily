import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveShieldedHeirKeyMaterial } from "@deepfamily/protocol-core";
import { ShieldedAssetSession } from "./shieldedAssetSession";
import type { ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  proof: vi.fn(),
  verify: vi.fn(),
  recover: vi.fn(),
  getBlock: vi.fn(),
  selectedQuery: vi.fn(),
  transfer: vi.fn(),
  notes: [] as Array<{
    commitment: bigint;
    note: { kind: "value"; amount: bigint; ownerCommitment: bigint };
  }>,
  lineage: "0x1111111111111111111111111111111111111111",
  verifier: "0x2222222222222222222222222222222222222222",
  pool: "0x3333333333333333333333333333333333333333",
}));
vi.mock("ethers", async (original) => ({
  ...(await original<typeof import("ethers")>()),
  JsonRpcProvider: class {
    getNetwork = async () => ({ chainId: 31337n });
    getBlockNumber = async () => 12;
    getBlock = mocks.getBlock;
  },
}));
vi.mock("@deepfamily/protocol-core", async (original) => ({
  ...(await original<typeof import("@deepfamily/protocol-core")>()),
  deriveIdentityMaterial: async ({ identity }: { identity: object }) => ({
    identity,
    identitySuiteId: 1,
    derivedSecretField: 13n,
    nameField: 17n,
    packedBirthGenderField: 19n,
    suiteCommitment: 23n,
    nameSecretCommitment: 29n,
    identityCommitment: 31n,
    personHash: `0x${"00".repeat(31)}1f`,
    identitySalt: new Uint8Array(16),
    derivedSecretBytes: new Uint8Array(32),
  }),
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({ lineageIndex: async () => mocks.lineage }),
  createLineageIndexContract: () => ({ root: async () => 0n }),
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
    nullifierSpent: mocks.selectedQuery,
  }),
}));
vi.mock("../shared/zk/shieldedReceiveCode", () => ({
  createShieldedReceiveCode: vi.fn(),
  verifyShieldedReceiveCode: mocks.verify,
}));
vi.mock("../shared/zk/shieldedZk", () => ({ generateShieldedProof: mocks.proof }));
vi.mock("../domains/inheritance/services/shieldedPoolChain", async (original) => ({
  ...(await original<typeof import("../domains/inheritance/services/shieldedPoolChain")>()),
  loadShieldedPoolSnapshot: mocks.scan,
}));
vi.mock("../domains/inheritance/services/shieldedWalletRecovery", async (original) => ({
  ...(await original<typeof import("../domains/inheritance/services/shieldedWalletRecovery")>()),
  recoverLocalShieldedWallet: mocks.recover,
}));
vi.mock("../domains/inheritance/services/shieldedTransferExitPreparation", () => ({
  prepareShieldedPrivateTransfer: mocks.transfer,
  prepareShieldedUnshield: vi.fn(),
}));
vi.mock("../domains/inheritance/services/inheritanceChain", () => ({
  loadLineageSnapshot: async () => null,
  findHeirLegitimacy: () => [],
}));
const blockHash = `0x${"aa".repeat(32)}`;
const context: ShieldedWorkerContext = {
  rpcUrl: "http://localhost:8545",
  chainId: "31337",
  factoryAddress: "0x4444444444444444444444444444444444444444",
  factoryDeploymentBlock: 3,
  familyAddress: "0x5555555555555555555555555555555555555555",
  lineageIndexAddress: mocks.lineage,
  poolAddress: mocks.pool,
  poolDeploymentBlock: 2,
  assetKind: "native",
};
const secretKeys = deriveShieldedHeirKeyMaterial(13n);
function assertNoOpenings(value: unknown) {
  const serialized = JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? String(entry) : entry,
  );
  for (const secret of [
    "assetRoot",
    "ownerSecret",
    "hpkeIkm",
    "derivedSecretField",
    "rawPassphrase",
    "policySalt",
    "enrollmentSalt",
    "witness",
    String(secretKeys.ownerSecret),
    secretKeys.hpkeIkm,
  ])
    expect(serialized).not.toContain(secret);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.notes = [];
  mocks.transfer.mockResolvedValue({
    witness: {},
    outputs: [{ note: { amount: 10n } }, { note: { amount: 0n } }],
    data: {
      fundMode: 0n,
      budgetKind: 0n,
      inputShardIds: [0n, 0n],
      inputRoots: [17n, 17n],
      inputNullifiers: [51n, 52n],
      periodNullifiers: Array(12).fill(0n),
      outputCommitments: [61n, 62n],
      outputCiphertexts: [`0x${"00".repeat(512)}`, `0x${"00".repeat(512)}`],
      relation0: 0n,
      relation1: 0n,
      asOf: 0n,
    },
  });
  mocks.getBlock.mockResolvedValue({ number: 12, hash: blockHash, timestamp: 1000 });
  mocks.scan.mockResolvedValue({ blockHash, spentNullifiers: new Set() });
  mocks.proof.mockResolvedValue({
    proof: {
      pi_a: ["1", "2", "1"],
      pi_b: [
        ["1", "2"],
        ["3", "4"],
        ["1", "0"],
      ],
      pi_c: ["1", "2", "1"],
      protocol: "groth16",
      curve: "bn128",
    },
  });
  mocks.recover.mockImplementation(async (_pool, input, options) => ({
    poolAddress: context.poolAddress,
    chainId: 31337n,
    toBlock: options.toBlock,
    blockHash,
    shards: new Map(),
    ownedNotes: new Map(mocks.notes.map((note) => [note.commitment, note])),
    spentNullifiers: new Set(),
    walletOwnerCommitment: input.keyMaterial.ownerCommitment,
    walletIdentityCommitment: input.identityCommitment,
    walletKeyMode: input.keyMaterial.keyMode,
    pendingIdentityBudgets: new Map(),
    fundingTemplates: new Map(),
    shieldedPolicies: new Map(),
  }));
});
async function unlocked() {
  const session = new ShieldedAssetSession();
  await session.call("unlockIdentity", {
    identity: {
      fullName: "Parent Example",
      gender: 1,
      birthYear: 1970,
      birthMonth: 1,
      birthDay: 1,
      isBirthBC: false,
    },
    rawPassphrase: "correct-identity-password",
  });
  return session;
}
describe("asset Worker preview and proof boundary", () => {
  it("returns no openings and checks complete anchored history without selected-nullifier RPCs", async () => {
    const session = await unlocked();
    const preview = await session.call("preview", {
      context,
      slot: "identity",
      action: "shield",
      amount: "10",
    });
    assertNoOpenings(preview);
    const proven = await session.call("prove", { context, handle: preview.handle });
    assertNoOpenings(proven);
    expect(mocks.scan).toHaveBeenCalledWith(expect.anything(), expect.any(Function), {
      fromBlock: 2,
      toBlock: 12,
    });
    expect(mocks.selectedQuery).not.toHaveBeenCalled();
    expect(mocks.proof.mock.calls[0][0].witness.ownerSecret).toBe(String(secretKeys.ownerSecret));
    await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
      "expired",
    );
  });
  it("rejects reorganized and incomplete history before proof generation", async () => {
    const session = await unlocked();
    const preview = await session.call("preview", {
      context,
      slot: "identity",
      action: "shield",
      amount: "10",
    });
    mocks.getBlock.mockResolvedValueOnce({ hash: `0x${"bb".repeat(32)}` });
    await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
      "reorganized",
    );
    mocks.scan.mockRejectedValueOnce(new Error("Shielded pool nullifier history is incomplete"));
    await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
      "incomplete",
    );
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(mocks.selectedQuery).not.toHaveBeenCalled();
  });
  it("discards a late proof when the secret session is locked", async () => {
    const session = await unlocked();
    const preview = await session.call("preview", {
      context,
      slot: "identity",
      action: "shield",
      amount: "10",
    });
    let release!: (value: { proof: object }) => void;
    mocks.proof.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = session.call("prove", { context, handle: preview.handle });
    await vi.waitFor(() => expect(mocks.proof).toHaveBeenCalledOnce());
    session.clear();
    release({ proof: {} });
    await expect(pending).rejects.toThrow("replaced or locked");
  });
  it("checks the current complete receiving-code fingerprint before selecting any fund input", async () => {
    const session = await unlocked();
    mocks.verify.mockResolvedValue({
      ok: true,
      fingerprint: "current-code",
      identityCommitment: "31",
      personHash: `0x${"00".repeat(31)}1f`,
      ownerCommitment: String(secretKeys.ownerCommitment),
      keyMode: 1,
      viewingKey: `0x${"01".repeat(32)}`,
    });
    await expect(
      session.call("preview", {
        context,
        slot: "identity",
        action: "fund",
        fundingEntry: "privateIndependent",
        amount: "100",
        periods: "1",
        periodDays: "30",
        rootVersionIndex: 1,
        publicRecipient: `0x${"00".repeat(31)}1f`,
        recipientCode: "code",
        recipientFingerprint: "previous-code",
        candidates: ["1"],
      }),
    ).rejects.toThrow("fingerprint");
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it("keeps a fresh funding policy handle stable across consolidation previews and checks input spends locally", async () => {
    const session = await unlocked();
    mocks.notes = [1n, 2n].map((commitment) => ({
      commitment,
      note: { kind: "value", amount: 5n, ownerCommitment: secretKeys.ownerCommitment },
    }));
    const request = {
      context,
      slot: "identity" as const,
      action: "fund" as const,
      fundingEntry: "public" as const,
      amount: "10",
      periods: "1",
      periodDays: "30",
      rootVersionIndex: 1,
      publicRecipient: `0x${"00".repeat(31)}1f`,
      candidates: ["1", "2"],
    };
    const first = await session.call("preview", request);
    expect(first.action).toBe("privateTransfer");
    expect(first.steps.map((step) => step.action)).toEqual(["privateTransfer", "fund"]);
    expect(first.inputs).toEqual(["1", "2"]);
    assertNoOpenings(first);
    const second = await session.call("preview", { ...request, policyHandle: first.policyHandle });
    expect(second.policyHandle).toBe(first.policyHandle);
    mocks.scan.mockResolvedValueOnce({ blockHash, spentNullifiers: new Set([51n]) });
    await expect(session.call("prove", { context, handle: second.handle })).rejects.toThrow(
      "spent after preview",
    );
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(mocks.selectedQuery).not.toHaveBeenCalled();
  });
  it("rejects the final transfer destination before making a preparatory merge", async () => {
    const session = await unlocked();
    mocks.verify.mockResolvedValue({
      ok: true,
      fingerprint: "current",
      personHash: `0x${"00".repeat(31)}1f`,
      identityCommitment: "31",
      ownerCommitment: "53",
      keyMode: 1,
      viewingKey: `0x${"01".repeat(32)}`,
    });
    await expect(
      session.call("preview", {
        context,
        slot: "identity",
        action: "privateTransfer",
        amount: "10",
        candidates: ["1", "2"],
        recipientCode: "new-code",
        recipientFingerprint: "old",
      }),
    ).rejects.toThrow("fingerprint");
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
});
