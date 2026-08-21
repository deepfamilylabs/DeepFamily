// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ZkWorkerTerminatedError,
  terminateZkWorker,
  terminateZkWorkerIfIdle,
  zkWorkerCall,
} from "./zkWorkerClient";

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly messages: any[] = [];
  readonly terminate = vi.fn();
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
    this.messages.push(message);
  }

  emit(type: string, data: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

describe("ZK worker lifecycle", () => {
  beforeEach(() => {
    terminateZkWorker();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    terminateZkWorker();
    vi.unstubAllGlobals();
  });

  it("only performs an idle cleanup when no proof call is pending and recreates after termination", async () => {
    const firstCall = zkWorkerCall(
      "verifyPersonRelationProof",
      { proof: {} as any, publicSignals: ["1"] },
      { timeoutMs: 0 },
    );
    const firstWorker = FakeWorker.instances[0];

    expect(terminateZkWorkerIfIdle()).toBe(false);
    expect(firstWorker.terminate).not.toHaveBeenCalled();

    const rejected = expect(firstCall).rejects.toBeInstanceOf(ZkWorkerTerminatedError);
    terminateZkWorker(new ZkWorkerTerminatedError("clear witness memory"));
    await rejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    const secondCall = zkWorkerCall(
      "verifyPersonRelationProof",
      { proof: {} as any, publicSignals: ["1"] },
      { timeoutMs: 0 },
    );
    const secondWorker = FakeWorker.instances[1];
    const request = secondWorker.messages[0];
    secondWorker.emit("message", { id: request.id, ok: true, result: { ok: true } });

    await expect(secondCall).resolves.toEqual({ ok: true });
    expect(terminateZkWorkerIfIdle()).toBe(true);
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);
  });
});
