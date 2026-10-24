import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, Wallet, getBytes, hexlify, type Contract } from "ethers";
import {
  SHIELDED_POOL_PROTOCOL_VERSION,
  buildShieldedIndependentKeySigningMessage,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  deriveShieldedIndependentKeyRootFromSignature,
  encodeShieldedIndependentKey,
  encodeShieldedIndependentKeyMnemonic,
  computeShieldedSpendNullifier,
  computeShieldedCiphertextHashField,
  computeShieldedNoteCommitmentFromPayload,
  createLineageTree,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  createShieldedLetterEnvelope,
  encryptShieldedLetter,
  computeShieldedLetterCiphertextHash,
  computeShieldedLetterRelationCommitment,
  computeShieldedAuthorizationAlias,
  buildShieldedIdentityAuthorizationState,
} from "@deepfamily/protocol-core";
import { ShieldedAssetSession, shieldedAssetErrorMessage } from "./shieldedAssetSession";
import { InheritanceError } from "../domains/inheritance/model/inheritanceErrors";
import type { ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  receive: vi.fn(),
  identity: vi.fn(),
  independentKeyIdentity: vi.fn(),
  independentKeyMaterial: vi.fn(),
  discoverPools: vi.fn(),
  loadLineage: vi.fn(),
  loadTargetedLineage: vi.fn(),
  readLetters: vi.fn(),
  network: vi.fn(),
  providers: [] as object[],
  providerDestroy: vi.fn(),
  authorizationState: vi.fn(),
  ownerProof: vi.fn(),
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
      constructor() { mocks.providers.push(this); }
      destroy = mocks.providerDestroy;
      getNetwork = mocks.network;
      getBlockNumber = async () => 12;
      getBlock = async () => ({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 });
    },
  };
});
vi.mock("@deepfamily/protocol-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@deepfamily/protocol-core")>()),
  deriveIdentityMaterial: mocks.identity,
  deriveShieldedIndependentKeyIdentitySecret: mocks.independentKeyIdentity,
  deriveShieldedIndependentKeyMaterial: mocks.independentKeyMaterial,
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
    AUTHORIZATION_STATE: async () => mocks.verifier,
  }),
}));
vi.mock("../domains/inheritance/services/shieldedIdentityAuthorizationChain", () => ({
  createIdentityAuthorizationContract: () => ({}),
  loadShieldedIdentityAuthorizationWitnessForMode: async (_contract: unknown, alias: bigint, mode?: unknown, scope?: unknown) => {
    const { getShieldedIdentityAuthorizationWitness } = await vi.importActual<typeof import("@deepfamily/protocol-core")>("@deepfamily/protocol-core");
    const result = await mocks.authorizationState(mode, scope);
    return { ...result, stateRoot: result.state.root, witness: getShieldedIdentityAuthorizationWitness(result.state, alias) };
  },
}));
vi.mock("../domains/inheritance/services/privateLetterChain", () => ({
  createPrivateLetterContract: () => ({ POOL_FACTORY: async () => mocks.factory, AUTHORIZATION_STATE: async () => mocks.verifier }),
  readPrivateLetters: mocks.readLetters,
}));
vi.mock("../shared/zk/shieldedReceiveCode", () => ({
  createShieldedReceiveCode: mocks.receive,
  verifyShieldedReceiveCode: vi.fn(),
}));
vi.mock("../shared/zk/shieldedZk", () => ({ generateShieldedProof: mocks.ownerProof }));
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
  loadTargetedLineageSnapshot: mocks.loadTargetedLineage,
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
const independentKeyIdentitySecret = new Uint8Array(32).fill(3);
// Keep recovery/proof setup deterministic under parallel frontend test workers.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providers.length = 0;
  mocks.network.mockReset().mockResolvedValue({ chainId: 31337n });
  mocks.authorizationState.mockReset().mockResolvedValue({ state: buildShieldedIdentityAuthorizationState(), checkpointId: 1n, asOf: 1000n, blockNumber: 12 });
  mocks.independentKeyIdentity
    .mockReset()
    .mockImplementation(async () => independentKeyIdentitySecret.slice());
  mocks.independentKeyMaterial.mockReset().mockImplementation(async (params) => {
    const actual = await vi.importActual<typeof import("@deepfamily/protocol-core")>(
      "@deepfamily/protocol-core",
    );
    return actual.deriveShieldedIndependentKeyMaterial(params);
  });
  mocks.loadLineage.mockReset().mockResolvedValue(null);
  mocks.loadTargetedLineage.mockReset().mockResolvedValue(null);
  mocks.readLetters.mockReset().mockResolvedValue([]);
  mocks.canonicalPool = mocks.pool;
  mocks.receive.mockResolvedValue({ code: "public-code", fingerprint: "public-fingerprint" });
  mocks.identity.mockReset().mockImplementation(async ({ identity }: { identity: object }) => ({
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

describe("receive-code current authorization state", () => {
  it.each([undefined, "rebuild", "chain"] as const)(
    "passes the selected read mode %s to receive-code authorization",
    async (stateReadMode) => {
      const session = new ShieldedAssetSession();
      await session.unlockIdentity(identityParams());
      await session.receiveCode({ slot: "identity", context: { ...context, stateReadMode }, expiresAt: "2000000000" });
      expect(mocks.authorizationState).toHaveBeenCalledWith(stateReadMode, {
        chainId: context.chainId,
        authorizationStateAddress: mocks.verifier,
      });
    },
  );

  it("rejects unsupported read modes before contacting the RPC", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await expect(session.receiveCode({
      slot: "identity",
      context: { ...context, stateReadMode: "unsupported" as "chain" },
      expiresAt: "2000000000",
    })).rejects.toThrow("Unsupported shielded state read mode");
    expect(mocks.providers).toHaveLength(0);
    expect(mocks.network).not.toHaveBeenCalled();
    expect(mocks.authorizationState).not.toHaveBeenCalled();
  });

  it("reads the current authorization state before issuing a new identity's code", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await expect(session.receiveCode({ slot: "identity", context, expiresAt: "2000000000" })).resolves.toEqual({ code: "public-code" });
    expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({ authorizationCounter: 0n }));
    expect(mocks.network).toHaveBeenCalledOnce();
    expect(mocks.authorizationState).toHaveBeenCalledOnce();
  });

  it("authorizes the live counter with a constant-size ownership statement", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    const alias = computeShieldedAuthorizationAlias({ identityCommitment: 31n, derivedSecretField: 13n });
    const globalState = buildShieldedIdentityAuthorizationState([[alias, 2n], [alias ^ (1n << 63n), 1n]]);
    mocks.authorizationState.mockResolvedValueOnce({ state: globalState, checkpointId: 4n, asOf: 1000n, blockNumber: 12 });
    mocks.ownerProof.mockResolvedValueOnce({ proof: {
      protocol: "groth16", curve: "bn128", pi_a: ["1", "2", "1"],
      pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["1", "2", "1"],
    } });
    const result = await session.authorizeIdentityCounter({ context });
    const input = mocks.ownerProof.mock.calls[0][0];
    expect(input.circuit).toBe("identityAuthorizationUpdate");
    expect(input.witness.oldCounter).toBe("2");
    expect(input.witness.newCounter).toBe("3");
    expect(input.witness.siblings).toEqual(Array(64).fill("0"));
    expect(input.witness.oldRoot).not.toBe(String(globalState.root));
    expect(result.args.slice(1, 6)).toEqual([String(alias), input.witness.oldRoot, input.witness.newRoot, "2", "3"]);
  });

  it("uses a nonzero current counter and reloads it for every renewal", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    const alias = computeShieldedAuthorizationAlias({ identityCommitment: 31n, derivedSecretField: 13n });
    for (const counter of [3n, 7n]) {
      mocks.authorizationState.mockResolvedValueOnce({ state: buildShieldedIdentityAuthorizationState([[alias, counter]]), checkpointId: counter + 1n, asOf: 1000n, blockNumber: 12 });
      await session.receiveCode({ slot: "identity", context, expiresAt: "2000000000" });
      expect(mocks.receive).toHaveBeenLastCalledWith(expect.objectContaining({ authorizationCounter: counter }));
    }
    expect(mocks.authorizationState).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "authorizationState"] as const)("refuses to generate a code when the %s read fails", async (dependency) => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    mocks[dependency].mockRejectedValue(new Error("RPC unavailable"));
    await expect(session.receiveCode({ slot: "identity", context, expiresAt: "2000000000" })).rejects.toThrow("RPC unavailable");
    expect(mocks.receive).not.toHaveBeenCalled();
  });
});

