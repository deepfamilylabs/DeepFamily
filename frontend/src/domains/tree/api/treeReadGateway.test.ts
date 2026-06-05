import { describe, it, expect, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import { makeNodeId } from "../../../shared/model";
import { createTreeReadGateway } from "./treeReadGateway";

describe("treeReadGateway listChildrenStrictAll", () => {
  it("paginates, deduplicates, and sorts child ids", async () => {
    const parentHash = "0xparent";
    const childA = "0xaaa";
    const childB = "0xbbb";
    const contract = {
      listChildren: vi.fn(),
    };
    const responses: any[] = [
      [[childB, childA], [2, 1], null, true, 2],
      [[childA], [1], null, false, 2],
    ];
    contract.listChildren.mockImplementation(async () => responses.shift());

    const gateway = createTreeReadGateway(contract, new QueryCache());
    const childIds = await gateway.listChildrenStrictAll(parentHash, 1, { pageLimit: 2 });

    expect(childIds).toEqual([makeNodeId(childA, 1), makeNodeId(childB, 2)]);
    expect(contract.listChildren).toHaveBeenCalledTimes(2);
    expect(contract.listChildren).toHaveBeenNthCalledWith(1, parentHash, 1, 0, 2);
    expect(contract.listChildren).toHaveBeenNthCalledWith(2, parentHash, 1, 2, 2);
  });
});

describe("treeReadGateway listChildrenUnionAll", () => {
  it("merges children across versions and pages with dedup", async () => {
    const parentHash = "0xparent";
    const childA = "0xaaa";
    const childB = "0xbbb";
    const contract = {
      listPersonVersions: vi.fn(async () => ({ totalVersions: 1 })),
      listChildren: vi.fn(async (_hash: string, parentVer: number, offset: number) => {
        if (parentVer === 0 && offset === 0) return [[childB], [1], null, true, 1];
        if (parentVer === 0 && offset === 1) return [[childA, childB], [1, 1], null, false, 1];
        if (parentVer === 1 && offset === 0) return [[childA], [1], null, false, 1];
        return [[], [], null, false, offset];
      }),
    };

    const gateway = createTreeReadGateway(contract, new QueryCache());
    const result = await gateway.listChildrenUnionAll(parentHash, {
      pageLimit: 2,
      totalVersionsOptions: { ttlMs: 1000 },
    });

    expect(result.totalVersions).toBe(1);
    expect(result.childIds).toEqual([makeNodeId(childA, 1), makeNodeId(childB, 1)]);
    expect(contract.listPersonVersions).toHaveBeenCalledTimes(1);
    expect(contract.listChildren).toHaveBeenCalledTimes(3);
  });
});

describe("treeReadGateway trusted endorser reads", () => {
  it("paginates and deduplicates trusted source accounts", async () => {
    const personHash = "0xPerson";
    const accountA = "0xAaA";
    const accountB = "0xBbB";
    const contract = {
      listTrustedEndorsers: vi.fn(),
    };
    const responses: any[] = [
      [[accountB, accountA], 3, true, 2],
      [[accountA], 3, false, 3],
    ];
    contract.listTrustedEndorsers.mockImplementation(async () => responses.shift());

    const gateway = createTreeReadGateway(contract, new QueryCache());
    const accounts = await gateway.listTrustedEndorsersAll(personHash, 1, { pageLimit: 2 });

    expect(accounts).toEqual([accountB.toLowerCase(), accountA.toLowerCase()]);
    expect(contract.listTrustedEndorsers).toHaveBeenCalledTimes(2);
    expect(contract.listTrustedEndorsers).toHaveBeenNthCalledWith(1, personHash, 1, 0, 2);
    expect(contract.listTrustedEndorsers).toHaveBeenNthCalledWith(2, personHash, 1, 2, 2);
  });

  it("normalizes trusted source account sets for visibility cache hits", async () => {
    const personHash = "0xPerson";
    const accountA = "0x00000000000000000000000000000000000000aA";
    const accountB = "0x00000000000000000000000000000000000000Bb";
    const contract = {
      isVersionEndorsedByAny: vi.fn(async () => true),
    };

    const gateway = createTreeReadGateway(contract, new QueryCache());
    await expect(
      gateway.isVersionEndorsedByAny(personHash, 2, [accountB, accountA, accountA], {
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true);
    await expect(
      gateway.isVersionEndorsedByAny(personHash, 2, [accountA.toLowerCase(), accountB], {
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true);
    await expect(gateway.isVersionEndorsedByAny(personHash, 2, [])).resolves.toBe(false);

    expect(contract.isVersionEndorsedByAny).toHaveBeenCalledTimes(1);
    expect(contract.isVersionEndorsedByAny).toHaveBeenCalledWith(personHash, 2, [
      accountA.toLowerCase(),
      accountB.toLowerCase(),
    ]);
  });
});
