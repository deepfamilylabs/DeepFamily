// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelShieldedAssetPreview,
  getShieldedAssetWorkerGeneration,
  shieldedAssetWorkerCall,
  subscribeShieldedAssetWorkerLock,
  terminateShieldedAssetWorker,
} from "./shieldedAssetWorkerClient";
class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: any[] = [];
  clones: any[] = [];
  listeners = new Map<string, ((event: any) => void)[]>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: any) {
    this.clones.push(structuredClone(request));
    this.requests.push(request);
  }
  addEventListener(type: string, callback: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, data: any) {
    for (const callback of this.listeners.get(type) ?? []) callback({ data });
  }
}
const identity = {
  fullName: "Child",
  gender: 1,
  birthYear: 2000,
  birthMonth: 1,
  birthDay: 1,
  isBirthBC: false,
};
describe("asset Worker secret lifetime", () => {
  beforeEach(() => {
    terminateShieldedAssetWorker();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    terminateShieldedAssetWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("clears dispatch envelopes after cloning and retains the session until lock", async () => {
    const promise = shieldedAssetWorkerCall("unlockIdentity", {
      identity,
      rawPassphrase: "private-identity",
    });
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0].params).toBeUndefined();
    expect(worker.clones[0].params.rawPassphrase).toBe("private-identity");
    worker.emit("message", {
      id: worker.clones[0].id,
      ok: true,
      result: { identity: null, funds: null },
    });
    await promise;
    expect(worker.terminate).not.toHaveBeenCalled();
    terminateShieldedAssetWorker();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("lock rejects pending jobs and ignores late responses from the old realm", async () => {
    const promise = shieldedAssetWorkerCall("unlockIdentity", {
      identity,
      rawPassphrase: "secret",
    });
    const old = FakeWorker.instances[0];
    const rejected = expect(promise).rejects.toThrow("locked");
    terminateShieldedAssetWorker();
    await rejected;
    const replacement = shieldedAssetWorkerCall("cancelPreview", {});
    const next = FakeWorker.instances[1];
    old.emit("message", { id: next.clones[0].id, ok: true, result: { leaked: true } });
    next.emit("message", { id: next.clones[0].id, ok: true, result: { ok: true } });
    await expect(replacement).resolves.toEqual({ ok: true });
  });
  it("timeout destroys all jobs instead of keeping a forgotten root unlocked", async () => {
    vi.useFakeTimers();
    const promise = shieldedAssetWorkerCall("cancelPreview", {}, { timeoutMs: 10 });
    const rejected = expect(promise).rejects.toThrow("locked");
    vi.advanceTimersByTime(10);
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it("abort destroys the realm", async () => {
    const controller = new AbortController();
    const promise = shieldedAssetWorkerCall(
      "unlockIdentity",
      { identity, rawPassphrase: "secret-abort" },
      { signal: controller.signal },
    );
    const rejected = expect(promise).rejects.toThrow("locked");
    controller.abort();
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it("failed clone discards diagnostics which could contain secrets", async () => {
    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(() => {
      throw new Error("secret-clone");
    });
    await expect(
      shieldedAssetWorkerCall("unlockIdentity", { identity, rawPassphrase: "secret-clone" }),
    ).rejects.toThrow("locked");
    expect(FakeWorker.instances[0].requests).toHaveLength(0);
  });
  it("cancelling a nonexistent preview does not start a secret session", async () => {
    await cancelShieldedAssetPreview();
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it("notifies public session owners on lock and advances the generation", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeShieldedAssetWorkerLock(listener);
    const before = getShieldedAssetWorkerGeneration();
    terminateShieldedAssetWorker();
    expect(listener).toHaveBeenCalledOnce();
    expect(getShieldedAssetWorkerGeneration()).toBeGreaterThan(before);
    unsubscribe();
  });
});