describe("verified event replay provider lifecycle", () => {
  it.each(["rebuild", "chain"] as const)(
    "requires a fresh secret session when switching from %s",
    async (stateReadMode) => {
      const session = new ShieldedAssetSession();
      await session.unlockIdentity(identityParams());
      await session.receiveCode({ slot: "identity", context: { ...context, stateReadMode }, expiresAt: "2000000000" });
      const nextMode = stateReadMode === "chain" ? "rebuild" : "chain";
      mocks.network.mockClear();
      mocks.authorizationState.mockClear();
      await expect(session.receiveCode({
        slot: "identity", context: { ...context, stateReadMode: nextMode }, expiresAt: "2000000000",
      })).rejects.toThrow("Protocol context changed");
      expect(mocks.network).not.toHaveBeenCalled();
      expect(mocks.authorizationState).not.toHaveBeenCalled();
      session.clear();
      await session.unlockIdentity(identityParams());
      await expect(session.receiveCode({
        slot: "identity", context: { ...context, stateReadMode: nextMode }, expiresAt: "2000000000",
      })).resolves.toEqual({ code: "public-code" });
      expect(mocks.authorizationState).toHaveBeenCalledWith(nextMode, expect.any(Object));
    },
  );

  it("treats omitted and explicit rebuild as the same session mode", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await session.receiveCode({ slot: "identity", context, expiresAt: "2000000000" });
    await expect(session.receiveCode({
      slot: "identity", context: { ...context, stateReadMode: "rebuild" }, expiresAt: "2000000000",
    })).resolves.toEqual({ code: "public-code" });
    expect(mocks.providers).toHaveLength(1);
  });

  const issue = (session: ShieldedAssetSession) =>
    session.receiveCode({ slot: "identity", context, expiresAt: "2000000000" });

  it("reuses its provider while rereading current chain state, then releases it on clear", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await issue(session);
    await issue(session);
    expect(mocks.providers).toHaveLength(1);
    expect(mocks.network).toHaveBeenCalledTimes(2);
    expect(mocks.authorizationState).toHaveBeenCalledTimes(2);
    expect(mocks.providerDestroy).not.toHaveBeenCalled();
    session.clear();
    expect(mocks.providerDestroy).toHaveBeenCalledOnce();
    await session.unlockIdentity(identityParams());
    await issue(session);
    expect(mocks.providers).toHaveLength(2);
  });

  it("disposes a failed initial provider and validates the next connection afresh", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    mocks.network.mockResolvedValueOnce({ chainId: 1n });
    await expect(issue(session)).rejects.toThrow("RPC chain");
    expect(mocks.providerDestroy).toHaveBeenCalledOnce();
    expect(mocks.authorizationState).not.toHaveBeenCalled();
    await issue(session);
    expect(mocks.providers).toHaveLength(2);
    expect(mocks.authorizationState).toHaveBeenCalledOnce();
  });

  it("fails closed on a reused provider's RPC error and retries without replacing the session", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await issue(session);
    mocks.network.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(issue(session)).rejects.toThrow("RPC unavailable");
    expect(mocks.authorizationState).toHaveBeenCalledOnce();
    await issue(session);
    expect(mocks.providers).toHaveLength(1);
    expect(mocks.authorizationState).toHaveBeenCalledTimes(2);
    expect(mocks.providerDestroy).not.toHaveBeenCalled();
  });

  it("does not reuse a verified connection for a different RPC endpoint", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    await issue(session);
    await expect(session.receiveCode({
      slot: "identity", context: { ...context, rpcUrl: "http://other-rpc.invalid" }, expiresAt: "2000000000",
    })).rejects.toThrow("Protocol context changed");
    expect(mocks.providers).toHaveLength(1);
    expect(mocks.authorizationState).toHaveBeenCalledOnce();
  });

  it("does not reinstall an initial connection after its credentials were cleared", async () => {
    const session = new ShieldedAssetSession();
    await session.unlockIdentity(identityParams());
    let release!: (network: { chainId: bigint }) => void;
    mocks.network.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = issue(session);
    session.clear();
    release({ chainId: 31337n });
    await expect(pending).rejects.toThrow("Credentials session was replaced or locked");
    expect(mocks.providerDestroy).toHaveBeenCalledOnce();
    expect(mocks.authorizationState).not.toHaveBeenCalled();
    await session.unlockIdentity(identityParams());
    await issue(session);
    expect(mocks.providers).toHaveLength(2);
  });
});

function independentKeyParams(session: ShieldedAssetSession) {
  return {
    expectedCredentialsHandle: session.state().credentials?.handle ?? "missing-credentials",
  };
}

it("reports missing letter recovery keys before scanning the chain archive", async () => {
  const session = new ShieldedAssetSession();
  await expect(session.call("recoverLetters", { context })).rejects.toThrow("Unlock the original identity credentials or restore the original independent key");
});

async function unlockedSession() {
  const session = new ShieldedAssetSession();
  mocks.identity.mockRejectedValueOnce(new Error("Identity proof suite unavailable"));
  await session.call("unlockIdentity", identityParams());
  return session;
}

