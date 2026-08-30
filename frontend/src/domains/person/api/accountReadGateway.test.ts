import { describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import { createAccountReadGateway } from "./accountReadGateway";

const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const personA = "0xaaaa";
const personB = "0xbbbb";

describe("accountReadGateway", () => {
  it("reads account endorsements through the reader in one call", async () => {
    const reader = {
      listUserEndorsements: vi.fn(async () => ({
        personHashes: [personA, personB],
        versionIndices: [1n, 2n],
        endorsementCounts: [5n, 3n],
        tokenIds: [101n, 0n],
        totalCount: 7n,
        hasMore: true,
        nextOffset: 2n,
      })),
    };
    const gateway = createAccountReadGateway({}, reader, new QueryCache());

    const page = await gateway.listEndorsementsByAccount(ACCOUNT, 0, 2);

    expect(reader.listUserEndorsements).toHaveBeenCalledWith(ACCOUNT, 0, 2);
    expect(page.rows).toEqual([
      { personHash: personA, versionIndex: 1, endorsementCount: 5, tokenId: 101 },
      { personHash: personB, versionIndex: 2, endorsementCount: 3, tokenId: 0 },
    ]);
    expect(page.totalCount).toBe(7);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(2);
  });

  it("falls back to walking the on-chain index when no reader is available", async () => {
    const contract = {
      userEndorsedPersonsCount: vi.fn(async () => 3n),
      userEndorsedPersonAt: vi.fn(async (_account: string, index: number) =>
        [personA, personB, "0xcccc"][Number(index)],
      ),
      endorsedVersionIndex: vi.fn(async (personHash: string) =>
        personHash === personA ? 1n : 2n,
      ),
    };
    const gateway = createAccountReadGateway(contract, null, new QueryCache());

    const page = await gateway.listEndorsementsByAccount(ACCOUNT, 0, 2);

    expect(page.rows).toEqual([
      { personHash: personA, versionIndex: 1 },
      { personHash: personB, versionIndex: 2 },
    ]);
    expect(page.totalCount).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(2);
    expect(contract.userEndorsedPersonAt).toHaveBeenCalledTimes(2);
  });

  it("stops at the balance when paging NFTs held by an account", async () => {
    const contract = {
      balanceOf: vi.fn(async () => 2n),
      tokenOfOwnerByIndex: vi.fn(async (_account: string, index: number) =>
        [101n, 202n][Number(index)],
      ),
      tokenIdToPerson: vi.fn(async (tokenId: number) => (tokenId === 101 ? personA : personB)),
      tokenIdToVersionIndex: vi.fn(async () => 3n),
      nftCoreInfo: vi.fn(async (tokenId: number) => ({
        basicInfo: { gender: 2 },
        supplementInfo: { fullName: tokenId === 101 ? "Ada Lovelace" : "" },
      })),
    };
    const gateway = createAccountReadGateway(contract, null, new QueryCache());

    const page = await gateway.listNftsByOwner(ACCOUNT, 0, 10);

    expect(page.rows).toEqual([
      { tokenId: 101, personHash: personA, versionIndex: 3, fullName: "Ada Lovelace" },
      // An empty on-chain name stays undefined rather than rendering as blank.
      { tokenId: 202, personHash: personB, versionIndex: 3, fullName: undefined },
    ]);
    expect(page.totalCount).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.truncated).toBe(false);
  });

  it("still lists NFTs when core info is unavailable", async () => {
    const contract = {
      balanceOf: vi.fn(async () => 1n),
      tokenOfOwnerByIndex: vi.fn(async () => 101n),
      tokenIdToPerson: vi.fn(async () => personA),
      tokenIdToVersionIndex: vi.fn(async () => 3n),
      nftCoreInfo: vi.fn(async () => {
        throw new Error("no core info");
      }),
    };
    const gateway = createAccountReadGateway(contract, null, new QueryCache());

    const page = await gateway.listNftsByOwner(ACCOUNT, 0, 10);
    expect(page.rows).toEqual([
      { tokenId: 101, personHash: personA, versionIndex: 3, fullName: undefined },
    ]);
  });

  it("reads creator versions from logs newest-first and caches the scan", async () => {
    const queryFilter = vi.fn(async () => [
      { args: { personHash: personA, versionIndex: 1n, timestamp: 11n }, blockNumber: 10 },
      { args: { personHash: personB, versionIndex: 2n, timestamp: 22n }, blockNumber: 20 },
    ]);
    const contract = {
      runner: { provider: { getBlockNumber: vi.fn(async () => 100) } },
      filters: { PersonVersionAdded: vi.fn(() => "FILTER") },
      queryFilter,
    };
    const cache = new QueryCache();
    const gateway = createAccountReadGateway(contract, null, cache);

    const first = await gateway.listVersionsByCreator(ACCOUNT, 0, 10);

    expect(contract.filters.PersonVersionAdded).toHaveBeenCalledWith(null, null, ACCOUNT);
    expect(first.rows).toEqual([
      { personHash: personB, versionIndex: 2, blockNumber: 20, timestamp: 22 },
      { personHash: personA, versionIndex: 1, blockNumber: 10, timestamp: 11 },
    ]);
    expect(first.totalCount).toBe(2);
    expect(first.truncated).toBe(false);
    expect(queryFilter).toHaveBeenCalledTimes(1);

    // Second page comes from the cached scan, not another log sweep.
    const second = await gateway.listVersionsByCreator(ACCOUNT, 1, 10);
    expect(queryFilter).toHaveBeenCalledTimes(1);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].personHash).toBe(personA);
  });

  it("resolves names only for minted pairs and survives partial failures", async () => {
    const contract = {
      versionToTokenId: vi.fn(async (personHash: string) => {
        if (personHash === personA) return 55n;
        if (personHash === personB) return 0n; // never minted
        throw new Error("unreadable");
      }),
      nftCoreInfo: vi.fn(async () => ({
        basicInfo: {},
        supplementInfo: { fullName: "Byron Lovelace" },
      })),
    };
    const gateway = createAccountReadGateway(contract, null, new QueryCache());

    const resolved = await gateway.resolveMintedIdentities([
      { personHash: personA, versionIndex: 1 },
      { personHash: personB, versionIndex: 2 },
      { personHash: "0xdddd", versionIndex: 3 },
    ]);

    expect(resolved).toEqual({
      [`${personA}:1`]: { tokenId: 55, fullName: "Byron Lovelace" },
    });
    // An unminted pair and an unreadable one are both simply absent.
    expect(contract.nftCoreInfo).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when no provider is reachable for the log scan", async () => {
    const gateway = createAccountReadGateway(
      { filters: { PersonVersionAdded: vi.fn() } },
      null,
      new QueryCache(),
    );
    await expect(gateway.listVersionsByCreator(ACCOUNT, 0, 10)).rejects.toThrow(
      /No provider available/,
    );
  });
});
