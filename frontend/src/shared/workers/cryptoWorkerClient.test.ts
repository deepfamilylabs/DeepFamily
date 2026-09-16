// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CryptoWorkerTerminatedError,
  CryptoWorkerPreemptedError,
  cryptoWorkerCall,
  terminateCryptoWorker,
  terminateCryptoWorkerIfIdle,
  type CryptoWorkerCallOptions,
} from "./cryptoWorkerClient";

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
    // Model the browser's synchronous structured clone separately from the
    // caller-realm request object retained by instrumentation.
    this.deliveredMessages.push(structuredClone(message));
    this.messages.push(message);
  }

  emit(type: string, data: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

const compute = (label: string, options?: CryptoWorkerCallOptions) =>
  cryptoWorkerCall(
    "computeIdentityHash",
    {
      input: {
        fullName: label,
        gender: 0,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 1,
        isBirthBC: false,
        passphrase: "",
      },
    },
    { timeoutMs: 0, ...options },
  );

const complete = (worker: FakeWorker, index = worker.messages.length - 1) => {
  const id = worker.messages[index].id;
  worker.emit("message", { id, ok: true, result: { identityHash: String(id) } });
};

describe("crypto worker lifecycle", () => {
  beforeEach(() => {
    terminateCryptoWorker();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    terminateCryptoWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serializes all callers and preserves foreground FIFO order", async () => {
    const first = compute("first");
    const second = compute("second");
    const third = compute("third");
    const worker = FakeWorker.instances[0];

    expect(worker.messages).toHaveLength(1);
    complete(worker);
    await first;
    expect(worker.deliveredMessages.map((message) => message.params.input.fullName)).toEqual([
      "first",
      "second",
    ]);
    complete(worker);
    await second;
    expect(worker.deliveredMessages.map((message) => message.params.input.fullName)).toEqual([
      "first",
      "second",
      "third",
    ]);
    complete(worker);
    await third;
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("preempts an active background job and dispatches foreground before queued background", async () => {
    const background = compute("background", { priority: "background" });
    const interrupted = expect(background).rejects.toBeInstanceOf(CryptoWorkerPreemptedError);
    const queued = compute("queued background", { priority: "background" });
    const oldWorker = FakeWorker.instances[0];
    const foreground = compute("foreground");

    await interrupted;
    const worker = FakeWorker.instances[1];
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    expect(worker.deliveredMessages[0].params.input.fullName).toBe("foreground");
    expect(worker.messages).toHaveLength(1);
    // A late event from the terminated worker cannot complete a different job.
    oldWorker.emit("message", { id: worker.messages[0].id, ok: true, result: "stale" });
    oldWorker.emit("error", undefined);
    expect(worker.terminate).not.toHaveBeenCalled();

    complete(worker);
    await foreground;
    expect(worker.deliveredMessages[1].params.input.fullName).toBe("queued background");
    complete(worker);
    await queued;
  });

  it("cancels a queued request without interrupting another caller's active work", async () => {
    const first = compute("active");
    const controller = new AbortController();
    const queued = compute("cancelled", { signal: controller.signal });
    const cancelled = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    const last = compute("last");
    const worker = FakeWorker.instances[0];

    controller.abort();
    await cancelled;
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.messages).toHaveLength(1);
    complete(worker);
    await first;
    expect(worker.deliveredMessages[1].params.input.fullName).toBe("last");
    complete(worker);
    await last;
  });

  it("stops an aborted active job while preserving queued jobs and removing settled abort listeners", async () => {
    const controller = new AbortController();
    const first = compute("cancelled", { signal: controller.signal });
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const nextController = new AbortController();
    const second = compute("second", { signal: nextController.signal });
    const third = compute("third");
    const oldWorker = FakeWorker.instances[0];

    controller.abort();
    await cancelled;
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    const worker = FakeWorker.instances[1];
    expect(worker.deliveredMessages[0].params.input.fullName).toBe("second");
    complete(worker);
    await second;
    nextController.abort();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.deliveredMessages[1].params.input.fullName).toBe("third");
    complete(worker);
    await third;
  });

  it("starts timeouts on dispatch and isolates a timeout from queued requests", async () => {
    vi.useFakeTimers();
    const first = compute("first");
    const second = compute("timeout", { timeoutMs: 50 });
    const timedOut = expect(second).rejects.toThrow("Crypto worker timeout");
    const last = compute("last");
    const firstWorker = FakeWorker.instances[0];

    await vi.advanceTimersByTimeAsync(100);
    expect(firstWorker.messages).toHaveLength(1);
    expect(firstWorker.terminate).not.toHaveBeenCalled();
    complete(firstWorker);
    await first;
    expect(firstWorker.deliveredMessages[1].params.input.fullName).toBe("timeout");
    await vi.advanceTimersByTimeAsync(50);
    await timedOut;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    const nextWorker = FakeWorker.instances[1];
    expect(nextWorker.deliveredMessages[0].params.input.fullName).toBe("last");
    complete(nextWorker);
    await last;
  });

  it("skips already-aborted calls and globally terminates both active and queued calls", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(compute("aborted", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(FakeWorker.instances).toHaveLength(0);
    const first = compute("first");
    const queued = compute("queued", { priority: "background" });
    const rejected = Promise.all([
      expect(first).rejects.toBeInstanceOf(CryptoWorkerTerminatedError),
      expect(queued).rejects.toBeInstanceOf(CryptoWorkerTerminatedError),
    ]);
    terminateCryptoWorker();
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(terminateCryptoWorkerIfIdle()).toBe(true);
  });

  it("termination rejects the active KDF request and the next call creates a new Worker", async () => {
    const rawPassphraseSentinel = "secret-raw-passphrase-\u00e9-8a72";
    const firstCall = cryptoWorkerCall(
      "decryptPersonVersionEnvelopeV1",
      {
        envelopeHex: "0x00",
        rawPassphrase: rawPassphraseSentinel,
        context: {
          chainId: 71,
          deepFamilyProxy: `0x${"11".repeat(20)}`,
          personHash: `0x${"22".repeat(32)}`,
          fatherHash: `0x${"00".repeat(32)}`,
          fatherVersionIndex: 0,
          motherHash: `0x${"00".repeat(32)}`,
          motherVersionIndex: 0,
          versionCommitment: 1,
        },
      },
      { timeoutMs: 0 },
    );
    const firstWorker = FakeWorker.instances[0];
    const rejected = expect(firstCall).rejects.toBeInstanceOf(CryptoWorkerTerminatedError);

    expect(firstWorker.messages[0]).toEqual({
      id: expect.any(Number),
      method: "decryptPersonVersionEnvelopeV1",
      params: undefined,
    });
    expect(firstWorker.deliveredMessages[0]).toMatchObject({
      method: "decryptPersonVersionEnvelopeV1",
      params: { rawPassphrase: rawPassphraseSentinel, envelopeHex: "0x00" },
    });
    expect(Object.keys(firstWorker.deliveredMessages[0].params).sort()).toEqual([
      "context",
      "envelopeHex",
      "rawPassphrase",
    ]);
    expect(JSON.stringify(firstWorker.messages)).not.toContain(rawPassphraseSentinel);
    expect(terminateCryptoWorkerIfIdle()).toBe(false);
    expect(firstWorker.terminate).not.toHaveBeenCalled();
    terminateCryptoWorker(new CryptoWorkerTerminatedError("cancelled"));
    await rejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(firstWorker.deliveredMessages).toEqual([]);

    const secondCall = cryptoWorkerCall(
      "preparePersonVersionContentV1",
      {
        metadata: {
          schema: "deepfamily/person-version@1.0",
          person: {
            fullName: "Alice",
            gender: 2,
            birthYear: 1980,
            birthMonth: 1,
            birthDay: 1,
            isBirthBC: false,
            personHash: `0x${"22".repeat(32)}`,
          },
          parents: { father: null, mother: null },
          tag: "v1",
          biography: "bio",
        },
        derivedSecretField: "3",
      },
      { timeoutMs: 0 },
    );
    const secondWorker = FakeWorker.instances[1];
    const request = secondWorker.messages[0];
    secondWorker.emit("message", {
      id: request.id,
      ok: true,
      result: {
        canonicalJsonLength: 1,
        contentDigestLo: "0",
        contentDigestHi: "0",
        versionCommitment: "1",
      },
    });

    await expect(secondCall).resolves.toMatchObject({ versionCommitment: "1" });
    expect(terminateCryptoWorkerIfIdle()).toBe(true);
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.deliveredMessages).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(secondWorker).not.toBe(firstWorker);
  });
});