function assertPublic(value: unknown) {
  const json = JSON.stringify(value);
  for (const forbidden of [
    "independentKeyRoot",
    "ownerSecret",
    "hpkeIkm",
    "derivedSecretField",
    "derivedSecretBytes",
    "identitySalt",
    "independentKeyIdentitySecret",
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
  keys: Awaited<ReturnType<typeof deriveShieldedIndependentKeyMaterial>>,
  options: { heirIdentity?: bigint; heirOwner?: bigint; keyMode?: bigint; spent?: boolean } = {},
) {
  const scope = {
    chainId: 31337n,
    poolAddress: context.poolAddress,
    viewingKey: keys.viewPublicKey,
  };
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
  const unrelatedKeys = deriveShieldedHeirKeyMaterial(999n);
  const unrelatedViewingKey = await deriveShieldedViewPublicKey(unrelatedKeys.hpkeIkm);
  async function unrelatedOutput(nonce: bigint) {
    const payload = encodeShieldedValueNotePayload(
      { ownerCommitment: unrelatedKeys.ownerCommitment, amount: 0n, nonce },
      scope,
    );
    const ciphertext = await encryptShieldedNote({
      payload,
      recipientPublicKey: unrelatedViewingKey,
      ...scope,
    });
    const commitment = computeShieldedNoteCommitmentFromPayload(
      { payload, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
      scope,
    ).noteCommitment;
    return { commitment, ciphertext };
  }
  const tree = createLineageTree();
  const iface = new Interface([
    "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
    "event NullifierSpent(uint256 nullifier)",
    "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
    "function protocolVersion() view returns (uint256)",
    "function nullifierCount() view returns (uint256)",
  ]);
  const log = (event: string, values: unknown[], index: number, transactionHash: string) => ({
    ...iface.encodeEventLog(iface.getEvent(event)!, values),
    address: context.poolAddress,
    blockNumber: 2,
    transactionHash,
    index,
  });
  const logs: ReturnType<typeof log>[] = [];
  function appendAction(
    action: 1 | 2,
    outputs: readonly [
      { commitment: bigint; ciphertext: Uint8Array },
      { commitment: bigint; ciphertext: Uint8Array },
    ],
    transactionHash: string,
  ) {
    logs.push(log("ActionExecuted", [action, 0n, 0n], logs.length, transactionHash));
    for (const output of outputs) {
      const leafIndex = tree.sizeBigInt;
      tree.insert(output.commitment);
      logs.push(
        log(
          "NoteAppended",
          [0n, leafIndex, output.commitment, tree.root, output.ciphertext],
          logs.length,
          transactionHash,
        ),
      );
    }
  }
  appendAction(1, [{ commitment, ciphertext }, await unrelatedOutput(37n)], `0x${"01".repeat(32)}`);
  if (options.spent) {
    const transactionHash = `0x${"02".repeat(32)}`;
    logs.push(
      log(
        "NullifierSpent",
        [
          computeShieldedSpendNullifier(
            { ownerSecret: keys.ownerSecret, noteCommitment: commitment },
            scope,
          ),
        ],
        logs.length,
        transactionHash,
      ),
    );
    appendAction(2, [await unrelatedOutput(41n), await unrelatedOutput(43n)], transactionHash);
  }
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
    protocolVersion: async () => BigInt(SHIELDED_POOL_PROTOCOL_VERSION),
    currentShardId: async () => 0n,
    noteShard: async () => ({ size: tree.sizeBigInt, root: tree.root }),
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

/** Every source remains a candidate until a trusted fingerprint or owned history confirms it. */
async function signatureCandidate(session: ShieldedAssetSession) {
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  const signature = await wallet.signMessage(
    buildShieldedIndependentKeySigningMessage(wallet.address),
  );
  await session.call(
    "restoreSignature",
    Object.assign(
      { signerAddress: wallet.address, signature, context },
      independentKeyParams(session),
    ),
  );
  const { independentKeyRoot } = await deriveShieldedIndependentKeyRootFromSignature({
    signerAddress: wallet.address,
    signature,
  });
  return {
    root: independentKeyRoot,
    keys: await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: independentKeyRoot.slice(),
      independentKeyIdentitySecret,
    }),
  };
}

describe("private letter recovery with original keys", () => {
  const letterContext = { ...context, lettersAddress: "0x6666666666666666666666666666666666666666" };
  async function archivedLetter(hpkeIkm: string, messageId: string, attached = false) {
    const attachment = attached ? { chainId: context.chainId, poolAddress: context.poolAddress, budgetCommitment: 73n } : undefined;
    const envelope = createShieldedLetterEnvelope({ body: "Original private letter", salt: 17n, attachment });
    const ciphertext = await encryptShieldedLetter({ ...letterContext, messageId, recipientPublicKey: getBytes(await deriveShieldedViewPublicKey(hpkeIkm)), envelope });
    return { messageId, ciphertext, ciphertextHash: computeShieldedLetterCiphertextHash(ciphertext), recipientBinding: "9",
      relationCommitment: String(computeShieldedLetterRelationCommitment({ attachment, salt: 17n, binding: 9n })),
      registeredAt: "700", expiresAt: "800", transactionHash: "0xletter" };
  }
  it("decrypts expired-code letters with the original identity and validates the budget reference", async () => {
    const session = new ShieldedAssetSession();
    await session.call("unlockIdentity", identityParams());
    const keys = deriveShieldedHeirKeyMaterial(13n);
    const valid = await archivedLetter(keys.hpkeIkm, "7", true);
    const mismatched = { ...await archivedLetter(keys.hpkeIkm, "8", true), relationCommitment: "1" };
    mocks.readLetters.mockResolvedValue([valid, mismatched]);
    const result = await session.call("recoverLetters", { context: letterContext });
    expect(result.letters).toMatchObject([{ messageId: "7", body: "Original private letter", slot: "identity", attachment: { budgetCommitment: "73" } }]);
    expect(result.letters).toHaveLength(1);
  });
  it("reads original independent-key letters even while a restored signature key is a candidate", async () => {
    const session = await unlockedSession();
    const restored = await signatureCandidate(session);
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    mocks.readLetters.mockResolvedValue([await archivedLetter(restored.keys.hpkeIkm, "9")]);
    const result = await session.call("recoverLetters", { context: letterContext });
    expect(result.letters).toMatchObject([{ messageId: "9", body: "Original private letter", slot: "independent", attachment: null }]);
  });
});

describe("independent-key credentials and async installation boundary", () => {
  it("requires credentials for random, signature and backup sources", async () => {
    const session = new ShieldedAssetSession();
    const expectedCredentialsHandle = "credentials:missing";
    await expect(
      session.call("createIndependentKey", {
        expectedCredentialsHandle,
        intent: "create" as const,
        rootSource: "random" as const,
        context,
      }),
    ).rejects.toThrow("credentials first");
    const signature = {
      expectedCredentialsHandle,
      signerAddress: mocks.lineage,
      signature: "private-signature",
      context,
    };
    await expect(session.call("restoreSignature", signature)).rejects.toThrow("credentials first");
    expect(signature.signature).toBe("");
    const backup = {
      expectedCredentialsHandle,
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      context,
    };
    await expect(session.call("importRecoveryMaterial", backup)).rejects.toThrow(
      "credentials first",
    );
    expect(backup.material).toBe("");
    expect(mocks.independentKeyMaterial).not.toHaveBeenCalled();
    expect(session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
  });

  it("keeps independent-key credentials independent of unavailable identity proof material and passes original input", async () => {
    const session = new ShieldedAssetSession();
    const params = identityParams();
    params.identity.fullName = "  Ｃhild  Example  ";
    const original = structuredClone(params);
    mocks.identity.mockRejectedValueOnce(new Error("Unsupported identity suite"));
    const state = await session.call("unlockIdentity", { ...params, identitySuiteId: 999 });
    expect(state.credentials?.handle).toMatch(/^credentials:/);
    expect(state.identity).toBeNull();
    expect(mocks.independentKeyIdentity).toHaveBeenCalledWith(original);
    expect(mocks.independentKeyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.identity.mock.invocationCallOrder[0],
    );
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      expectedFingerprint: keys.keyFingerprint,
      context,
    });
    await expect(session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
      "Identity credentials",
    );
    const preview = await session.call("preview", {
      context,
      slot: "independent",
      action: "shield",
      amount: "100",
    });
    expect(preview.slot).toBe("independent");
    assertPublic(session.state());
    assertPublic(preview);
  });

  it("clears both secret paths on replacement, and a failed independent-key KDF establishes no session", async () => {
    const session = new ShieldedAssetSession();
    const first = await session.call("unlockIdentity", identityParams());
    const internals = session as unknown as {
      independentKeyIdentitySecret: Uint8Array;
      identity: { derivedSecretBytes: Uint8Array; identitySalt: Uint8Array };
    };
    const keyIdentitySecret = internals.independentKeyIdentitySecret;
    const identitySecret = internals.identity.derivedSecretBytes;
    const identitySalt = internals.identity.identitySalt;
    await session.call("createIndependentKey", {
      ...independentKeyParams(session),
      intent: "create" as const,
      rootSource: "random" as const,
      context,
    });
    mocks.independentKeyIdentity.mockRejectedValueOnce(new Error("private-KDF-error"));
    const params = identityParams();
    await expect(session.call("unlockIdentity", params)).rejects.toThrow("private-KDF-error");
    expect(params.rawPassphrase).toBe("");
    for (const bytes of [keyIdentitySecret, identitySecret, identitySalt])
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
    expect(mocks.identity).toHaveBeenCalledTimes(1);
    const next = await session.call("unlockIdentity", identityParams());
    expect(next.credentials?.handle).not.toBe(first.credentials?.handle);
  });

  it("keeps the credentials handle and both secrets across a real independent-key-only backup drill", async () => {
    const session = new ShieldedAssetSession();
    const opened = await session.call("unlockIdentity", identityParams());
    const internals = session as unknown as {
      independentKeyIdentitySecret: Uint8Array;
      identity: { derivedSecretBytes: Uint8Array };
      root: Uint8Array;
    };
    const keyIdentitySecret = internals.independentKeyIdentitySecret;
    const identitySecret = internals.identity.derivedSecretBytes;
    const created = await session.call("createIndependentKey", {
      ...independentKeyParams(session),
      intent: "create" as const,
      rootSource: "random" as const,
      context,
    });
    const backup = await session.call("exportRecoveryMaterial", {
      format: "shieldedKey" as const,
      context,
    });
    const root = internals.root;
    const cleared = await session.call("clearIndependentKey", {});
    expect(cleared.credentials).toEqual(opened.credentials);
    expect(cleared.identity).toEqual(opened.identity);
    expect(root.every((byte) => byte === 0)).toBe(true);
    expect(keyIdentitySecret).toEqual(independentKeyIdentitySecret);
    expect(identitySecret).toEqual(new Uint8Array(32).fill(2));
    const restored = await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: backup.material,
      expectedFingerprint: created.independentKey!.keyFingerprint,
      context,
    });
    expect(restored.independentKey?.recoveryVerified).toBe(true);
    expect(mocks.independentKeyIdentity).toHaveBeenCalledOnce();
    session.clear();
    expect(keyIdentitySecret.every((byte) => byte === 0)).toBe(true);
    expect(identitySecret.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects missing or obsolete handles before deriving an independent key root", async () => {
    const session = await unlockedSession();
    const oldHandle = session.state().credentials!.handle;
    await session.call("unlockIdentity", identityParams());
    await expect(
      session.call("createIndependentKey", {
        expectedCredentialsHandle: oldHandle,
        intent: "create" as const,
        rootSource: "random" as const,
        context,
      }),
    ).rejects.toThrow("replaced or locked");
    await expect(
      session.call("importRecoveryMaterial", {
        expectedCredentialsHandle: "",
        format: "shieldedKey" as const,
        material: encodeShieldedIndependentKey(fixedRoot),
        context,
      }),
    ).rejects.toThrow("handle is required");
    expect(mocks.independentKeyMaterial).not.toHaveBeenCalled();
    expect(session.state().independentKey).toBeNull();
  });

  it("never accepts a previous Worker's credentials handle even if its counters restart", async () => {
    const previous = await unlockedSession();
    const handle = previous.state().credentials!.handle;
    previous.clear();
    const replacement = await unlockedSession();
    expect(replacement.state().credentials!.handle).not.toBe(handle);
    await expect(
      replacement.call("createIndependentKey", {
        expectedCredentialsHandle: handle,
        intent: "create" as const,
        rootSource: "random" as const,
        context,
      }),
    ).rejects.toThrow("replaced or locked");
  });

  it("checks credentials again when accessing an already installed independent key", async () => {
    const session = await unlockedSession();
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      expectedFingerprint: keys.keyFingerprint,
      context,
    });
    const internals = session as unknown as { independentKeyIdentitySecret: Uint8Array | null };
    internals.independentKeyIdentitySecret!.fill(0);
    internals.independentKeyIdentitySecret = null;
    await expect(
      session.call("preview", {
        context,
        slot: "independent",
        action: "shield",
        amount: "100",
      }),
    ).rejects.toThrow("credentials first");
    await expect(
      session.call("exportRecoveryMaterial", {
        format: "shieldedKey" as const,
        context,
      }),
    ).rejects.toThrow("credentials first");
  });

  it("rejects the original fingerprint when different credentials derive a different bound root", async () => {
    const original = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    mocks.independentKeyIdentity.mockResolvedValueOnce(new Uint8Array(32).fill(4));
    const session = await unlockedSession();
    await expect(
      session.call("importRecoveryMaterial", {
        ...independentKeyParams(session),
        format: "shieldedKey" as const,
        material: encodeShieldedIndependentKey(fixedRoot),
        expectedFingerprint: original.keyFingerprint,
        context,
      }),
    ).rejects.toThrow("fingerprint differs");
    expect(session.state().independentKey).toBeNull();
  });

  it("discards an independent-key KDF result after a new credentials session has replaced it", async () => {
    let finish!: (value: Uint8Array) => void;
    mocks.independentKeyIdentity.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    const session = new ShieldedAssetSession();
    const params = identityParams();
    const late = session.call("unlockIdentity", params);
    const rejected = expect(late).rejects.toThrow("replaced or locked");
    const current = await session.call("unlockIdentity", identityParams());
    const lateSecret = new Uint8Array(32).fill(9);
    finish(lateSecret);
    await rejected;
    expect(lateSecret.every((byte) => byte === 0)).toBe(true);
    expect(params.rawPassphrase).toBe("");
    expect(session.state()).toEqual(current);
  });

  it("clears uninstalled identity and independent-key material when locking during identity derivation", async () => {
    let finish!: (value: unknown) => void;
    const identityImpl = mocks.identity.getMockImplementation()!;
    const material = await identityImpl({ identity: identityParams().identity });
    const keyIdentitySecret = new Uint8Array(32).fill(8);
    mocks.independentKeyIdentity.mockResolvedValueOnce(keyIdentitySecret);
    mocks.identity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const session = new ShieldedAssetSession();
    const late = session.call("unlockIdentity", identityParams());
    const rejected = expect(late).rejects.toThrow("replaced or locked");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    session.clear();
    finish(material);
    await rejected;
    for (const bytes of [keyIdentitySecret, material.derivedSecretBytes, material.identitySalt])
      expect(bytes.every((byte: number) => byte === 0)).toBe(true);
    expect(session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
  });

  it.each(["clearIndependentKey", "replaceCredentials"] as const)(
    "rejects a late asset derivation after %s and wipes temporary copies",
    async (event) => {
      const session = await unlockedSession();
      const currentHandle = session.state().credentials!.handle;
      const actual = await vi.importActual<typeof import("@deepfamily/protocol-core")>(
        "@deepfamily/protocol-core",
      );
      const keys = await actual.deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: fixedRoot,
        independentKeyIdentitySecret,
      });
      let finish!: (value: typeof keys) => void;
      let temporaryRoot!: Uint8Array;
      let temporarySecret!: Uint8Array;
      mocks.independentKeyMaterial.mockImplementationOnce((params) => {
        temporaryRoot = params.independentKeyRoot;
        temporarySecret = params.independentKeyIdentitySecret;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const late = session.call("importRecoveryMaterial", {
        ...independentKeyParams(session),
        format: "shieldedKey" as const,
        material: encodeShieldedIndependentKey(fixedRoot),
        context,
      });
      const rejected = expect(late).rejects.toThrow(
        event === "clearIndependentKey" ? "replaced or cleared" : "replaced or locked",
      );
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (event === "clearIndependentKey") await session.call("clearIndependentKey", {});
      else await session.call("unlockIdentity", identityParams());
      const current = session.state();
      finish(keys);
      await rejected;
      expect(temporaryRoot.every((byte) => byte === 0)).toBe(true);
      expect(temporarySecret.every((byte) => byte === 0)).toBe(true);
      expect(session.state()).toEqual(current);
      expect(session.state().independentKey).toBeNull();
      if (event === "clearIndependentKey") expect(current.credentials?.handle).toBe(currentHandle);
      else expect(current.credentials?.handle).not.toBe(currentHandle);
    },
  );

  it("never installs old scan openings into a replaced credentials session", async () => {
    const session = await unlockedSession();
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      context,
    });
    let finish!: (value: unknown) => void;
    mocks.recover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const late = session.call("recover", { context });
    const rejected = expect(late).rejects.toThrow("replaced or locked");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const current = await session.call("unlockIdentity", identityParams());
    finish(recoveryHistory(keys.ownerCommitment));
    await rejected;
    expect(session.state()).toEqual(current);
    const internals = session as unknown as { wallets: Map<string, unknown>; summary: unknown };
    expect(internals.wallets.size).toBe(0);
    expect(internals.summary).toBeNull();
  });
});

