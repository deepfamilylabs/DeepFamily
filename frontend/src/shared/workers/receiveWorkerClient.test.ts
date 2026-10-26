// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiveWorkerClient, type ReceiveWorkerContext } from "./receiveWorkerClient";
import { publicWorkerResult, publicWorkerError } from "../../workers/receive.worker";
import { ProtocolError } from "@deepfamily/protocol-core";
class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: unknown[] = [];
  clones: Array<{ id: number; input: unknown }> = [];
  listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: { id: number; input: unknown }) { this.requests.push(request); this.clones.push(structuredClone(request)); }
  addEventListener(name: string, listener: (event: { data: unknown }) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  reply(data: unknown) { for (const listener of this.listeners.get("message") ?? []) listener({ data }); }
}
const context: ReceiveWorkerContext = { rpcUrl: "http://localhost:8545",
  deployment: { chainId: 31337n, registryAddress: "0x0000000000000000000000000000000000001234", poolAddress: "0x0000000000000000000000000000000000004321" },
  manifest: { version: 1, chainId: "31337", registryAddress: "0x0000000000000000000000000000000000001234", circuits: {} } };
describe("receiving proof worker boundary", () => {
  let client: ReceiveWorkerClient;
  beforeEach(() => { vi.stubGlobal("Worker", FakeWorker); FakeWorker.instances = []; client = new ReceiveWorkerClient(); });
  afterEach(() => { client.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("clones each job then releases the dispatch envelope and returns only its matching public result", async () => {
    const pending = client.call("createCode", { masterKey: new Uint8Array(32).fill(37), chainId: 31337n,
      authorizerScope: context.deployment.registryAddress, codeIndex: 7n, expiresAt: 2_000_000_000n }, context);
    const worker = FakeWorker.instances[0];
    expect((worker.requests[0] as { input?: unknown }).input).toBeUndefined();
    expect(worker.clones[0].input).toHaveProperty("masterKey");
    worker.reply({ id: worker.clones[0].id, ok: true, result: { code: "dfreceive1public" } });
    await expect(pending).resolves.toEqual({ code: "dfreceive1public" });
  });
  it("cancellation terminates the secret realm and rejects active jobs", async () => {
    const abort = new AbortController();
    const pending = client.call("verifyCode", { code: "public" }, context, { signal: abort.signal });
    const worker = FakeWorker.instances[0];
    abort.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("preserves an explicit revoked status without sending prover messages or witnesses", async () => {
    const secret = "private-error-witness";
    const error = publicWorkerError(new ProtocolError("QUALIFICATION_REVOKED", secret));
    expect(error).toEqual({ code: "QUALIFICATION_REVOKED", message: "This qualification has been revoked." });
    const pending = client.call("verifyCode", { code: "public" }, context);
    const worker = FakeWorker.instances[0];
    worker.reply({ id: worker.clones[0].id, ok: false, error });
    await expect(pending).rejects.toMatchObject({ code: "QUALIFICATION_REVOKED" });
    for (const failure of [new Error(secret), new ProtocolError("INVALID_PROOF", secret),
      Object.assign(new Error(secret), { code: "NETWORK_ERROR", witness: secret })]) {
      expect(publicWorkerError(failure)).toEqual({ message: "Receive proof operation failed" });
    }
  });
  it("removes private witnesses and note openings even if a future SDK result grows extra fields", () => {
    const secret = "private-must-not-cross";
    const value = { kind: "create", code: { chainId: 31337n, private: secret, proof: { pi_a: [1n, 2n], witness: secret },
      capabilities: [{ issuanceRoot: 7n, private: secret, proof: { pi_c: [3n, 4n], witness: secret } }] },
      budgetKey: 5n, witness: { derivedSecretField: secret }, ownerSecret: secret, note: { familyCommitment: secret },
      publicInput: { inputRoot: 11n, derivedSecretField: secret }, proof: { pi_a: [1n, 2n], witness: secret } };
    const result = publicWorkerResult("prepareDeposit", value);
    expect(JSON.stringify(result, (_key, field) => typeof field === "bigint" ? String(field) : field)).not.toContain(secret);
    expect(result).toHaveProperty("budgetKey", 5n);
    expect(publicWorkerResult("createCode", { code: "public", ownerSecret: secret })).toEqual({ code: "public" });
  });
});
