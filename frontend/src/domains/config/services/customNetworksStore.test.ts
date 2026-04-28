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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { chainId: 1234, name: "Local", rpcUrl: "http://localhost" },
        { chainId: "bad", name: "X", rpcUrl: "http://x" },
        null,
        { name: "missing-id", rpcUrl: "http://y" },
      ]),
    );
    expect(loadCustomNetworks()).toEqual([
      { chainId: 1234, name: "Local", rpcUrl: "http://localhost", isCustom: true },
    ]);
  });

  it("persists only chainId/name/rpcUrl on save", () => {
    saveCustomNetworks([
      { chainId: 9, name: "Foo", rpcUrl: "http://foo", isCustom: true },
    ]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBe(JSON.stringify([{ chainId: 9, name: "Foo", rpcUrl: "http://foo" }]));
  });
});
