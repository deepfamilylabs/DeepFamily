import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedHeirKeyMaterial,
  encodeShieldedIndependentKey,
  encodePublicShieldedBudgetEnvelope,
} from "@deepfamily/protocol-core";
import { getAddress, hexlify } from "ethers";
import { ShieldedAssetSession } from "./shieldedAssetSession";
import type { ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  proof: vi.fn(),
  receipt: vi.fn(),
  verify: vi.fn(),
  recover: vi.fn(),
  getBlock: vi.fn(),
  selectedQuery: vi.fn(),
  transfer: vi.fn(),
  unshield: vi.fn(),
  fund: vi.fn(),
  claim: vi.fn(),
  lineageRoot: vi.fn(),
  knownCheckpoint: vi.fn(),
  proofLifetime: vi.fn(),
  fundingDestination: vi.fn(),
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
  decodeShieldedReceiveCredential: () => ({ disclosure: "anonymous", authorizationAlias: 17n, authorizationCounter: 0n, expiresAt: 2000000000n,
    ownerCommitment: 29n, viewingKey: `0x${"01".repeat(32)}`, keyMode: 0, identitySuiteId: 1, independentKeySuiteId: 1, independentKeyDerivationVersion: 1,
    proof: { protocol: "groth16", curve: "bn128", pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["1", "2", "1"] } }),
  deriveShieldedIndependentKeyIdentitySecret: async () => new Uint8Array(32).fill(3),
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
  createLineageIndexContract: () => ({ root: mocks.lineageRoot, isKnownCheckpoint: mocks.knownCheckpoint }),
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
    ACTION_PROOF_LIFETIME: mocks.proofLifetime,
    AUTHORIZATION_STATE: async () => mocks.verifier,
    nullifierSpent: mocks.selectedQuery,
  }),
}));
vi.mock("../shared/zk/shieldedReceivePresentation", () => ({ proveShieldedReceivePresentation: mocks.receipt }));
vi.mock("../domains/inheritance/services/shieldedIdentityAuthorizationChain", () => ({
  createIdentityAuthorizationContract: () => ({}),
  loadShieldedIdentityAuthorizationState: async () => {
    const { buildShieldedIdentityAuthorizationState } = await import("@deepfamily/protocol-core");
    return { state: buildShieldedIdentityAuthorizationState(), checkpointId: 1n, asOf: 1000n, blockNumber: 12 };
  },
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
  prepareShieldedUnshield: mocks.unshield,
}));
vi.mock("../domains/inheritance/services/shieldedClaimPreparation", () => ({
  prepareShieldedClaim: mocks.claim,
}));
vi.mock("../domains/inheritance/services/shieldedFundingPreparation", async (original) => ({
  ...(await original<
    typeof import("../domains/inheritance/services/shieldedFundingPreparation")
  >()),
  prepareShieldedFund: mocks.fund,
  validateShieldedFundingDestination: mocks.fundingDestination,
}));
vi.mock("../domains/inheritance/services/inheritanceChain", () => ({
  loadLineageSnapshot: async () => ({ timestamp: 1000n, checkpointId: 7n, versions: new Map(), endorsements: new Map(), trustedEndorsers: new Map() }),
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
const fixedRoot = new Uint8Array(32).fill(41);
const independentKeyMaterial = await deriveShieldedIndependentKeyMaterial({
  independentKeyRoot: fixedRoot,
  independentKeyIdentitySecret: new Uint8Array(32).fill(3),
});
function preparedValueOutputs(amounts: bigint[], offset = 0n, capacity = 8) {
  return {
    witness: {},
    outputs: amounts.map((amount) => ({ note: { amount } })),
    data: {
      fundMode: 0n,
      budgetKind: 0n,
      inputShardIds: Array(capacity).fill(0n),
      inputRoots: Array(capacity).fill(17n),
      inputNullifiers: Array.from({ length: capacity }, (_, index) => BigInt(51 + index)),
      periodNullifiers: Array(12).fill(0n),
      outputCommitments: [61n + offset, 62n + offset],
      outputCiphertexts: [`0x${"00".repeat(512)}`, `0x${"00".repeat(512)}`],
      relation0: 0n,
      relation1: 0n,
      asOf: 0n,
      lineageCheckpointId: 0n,
    },
  };
}
function preparedPublicFundOutputs(amounts: bigint[]) {
  const prepared = preparedValueOutputs(amounts, 0n, 2);
  prepared.data.budgetKind = 1n;
  prepared.data.outputCiphertexts[0] = hexlify(encodePublicShieldedBudgetEnvelope({
    binding: "identity", rootIdentityCommitment: 31n, rootVersionIndex: 1n, heirIdentityCommitment: 31n,
    amountPerPeriod: amounts[0], periodDays: 30n, eligibleFrom: 1000n, policyCommitment: 101n,
    enrollmentCommitment: 102n, remaining: amounts[0], nonce: 103n,
  }, { chainId: context.chainId, poolAddress: context.poolAddress }));
  return prepared;
}
function assertNoOpenings(value: unknown) {
  const serialized = JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? String(entry) : entry,
  );
  for (const secret of [
    "independentKeyRoot",
    "ownerSecret",
    "hpkeIkm",
    "derivedSecretField",
    "rawPassphrase",
    "policySalt",
    "enrollmentSalt",
    "witness",
    String(secretKeys.ownerSecret),
    secretKeys.hpkeIkm,
    String(independentKeyMaterial.ownerSecret),
    independentKeyMaterial.hpkeIkm,
  ])
    expect(serialized).not.toContain(secret);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pool = context.poolAddress;
  mocks.notes = [];
  mocks.transfer.mockImplementation(async ({ destinations }) =>
    preparedValueOutputs(
      destinations.map((destination: { amount: bigint }) => BigInt(destination.amount)),
      BigInt((mocks.transfer.mock.calls.length - 1) * 2),
    ),
  );
  mocks.unshield.mockImplementation(async ({ amount, recipient }) => ({
    ...preparedValueOutputs([0n, 0n]),
    amount: BigInt(amount),
    recipient,
  }));
  const publicFund = preparedPublicFundOutputs([10n, 0n]);
  mocks.fund.mockResolvedValue(publicFund);
  mocks.receipt.mockResolvedValue({ proof: "0x1234", publicSignals: [] });
  mocks.lineageRoot.mockResolvedValue(0n);
  mocks.knownCheckpoint.mockResolvedValue(true);
  mocks.proofLifetime.mockResolvedValue(300n);
  mocks.fundingDestination.mockResolvedValue(undefined);
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
    ownedNotes: new Map(
      mocks.notes
        .filter((note) => note.note.ownerCommitment === input.keyMaterial.ownerCommitment)
        .map((note) => [note.commitment, note]),
    ),
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
async function withBothOwners() {
  const session = await unlocked();
  await session.call("importRecoveryMaterial", {
    expectedCredentialsHandle: session.state().credentials!.handle,
    format: "shieldedKey",
    material: encodeShieldedIndependentKey(fixedRoot),
    expectedFingerprint: independentKeyMaterial.keyFingerprint,
    context,
  });
  return session;
}
function value(commitment: bigint, amount: bigint, ownerCommitment: bigint) {
  return { commitment, note: { kind: "value" as const, amount, ownerCommitment } };
}
async function timeBoundPreview(action: "fund" | "claim") {
  const session = await unlocked();
  const prepared = action === "fund" ? preparedPublicFundOutputs([10n, 0n]) : preparedValueOutputs([10n, 0n], 0n, 2);
  prepared.data.asOf = 1000n;
  prepared.data.lineageCheckpointId = 7n;
  if (action === "fund") {
    mocks.notes = [value(1n, 10n, secretKeys.ownerCommitment)];
    mocks.fund.mockResolvedValue(prepared);
  } else {
    prepared.data.periodNullifiers[0] = 91n;
    mocks.claim.mockResolvedValue({ ...prepared, amount: 10n });
    // Claim eligibility and witness construction have dedicated integration tests.
    // Supply their public summary while retaining the real recovered wallet/session.
    const recover = session.recover.bind(session);
    vi.spyOn(session, "recover").mockImplementation(async (params) => ({
      ...(await recover(params)),
      claims: [{
        handle: "identity:budget",
        slot: "identity",
        budgets: ["1"],
        periodIndices: ["0"],
        amount: "10",
        amountPerPeriod: "10",
        status: "ready",
      }],
    }));
  }
  const request = {
    context,
    slot: "identity" as const,
    action,
    amount: "10",
    fundingEntry: "public" as const,
    periods: "1",
    periodDays: "30",
    rootVersionIndex: 1,
    publicRecipient: `0x${"00".repeat(31)}1f`,
    candidates: ["1"],
    claimHandle: "identity:budget",
  };
  return { session, prepared, request, preview: await session.call("preview", request) };
}
describe("asset Worker preview and proof boundary", () => {
  describe.each(["privateTransfer", "unshield"] as const)("exact balance selection for %s", (action) => {
    it.each([true, false])("uses only permitted inputs when the exact pair is allowed: %s", async (allowPair) => {
      const session = await unlocked();
      mocks.notes = [
        value(1n, 1n, secretKeys.ownerCommitment),
        value(2n, 2n, secretKeys.ownerCommitment),
        value(3n, 10n, secretKeys.ownerCommitment),
      ];
      mocks.verify.mockResolvedValue({
        ok: true,
        fingerprint: "verified-destination",
        identityCommitment: "31",
        personHash: `0x${"00".repeat(31)}1f`,
        ownerCommitment: String(secretKeys.ownerCommitment),
        keyMode: 0,
        viewingKey: `0x${"01".repeat(32)}`,
      });
      const preview = await session.call("preview", {
        context,
        slot: "identity",
        action,
        amount: "3",
        candidates: allowPair ? ["1", "2", "3"] : ["3"],
        ...(action === "privateTransfer"
          ? { recipientCode: "verified-code" }
          : { publicRecipient: context.familyAddress }),
      });
      expect(preview.action).toBe(action);
      expect([...preview.inputs].sort()).toEqual(allowPair ? ["1", "2"] : ["3"]);
      expect(preview.inputAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n)).toBe(allowPair ? 3n : 10n);
      expect(preview.steps).toEqual([{
        action,
        inputs: preview.inputs,
        outputAmounts: ["3", allowPair ? "0" : "7"],
      }]);
      const preparation = action === "privateTransfer" ? mocks.transfer : mocks.unshield;
      expect(preparation).toHaveBeenCalledOnce();
      expect(preparation.mock.calls[0][0].inputs.map((input: { commitment: string }) => input.commitment)).toEqual(preview.inputs);
      if (action === "privateTransfer") {
        expect(mocks.unshield).not.toHaveBeenCalled();
        expect(preparation.mock.calls[0][0].destinations).toMatchObject([
          { kind: "recipient", amount: 3n },
          { kind: "inputOwner", amount: allowPair ? 0n : 7n },
        ]);
      } else {
        expect(mocks.transfer).not.toHaveBeenCalled();
        expect(preparation.mock.calls[0][0]).toMatchObject({ amount: 3n, recipient: context.familyAddress });
      }
      assertNoOpenings(preview);
      const proven = await session.call("prove", { context, handle: preview.handle });
      expect(proven.action).toBe(action);
      expect(preparation).toHaveBeenCalledOnce();
      expect(mocks.proof).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ circuit: action }));
    });
  });

  it("keeps funding to one donor input instead of merging an exact pair", async () => {
    const session = await unlocked();
    mocks.notes = [
      value(1n, 1n, secretKeys.ownerCommitment),
      value(2n, 2n, secretKeys.ownerCommitment),
      value(3n, 10n, secretKeys.ownerCommitment),
    ];
    const publicFund = preparedPublicFundOutputs([3n, 7n]);
    mocks.fund.mockResolvedValueOnce(publicFund);
    const preview = await session.call("preview", {
      context,
      slot: "identity",
      action: "fund",
      fundingEntry: "public",
      amount: "3",
      periods: "1",
      periodDays: "30",
      rootVersionIndex: 1,
      publicRecipient: `0x${"00".repeat(31)}1f`,
      candidates: ["1", "2", "3"],
    });
    expect(preview.action).toBe("fund");
    expect(preview.inputs).toEqual(["3"]);
    expect(preview.steps).toEqual([{ action: "fund", inputs: ["3"], outputAmounts: ["3", "7"] }]);
    expect(mocks.fund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ donorCommitment: "3" }));
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  describe.each(["fund", "claim"] as const)("time-bound %s", (action) => {
    it("rejects an expired checkpoint without rebuilding the approved plan", async () => {
      const { session, preview } = await timeBoundPreview(action);
      mocks.knownCheckpoint.mockResolvedValue(false);
      await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
        "Family eligibility snapshot expired after preview",
      );
      expect(mocks.proof).not.toHaveBeenCalled();
      expect(action === "fund" ? mocks.fund : mocks.claim).toHaveBeenCalledOnce();
      expect(mocks.knownCheckpoint).toHaveBeenCalledWith(7n, 0n, 0n, 1000n, { blockTag: 12 });
    });

    it("reuses its prepared proof inputs after unrelated roots change within the checkpoint window", async () => {
      const { session, preview } = await timeBoundPreview(action);
      mocks.lineageRoot.mockResolvedValue(999n);
      const proven = await session.call("prove", { context, handle: preview.handle });
      expect(proven.data).toMatchObject({ lineageCheckpointId: 7n, asOf: 1000n });
      expect(mocks.knownCheckpoint).toHaveBeenCalledWith(7n, 0n, 0n, 1000n, { blockTag: 12 });
      expect(mocks.lineageRoot).not.toHaveBeenCalled();
      expect(mocks.proof).toHaveBeenCalledOnce();
    });

    it.each([
      ["expired", 1300, blockHash],
      ["future", 999, blockHash],
      ["different history anchor", 1000, `0x${"bb".repeat(32)}`],
    ])("rejects a %s preview before generating a proof", async (_reason, timestamp, hash) => {
      const { session, preview } = await timeBoundPreview(action);
      mocks.getBlock
        .mockResolvedValueOnce({ number: 12, hash: blockHash, timestamp: 1000 })
        .mockResolvedValueOnce({ number: 12, hash, timestamp });
      await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
        "time-bound proof preview expired",
      );
      expect(mocks.proof).not.toHaveBeenCalled();
      expect(mocks.lineageRoot).not.toHaveBeenCalled();
    });

    it("requires a fresh preview after expiry and binds it to the replacement snapshot", async () => {
      const { session, preview, prepared, request } = await timeBoundPreview(action);
      mocks.knownCheckpoint.mockResolvedValue(false);
      await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
        "Family eligibility snapshot expired after preview",
      );
      mocks.knownCheckpoint.mockResolvedValue(true);
      prepared.data.lineageCheckpointId = 8n;
      prepared.data.relation0 = 7n;
      prepared.data.relation1 = 7n;
      const fresh = await session.call("preview", request);
      expect(fresh.handle).not.toBe(preview.handle);
      await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow("expired");
      const proven = await session.call("prove", { context, handle: fresh.handle });
      expect(proven.data).toMatchObject({ relation0: 7n, relation1: 7n, asOf: 1000n });
      expect(mocks.proof).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        circuit: action,
        expectedPublicSignals: expect.arrayContaining(["7", "1000"]),
      }));
      expect(mocks.proofLifetime).toHaveBeenCalledWith({ blockTag: 12 });
      expect(action === "fund" ? mocks.fund : mocks.claim).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects a claim period spent after preview using the full history", async () => {
    const { session, preview } = await timeBoundPreview("claim");
    mocks.scan.mockResolvedValueOnce({ blockHash, spentNullifiers: new Set([91n]) });
    await expect(session.call("prove", { context, handle: preview.handle })).rejects.toThrow(
      "claim period was used after preview",
    );
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(mocks.selectedQuery).not.toHaveBeenCalled();
  });

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
  it("checks the receiving code's child before selecting any fund input", async () => {
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
        publicRecipient: `0x${"00".repeat(31)}2f`,
        recipientCode: "code",
        candidates: ["1"],
      }),
    ).rejects.toThrow("does not match the selected child");
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
    mocks.verify.mockResolvedValue({ ok: false });
    await expect(
      session.call("preview", {
        context,
        slot: "identity",
        action: "privateTransfer",
        amount: "10",
        candidates: ["1", "2"],
        recipientCode: "new-code",
      }),
    ).rejects.toThrow("receiving code");
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it.each(["unshield", "privateTransfer", "fund"] as const)(
    "does not borrow independent-key balance for an explicitly selected identity %s",
    async (action) => {
      const session = await withBothOwners();
      mocks.notes = [
        value(1n, 4n, secretKeys.ownerCommitment),
        value(2n, 10n, independentKeyMaterial.ownerCommitment),
      ];
      mocks.verify.mockResolvedValue({
        ok: true,
        fingerprint: "verified-destination",
        identityCommitment: "31",
        personHash: `0x${"00".repeat(31)}1f`,
        ownerCommitment: String(secretKeys.ownerCommitment),
        keyMode: 0,
        viewingKey: `0x${"01".repeat(32)}`,
      });
      const request = {
        context,
        slot: "identity" as const,
        action,
        amount: "8",
        fundingEntry: "public" as const,
        periods: "1",
        periodDays: "30",
        rootVersionIndex: 1,
        publicRecipient: action === "fund" ? `0x${"00".repeat(31)}1f` : context.familyAddress,
        ...(action === "privateTransfer" ? { recipientCode: "verified-code" } : {}),
        candidates: ["1"],
      };
      await expect(session.call("preview", request)).rejects.toThrow("Insufficient candidate");
      await expect(session.call("preview", { ...request, candidates: ["2"] })).rejects.toThrow(
        "candidate is unavailable",
      );
      expect(mocks.transfer).not.toHaveBeenCalled();
      expect(mocks.unshield).not.toHaveBeenCalled();
      expect(mocks.fund).not.toHaveBeenCalled();
    },
  );

  it.each(["unshield", "privateTransfer", "fund"] as const)(
    "rejects mixed-owner candidates for an explicitly selected identity %s",
    async (action) => {
      const session = await withBothOwners();
      mocks.notes = [
        value(1n, 10n, secretKeys.ownerCommitment),
        value(2n, 10n, independentKeyMaterial.ownerCommitment),
      ];
      mocks.verify.mockResolvedValue({
        ok: true,
        fingerprint: "verified-destination",
        identityCommitment: "31",
        personHash: `0x${"00".repeat(31)}1f`,
        ownerCommitment: String(secretKeys.ownerCommitment),
        keyMode: 0,
        viewingKey: `0x${"01".repeat(32)}`,
      });
      await expect(
        session.call("preview", {
          context,
          slot: "identity",
          action,
          amount: "8",
          fundingEntry: "public",
          periods: "1",
          periodDays: "30",
          rootVersionIndex: 1,
          publicRecipient: action === "fund" ? `0x${"00".repeat(31)}1f` : context.familyAddress,
          ...(action === "privateTransfer" ? { recipientCode: "verified-code" } : {}),
          candidates: ["1", "2"],
        }),
      ).rejects.toThrow("candidate is unavailable");
      expect(mocks.transfer).not.toHaveBeenCalled();
      expect(mocks.unshield).not.toHaveBeenCalled();
      expect(mocks.fund).not.toHaveBeenCalled();
    },
  );

  it.each(["shield", "unshield", "privateTransfer", "fund"] as const)(
    "requires a restored independent key when the user selects it for %s",
    async (action) => {
      const session = await unlocked();
      mocks.notes = [value(1n, 10n, secretKeys.ownerCommitment)];
      await expect(
        session.call("preview", {
          context,
          slot: "independent",
          action,
          amount: "10",
          publicRecipient: context.familyAddress,
          candidates: ["1"],
        }),
      ).rejects.toThrow("Restore the original independent key");
      expect(mocks.recover).not.toHaveBeenCalled();
      expect(mocks.transfer).not.toHaveBeenCalled();
      expect(mocks.unshield).not.toHaveBeenCalled();
      expect(mocks.fund).not.toHaveBeenCalled();
    },
  );

  it("spends explicitly selected independent-key notes with their original owner keys", async () => {
    const session = await withBothOwners();
    mocks.notes = [
      value(1n, 10n, secretKeys.ownerCommitment),
      value(2n, 10n, independentKeyMaterial.ownerCommitment),
    ];
    const preview = await session.call("preview", {
      context,
      slot: "independent",
      action: "unshield",
      amount: "8",
      publicRecipient: context.familyAddress,
      candidates: ["2"],
    });
    expect(preview.slot).toBe("independent");
    expect(preview.inputs).toEqual(["2"]);
    expect(preview.steps).toHaveLength(1);
    expect(mocks.unshield.mock.calls[0][0]).toMatchObject({
      inputs: [{ keyMaterial: { ownerCommitment: independentKeyMaterial.ownerCommitment }, commitment: "2" }],
      amount: 8n,
    });
    assertNoOpenings(preview);
    const proven = await session.call("prove", { context, handle: preview.handle });
    expect(proven.action).toBe("unshield");
    assertNoOpenings(proven);
  });

  it("binds funding to the explicitly selected wallet and original owner keys", async () => {
    const session = await withBothOwners();
    mocks.notes = [
      value(1n, 10n, secretKeys.ownerCommitment),
      value(2n, 10n, independentKeyMaterial.ownerCommitment),
    ];
    const preview = await session.call("preview", {
      context,
      slot: "independent",
      action: "fund",
      fundingEntry: "public",
      amount: "10",
      periods: "1",
      periodDays: "30",
      rootVersionIndex: 1,
      publicRecipient: `0x${"00".repeat(31)}1f`,
      candidates: ["2"],
    });
    expect(preview.slot).toBe("independent");
    expect(preview.action).toBe("fund");
    expect(mocks.fund.mock.calls[0][0]).toMatchObject({
      keyMaterial: { ownerCommitment: independentKeyMaterial.ownerCommitment },
      wallet: { walletOwnerCommitment: independentKeyMaterial.ownerCommitment },
      donorCommitment: "2",
    });
    expect(mocks.fundingDestination).not.toHaveBeenCalled();
  });

  it("keeps preparatory consolidation within the explicitly selected owner", async () => {
    const session = await withBothOwners();
    mocks.notes = [
      value(1n, 100n, secretKeys.ownerCommitment),
      ...Array.from({ length: 9 }, (_, index) =>
        value(BigInt(index + 2), 1n, independentKeyMaterial.ownerCommitment),
      ),
    ];
    const preview = await session.call("preview", {
      context,
      slot: "independent",
      action: "unshield",
      amount: "9",
      publicRecipient: context.familyAddress,
      candidates: mocks.notes.slice(1).map((note) => String(note.commitment)),
    });
    expect(preview.slot).toBe("independent");
    expect(preview.action).toBe("privateTransfer");
    expect(preview.steps.map((step) => step.action)).toEqual(["privateTransfer", "unshield"]);
    const transfer = mocks.transfer.mock.calls[0][0];
    expect(transfer.inputs.length).toBeGreaterThan(1);
    for (const input of transfer.inputs)
      expect(input.keyMaterial.ownerCommitment).toBe(independentKeyMaterial.ownerCommitment);
    expect(transfer.destinations).toMatchObject([
      { kind: "inputOwner", inputIndex: 0 },
      { kind: "inputOwner", inputIndex: 0 },
    ]);
    expect(mocks.unshield).not.toHaveBeenCalled();
    assertNoOpenings(preview);
  });

  it.each(["Recipient identity is unknown", "Heir has no current direct-child endorsement"])(
    "rejects funding destination failure before same-owner consolidation: %s",
    async (message) => {
      const session = await unlocked();
      mocks.notes = [
        value(1n, 4n, secretKeys.ownerCommitment),
        value(2n, 7n, secretKeys.ownerCommitment),
      ];
      mocks.fundingDestination.mockRejectedValueOnce(new Error(message));
      await expect(
        session.call("preview", {
          context,
          slot: "identity",
          action: "fund",
          fundingEntry: "public",
          amount: "10",
          periods: "1",
          periodDays: "30",
          rootVersionIndex: 1,
          publicRecipient: `0x${"00".repeat(31)}1f`,
          candidates: ["1", "2"],
        }),
      ).rejects.toThrow(message);
      expect(mocks.fundingDestination).toHaveBeenCalledOnce();
      expect(mocks.transfer).not.toHaveBeenCalled();
      expect(mocks.fund).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "invalid-address",
    "0x0000000000000000000000000000000000000000",
    context.poolAddress,
  ])("rejects withdrawal recipient %s before same-owner consolidation", async (publicRecipient) => {
    const session = await unlocked();
    mocks.notes = Array.from({ length: 9 }, (_, index) =>
      value(BigInt(index + 1), 1n, secretKeys.ownerCommitment),
    );
    await expect(
      session.call("preview", {
        context,
        slot: "identity",
        action: "unshield",
        amount: "9",
        publicRecipient,
        candidates: mocks.notes.map((note) => String(note.commitment)),
      }),
    ).rejects.toThrow();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.unshield).not.toHaveBeenCalled();
  });

  it.each(["lowercase", "checksum"] as const)(
    "rejects the pool's %s address before a nine-note withdrawal consolidation",
    async (addressCase) => {
      const session = await unlocked();
      const poolAddress = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
      mocks.pool = poolAddress;
      mocks.notes = Array.from({ length: 9 }, (_, index) =>
        value(BigInt(index + 1), 1n, secretKeys.ownerCommitment),
      );
      await expect(
        session.call("preview", {
          context: { ...context, poolAddress },
          slot: "identity",
          action: "unshield",
          amount: "9",
          publicRecipient: addressCase === "lowercase" ? poolAddress.toLowerCase() : poolAddress,
          candidates: mocks.notes.map((note) => String(note.commitment)),
        }),
      ).rejects.toThrow("Unshield recipient must not be the pool");
      expect(mocks.transfer).not.toHaveBeenCalled();
      expect(mocks.unshield).not.toHaveBeenCalled();
      expect(mocks.proof).not.toHaveBeenCalled();
    },
  );

  it("normalizes a valid withdrawal recipient before preparation", async () => {
    const session = await unlocked();
    const destination = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    mocks.notes = [value(1n, 10n, secretKeys.ownerCommitment)];
    const preview = await session.call("preview", {
      context,
      slot: "identity",
      action: "unshield",
      amount: "8",
      publicRecipient: destination,
      candidates: ["1"],
    });
    expect(preview.action).toBe("unshield");
    expect(preview.recipient).toBe(getAddress(destination));
    expect(mocks.unshield).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: getAddress(destination) }),
    );
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
});
