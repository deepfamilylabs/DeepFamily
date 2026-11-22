import { wrapIdentityCommitmentAsPersonHash } from "@deepfamily/protocol-core";
import type { Contract } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupRegisteredShieldedIdentities } from "./shieldedIdentityLookup";

const mocks = vi.hoisted(() => ({ lineage: vi.fn() }));
vi.mock("./inheritanceChain", () => ({ loadLineageSnapshot: mocks.lineage }));
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
const lookup = () => lookupRegisteredShieldedIdentities(candidates, contracts, blockNumber);

describe("registered inheritance identities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lineage.mockResolvedValue({
      versions: new Map(candidates.map((entry) => [entry.personHash, [entry, entry]])),
    });
  });
  it("returns each registered identity once across multiple person versions", async () => {
    expect((await lookup()).matches).toEqual(
      candidates.map(({ personHash, identitySuiteId }) => ({ personHash, identitySuiteId })),
    );
    expect(mocks.lineage).toHaveBeenCalledWith(contracts.lineageIndex, contracts.family, {
      toBlock: blockNumber,
      selection: { versionPersonHashes: candidates.map((entry) => entry.personHash) },
    });
  });
  it.each(candidates)("returns the sole registered candidate in suite $identitySuiteId", async (candidate) => {
    mocks.lineage.mockResolvedValue({ versions: new Map([[candidate.personHash, [candidate]]]) });
    expect(await lookup()).toEqual({
      matches: [{ identitySuiteId: candidate.identitySuiteId, personHash: candidate.personHash }],
    });
  });
  it("returns no match when neither candidate is registered", async () => {
    mocks.lineage.mockResolvedValue({ versions: new Map() });
    expect(await lookup()).toEqual({ matches: [] });
  });
  it("rejects inconsistent registered versions", async () => {
    mocks.lineage.mockResolvedValue({
      versions: new Map([[first.personHash, [first, { ...first, identitySuiteId: second.identitySuiteId }]]]),
    });
    await expect(lookup()).rejects.toThrow("lineage record");
  });
});