describe("pending backup challenges across credentials sessions", () => {
  it.each([
    { source: "random", format: "mnemonic" },
    { source: "random", format: "shieldedKey" },
    { source: "walletSignature", format: "mnemonic" },
    { source: "walletSignature", format: "shieldedKey" },
  ] as const)(
    "completes a saved $source $format drill after a full lock without chain history",
    async ({ source, format }) => {
      const original = await unlockedSession();
      const signer = new Wallet(`0x${"11".repeat(32)}`);
      const created = await original.call("createIndependentKey", {
        ...independentKeyParams(original),
        intent: "create",
        rootSource: source,
        ...(source === "walletSignature"
          ? {
              signerAddress: signer.address,
              signature: await signer.signMessage(
                buildShieldedIndependentKeySigningMessage(signer.address),
              ),
            }
          : {}),
        context,
      });
      const backup = await original.call("exportRecoveryMaterial", { format, context });
      original.clear();
      const recovered = await unlockedSession();
      const state = await recovered.call("importRecoveryMaterial", {
        ...independentKeyParams(recovered),
        format,
        material: backup.material,
        pendingBackupFingerprints: [created.independentKey!.keyFingerprint],
        context,
      });
      expect(state.independentKey).toMatchObject({
        keyFingerprint: created.independentKey!.keyFingerprint,
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      expect(state.credentials?.handle).not.toBe(created.credentials?.handle);
      expect(mocks.recover).not.toHaveBeenCalled();
      expect((await recovered.call("exportRecoveryMaterial", { format, context })).material).toBe(
        backup.material,
      );
      assertPublic(state);
    },
  );

  it("keeps a different credential's import as a candidate and preserves every other challenge", async () => {
    const original = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const other = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(32).fill(42),
      independentKeyIdentitySecret,
    });
    const pendingBackupFingerprints = [original.keyFingerprint, other.keyFingerprint];
    mocks.independentKeyIdentity.mockResolvedValueOnce(new Uint8Array(32).fill(4));
    const recovered = await unlockedSession();
    const state = await recovered.call("importRecoveryMaterial", {
      ...independentKeyParams(recovered),
      format: "shieldedKey",
      material: encodeShieldedIndependentKey(fixedRoot),
      pendingBackupFingerprints,
      context,
    });
    expect(state.independentKey?.recoveryVerified).toBe(false);
    expect(state.independentKey?.recoveryPath).toBeUndefined();
    expect(state.independentKey?.backupRequired).toBe(false);
    expect(pendingBackupFingerprints).toEqual([original.keyFingerprint, other.keyFingerprint]);
    await recovered.call("recover", { context });
    expect(recovered.state().independentKey?.recoveryVerified).toBe(false);
    await expect(
      recovered.call("exportRecoveryMaterial", { format: "shieldedKey", context }),
    ).rejects.toThrow();
  });

  it("matches only its own bound fingerprint when the tab holds challenges for multiple credentials", async () => {
    const original = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const currentSecret = new Uint8Array(32).fill(4);
    const current = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret: currentSecret,
    });
    const pendingBackupFingerprints = [original.keyFingerprint, current.keyFingerprint];
    mocks.independentKeyIdentity.mockResolvedValueOnce(currentSecret.slice());
    const recovered = await unlockedSession();
    const state = await recovered.call("importRecoveryMaterial", {
      ...independentKeyParams(recovered),
      format: "mnemonic",
      material: encodeShieldedIndependentKeyMnemonic(fixedRoot),
      pendingBackupFingerprints,
      context,
    });
    expect(state.independentKey).toMatchObject({
      keyFingerprint: current.keyFingerprint,
      recoveryVerified: true,
      recoveryPath: "mnemonic",
    });
    expect(state.independentKey?.keyFingerprint).not.toBe(original.keyFingerprint);
    expect(pendingBackupFingerprints).toEqual([original.keyFingerprint, current.keyFingerprint]);
  });

  it("does not replace an explicit original fingerprint with a different matching tab challenge", async () => {
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const recovered = await unlockedSession();
    await expect(
      recovered.call("importRecoveryMaterial", {
        ...independentKeyParams(recovered),
        format: "shieldedKey",
        material: encodeShieldedIndependentKey(fixedRoot),
        expectedFingerprint: `0x${"ff".repeat(32)}`,
        pendingBackupFingerprints: [keys.keyFingerprint],
        context,
      }),
    ).rejects.toThrow("fingerprint differs");
    expect(recovered.state().independentKey).toBeNull();
  });
});

