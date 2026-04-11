import { describe, it, expect } from "vitest";
import {
  buildTreeTxInvalidation,
  getInvalidateKeysAfterPersonVersionAdded,
  parseTreeTxEvents,
} from "./treeInvalidation";
import { makeNodeId } from "../../../types/graph";
import { unionParentKey } from "../../../types/treeStore";
import { nftKey, tvKey, vdKey } from "../../../shared/cache/queryKeys";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";

const sort = (items: string[]) => [...items].sort();

describe("treeInvalidation getInvalidateKeysAfterPersonVersionAdded", () => {
  it("builds invalidation keys for child and parents", () => {
    const ev = {
      personHash: "0xchild",
      versionIndex: 1,
      fatherHash: "0xfather",
      fatherVersionIndex: 2,
      motherHash: "0xmother",
      motherVersionIndex: 3,
    };
    const out = getInvalidateKeysAfterPersonVersionAdded(ev);
    expect(sort(out.totalVersionsKeys)).toEqual(
      sort([tvKey("0xchild"), tvKey("0xfather"), tvKey("0xmother")]),
    );
    expect(sort(out.unionKeys)).toEqual(
      sort([unionParentKey("0xfather"), unionParentKey("0xmother")]),
    );
    expect(sort(out.strictKeys)).toEqual(
      sort([makeNodeId("0xfather", 2), makeNodeId("0xmother", 3)]),
    );
    expect(out.strictPrefixes).toEqual([]);
  });

  it("uses strict prefixes when parent version is missing/invalid", () => {
    const ev = {
      personHash: "0xchild",
      versionIndex: 1,
      fatherHash: "0xfather",
      fatherVersionIndex: undefined,
      motherHash: "0xmother",
      motherVersionIndex: 0,
    };
    const out = getInvalidateKeysAfterPersonVersionAdded(ev);
    expect(sort(out.unionKeys)).toEqual(
      sort([unionParentKey("0xfather"), unionParentKey("0xmother")]),
    );
    expect(out.strictKeys).toEqual([]);
    expect(sort(out.strictPrefixes)).toEqual(sort(["0xfather-v-", "0xmother-v-"]));
  });

  it("skips zero hashes", () => {
    const ev = {
      personHash: "0xchild",
      versionIndex: 1,
      fatherHash: "0x",
      fatherVersionIndex: 1,
      motherHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      motherVersionIndex: 2,
    };
    const out = getInvalidateKeysAfterPersonVersionAdded(ev);
    expect(out.unionKeys).toEqual([]);
    expect(out.strictKeys).toEqual([]);
    expect(out.strictPrefixes).toEqual([]);
    expect(out.totalVersionsKeys).toEqual([tvKey("0xchild")]);
  });
});

describe("treeInvalidation parseTreeTxEvents", () => {
  it("parses only target-contract logs", () => {
    const eventInterface = createDeepFamilyInterface();
    const addedEvent = eventInterface.getEvent("PersonVersionAdded");
    if (!addedEvent) {
      throw new Error("PersonVersionAdded event ABI missing");
    }

    const addedLog = eventInterface.encodeEventLog(addedEvent, [
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      2,
      "0x00000000000000000000000000000000000000bb",
      123n,
      "0x00000000000000000000000000000000000000000000000000000000000000bb",
      3,
      "0x00000000000000000000000000000000000000000000000000000000000000cc",
      4,
      "tag",
    ]);

    const out = parseTreeTxEvents(
      {
        logs: [
          {
            address: "0x0000000000000000000000000000000000000abc",
            topics: addedLog.topics,
            data: addedLog.data,
          },
          {
            address: "0x0000000000000000000000000000000000000def",
            topics: addedLog.topics,
            data: addedLog.data,
          },
        ],
      },
      eventInterface,
      "0x0000000000000000000000000000000000000abc",
    );

    expect(out.PersonVersionAdded).toHaveLength(1);
    expect(out.PersonVersionAdded[0]).toMatchObject({
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
      versionIndex: 2,
      fatherVersionIndex: 3,
      motherVersionIndex: 4,
    });
  });
});

describe("treeInvalidation buildTreeTxInvalidation", () => {
  it("collects invalidation targets from receipt events and hints", () => {
    const eventInterface = createDeepFamilyInterface();
    const endorseEvent = eventInterface.getEvent("PersonVersionEndorsed");
    const mintEvent = eventInterface.getEvent("PersonNFTMinted");
    if (!endorseEvent || !mintEvent) {
      throw new Error("Expected event ABI missing");
    }

    const endorseLog = eventInterface.encodeEventLog(endorseEvent, [
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      "0x00000000000000000000000000000000000000bb",
      2,
      "0x00000000000000000000000000000000000000cc",
      1n,
      "0x00000000000000000000000000000000000000dd",
      1n,
      2n,
      123n,
    ]);
    const mintLog = eventInterface.encodeEventLog(mintEvent, [
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      88n,
      "0x00000000000000000000000000000000000000bb",
      2,
      "ipfs://token-uri",
      456n,
    ]);

    const out = buildTreeTxInvalidation(
      {
        receipt: {
          logs: [
            {
              address: "0x0000000000000000000000000000000000000abc",
              topics: endorseLog.topics,
              data: endorseLog.data,
            },
            {
              address: "0x0000000000000000000000000000000000000abc",
              topics: mintLog.topics,
              data: mintLog.data,
            },
          ],
        },
        hints: {
          personHash: "0x00000000000000000000000000000000000000000000000000000000000000ff",
          versionIndex: 7,
          tokenId: "99",
        },
      },
      {
        eventInterface,
        contractAddress: "0x0000000000000000000000000000000000000abc",
      },
    );

    expect(out.versionDetailKeys.sort()).toEqual(
      [
        vdKey(
          "0x00000000000000000000000000000000000000000000000000000000000000aa",
          2,
        ),
        vdKey(
          "0x00000000000000000000000000000000000000000000000000000000000000ff",
          7,
        ),
      ].sort(),
    );
    expect(out.nftKeys.sort()).toEqual([nftKey("88"), nftKey("99")].sort());
    expect(out.parsedEvents.PersonVersionEndorsed).toHaveLength(1);
    expect(out.parsedEvents.PersonNFTMinted).toHaveLength(1);
  });
});
