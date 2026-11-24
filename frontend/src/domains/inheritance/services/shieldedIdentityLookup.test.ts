import { wrapIdentityCommitmentAsPersonHash } from "@deepfamily/protocol-core";
import type { Contract, JsonRpcProvider } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findWalletsWithNoteHistory, lookupFamilyIdentities } from "./shieldedIdentityLookup";

const mocks = vi.hoisted(() => ({ lineage: vi.fn(), discover: vi.fn(), recover: vi.fn() }));
vi.mock("./inheritanceChain", () => ({ loadLineageSnapshot: mocks.lineage }));
vi.mock("./shieldedAssetRegistry", () => ({ discoverShieldedFactoryPools: mocks.discover }));
vi.mock("./shieldedWalletRecovery", () => ({ recoverLocalShieldedWallet: mocks.recover }));
const contracts = { family: {} as Contract, lineageIndex: {} as Contract };
const blockNumber = 7;
const first = {
  identitySuiteId: 1,
  identityCommitment: 11n,
  personHash: wrapIdentityCommitmentAsPersonHash(11n),
};
const second = {
  identitySuiteId: 2,
  identityCommitment: 22n,
  personHash: wrapIdentityCommitmentAsPersonHash(22n),
};
const candidates = [second, first];
const lookup = () => lookupFamilyIdentities(candidates, contracts, blockNumber);

describe("registered inheritance identities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lineage.mockResolvedValue({
      versions: new Map(candidates.map((entry) => [entry.personHash, [entry, entry]])),
    });
  });
  it("returns each registered identity once across multiple person versions", async () => {
    expect((await lookup()).matches).toEqual(
      candidates.map(({ personHash, identitySuiteId }) => ({ personHash, identitySuiteId, history: "registered" })),
    );
    expect(mocks.lineage).toHaveBeenCalledWith(contracts.lineageIndex, contracts.family, {
      toBlock: blockNumber,
      selection: {
        versionPersonHashes: candidates.map(entry => entry.personHash),
        referencedParentCommitments: candidates.map(entry => entry.identityCommitment),
      },
    });
  });
  it.each(candidates)("returns the sole registered candidate in suite $identitySuiteId", async (candidate) => {
    mocks.lineage.mockResolvedValue({ versions: new Map([[candidate.personHash, [candidate]]]) });
    expect(await lookup()).toEqual({
      matches: [{ identitySuiteId: candidate.identitySuiteId, personHash: candidate.personHash, history: "registered" }],
    });
  });
  it("returns no match when neither candidate is registered", async () => {
    mocks.lineage.mockResolvedValue({ versions: new Map() });
    expect(await lookup()).toEqual({ matches: [] });
  });
  it("recognizes a suite-1 parent who was referenced before registering their own version", async () => {
    mocks.lineage.mockResolvedValue({ versions: new Map([["child", [{ fatherIdentityCommitment: first.identityCommitment, motherIdentityCommitment: 0n }]]]) });
    expect((await lookup()).matches).toEqual([{ personHash: first.personHash, identitySuiteId: 1, history: "referenced" }]);
  });
  it("rejects inconsistent registered versions", async () => {
    mocks.lineage.mockResolvedValue({
      versions: new Map([[first.personHash, [first, { ...first, identitySuiteId: second.identitySuiteId }]]]),
    });
    await expect(lookup()).rejects.toThrow("lineage record");
  });
});

describe("unregistered identity wallet history", () => {
  const env = { factory: {} as Contract, provider: {} as JsonRpcProvider, verifierAddress: "verifier" };
  const scope = { factoryDeploymentBlock: 1, lineageIndexAddress: "lineage", chainId: "31337" };
  const anchor = { number: blockNumber, hash: "block-hash" };
  const keyMaterial = { keyMode: 0 as const, ownerSecret: 4n, ownerCommitment: 5n, hpkeIkm: new Uint8Array(32) };
  const pools = ["token", "native"].map((pool, i) => ({ pool, poolDeploymentBlock: i + 1, configurationVerified: true }));
  const found = { enumerationComplete: true, pools, toBlock: blockNumber, blockHash: anchor.hash };
  const empty = { toBlock: blockNumber, blockHash: anchor.hash, ownedNotes: new Map() };
  const current = vi.fn();
  const find = () => findWalletsWithNoteHistory(candidates.map(c => ({ ...c, keyMaterial })), env, scope, anchor, current);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.discover.mockResolvedValue(found);
    mocks.recover.mockResolvedValue(empty);
  });
  it("recognizes owned history in a different pool even when the note is spent", async () => {
    mocks.recover.mockImplementation(async (pool, { identityCommitment }) => {
      return pool === "native" && identityCommitment === first.identityCommitment
        ? { ...empty, ownedNotes: new Map([[1n, { spent: true }]]) } : empty;
    });
    expect(await find()).toEqual(new Set([1]));
    expect(mocks.recover).toHaveBeenCalledWith("native", { keyMaterial, identityCommitment: first.identityCommitment }, { fromBlock: 2, toBlock: blockNumber });
  });
  it("returns no matches after checking every candidate and pool at the lookup block", async () => {
    expect(await find()).toEqual(new Set());
    expect(mocks.recover).toHaveBeenCalledTimes(candidates.length * pools.length);
    expect(mocks.discover).toHaveBeenCalledWith(env.factory, env.provider, expect.objectContaining({ toBlock: anchor.number }));
  });
  it.each([
    [{ ...found, enumerationComplete: false }, "Incomplete pool history"],
    [{ ...found, pools: [{ ...pools[0], configurationVerified: false }] }, "Unverified pool"],
    [{ ...found, blockHash: "replacement" }, "Pool history changed"],
  ] as const)("rejects incomplete or reorganized discovery", async (result, reason) => {
    mocks.discover.mockResolvedValue(result);
    await expect(find()).rejects.toThrow(reason);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it.each([{ invalidated: true }, { blockHash: "replacement" }, { toBlock: blockNumber - 1 }])(
    "rejects an inconsistent recovery snapshot", async (change) => {
      mocks.recover.mockResolvedValue({ ...empty, ...change });
      await expect(find()).rejects.toThrow("Pool history changed");
    },
  );
  it("propagates a failed scan and stops when the credentials change", async () => {
    mocks.recover.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(find()).rejects.toThrow("RPC unavailable");
    current.mockImplementationOnce(() => { throw new Error("Locked"); });
    await expect(find()).rejects.toThrow("Locked");
    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });
});