describe("restarting pending independent key setup", () => {
  async function pendingKeySession() {
    const session = new ShieldedAssetSession();
    const opened = await session.call("unlockIdentity", identityParams());
    const created = await session.call("createIndependentKey", {
      ...independentKeyParams(session),
      intent: "create",
      rootSource: "random",
      context,
    });
    return { session, opened, created };
  }

  it("wipes the matching pending root while preserving unlocked identity and credentials", async () => {
    const { session, opened, created } = await pendingKeySession();
    const internals = session as unknown as {
      root: Uint8Array;
      independentKeyIdentitySecret: Uint8Array;
      identity: { derivedSecretBytes: Uint8Array; identitySalt: Uint8Array };
    };
    const root = internals.root;
    const keyIdentitySecret = internals.independentKeyIdentitySecret;
    const identitySecret = internals.identity.derivedSecretBytes;
    const identitySalt = internals.identity.identitySalt;
    const cleared = await session.call("clearPendingIndependentKey", {
      ...independentKeyParams(session),
      expectedFingerprint: created.independentKey!.keyFingerprint,
    });

    expect(root.every((byte) => byte === 0)).toBe(true);
    expect(cleared).toEqual({ ...opened, independentKey: null });
    expect(keyIdentitySecret).toEqual(independentKeyIdentitySecret);
    expect(identitySecret).toEqual(new Uint8Array(32).fill(2));
    expect(identitySalt).toEqual(new Uint8Array(16).fill(1));
    await expect(session.call("receiveCode", { slot: "identity", context, expiresAt: "2000000000" })).resolves.toEqual({
      code: "public-code",
    });
    await expect(session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
      "Restore the original independent key",
    );
    assertPublic(cleared);
  });

  it("keeps the pending root intact when the expected fingerprint differs", async () => {
    const { session, created } = await pendingKeySession();
    const root = (session as unknown as { root: Uint8Array }).root;
    const originalBytes = root.slice();
    await expect(
      session.call("clearPendingIndependentKey", {
        ...independentKeyParams(session),
        expectedFingerprint: `0x${"ff".repeat(32)}`,
      }),
    ).rejects.toThrow("fingerprint changed");
    expect(session.state()).toEqual(created);
    expect((session as unknown as { root: Uint8Array }).root).toBe(root);
    expect(root).toEqual(originalBytes);
  });

  it("rejects stale credentials after a replacement session creates another pending root", async () => {
    const { session, opened, created } = await pendingKeySession();
    await session.call("unlockIdentity", identityParams());
    const current = await session.call("createIndependentKey", {
      ...independentKeyParams(session),
      intent: "create",
      rootSource: "random",
      context,
    });
    const root = (session as unknown as { root: Uint8Array }).root;
    const originalBytes = root.slice();
    await expect(
      session.call("clearPendingIndependentKey", {
        expectedCredentialsHandle: opened.credentials!.handle,
        expectedFingerprint: created.independentKey!.keyFingerprint,
      }),
    ).rejects.toThrow("replaced or locked");
    expect(session.state()).toEqual(current);
    expect((session as unknown as { root: Uint8Array }).root).toBe(root);
    expect(root).toEqual(originalBytes);
  });

  it.each([false, true])(
    "refuses an imported key with recoveryVerified=%s and no pending backup",
    async (verified) => {
      const session = new ShieldedAssetSession();
      await session.call("unlockIdentity", identityParams());
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: fixedRoot,
        independentKeyIdentitySecret,
      });
      const imported = await session.call("importRecoveryMaterial", {
        ...independentKeyParams(session),
        format: "shieldedKey",
        material: encodeShieldedIndependentKey(fixedRoot),
        ...(verified ? { expectedFingerprint: keys.keyFingerprint } : {}),
        context,
      });
      expect(imported.independentKey).toMatchObject({
        backupRequired: false,
        recoveryVerified: verified,
      });
      const root = (session as unknown as { root: Uint8Array }).root;
      const originalBytes = root.slice();
      await expect(
        session.call("clearPendingIndependentKey", {
          ...independentKeyParams(session),
          expectedFingerprint: imported.independentKey!.keyFingerprint,
        }),
      ).rejects.toThrow("Only an unverified independent key awaiting backup");
      expect(session.state()).toEqual(imported);
      expect((session as unknown as { root: Uint8Array }).root).toBe(root);
      expect(root).toEqual(originalBytes);
    },
  );

  it("rejects an empty key slot without altering its identity session", async () => {
    const session = new ShieldedAssetSession();
    const opened = await session.call("unlockIdentity", identityParams());
    await expect(
      session.call("clearPendingIndependentKey", {
        ...independentKeyParams(session),
        expectedFingerprint: `0x${"ff".repeat(32)}`,
      }),
    ).rejects.toThrow("Only an unverified independent key awaiting backup");
    expect(session.state()).toEqual(opened);
  });
});

