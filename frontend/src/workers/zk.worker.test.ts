// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), post: vi.fn() }));
vi.mock("../shared/zk/zkSnark", () => ({ generatePersonRelationProof: vi.fn(), verifyPersonRelationProof: mocks.verify, generateDisclosureBindingProof: vi.fn(), verifyDisclosureBindingProof: mocks.verify }));
let onMessage: (event: { data: any }) => Promise<void>;
beforeAll(async () => { vi.stubGlobal("self", { addEventListener: (_type: string, listener: typeof onMessage) => { onMessage = listener; }, postMessage: mocks.post }); await import("./zk.worker"); });
beforeEach(() => vi.resetAllMocks()); afterAll(() => vi.unstubAllGlobals());
describe("identity proof worker secret boundary", () => {
  it("clears the request and redacts proof exceptions", async () => {
    mocks.verify.mockRejectedValueOnce(new Error("private-witness-must-not-cross"));
    const request = { id: 7, method: "verifyPersonRelationProof", params: { proof: {}, publicSignals: [] } };
    await onMessage({ data: request });
    expect(request.params).toBeUndefined();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ id: 7, ok: false, error: { message: "Local cryptographic operation failed" } });
  });
  it("returns only the proof verification result", async () => {
    mocks.verify.mockResolvedValueOnce(true);
    const request = { id: 8, method: "verifyPersonRelationProof", params: { proof: {}, publicSignals: [] } };
    await onMessage({ data: request });
    expect(request.params).toBeUndefined();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ id: 8, ok: true, result: { ok: true } });
  });
  it("rejects unknown operations and clears their input", async () => {
    const request = { id: 9, method: "unrecognizedOperation", params: { privateInput: "secret" } };
    await onMessage({ data: request });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ id: 9, ok: false, error: { message: "Invalid ZK worker request" } });
    expect(request.params).toBeUndefined();
  });
});
