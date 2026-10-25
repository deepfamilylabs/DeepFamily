// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ZkWorkerTerminatedError,
  terminateZkWorker,
  terminateZkWorkerIfIdle,
  zkWorkerCall,
} from "./zkWorkerClient";
import { subscribePublicStateSyncProgress } from "./publicStateSyncProgress";

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly messages: any[] = [];
  readonly deliveredMessages: any[] = [];
  readonly terminate = vi.fn(() => {
    this.deliveredMessages.length = 0;
  });
  private listeners = new Map<string, Array<(event: any) => void>>();

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: any): void {
    this.deliveredMessages.push(structuredClone(message));
    this.messages.push(message);
  }

  emit(type: string, data: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

describe("ZK worker lifecycle", () => {
  let unsubscribeProgress: (() => void) | undefined;
  beforeEach(() => {
    terminateZkWorker();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    unsubscribeProgress?.();
    unsubscribeProgress = undefined;
    terminateZkWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not return credentials from a failed structured clone", async () => {
    const secret = "zk-dispatch-secret-8Q!";
    const post = vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementationOnce((request) => {
      const passphrase = request.params.proof.pi_a[0];
      throw Object.assign(new Error(encodeURIComponent(passphrase)), { name: passphrase });
    });
    try {
      await expect(
        zkWorkerCall("verifyPersonRelationProof", {
          proof: { pi_a: [secret, "2", "1"] } as any, publicSignals: ["1"],
        }),
      ).rejects.toThrow("Local cryptographic operation failed");
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    } finally {
      post.mockRestore();
    }
  });

  it("publishes sync progress without settling proof verification or triggering idle cleanup", async () => {
    const listener = vi.fn();
    unsubscribeProgress = subscribePublicStateSyncProgress(listener);
    const call = zkWorkerCall("verifyPersonRelationProof", {
      proof: {} as any, publicSignals: ["1"],
    });
    const worker = FakeWorker.instances[0];
    const progress = { domain: "authorization", phase: "download", completed: 2, total: 3, resumed: true };
    let settled = false;
    void call.then(() => { settled = true; });
    worker.emit("message", { type: "publicStateSyncProgress", progress, id: worker.messages[0].id, ok: true, result: "not-the-code" });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledExactlyOnceWith(progress);
    expect(settled).toBe(false);
    expect(terminateZkWorkerIfIdle()).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].params).toBeUndefined();
    worker.emit("message", { id: worker.messages[0].id, ok: true, result: { ok: true } });
    await expect(call).resolves.toEqual({ ok: true });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("ignores malformed progress without settling a request or releasing its Worker", async () => {
    const listener = vi.fn();
    unsubscribeProgress = subscribePublicStateSyncProgress(listener);
    const call = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] });
    const worker = FakeWorker.instances[0];
    let settled = false;
    void call.then(() => { settled = true; });
    const valid = { domain: "lineage", phase: "verify", completed: 1, total: 2 };
    for (const progress of [
      undefined, null, {}, { ...valid, domain: "identity" }, { ...valid, phase: "proving" },
      { ...valid, completed: -1 }, { ...valid, total: 0 }, { ...valid, completed: NaN },
      { ...valid, total: Infinity }, { ...valid, total: "2" }, { ...valid, resumed: "yes" },
    ]) worker.emit("message", { type: "publicStateSyncProgress", progress, id: worker.messages[0].id, ok: true, result: "malformed" });
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit("message", { id: worker.messages[0].id, ok: true, result: { ok: true } });
    await expect(call).resolves.toEqual({ ok: true });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the original timeout deadline after a progress message", async () => {
    vi.useFakeTimers();
    const call = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] }, { timeoutMs: 100 });
    const rejected = expect(call).rejects.toThrow("ZK worker timeout");
    const worker = FakeWorker.instances[0];
    vi.advanceTimersByTime(90);
    worker.emit("message", { type: "publicStateSyncProgress", progress: { domain: "authorization", phase: "catchup", completed: 2, total: 3 } });
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("renews default liveness deadlines for active and queued calls while synchronization advances", async () => {
    vi.useFakeTimers();
    const params = { proof: {} as any, publicSignals: ["1"] };
    const active = zkWorkerCall("verifyPersonRelationProof", params);
    const queued = zkWorkerCall("verifyPersonRelationProof", params);
    const rejected = Promise.all([expect(active).rejects.toThrow("ZK worker timeout"), expect(queued).rejects.toThrow("ZK worker timeout")]);
    const worker = FakeWorker.instances[0];
    for (const completed of [1, 2]) {
      vi.advanceTimersByTime(179_000);
      worker.emit("message", { type: "publicStateSyncProgress", progress: { domain: "authorization", phase: "download", completed, total: 4 } });
      expect(worker.terminate).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(179_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not renew a stalled default call for repeated, regressing, or total-only progress changes", async () => {
    vi.useFakeTimers();
    const active = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] });
    const rejected = expect(active).rejects.toThrow("ZK worker timeout");
    const worker = FakeWorker.instances[0];
    vi.advanceTimersByTime(150_000);
    const progress = { domain: "lineage", phase: "verify", completed: 2, total: 4 };
    worker.emit("message", { type: "publicStateSyncProgress", progress });
    vi.advanceTimersByTime(150_000);
    for (const change of [{}, { completed: 1 }, { total: 5 }, { resumed: true }])
      worker.emit("message", { type: "publicStateSyncProgress", progress: { ...progress, ...change } });
    vi.advanceTimersByTime(29_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("renews for a phase's first empty completion only once", async () => {
    vi.useFakeTimers();
    const active = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] });
    const rejected = expect(active).rejects.toThrow("ZK worker timeout");
    const worker = FakeWorker.instances[0];
    vi.advanceTimersByTime(150_000);
    const progress = { domain: "authorization", phase: "catchup", completed: 0, total: 0 };
    worker.emit("message", { type: "publicStateSyncProgress", progress });
    vi.advanceTimersByTime(150_000);
    worker.emit("message", { type: "publicStateSyncProgress", progress });
    vi.advanceTimersByTime(29_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("resets the progress watermark when the next queued operation starts after a response", async () => {
    vi.useFakeTimers();
    const params = { proof: {} as any, publicSignals: ["1"] };
    const first = zkWorkerCall("verifyPersonRelationProof", params);
    const queued = zkWorkerCall("verifyPersonRelationProof", params);
    const rejected = expect(queued).rejects.toThrow("ZK worker timeout");
    const worker = FakeWorker.instances[0];
    worker.emit("message", { type: "publicStateSyncProgress", progress: { domain: "lineage", phase: "verify", completed: 100, total: 200 } });
    worker.emit("message", { id: worker.messages[0].id, ok: true, result: { ok: true } });
    await first;
    vi.advanceTimersByTime(150_000);
    worker.emit("message", { type: "publicStateSyncProgress", progress: { domain: "lineage", phase: "verify", completed: 1, total: 20 } });
    vi.advanceTimersByTime(179_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects late progress from a terminated Worker while accepting its replacement", async () => {
    const listener = vi.fn();
    unsubscribeProgress = subscribePublicStateSyncProgress(listener);
    const call = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] });
    const old = FakeWorker.instances[0];
    const rejected = expect(call).rejects.toBeInstanceOf(ZkWorkerTerminatedError);
    terminateZkWorker();
    await rejected;
    const progress = { domain: "authorization", phase: "complete", completed: 3, total: 3 };
    old.emit("message", { type: "publicStateSyncProgress", progress });
    expect(listener).not.toHaveBeenCalled();
    const replacement = zkWorkerCall("verifyPersonRelationProof", { proof: {} as any, publicSignals: ["1"] });
    const next = FakeWorker.instances[1];
    old.emit("message", { type: "publicStateSyncProgress", progress, id: next.messages[0].id });
    expect(listener).not.toHaveBeenCalled();
    next.emit("message", { type: "publicStateSyncProgress", progress });
    expect(listener).toHaveBeenCalledExactlyOnceWith(progress);
    next.emit("message", { id: next.messages[0].id, ok: true, result: { ok: true } });
    await expect(replacement).resolves.toEqual({ ok: true });
    expect(next.terminate).toHaveBeenCalledOnce();
  });

  it("only performs an idle cleanup when no proof call is pending and recreates after termination", async () => {
    const witnessSentinel = 918273645546372819n;
    const digestLoSentinel = "717273747576777879";
    const digestHiSentinel = "818283848586878889";
    const firstCall = zkWorkerCall(
      "generatePersonRelationProof",
      {
        person: {
          fullName: "Worker Witness Sentinel",
          gender: 1,
          birthYear: 1980,
          birthMonth: 2,
          birthDay: 3,
          isBirthBC: false,
          derivedSecretField: witnessSentinel,
          identitySuiteId: 1,
        },
        father: null,
        mother: null,
        submitterAddress: `0x${"11".repeat(20)}`,
        selfSuiteId: 1,
        fatherSuiteId: 0,
        motherSuiteId: 0,
        contentDigestLo: digestLoSentinel,
        contentDigestHi: digestHiSentinel,
      },
      { timeoutMs: 0 },
    );
    const firstWorker = FakeWorker.instances[0];

    expect(firstWorker.messages[0]).toEqual({
      id: expect.any(Number),
      method: "generatePersonRelationProof",
      params: undefined,
    });
    const bufferedMessages = JSON.stringify(firstWorker.messages);
    expect(bufferedMessages).not.toContain(witnessSentinel.toString());
    expect(bufferedMessages).not.toContain(digestLoSentinel);
    expect(bufferedMessages).not.toContain(digestHiSentinel);
    expect(firstWorker.deliveredMessages[0]).toMatchObject({
      method: "generatePersonRelationProof",
      params: {
        person: { derivedSecretField: witnessSentinel },
        contentDigestLo: digestLoSentinel,
        contentDigestHi: digestHiSentinel,
      },
    });
    expect(firstWorker.deliveredMessages[0].params).not.toHaveProperty("rawPassphrase");
    expect(firstWorker.deliveredMessages[0].params).not.toHaveProperty("identitySalt");
    expect(firstWorker.deliveredMessages[0].params).not.toHaveProperty("kek");
    expect(firstWorker.deliveredMessages[0].params).not.toHaveProperty("dek");
    expect(terminateZkWorkerIfIdle()).toBe(false);
    expect(firstWorker.terminate).not.toHaveBeenCalled();

    const rejected = expect(firstCall).rejects.toBeInstanceOf(ZkWorkerTerminatedError);
    terminateZkWorker(new ZkWorkerTerminatedError("clear witness memory"));
    await rejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(firstWorker.deliveredMessages).toEqual([]);

    const secondCall = zkWorkerCall(
      "verifyPersonRelationProof",
      { proof: {} as any, publicSignals: ["1"] },
      { timeoutMs: 0 },
    );
    const secondWorker = FakeWorker.instances[1];
    const request = secondWorker.messages[0];
    secondWorker.emit("message", { id: request.id, ok: true, result: { ok: true } });

    await expect(secondCall).resolves.toEqual({ ok: true });
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(terminateZkWorkerIfIdle()).toBe(true);
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.deliveredMessages).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(2);
  });
});
