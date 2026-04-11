import { describe, expect, it, vi } from "vitest";
import {
  ensureTreeProviderReady,
  ensureTreeRootExists,
} from "./treeSessionPreflight";

describe("treeSessionPreflight", () => {
  it("probes provider chain id", async () => {
    const provider = {
      send: vi.fn(async () => "0x1"),
    };

    await ensureTreeProviderReady(provider);

    expect(provider.send).toHaveBeenCalledWith("eth_chainId", []);
  });

  it("checks root existence through version details", async () => {
    const api = {
      getVersionDetails: vi.fn(async () => ({ version: {}, endorsementCount: 0, tokenId: "0" })),
    };

    await ensureTreeRootExists({
      api: api as any,
      rootHash: "0xabc",
      rootVersionIndex: 2,
      versionDetailsTtlMs: 123,
    });

    expect(api.getVersionDetails).toHaveBeenCalledWith("0xabc", 2, { ttlMs: 123 });
  });
});
