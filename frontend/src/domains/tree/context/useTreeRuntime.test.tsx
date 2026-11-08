// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/cache/queryClient";
import { tvKey } from "../../../shared/cache/queryKeys";
import { useTreeRuntime } from "./useTreeRuntime";

const mocks = vi.hoisted(() => ({
  config: {
    rpcUrl: "rpc-a", chainId: 1, contractAddress: "0xaaa", readerAddress: "reader-a",
    rootHash: "", rootVersionIndex: 1,
  },
  readsA: vi.fn(),
  readsB: vi.fn(),
}));
vi.mock("../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: (rpc: string) => ({ rpc }),
}));
vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({}),
  createDeepFamilyInterface: () => ({}),
  createDeepFamilyReaderContract: (address: string) => ({
    listPersonVersions: address === "reader-a" ? mocks.readsA : mocks.readsB,
  }),
}));

const personHash = `0x${"12".repeat(32)}`;
const options = { ttlMs: 60_000 };
const scopeA = { rpcUrl: "rpc-a", chainId: 1, contractAddress: "0xaaa", readerAddress: "reader-a" };
const scopeB = { rpcUrl: "rpc-b", chainId: 2, contractAddress: "0xbbb", readerAddress: "reader-b" };

describe("tree runtime cache binding", () => {
  beforeEach(() => {
    queryClient.clear();
    mocks.config = { ...scopeA, rootHash: "", rootVersionIndex: 1 };
    mocks.readsA.mockReset().mockResolvedValue({ totalVersions: 11 });
    mocks.readsB.mockReset().mockResolvedValue({ totalVersions: 22 });
  });
  afterEach(cleanup);

  it("reads the new chain rather than a cached value from the previous chain", async () => {
    const { result, rerender } = renderHook(() => useTreeRuntime());
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(11);
    const originalCache = result.current.queryCacheRef;

    mocks.config = { ...mocks.config, ...scopeB };
    act(() => rerender());
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(22);
    expect(mocks.readsB).toHaveBeenCalledOnce();
    expect(originalCache.current.get(tvKey(personHash), 60_000)).toBe(11);
    expect(result.current.queryCacheRef.current.get(tvKey(personHash), 60_000)).toBe(22);
  });

  it("keeps late reads and captured cache actions in their original scope", async () => {
    let resolve!: (value: { totalVersions: number }) => void;
    mocks.readsA.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result, rerender } = renderHook(() => useTreeRuntime());
    const originalCache = result.current.queryCacheRef;
    const pending = result.current.api!.getTotalVersions(personHash, options);
    mocks.config = { ...mocks.config, ...scopeB };
    act(() => rerender());
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(22);
    resolve({ totalVersions: 11 });
    await pending;
    originalCache.current.clear();
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(22);
    expect(mocks.readsB).toHaveBeenCalledOnce();
  });

  it("rebinds the cache even when a reader instance is unchanged", async () => {
    const { result, rerender } = renderHook(() => useTreeRuntime());
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(11);
    mocks.readsA.mockResolvedValue({ totalVersions: 33 });
    mocks.config = { ...mocks.config, contractAddress: "0xccc" };
    act(() => rerender());
    expect(await result.current.api!.getTotalVersions(personHash, options)).toBe(33);
  });
});
