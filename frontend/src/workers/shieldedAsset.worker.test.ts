import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { normalizeChainError } from "@deepfamily/chain-client";

const mocks = vi.hoisted(() => ({ call: vi.fn(), safeMessage: vi.fn() }));
vi.mock("./shieldedAssetSession", () => ({
  ShieldedAssetSession: class { call = mocks.call; },
  shieldedAssetErrorMessage: mocks.safeMessage,
}));
vi.mock("../shared/workers/trustedWorkerUrls", () => ({ installTrustedWorkerUrlPolicy: vi.fn() }));

let handler: (event: { data: unknown }) => void;
const postMessage = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  mocks.call.mockReset();
  mocks.safeMessage.mockReset().mockReturnValue("Asset operation could not be completed.");
  postMessage.mockReset();
  vi.stubGlobal("self", { addEventListener: (_type: string, listener: typeof handler) => { handler = listener; }, postMessage });
  await import("./shieldedAsset.worker");
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["NETWORK_ERROR", "NETWORK_ERROR"],
  ["privateCustomSecretCode", "CHAIN_OPERATION_FAILED"],
])("posts only the safe message and canonical metadata for failure code %s", async (code, publicCode) => {
  const failure = normalizeChainError(Object.assign(new Error("private-network-error"), {
    code, witness: "private-witness", request: { passphrase: "private-passphrase" },
  }), { category: "network", operation: "read" });
  mocks.call.mockRejectedValue(failure);
  const request = { id: 1, method: "recover", params: { rawPassphrase: "private-input" } };
  handler({ data: request });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
  expect(postMessage.mock.calls[0][0]).toEqual({ id: 1, ok: false, error: {
    message: "Asset operation could not be completed.",
    chainError: { category: "network", operation: "read", code: publicCode, retryable: true },
  } });
  expect(JSON.stringify(postMessage.mock.calls[0][0])).not.toContain("private");
  expect(mocks.safeMessage).toHaveBeenCalledExactlyOnceWith(failure, "recover");
  expect(request.params).toBeUndefined();
});