describe("ephemeral asset Worker independent key lifecycle", () => {
  it.each([undefined, "rebuild", "chain"] as const)(
    "uses only the selected lineage read mode %s during recovery",
    async (stateReadMode) => {
      const session = new ShieldedAssetSession();
      await session.unlockIdentity(identityParams());
      await session.recover({ context: { ...context, stateReadMode } });
      if (stateReadMode === "chain") {
        expect(mocks.loadLineage).not.toHaveBeenCalled();
        expect(mocks.loadTargetedLineage).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
          blockNumber: 12,
          parentIdentityCommitments: [31n],
        }));
      } else {
        expect(mocks.loadTargetedLineage).not.toHaveBeenCalled();
        expect(mocks.loadLineage).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ toBlock: 12, selection: expect.objectContaining({ parentIdentityCommitments: [31n] }) }));
      }
    },
  );

  it.each(["rebuild", "chain"] as const)(
    "keeps %s lineage failures in the selected mode",
    async (stateReadMode) => {
      const session = new ShieldedAssetSession();
      await session.unlockIdentity(identityParams());
      const selected = stateReadMode === "chain" ? mocks.loadTargetedLineage : mocks.loadLineage;
      const other = stateReadMode === "chain" ? mocks.loadLineage : mocks.loadTargetedLineage;
      selected.mockRejectedValueOnce(new Error("RPC unavailable"));
      const result = await session.recover({ context: { ...context, stateReadMode } });
      expect(result.familyRecordsAvailable).toBe(false);
      expect(selected).toHaveBeenCalledOnce();
      expect(other).not.toHaveBeenCalled();
    },
  );

  it("keeps VALUE recovery available when family records fail and restores parent versions on retry", async () => {
    const session = await unlockedSession();
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const emptyRecovery = mocks.recover.getMockImplementation()!;
    mocks.recover.mockImplementation(async (pool, input, options) =>
      input.keyMaterial.keyMode === 1
        ? recoveryHistory(keys.ownerCommitment)
        : emptyRecovery(pool, input, options),
    );
    await session.call(
      "importRecoveryMaterial",
      Object.assign(
        {
          format: "shieldedKey" as const,
          material: encodeShieldedIndependentKey(fixedRoot),
          context,
        },
        independentKeyParams(session),
      ),
    );
    const rootOnly = await session.call("recover", { context });
    expect(rootOnly.familyRecordsAvailable).toBeUndefined();
    expect(mocks.loadLineage).not.toHaveBeenCalled();

    await session.call("unlockIdentity", identityParams());
    await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      context,
    });
    mocks.loadLineage.mockRejectedValueOnce(new Error("private-lineage-error-sentinel"));
    const failed = await session.call("recover", { context });
    expect(failed.familyRecordsAvailable).toBe(false);
    expect(failed.familyRecordsError).toBe("unavailable");
    expect(failed.notes).toMatchObject([{ slot: "independent", kind: "value", amount: "100" }]);
    expect(failed.parentVersions).toEqual([]);
    expect(failed.claims).toEqual([]);
    expect(failed.sessionState?.independentKey).toMatchObject({ recoveryVerified: true });
    expect(JSON.stringify(failed)).not.toContain("private-lineage-error-sentinel");
    assertPublic(failed);

    mocks.loadLineage.mockRejectedValueOnce(
      new InheritanceError("lineageIncompatible", "private-lineage-interface-sentinel"),
    );
    const incompatible = await session.call("recover", { context });
    expect(incompatible.familyRecordsAvailable).toBe(false);
    expect(incompatible.familyRecordsError).toBe("incompatible");
    expect(incompatible.notes).toEqual(failed.notes);
    expect(JSON.stringify(incompatible)).not.toContain("private-lineage-interface-sentinel");
    assertPublic(incompatible);

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
    expect(recovered.familyRecordsError).toBeUndefined();
    expect(mocks.loadLineage).toHaveBeenCalledTimes(3);
    assertPublic(recovered);
  });

  it("creates only on explicit intent and refuses private method dispatch or recovery fallback", async () => {
    const session = new ShieldedAssetSession();
    await expect(
      session.call(
        "createIndependentKey",
        Object.assign(
          { intent: "restore" as "create", rootSource: "random" as const, context },
          independentKeyParams(session),
        ),
      ),
    ).rejects.toThrow("explicit");
    await expect(session.call("recover", { context })).rejects.toThrow("Unlock");
    await expect(session.call("keys" as "receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
      "Unsupported",
    );
    await expect(
      session.call(
        "createIndependentKey",
        Object.assign(
          {
            intent: "create" as const,
            rootSource: "walletSignature" as const,
            signature: "bad-secret",
            signerAddress: mocks.lineage,
            context,
          },
          independentKeyParams(session),
        ),
      ),
    ).rejects.toThrow();
    expect(session.state().independentKey).toBeNull();
    assertPublic(session.state());
  });

  it.each(["mnemonic", "shieldedKey"] as const)(
    "runs the %s backup drill by clearing only the independent key root, keeping the unlocked identity",
    async (format) => {
      const session = new ShieldedAssetSession();
      const identity = await session.call("unlockIdentity", identityParams());
      const created = await session.call(
        "createIndependentKey",
        Object.assign(
          {
            intent: "create" as const,
            rootSource: "random" as const,
            context,
          },
          independentKeyParams(session),
        ),
      );
      const exported = await session.call("exportRecoveryMaterial", { format, context });
      const secretBytes = (session as unknown as { root: Uint8Array }).root;

      const cleared = await session.call("clearIndependentKey", {});
      expect(secretBytes.every((byte) => byte === 0)).toBe(true);
      expect(cleared).toEqual({
        credentials: identity.credentials,
        identity: identity.identity,
        independentKey: null,
      });
      await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow(
        "Unlock the existing independent key root",
      );
      await expect(session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
        "Restore the original independent key",
      );

      // Without the application's original fingerprint, valid words remain a
      // candidate; they cannot establish that the original credentials were used.
      const reentered = await session.call(
        "importRecoveryMaterial",
        Object.assign(
          {
            format,
            material: exported.material,
            context,
          },
          independentKeyParams(session),
        ),
      );
      expect(reentered.independentKey).toMatchObject({
        keyFingerprint: created.independentKey!.keyFingerprint,
        backupRequired: false,
        recoveryVerified: false,
      });
      expect(reentered.independentKey?.recoveryPath).toBeUndefined();
      await session.call("clearIndependentKey", {});

      const params = {
        format,
        material: exported.material,
        expectedFingerprint: exported.keyFingerprint,
        context,
      };
      const verified = await session.call(
        "importRecoveryMaterial",
        Object.assign(params, independentKeyParams(session)),
      );
      expect(params.material).toBe("");
      expect(verified.identity).toEqual(identity.identity);
      expect(verified.independentKey).toMatchObject({
        keyFingerprint: created.independentKey!.keyFingerprint,
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      // The identity unlocked before the drill proves the code without a second unlock.
      assertPublic(await session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" }));
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
      const initial = await session.call(
        "createIndependentKey",
        Object.assign(
          {
            intent: "create" as const,
            rootSource: "random" as const,
            context,
          },
          independentKeyParams(session),
        ),
      );
      expect(initial.independentKey).toMatchObject({
        rootSource: "random" as const,
        recoveryVerified: false,
        backupRequired: true,
      });
      assertPublic(initial);
      const forgedPublicState = session.state();
      forgedPublicState.independentKey!.recoveryVerified = true;
      forgedPublicState.independentKey!.backupRequired = false;
      expect(session.state()).toEqual(initial);
      await expect(session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
        "Verify recovery",
      );
      const exported = await session.call("exportRecoveryMaterial", { format, context });
      expect(exported).toMatchObject({
        format,
        version: 1,
        keyFingerprint: initial.independentKey!.keyFingerprint,
      });
      if (format === "mnemonic") expect(exported.material.split(" ")).toHaveLength(24);
      else expect(exported.material).toMatch(/^0x[0-9a-f]{64}$/);
      expect(session.state()).toEqual(initial);
      const notFresh = { format, material: exported.material, context };
      await expect(
        session.call(
          "importRecoveryMaterial",
          Object.assign(notFresh, independentKeyParams(session)),
        ),
      ).rejects.toThrow("Clear the original");
      expect(notFresh.material).toBe("");
      expect(session.state()).toEqual(initial);
      const secretBytes = (session as unknown as { root: Uint8Array }).root;
      session.clear();
      expect(secretBytes.every((byte) => byte === 0)).toBe(true);
      expect(session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
      const fresh = await unlockedSession();
      const params = {
        format,
        material: exported.material,
        expectedFingerprint: exported.keyFingerprint,
        context,
      };
      const restored = await fresh.call(
        "importRecoveryMaterial",
        Object.assign(params, independentKeyParams(fresh)),
      );
      expect(params.material).toBe("");
      expect(restored.identity).toBeNull();
      expect(restored.independentKey).toMatchObject({
        keyFingerprint: exported.keyFingerprint,
        rootSource: "imported",
        recoveryVerified: true,
        recoveryPath: format,
        backupRequired: false,
      });
      assertPublic(restored);
      await fresh.call("unlockIdentity", identityParams());
      await fresh.call("importRecoveryMaterial", {
        ...independentKeyParams(fresh),
        format,
        material: exported.material,
        expectedFingerprint: exported.keyFingerprint,
        context,
      });
      assertPublic(await fresh.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" }));
      expect(mocks.receive).toHaveBeenCalledOnce();
    },
  );

  it.each(["mnemonic", "shieldedKey"] as const)(
    "rejects malformed %s and wrong fingerprints without installing or replacing the independent key",
    async (format) => {
      const session = await unlockedSession();
      const material =
        format === "mnemonic"
          ? encodeShieldedIndependentKeyMnemonic(fixedRoot)
          : encodeShieldedIndependentKey(fixedRoot);
      const wrongFingerprint = {
        format,
        material,
        expectedFingerprint: `0x${"ff".repeat(32)}`,
        context,
      };
      await expect(
        session.call(
          "importRecoveryMaterial",
          Object.assign(wrongFingerprint, independentKeyParams(session)),
        ),
      ).rejects.toThrow("fingerprint differs");
      expect(wrongFingerprint.material).toBe("");
      expect(session.state().independentKey).toBeNull();
      const invalid = {
        format,
        material:
          format === "mnemonic" ? `${"abandon ".repeat(23)}abandon` : `0x${"11".repeat(31)}`,
        context,
      };
      await expect(
        session.call(
          "importRecoveryMaterial",
          Object.assign(invalid, independentKeyParams(session)),
        ),
      ).rejects.toThrow();
      expect(invalid.material).toBe("");
      expect(session.state().independentKey).toBeNull();
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: fixedRoot,
        independentKeyIdentitySecret,
      });
      const valid = await session.call(
        "importRecoveryMaterial",
        Object.assign(
          {
            format,
            material,
            expectedFingerprint: keys.keyFingerprint,
            context,
          },
          independentKeyParams(session),
        ),
      );
      const replacement = {
        format,
        material:
          format === "mnemonic"
            ? encodeShieldedIndependentKeyMnemonic(new Uint8Array(32).fill(42))
            : encodeShieldedIndependentKey(new Uint8Array(32).fill(42)),
        context,
      };
      await expect(
        session.call(
          "importRecoveryMaterial",
          Object.assign(replacement, independentKeyParams(session)),
        ),
      ).rejects.toThrow("Clear the original");
      expect(replacement.material).toBe("");
      await expect(
        session.call(
          "createIndependentKey",
          Object.assign(
            { intent: "create" as const, rootSource: "random" as const, context },
            independentKeyParams(session),
          ),
        ),
      ).rejects.toThrow("empty independent key slot");
      await expect(
        session.call(
          "restoreSignature",
          Object.assign(
            {
              signerAddress: mocks.lineage,
              signature: "bad-signature-sentinel",
              context,
            },
            independentKeyParams(session),
          ),
        ),
      ).rejects.toThrow("Clear the original");
      expect(session.state()).toEqual(valid);
      expect(JSON.stringify(valid)).not.toContain(material);
      assertPublic(valid);
    },
  );

  it("verifies a real repeated signature against the old fingerprint and rejects a different signer", async () => {
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    const signature = await wallet.signMessage(
      buildShieldedIndependentKeySigningMessage(wallet.address),
    );
    const first = await unlockedSession();
    const created = await first.call(
      "createIndependentKey",
      Object.assign(
        {
          intent: "create" as const,
          rootSource: "walletSignature" as const,
          signerAddress: wallet.address,
          signature,
          context,
        },
        independentKeyParams(first),
      ),
    );
    expect(created.independentKey?.recoveryVerified).toBe(false);
    expect(created.independentKey?.backupRequired).toBe(true);
    const exported = await first.call("exportRecoveryMaterial", {
      format: "shieldedKey" as const,
      context,
    });
    first.clear();
    const manual = await unlockedSession();
    const manualState = await manual.call(
      "importRecoveryMaterial",
      Object.assign(
        {
          format: "shieldedKey" as const,
          material: exported.material,
          expectedFingerprint: created.independentKey!.keyFingerprint,
          context,
        },
        independentKeyParams(manual),
      ),
    );
    expect(manualState.independentKey).toMatchObject({
      rootSource: "imported",
      recoveryVerified: true,
      recoveryPath: "shieldedKey",
      keyFingerprint: created.independentKey!.keyFingerprint,
      backupRequired: false,
    });
    expect(manualState.independentKey?.signerAddress).toBeUndefined();
    manual.clear();
    const fresh = await unlockedSession();
    const params = {
      signerAddress: wallet.address,
      signature: await wallet.signMessage(
        buildShieldedIndependentKeySigningMessage(wallet.address),
      ),
      expectedFingerprint: created.independentKey!.keyFingerprint,
      context,
    };
    const restored = await fresh.call(
      "restoreSignature",
      Object.assign(params, independentKeyParams(fresh)),
    );
    expect(params.signature).toBe("");
    expect(restored.independentKey).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "signature",
      keyFingerprint: created.independentKey!.keyFingerprint,
    });
    assertPublic(restored);
    const other = new Wallet(`0x${"22".repeat(32)}`);
    const wrong = await unlockedSession();
    await expect(
      wrong.call(
        "restoreSignature",
        Object.assign(
          {
            signerAddress: other.address,
            signature: await other.signMessage(
              buildShieldedIndependentKeySigningMessage(other.address),
            ),
            expectedFingerprint: created.independentKey!.keyFingerprint,
            context,
          },
          independentKeyParams(wrong),
        ),
      ),
    ).rejects.toThrow("fingerprint differs");
    expect(wrong.state().independentKey).toBeNull();
  });

  it.each([true, false])(
    "never skips a new wallet's manual backup through re-signing or history (known fingerprint: %s)",
    async (hasOriginalFingerprint) => {
      const wallet = new Wallet(`0x${"11".repeat(32)}`);
      const signature = await wallet.signMessage(
        buildShieldedIndependentKeySigningMessage(wallet.address),
      );
      const generated = await deriveShieldedIndependentKeyRootFromSignature({
        signerAddress: wallet.address,
        signature,
      });
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: generated.independentKeyRoot,
        independentKeyIdentitySecret,
      });
      const pendingBackupFingerprints = [keys.keyFingerprint];
      const signatureSession = await unlockedSession();
      const restored = await signatureSession.call(
        "restoreSignature",
        Object.assign(
          {
            signerAddress: wallet.address,
            signature,
            expectedFingerprint: hasOriginalFingerprint ? keys.keyFingerprint : undefined,
            pendingBackupFingerprints,
            context,
          },
          independentKeyParams(signatureSession),
        ),
      );
      expect(restored.independentKey).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });
      mocks.recover.mockResolvedValue(recoveryHistory(keys.ownerCommitment));
      await signatureSession.call("recover", { context });
      expect(signatureSession.state().independentKey).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });
      const knownOriginalExport = await signatureSession.call("exportRecoveryMaterial", {
        format: "shieldedKey" as const,
        context,
      });
      expect(knownOriginalExport.material).toBe(
        encodeShieldedIndependentKey(generated.independentKeyRoot),
      );
      expect(signatureSession.state()).toEqual(restored);
      expect(signatureSession.state().independentKey).toMatchObject({
        backupRequired: true,
        recoveryVerified: false,
      });

      const exportedWords = await signatureSession.call("exportRecoveryMaterial", {
        format: "mnemonic" as const,
        context,
      });
      expect(exportedWords.material).toBe(
        encodeShieldedIndependentKeyMnemonic(generated.independentKeyRoot),
      );
      signatureSession.clear();
      // Manually re-entering the exported words is the drill itself.
      const manual = await unlockedSession();
      const opened = await manual.call(
        "importRecoveryMaterial",
        Object.assign(
          {
            format: "mnemonic" as const,
            material: exportedWords.material,
            ...(hasOriginalFingerprint ? { expectedFingerprint: keys.keyFingerprint } : {}),
            context,
          },
          independentKeyParams(manual),
        ),
      );
      expect(opened.independentKey).toMatchObject({
        backupRequired: false,
        recoveryVerified: hasOriginalFingerprint,
        ...(hasOriginalFingerprint ? { recoveryPath: "mnemonic" } : {}),
      });
      if (!hasOriginalFingerprint) {
        expect(opened.independentKey?.recoveryPath).toBeUndefined();
        await manual.call("recover", { context });
        expect(manual.state().independentKey).toMatchObject({
          recoveryVerified: true,
          recoveryPath: "history",
        });
      }
    },
  );

  it("refuses to export an unknown re-signed candidate when pending fingerprints do not match", async () => {
    const session = await unlockedSession();
    const pendingBackupFingerprints = [`0x${"ff".repeat(32)}`];
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    await session.call(
      "restoreSignature",
      Object.assign(
        {
          signerAddress: wallet.address,
          signature: await wallet.signMessage(
            buildShieldedIndependentKeySigningMessage(wallet.address),
          ),
          pendingBackupFingerprints,
          context,
        },
        independentKeyParams(session),
      ),
    );
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    expect(session.state().independentKey?.keyFingerprint).not.toBe(pendingBackupFingerprints[0]);
    await expect(
      session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }),
    ).rejects.toThrow();
    await session.call("recover", { context });
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    await expect(
      session.call("exportRecoveryMaterial", { format: "mnemonic" as const, context }),
    ).rejects.toThrow();
  });

  it("restores the same independent key root in a newly configured deployment without changing its backup", async () => {
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const material = encodeShieldedIndependentKey(fixedRoot);
    const changedContext = {
      ...context,
      factoryAddress: "0x6666666666666666666666666666666666666666",
    };
    for (const currentContext of [context, changedContext]) {
      const session = await unlockedSession();
      const state = await session.call(
        "importRecoveryMaterial",
        Object.assign(
          {
            format: "shieldedKey" as const,
            material,
            expectedFingerprint: keys.keyFingerprint,
            context: currentContext,
          },
          independentKeyParams(session),
        ),
      );
      expect(state.independentKey).toMatchObject({
        keyFingerprint: keys.keyFingerprint,
        recoveryVerified: true,
        recoveryPath: "shieldedKey",
      });
      expect(
        (
          await session.call("exportRecoveryMaterial", {
            format: "shieldedKey" as const,
            context: currentContext,
          })
        ).material,
      ).toBe(material);
      assertPublic(state);
    }
  });

  it("summarizes VALUE and pending budgets without identity proof capability without revealing openings or granting claims", async () => {
    const session = await unlockedSession();
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    await session.call(
      "importRecoveryMaterial",
      Object.assign(
        {
          format: "mnemonic" as const,
          material: encodeShieldedIndependentKeyMnemonic(fixedRoot),
          expectedFingerprint: keys.keyFingerprint,
          context,
        },
        independentKeyParams(session),
      ),
    );
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
        slot: "independent",
        action: "claim",
        claimHandle: "73",
      }),
    ).rejects.toThrow("identity credentials");
  });

  it("does not let random creation bypass its backup gate by scanning a matching history", async () => {
    const session = await unlockedSession();
    await session.call(
      "createIndependentKey",
      Object.assign(
        { intent: "create" as const, rootSource: "random" as const, context },
        independentKeyParams(session),
      ),
    );
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
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    expect(session.state().independentKey?.backupRequired).toBe(true);
  });

  it("confirms a re-signed candidate from an authenticated independent budget only after the original identity is unlocked", async () => {
    const session = await unlockedSession();
    const { keys, root } = await signatureCandidate(session);
    const commitment = await authenticatedBudgetHistory(keys);

    const rootOnly = await session.call("recover", { context });
    expect(rootOnly.notes).toMatchObject([
      { commitment: String(commitment), kind: "budget", keyMode: 1, pendingIdentity: true },
    ]);
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    expect(rootOnly.claims).toEqual([]);
    await expect(
      session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }),
    ).rejects.toThrow();

    await session.call("unlockIdentity", identityParams());
    await session.call("importRecoveryMaterial", {
      ...independentKeyParams(session),
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(root),
      context,
    });
    const authenticated = await session.call("recover", { context });
    expect(authenticated.notes).toMatchObject([
      { commitment: String(commitment), kind: "budget", keyMode: 1, pendingIdentity: false },
    ]);
    expect(authenticated.sessionState?.independentKey).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "history",
    });
    expect(authenticated.sessionState?.independentKey?.backupRequired).toBeFalsy();
    // Recovering ownership does not grant lineage eligibility or create a claim.
    expect(authenticated.claims).toEqual([]);
    expect(
      (await session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }))
        .material,
    ).toBe(encodeShieldedIndependentKey(root));
    assertPublic(authenticated);
  });

  it.each(["identity", "owner", "mode", "spent"] as const)(
    "does not confirm a candidate root from a budget with a mismatching %s or spent history",
    async (invalid) => {
      const session = new ShieldedAssetSession();
      await session.call("unlockIdentity", identityParams());
      const { keys } = await signatureCandidate(session);
      await authenticatedBudgetHistory(keys, {
        ...(invalid === "identity" ? { heirIdentity: 99n } : {}),
        ...(invalid === "owner" ? { heirOwner: keys.ownerCommitment + 1n } : {}),
        ...(invalid === "mode" ? { keyMode: 0n } : {}),
        ...(invalid === "spent" ? { spent: true } : {}),
      });
      const summary = await session.call("recover", { context });
      expect(summary.notes).toEqual([]);
      expect(session.state().independentKey?.recoveryVerified).toBe(false);
      expect(session.state().independentKey?.recoveryPath).toBeUndefined();
      await expect(
        session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }),
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
      await session.call(
        "createIndependentKey",
        Object.assign(
          {
            intent: "create" as const,
            rootSource,
            ...(rootSource === "walletSignature"
              ? {
                  signerAddress: signer.address,
                  signature: await signer.signMessage(
                    buildShieldedIndependentKeySigningMessage(signer.address),
                  ),
                }
              : {}),
            context,
          },
          independentKeyParams(session),
        ),
      );
      const backup = await session.call("exportRecoveryMaterial", {
        format: "shieldedKey" as const,
        context,
      });
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: getBytes(backup.material),
        independentKeyIdentitySecret,
      });
      await authenticatedBudgetHistory(keys);
      const summary = await session.call("recover", { context });
      expect(summary.notes).toMatchObject([{ kind: "budget", keyMode: 1, pendingIdentity: false }]);
      expect(summary.sessionState?.independentKey).toMatchObject({
        recoveryVerified: false,
        backupRequired: true,
      });
      await expect(session.call("receiveCode", { slot: "independent", context, expiresAt: "2000000000" })).rejects.toThrow(
        "Verify recovery",
      );
      assertPublic(summary);
    },
  );

  it.each(["mnemonic", "shieldedKey"] as const)(
    "keeps a valid %s as a candidate until positive funds history confirms it",
    async (format) => {
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: fixedRoot,
        independentKeyIdentitySecret,
      });
      const material =
        format === "mnemonic"
          ? encodeShieldedIndependentKeyMnemonic(fixedRoot)
          : encodeShieldedIndependentKey(fixedRoot);
      const session = await unlockedSession();
      const params = { ...independentKeyParams(session), format, material, context };
      const restored = await session.call("importRecoveryMaterial", params);
      expect(params.material).toBe("");
      expect(restored.independentKey).toMatchObject({
        keyFingerprint: keys.keyFingerprint,
        rootSource: "imported",
        recoveryVerified: false,
        backupRequired: false,
      });
      expect(restored.independentKey?.recoveryPath).toBeUndefined();
      await session.call("recover", { context });
      expect(session.state().independentKey?.recoveryVerified).toBe(false);
      await expect(session.call("exportRecoveryMaterial", { format, context })).rejects.toThrow();
      await expect(
        session.call("preview", {
          context,
          slot: "independent",
          action: "shield",
          amount: "100",
        }),
      ).rejects.toThrow("Verify recovery");
      mocks.recover.mockResolvedValue(recoveryHistory(keys.ownerCommitment));
      const confirmed = await session.call("recover", { context });
      expect(confirmed.sessionState?.independentKey).toMatchObject({
        recoveryVerified: true,
        recoveryPath: "history",
      });
      expect((await session.call("exportRecoveryMaterial", { format, context })).material).toBe(
        material,
      );
      assertPublic(confirmed);
      session.clear();
      expect(session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
      await expect(session.call("recover", { context })).rejects.toThrow("Unlock");
    },
  );

  it("clears pasted recovery secrets before an asynchronous context validation can fail", async () => {
    const session = await unlockedSession();
    const params = {
      format: "shieldedKey" as const,
      material: encodeShieldedIndependentKey(fixedRoot),
      context: { ...context, chainId: "1" },
    };
    const failed = session.call(
      "importRecoveryMaterial",
      Object.assign(params, independentKeyParams(session)),
    );
    expect(params.material).toBe("");
    await expect(failed).rejects.toThrow("RPC chain");
    expect(session.state().independentKey).toBeNull();
    assertPublic(session.state());
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: fixedRoot,
      independentKeyIdentitySecret,
    });
    const recovered = await session.call(
      "importRecoveryMaterial",
      Object.assign(
        {
          format: "shieldedKey" as const,
          material: encodeShieldedIndependentKey(fixedRoot),
          expectedFingerprint: keys.keyFingerprint,
          context,
        },
        independentKeyParams(session),
      ),
    );
    expect(recovered.independentKey).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "shieldedKey",
    });
  });

  it("keeps a re-signed candidate pending on empty or insufficient history and confirms it from owned positive VALUE", async () => {
    const wallet = new Wallet(`0x${"11".repeat(32)}`);
    const signature = await wallet.signMessage(
      buildShieldedIndependentKeySigningMessage(wallet.address),
    );
    const session = await unlockedSession();
    await session.call(
      "restoreSignature",
      Object.assign(
        { signerAddress: wallet.address, signature, context },
        independentKeyParams(session),
      ),
    );
    await session.call("recover", { context });
    expect(session.state().independentKey?.recoveryVerified).toBe(false);
    const generated = await deriveShieldedIndependentKeyRootFromSignature({
      signerAddress: wallet.address,
      signature,
    });
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: generated.independentKeyRoot,
      independentKeyIdentitySecret,
    });
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
      expect(session.state().independentKey?.recoveryVerified).toBe(false);
      await expect(
        session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }),
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
      walletKeyMode: keys.keyMode,
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
    expect(session.state().independentKey).toMatchObject({
      recoveryVerified: true,
      recoveryPath: "history",
    });
    expect(corroborated.sessionState?.independentKey).toMatchObject({
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
      const session = await unlockedSession();
      return { session, ...(await signatureCandidate(session)) };
    }

    it("confirms a candidate root from positive VALUE in another verified factory pool", async () => {
      const { session, keys, root } = await candidateSession();
      await session.call("recover", { context });
      expect(session.state().independentKey?.recoveryVerified).toBe(false);
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
      expect(result.sessionState?.independentKey).toMatchObject({
        recoveryVerified: true,
        recoveryPath: "history",
      });
      // The unverified pool is never scanned, so its history cannot confirm anything.
      expect(mocks.recover.mock.calls.some(([pool]) => pool === unverifiedPool)).toBe(false);
      expect(
        (await session.call("exportRecoveryMaterial", { format: "shieldedKey" as const, context }))
          .material,
      ).toBe(encodeShieldedIndependentKey(root));
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
        else expect((await discovery).sessionState?.independentKey?.recoveryVerified).toBe(false);
        expect(session.state().independentKey).toMatchObject({ recoveryVerified: false });
        expect(session.state().independentKey?.recoveryPath).toBeUndefined();
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

    it("keeps identity and the independent key root but drops the previous pool's history", async () => {
      const session = new ShieldedAssetSession();
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: fixedRoot,
        independentKeyIdentitySecret,
      });
      await session.call("unlockIdentity", identityParams());
      await session.call(
        "importRecoveryMaterial",
        Object.assign(
          {
            format: "shieldedKey" as const,
            material: encodeShieldedIndependentKey(fixedRoot),
            expectedFingerprint: keys.keyFingerprint,
            context,
          },
          independentKeyParams(session),
        ),
      );
      await session.call("recover", { context });
      expect(internals(session).summary).not.toBeNull();
      const before = session.state();

      mocks.canonicalPool = otherPoolContext.poolAddress;
      const exported = await session.call("exportRecoveryMaterial", {
        format: "shieldedKey" as const,
        context: otherPoolContext,
      });
      expect(exported.material).toBe(encodeShieldedIndependentKey(fixedRoot));
      expect(internals(session).summary).toBeNull();
      expect(internals(session).wallets.size).toBe(0);
      expect(session.state()).toEqual(before);
      assertPublic(await session.call("receiveCode", { slot: "independent", context: otherPoolContext, expiresAt: "2000000000" }));
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
      cause: { independentKeyRoot: secret, witness: secret },
    });
    expect(shieldedAssetErrorMessage(error)).not.toContain(secret);
    expect(shieldedAssetErrorMessage({ message: secret })).not.toContain(secret);
    expect(hexlify(fixedRoot)).not.toContain("password");
  });
});
