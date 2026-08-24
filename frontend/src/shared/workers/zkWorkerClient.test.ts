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
    expect(terminateZkWorkerIfIdle()).toBe(true);
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.deliveredMessages).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(2);
  });
});
