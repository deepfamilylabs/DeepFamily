import { describe, expect, it } from "vitest";
import { summarizeDataSourceHealth } from "./dataSourceHealth";
import type { DataSourceHealthInput, RootHealth } from "./dataSourceHealth";

const READER = "0x" + "1".repeat(40);
const CONTRACT = "0x" + "2".repeat(40);

function input(overrides: Partial<DataSourceHealthInput> = {}): DataSourceHealthInput {
  return {
    readerAddress: READER,
    contractAddress: CONTRACT,
    moduleResolutionError: null,
    root: "ok" as RootHealth,
    ...overrides,
  };
}

describe("summarizeDataSourceHealth", () => {
  it("clears everything when the reader resolved and the root is on the chain", () => {
    expect(summarizeDataSourceHealth(input())).toEqual({
      reader: "ok",
      root: "ok",
      problem: null,
      isChecking: false,
    });
  });

  it("calls an unconfigured reader unset, not broken", () => {
    const health = summarizeDataSourceHealth(input({ readerAddress: "  ", contractAddress: "" }));
    expect(health.reader).toBe("unset");
    expect(health.problem).toBe("readerUnset");
  });

  it("waits while the reader is still resolving", () => {
    const health = summarizeDataSourceHealth(input({ contractAddress: "" }));
    expect(health.reader).toBe("checking");
    expect(health.isChecking).toBe(true);
    expect(health.problem).toBeNull();
  });

  it("reports a reader that did not answer on this chain", () => {
    const health = summarizeDataSourceHealth(
      input({ contractAddress: "", moduleResolutionError: "Invalid reader address" }),
    );
    expect(health.reader).toBe("unreachable");
    expect(health.problem).toBe("readerUnreachable");
  });

  it("does not blame the root for a reader that never answered", () => {
    // The root check cannot even be put without a reader, so whatever it last
    // said belongs to the chain before this one.
    const health = summarizeDataSourceHealth(
      input({ contractAddress: "", moduleResolutionError: "boom", root: "missing" }),
    );
    expect(health.root).toBe("idle");
    expect(health.problem).toBe("readerUnreachable");
  });

  it("reports a root hash that is not recorded on this chain", () => {
    expect(summarizeDataSourceHealth(input({ root: "missing" })).problem).toBe("rootMissing");
  });

  it("separates a missing version from a missing person", () => {
    expect(summarizeDataSourceHealth(input({ root: "versionMissing" })).problem).toBe(
      "rootVersionMissing",
    );
  });

  it("reports a root that could not be checked at all", () => {
    expect(summarizeDataSourceHealth(input({ root: "unreachable" })).problem).toBe(
      "rootUnreachable",
    );
  });

  it("says nothing while the root answer is in flight", () => {
    const health = summarizeDataSourceHealth(input({ root: "checking" }));
    expect(health.isChecking).toBe(true);
    expect(health.problem).toBeNull();
  });

  it("treats a root nobody asked about as no problem", () => {
    const health = summarizeDataSourceHealth(input({ root: "idle" }));
    expect(health.problem).toBeNull();
    expect(health.isChecking).toBe(false);
  });
});
