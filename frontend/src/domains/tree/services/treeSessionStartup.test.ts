import { describe, expect, it, vi } from "vitest";
import * as treeSessionErrors from "./treeSessionErrors";
import * as treeSessionPreflight from "./treeSessionPreflight";
import { verifyTreeSessionStartup } from "./treeSessionStartup";

describe("treeSessionStartup", () => {
  it("returns ok when provider and root are ready", async () => {
    const ensureProviderReady = vi
      .spyOn(treeSessionPreflight, "ensureTreeProviderReady")
      .mockResolvedValue(undefined);
    const ensureRootExists = vi
      .spyOn(treeSessionPreflight, "ensureTreeRootExists")
      .mockResolvedValue(undefined);

    await expect(
      verifyTreeSessionStartup({
        provider: {},
        api: {},
        rootHash: "0xabc",
        rootVersionIndex: 1,
        versionDetailsTtlMs: 1000,
      }),
    ).resolves.toEqual({ ok: true });

    expect(ensureProviderReady).toHaveBeenCalled();
    expect(ensureRootExists).toHaveBeenCalled();
  });

  it("classifies provider failures", async () => {
    const error = new Error("provider failed");
    vi.spyOn(treeSessionPreflight, "ensureTreeProviderReady").mockRejectedValue(error);
    vi.spyOn(treeSessionErrors, "classifyTreeSessionConnectionError").mockReturnValue("networkError");

    await expect(
      verifyTreeSessionStartup({
        provider: {},
        api: {},
        rootHash: "0xabc",
        rootVersionIndex: 1,
        versionDetailsTtlMs: 1000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      stage: "provider",
      status: "networkError",
      isRootInvalid: false,
      error,
    });
  });

  it("classifies root failures", async () => {
    const error = new Error("root failed");
    vi.spyOn(treeSessionPreflight, "ensureTreeProviderReady").mockResolvedValue(undefined);
    vi.spyOn(treeSessionPreflight, "ensureTreeRootExists").mockRejectedValue(error);
    vi.spyOn(treeSessionErrors, "classifyTreeRootCheckError").mockReturnValue({
      status: "rootNotFound",
      isRootInvalid: true,
    });

    await expect(
      verifyTreeSessionStartup({
        provider: {},
        api: {},
        rootHash: "0xabc",
        rootVersionIndex: 1,
        versionDetailsTtlMs: 1000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      stage: "root",
      status: "rootNotFound",
      isRootInvalid: true,
      error,
    });
  });
});
