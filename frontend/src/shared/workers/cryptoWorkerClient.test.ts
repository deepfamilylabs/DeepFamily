// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CryptoWorkerTerminatedError,
  cryptoWorkerCall,
  terminateCryptoWorker,
  terminateCryptoWorkerIfIdle,
} from "./cryptoWorkerClient";

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

describe("crypto worker lifecycle", () => {
  beforeEach(() => {
    terminateCryptoWorker();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    terminateCryptoWorker();
    vi.unstubAllGlobals();
  });

  it("termination rejects the active KDF request and the next call creates a new Worker", async () => {
    const firstCall = cryptoWorkerCall(
      "decryptPersonVersionEnvelopeV1",
      {
        envelopeHex: "0x00",
        rawPassphrase: "worker-only-secret",
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

    expect(terminateCryptoWorkerIfIdle()).toBe(false);
    expect(firstWorker.terminate).not.toHaveBeenCalled();
    terminateCryptoWorker(new CryptoWorkerTerminatedError("cancelled"));
    await rejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

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
    expect(FakeWorker.instances).toHaveLength(2);
    expect(secondWorker).not.toBe(firstWorker);
  });
});
