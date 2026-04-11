import { describe, expect, it } from "vitest";
import { applyTotalVersionsToNodes, parseTotalVersionsResult } from "./treeTotals";

describe("treeTotals parseTotalVersionsResult", () => {
  it("reads totalVersions from named and tuple fields", () => {
    expect(parseTotalVersionsResult({ totalVersions: 3 })).toBe(3);
    expect(parseTotalVersionsResult([null, 4])).toBe(4);
    expect(parseTotalVersionsResult({ totalVersions: "x" })).toBe(0);
  });
});

describe("treeTotals applyTotalVersionsToNodes", () => {
  it("updates all nodes for the same person hash", () => {
    const nodes = {
      "0xabc-v-1": { personHash: "0xAbC", versionIndex: 1, id: "0xabc-v-1", totalVersions: 1 },
      "0xabc-v-2": { personHash: "0xabc", versionIndex: 2, id: "0xabc-v-2" },
      "0xdef-v-1": { personHash: "0xdef", versionIndex: 1, id: "0xdef-v-1", totalVersions: 7 },
    };

    const out = applyTotalVersionsToNodes(nodes, "0xabc", 5);

    expect(out["0xabc-v-1"]?.totalVersions).toBe(5);
    expect(out["0xabc-v-2"]?.totalVersions).toBe(5);
    expect(out["0xdef-v-1"]?.totalVersions).toBe(7);
  });

  it("can ensure the current root node exists", () => {
    const out = applyTotalVersionsToNodes({}, "0xabc", 2, {
      ensureNode: { versionIndex: 3 },
    });

    expect(out["0xabc-v-3"]).toMatchObject({
      personHash: "0xabc",
      versionIndex: 3,
      totalVersions: 2,
    });
  });

  it("returns original object when nothing changes", () => {
    const nodes = {
      "0xabc-v-1": { personHash: "0xabc", versionIndex: 1, id: "0xabc-v-1", totalVersions: 2 },
    };

    expect(applyTotalVersionsToNodes(nodes, "0xabc", 2)).toBe(nodes);
  });
});
