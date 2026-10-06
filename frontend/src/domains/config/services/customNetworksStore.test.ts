// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCustomNetworks, saveCustomNetworks } from "./customNetworksStore";

const STORAGE_KEY = "ft:customNetworks";

describe("customNetworksStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when storage is empty", () => {
    expect(loadCustomNetworks()).toEqual([]);
  });

  it("returns an empty list when storage value is invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(loadCustomNetworks()).toEqual([]);
  });

  it("returns an empty list when storage value is not an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chainId: 1 }));
    expect(loadCustomNetworks()).toEqual([]);
  });

  it("filters out malformed entries and marks survivors as custom", () => {
    const reader = "0x" + "9".repeat(40);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { chainId: 1234, name: "Local", rpcUrl: "http://localhost", readerAddress: reader },
        { chainId: "bad", name: "X", rpcUrl: "http://x", readerAddress: reader },
        null,
        { name: "missing-id", rpcUrl: "http://y", readerAddress: reader },
        { chainId: 5678, name: "missing-reader", rpcUrl: "http://z" },
      ]),
    );
    expect(loadCustomNetworks()).toEqual([
      {
        chainId: 1234,
        name: "Local",
        rpcUrl: "http://localhost",
        readerAddress: reader,
        isCustom: true,
      },
    ]);
  });

  it("persists only chainId/name/rpcUrl/readerAddress on save", () => {
    const reader = "0x" + "9".repeat(40);
    saveCustomNetworks([
      { chainId: 9, name: "Foo", rpcUrl: "http://foo", readerAddress: reader, isCustom: true },
    ]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBe(
      JSON.stringify([{ chainId: 9, name: "Foo", rpcUrl: "http://foo", readerAddress: reader }]),
    );
  });
  it("carries the entry contract, which nothing else on this build knows", () => {
    const reader = "0x" + "9".repeat(40);
    saveCustomNetworks([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local", readerAddress: reader },
    ]);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local", readerAddress: reader },
    ]);
    expect(loadCustomNetworks()[0].readerAddress).toBe(reader);
  });
});
