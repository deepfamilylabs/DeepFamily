// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = "0x" + "b".repeat(64);
const READER = "0x" + "1".repeat(40);
const CONTRACT = "0x" + "2".repeat(40);

const mocks = vi.hoisted(() => ({
  config: {
    readerAddress: "",
    contractAddress: "",
    moduleResolutionError: null as string | null,
    rootHash: "",
    rootVersionIndex: 1,
  },
  gateway: null as { listVersionEndorsements: ReturnType<typeof vi.fn> } | null,
}));

vi.mock("../../context", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("../../../person", () => ({
  usePersonGateway: () => mocks.gateway,
}));

import { useDataSourceHealth } from "./useDataSourceHealth";

function listReturning(totalVersions: number) {
  return vi.fn().mockResolvedValue({
    versionIndices: [],
    endorsementCounts: [],
    tokenIds: [],
    totalVersions,
    hasMore: false,
    nextOffset: 0,
  });
}

describe("useDataSourceHealth", () => {
  beforeEach(() => {
    mocks.config = {
      readerAddress: READER,
      contractAddress: CONTRACT,
      moduleResolutionError: null,
      rootHash: ROOT,
      rootVersionIndex: 1,
    };
    mocks.gateway = { listVersionEndorsements: listReturning(3) };
  });

  it("clears the root once the chain says it has versions", async () => {
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.root).toBe("ok"));
    expect(result.current.problem).toBeNull();
    // One row, not a page: the total is what the question was about.
    expect(mocks.gateway?.listVersionEndorsements).toHaveBeenCalledWith(ROOT, 0, 1);
  });

  it("reports a root hash the chain has never heard of", async () => {
    mocks.gateway = { listVersionEndorsements: listReturning(0) };
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.problem).toBe("rootMissing"));
  });

  it("reports a version index past what the chain holds", async () => {
    mocks.config.rootVersionIndex = 9;
    mocks.gateway = { listVersionEndorsements: listReturning(3) };
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.problem).toBe("rootVersionMissing"));
  });

  it("reports a root the chain could not be asked about", async () => {
    mocks.gateway = { listVersionEndorsements: vi.fn().mockRejectedValue(new Error("rpc down")) };
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.problem).toBe("rootUnreachable"));
  });

  it("does not ask about the root until the reader has resolved", async () => {
    mocks.config.contractAddress = "";
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.reader).toBe("checking"));
    expect(mocks.gateway?.listVersionEndorsements).not.toHaveBeenCalled();
    expect(result.current.root).toBe("idle");
  });

  it("blames the reader, not the root, when the reader did not answer", async () => {
    mocks.config.contractAddress = "";
    mocks.config.moduleResolutionError = "Invalid reader address";
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.problem).toBe("readerUnreachable"));
    expect(mocks.gateway?.listVersionEndorsements).not.toHaveBeenCalled();
  });

  it("does not ask about a root hash that is not a hash", async () => {
    mocks.config.rootHash = "not-a-hash";
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.reader).toBe("ok"));
    expect(mocks.gateway?.listVersionEndorsements).not.toHaveBeenCalled();
    expect(result.current.problem).toBeNull();
  });

  it("reports an unset reader rather than a false all-clear", async () => {
    mocks.config.readerAddress = "";
    mocks.config.contractAddress = "";
    const { result } = renderHook(() => useDataSourceHealth());

    await waitFor(() => expect(result.current.problem).toBe("readerUnset"));
    expect(result.current.isChecking).toBe(false);
  });
});
