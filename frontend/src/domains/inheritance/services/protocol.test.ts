import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { ReceiveChain } from "../../../shared/clients/receiveChain";
import { ReceiveProtocol } from "./protocol";

type TransactionOptions = NonNullable<ConstructorParameters<typeof ReceiveChain>[2]>;
const mocks = vi.hoisted(() => ({ options: [] as TransactionOptions[], destroy: vi.fn() }));
vi.mock("ethers", () => ({ JsonRpcProvider: class { destroy = mocks.destroy; } }));
vi.mock("../../../shared/clients/receiveChain", () => ({ ReceiveChain: class {
  constructor(_deployment: unknown, _runner: unknown, options?: TransactionOptions) {
    if (options) mocks.options.push(options);
  }
} }));

// Keep the actual worker client so these tests cover cancellation of an outstanding
// dispatch and a response already delivered before the async caller resumes.
class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: Array<{ id: number; method: string; input: unknown }> = [];
  private listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: { id: number; method: string; input: unknown }) {
    this.requests.push(structuredClone(request));
  }
  addEventListener(name: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]);
  }
  reply(result: unknown) {
    for (const listener of this.listeners.get("message") ?? [])
      listener({ data: { id: this.requests[0].id, ok: true, result } });
  }
}
const deployment = { chainId: 31337n,
  registryAddress: "0x0000000000000000000000000000000000001234",
  poolAddress: "0x0000000000000000000000000000000000004321" };
const manifest = { version: 1 as const, chainId: "31337", registryAddress: deployment.registryAddress, circuits: {} };
const status = { issuanceRoot: 11n, nonce: 13n, childTag: 17n, endorsementTag: 19n, trustedTag: 23n };
const protocols: ReceiveProtocol[] = [];
const setup = () => {
  const protocol = new ReceiveProtocol("http://localhost:8545", deployment, manifest);
  protocols.push(protocol);
  protocol.transactions({} as Signer);
  return { protocol, options: mocks.options[mocks.options.length - 1]! };
};
beforeEach(() => {
  mocks.options.length = 0;
  mocks.destroy.mockClear();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  for (const protocol of protocols.splice(0)) protocol.close();
  vi.unstubAllGlobals();
});

describe("public receive transaction cancellation", () => {
  it.each(["cancel", "close"] as const)("invalidates an existing transaction adapter on %s before another worker starts", async action => {
    const { protocol, options } = setup();
    expect(() => options.beforeTransaction!()).not.toThrow();
    protocol[action]();
    expect(() => options.beforeTransaction!()).toThrow("cancelled");
    await expect(options.prepareRevocationScans!(status)).rejects.toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(0);
    expect(mocks.destroy).toHaveBeenCalledTimes(action === "close" ? 1 : 0);
  });

  it.each(["cancel", "close"] as const)("terminates an outstanding preparation on %s and keeps the old adapter invalid", async action => {
    const { protocol, options } = setup();
    const pending = options.prepareRevocationScans!(status);
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]).toMatchObject({ method: "prepareRevocationScans", input: status });
    protocol[action]();
    await expect(pending).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(() => options.beforeTransaction!()).toThrow("cancelled");
    await expect(options.prepareRevocationScans!(status)).rejects.toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it.each(["cancel", "close"] as const)("rejects an already delivered proof response if %s occurs before its await resumes", async action => {
    const { protocol, options } = setup();
    const pending = options.prepareRevocationScans!(status);
    const worker = FakeWorker.instances[0];
    worker.reply({ revocationScans: [] });
    protocol[action]();
    await expect(pending).rejects.toThrow("cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(() => options.beforeTransaction!()).toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("allows an explicitly created adapter after cancellation while the old one stays invalid", async () => {
    const { protocol, options: old } = setup();
    protocol.cancel();
    protocol.transactions({} as Signer);
    const next = mocks.options[mocks.options.length - 1]!;
    expect(() => old.beforeTransaction!()).toThrow("cancelled");
    expect(() => next.beforeTransaction!()).not.toThrow();
    const pending = next.prepareRevocationScans!(status);
    expect(FakeWorker.instances).toHaveLength(1);
    FakeWorker.instances[0].reply({ revocationScans: [] });
    await expect(pending).resolves.toEqual([]);
    await expect(old.prepareRevocationScans!(status)).rejects.toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
