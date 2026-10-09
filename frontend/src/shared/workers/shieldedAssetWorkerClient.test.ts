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
const context = {
  rpcUrl: "http://localhost:8545",
  chainId: "31337",
  factoryAddress: "0x1111111111111111111111111111111111111111",
  factoryDeploymentBlock: 1,
  familyAddress: "0x2222222222222222222222222222222222222222",
  lineageIndexAddress: "0x3333333333333333333333333333333333333333",
  poolAddress: "0x4444444444444444444444444444444444444444",
  poolDeploymentBlock: 2,
  assetKind: "native" as const,
};
function respond(worker: FakeWorker, result: unknown) {
  worker.emit("message", { id: worker.clones[worker.clones.length - 1].id, ok: true, result });
}
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
  it("keeps the new-wallet backup challenge across realm destruction until manual restore", async () => {
    const fingerprint = `0x${"ab".repeat(32)}`;
    const created = shieldedAssetWorkerCall("createFunds", {
      intent: "create",
      rootSource: "random",
      context,
    });
    respond(FakeWorker.instances[0], {
      funds: { fundsFingerprint: fingerprint, backupRequired: true },
    });
    await created;
    expect(sessionStorage.getItem("deepfamily:pending-funds-backups:v1")).toContain(fingerprint);
    terminateShieldedAssetWorker();

    const restored = shieldedAssetWorkerCall("restoreSignature", {
      signerAddress: context.familyAddress,
      signature: "signature-secret",
      expectedFingerprint: fingerprint,
      context,
    });
    const signatureWorker = FakeWorker.instances[1];
    expect(signatureWorker.clones[0].params.pendingBackupFingerprints).toContain(fingerprint);
    expect(signatureWorker.requests[0].params).toBeUndefined();
    respond(signatureWorker, {
      funds: { fundsFingerprint: fingerprint, backupRequired: true, recoveryVerified: false },
    });
    await restored;
    terminateShieldedAssetWorker();

    const imported = shieldedAssetWorkerCall("importRecoveryMaterial", {
      format: "shieldedKey",
      material: "manual-root-secret",
      expectedFingerprint: fingerprint,
      context,
    });
    const importWorker = FakeWorker.instances[2];
    expect(importWorker.clones[0].params.pendingBackupFingerprints).toContain(fingerprint);
    expect(importWorker.requests[0].params).toBeUndefined();
    expect(importWorker.clones[0].params.material).toBe("manual-root-secret");
    respond(importWorker, {
      funds: { fundsFingerprint: fingerprint, backupRequired: false, recoveryVerified: true },
    });
    await imported;
    expect(sessionStorage.getItem("deepfamily:pending-funds-backups:v1") ?? "").not.toContain(
      fingerprint,
    );
    terminateShieldedAssetWorker();

    const reopened = shieldedAssetWorkerCall("restoreSignature", {
      signerAddress: context.familyAddress,
      signature: "other-signature-secret",
      expectedFingerprint: fingerprint,
      context,
    });
    const next = FakeWorker.instances[3];
    expect(next.clones[0].params.pendingBackupFingerprints).not.toContain(fingerprint);
    respond(next, { identity: null, funds: null });
    await reopened;
  });
  it("does not clear the backup challenge after an unverified material import", async () => {
    const fingerprint = `0x${"cd".repeat(32)}`;
    const created = shieldedAssetWorkerCall("createFunds", {
      intent: "create",
      rootSource: "random",
      context,
    });
    respond(FakeWorker.instances[0], {
      funds: { fundsFingerprint: fingerprint, backupRequired: true, recoveryVerified: false },
    });
    await created;
    terminateShieldedAssetWorker();
    const candidate = shieldedAssetWorkerCall("importRecoveryMaterial", {
      format: "mnemonic",
      material: "candidate words",
      context,
    });
    const next = FakeWorker.instances[1];
    expect(next.clones[0].params.pendingBackupFingerprints).toContain(fingerprint);
    respond(next, {
      funds: { fundsFingerprint: fingerprint, backupRequired: true, recoveryVerified: false },
    });
    await candidate;
    terminateShieldedAssetWorker();
    const restored = shieldedAssetWorkerCall("restoreSignature", {
      signerAddress: context.familyAddress,
      signature: "candidate-signature-secret",
      context,
    });
    const last = FakeWorker.instances[2];
    expect(last.clones[0].params.pendingBackupFingerprints).toContain(fingerprint);
    respond(last, { identity: null, funds: null });
    await restored;
  });
  it("reloads only public pending fingerprints for a new client instance", async () => {
    const fingerprint = `0x${"ef".repeat(32)}`;
    sessionStorage.setItem(
      "deepfamily:pending-funds-backups:v1",
      JSON.stringify([fingerprint, "not-a-fingerprint"]),
    );
    vi.resetModules();
    const reloaded = await import("./shieldedAssetWorkerClient");
    try {
      const candidate = reloaded.shieldedAssetWorkerCall("restoreSignature", {
        signerAddress: context.familyAddress,
        signature: "reload-signature-secret",
        context,
      });
      const next = FakeWorker.instances[0];
      expect(next.clones[0].params.pendingBackupFingerprints).toEqual([fingerprint]);
      respond(next, {
        funds: { fundsFingerprint: fingerprint, backupRequired: true, recoveryVerified: false },
      });
      await candidate;
      expect(sessionStorage.getItem("deepfamily:pending-funds-backups:v1")).toBe(
        JSON.stringify([fingerprint]),
      );
      expect(sessionStorage.getItem("deepfamily:pending-funds-backups:v1")).not.toContain(
        "reload-signature-secret",
      );
    } finally {
      reloaded.terminateShieldedAssetWorker();
      sessionStorage.clear();
    }
  });
});
