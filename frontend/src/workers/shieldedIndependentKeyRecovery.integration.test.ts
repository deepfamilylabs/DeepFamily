import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { buildShieldedIndependentKeySigningMessage } from "@deepfamily/protocol-core";
import { serializeChainError } from "@deepfamily/chain-client";
import { ShieldedAssetSession, shieldedAssetErrorMessage } from "./shieldedAssetSession";
import type { ShieldedAssetWorkerCallMap, ShieldedWorkerContext } from "../shared/workers/shieldedAssetWorkerTypes";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  discover: vi.fn(),
  lineage: "0x1111111111111111111111111111111111111111",
  verifier: "0x2222222222222222222222222222222222222222",
  pool: "0x3333333333333333333333333333333333333333",
  factory: "0x4444444444444444444444444444444444444444",
}));

vi.mock("ethers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ethers")>()),
  JsonRpcProvider: class {
    getNetwork = async () => ({ chainId: 31337n });
    destroy() {}
  },
}));
vi.mock("@deepfamily/protocol-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@deepfamily/protocol-core")>()),
  // Skip the expensive credential KDF and optional identity proof derivation. Root
  // generation, signatures, recovery codecs and bound-key derivation stay real.
  deriveShieldedIndependentKeyIdentitySecret: async () => new Uint8Array(32).fill(3),
  deriveIdentityMaterial: async () => { throw new Error("Identity proof suite unavailable"); },
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({ lineageIndex: async () => mocks.lineage }),
  createLineageIndexContract: () => ({}),
  createShieldedPoolFactoryContract: () => ({
    LINEAGE_INDEX: async () => mocks.lineage,
    VERIFIER: async () => mocks.verifier,
    poolFor: async () => mocks.pool,
  }),
  createShieldedErc20PoolContract: () => ({}),
  createShieldedNativePoolContract: () => ({
    protocolVersion: async () => 1n,
    LINEAGE_INDEX: async () => mocks.lineage,
    VERIFIER: async () => mocks.verifier,
    assetKind: async () => 1n,
  }),
}));
vi.mock("../domains/inheritance/services/shieldedWalletRecovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domains/inheritance/services/shieldedWalletRecovery")>()),
  recoverLocalShieldedWallet: mocks.recover,
}));
vi.mock("../domains/inheritance/services/shieldedAssetRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domains/inheritance/services/shieldedAssetRegistry")>()),
  discoverShieldedFactoryPools: mocks.discover,
}));

type Client = typeof import("../shared/workers/shieldedAssetWorkerClient");
type Method = keyof ShieldedAssetWorkerCallMap;
type Request = { id: number; method: Method; params: never };

/** Reproduce the worker's async clone/dispatch boundary with a real secret session. */
class SessionWorker {
  static instances: SessionWorker[] = [];
  readonly session = new ShieldedAssetSession();
  readonly calls: Array<{ method: Method; expectedFingerprint?: string; pendingBackupFingerprints?: string[] }> = [];
  private listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  private queue = Promise.resolve();
  private terminated = false;

  constructor() { SessionWorker.instances.push(this); }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(envelope: Request) {
    const request = structuredClone(envelope);
    const params = request.params as { expectedFingerprint?: string; pendingBackupFingerprints?: string[] };
    this.calls.push({
      method: request.method,
      expectedFingerprint: params.expectedFingerprint,
      pendingBackupFingerprints: params.pendingBackupFingerprints,
    });
    this.queue = this.queue.then(async () => {
      if (this.terminated) return;
      try {
        const result = await this.session.call(request.method, request.params);
        this.respond({ id: request.id, ok: true, result });
      } catch (error) {
        this.respond({ id: request.id, ok: false,
          error: serializeChainError(error, shieldedAssetErrorMessage(error, request.method)) });
      } finally {
        request.params = undefined as never;
      }
    });
  }

  terminate() {
    this.terminated = true;
    this.session.clear();
  }

  private respond(data: unknown) {
    if (!this.terminated)
      for (const listener of this.listeners.get("message") ?? []) listener({ data: structuredClone(data) });
  }
}

const context: ShieldedWorkerContext = {
  rpcUrl: "http://localhost:8545",
  chainId: "31337",
  factoryAddress: mocks.factory,
  factoryDeploymentBlock: 3,
  familyAddress: "0x5555555555555555555555555555555555555555",
  lineageIndexAddress: mocks.lineage,
  poolAddress: mocks.pool,
  poolDeploymentBlock: 2,
  assetKind: "native",
};
const credentials = () => ({
  identity: { fullName: "Recovery Example", gender: 1, birthYear: 2001,
    birthMonth: 4, birthDay: 9, isBirthBC: false },
  rawPassphrase: "integration-credential-sentinel",
});
const clients: Client[] = [];
async function freshClient() {
  vi.resetModules();
  const client = await import("../shared/workers/shieldedAssetWorkerClient");
  clients.push(client);
  return client;
}
async function unlock(client: Client) {
  const state = await client.shieldedAssetWorkerCall("unlockIdentity", credentials());
  expect(state.credentials?.handle).toBeTruthy();
  return state.credentials!.handle;
}

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
    get length() { return stored.size; },
  });
  SessionWorker.instances = [];
  vi.stubGlobal("Worker", SessionWorker);
  mocks.recover.mockReset().mockRejectedValue(new Error("History must not be needed for backup import"));
  mocks.discover.mockReset().mockRejectedValue(new Error("Pool discovery must not be needed for backup import"));
});
afterEach(() => {
  for (const client of clients.splice(0)) client.terminateShieldedAssetWorker();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("independent-key backup recovery through the real worker client", () => {
  it.each([
    { source: "random", format: "mnemonic" },
    { source: "random", format: "shieldedKey" },
    { source: "walletSignature", format: "mnemonic" },
    { source: "walletSignature", format: "shieldedKey" },
  ] as const)("restores a $source $format backup after full lock and on a new device without history or a fingerprint", async ({ source, format }) => {
    const originalClient = await freshClient();
    const expectedCredentialsHandle = await unlock(originalClient);
    const signer = new Wallet(`0x${"11".repeat(32)}`);
    const created = await originalClient.shieldedAssetWorkerCall("createIndependentKey", {
      expectedCredentialsHandle,
      intent: "create",
      rootSource: source,
      ...(source === "walletSignature" ? {
        signerAddress: signer.address,
        signature: await signer.signMessage(buildShieldedIndependentKeySigningMessage(signer.address)),
      } : {}),
      context,
    });
    expect(created.independentKey).toMatchObject({ recoveryVerified: false, backupRequired: true });
    await expect(originalClient.shieldedAssetWorkerCall("preview", {
      context, slot: "independent", action: "shield", amount: "100",
    })).rejects.toThrow("Verify recovery");
    const backup = await originalClient.shieldedAssetWorkerCall("exportRecoveryMaterial", { format, context });
    if (format === "mnemonic") expect(backup.material.split(" ")).toHaveLength(24);
    else expect(backup.material).toMatch(/^0x[0-9a-f]{64}$/);
    await originalClient.shieldedAssetWorkerCall("clearIndependentKey", {});
    const verified = await originalClient.shieldedAssetWorkerCall("importRecoveryMaterial", {
      expectedCredentialsHandle, format, material: backup.material,
      expectedFingerprint: backup.keyFingerprint, context,
    });
    expect(verified.independentKey).toMatchObject({
      keyFingerprint: backup.keyFingerprint, recoveryVerified: true, backupRequired: false, recoveryPath: format,
    });
    expect(sessionStorage.length).toBe(0);

    originalClient.terminateShieldedAssetWorker();
    expect(SessionWorker.instances[0].session.state()).toEqual({ credentials: null, identity: null, independentKey: null });
    const lockedHandle = await unlock(originalClient);
    expect(lockedHandle).not.toBe(expectedCredentialsHandle);
    const restored = await originalClient.shieldedAssetWorkerCall("importRecoveryMaterial", {
      expectedCredentialsHandle: lockedHandle, format, material: backup.material, context,
    });
    expect(restored.independentKey).toMatchObject({
      keyFingerprint: backup.keyFingerprint, ownerCommitment: created.independentKey!.ownerCommitment,
      viewingKey: created.independentKey!.viewingKey,
      recoveryVerified: true, backupRequired: false, recoveryPath: format,
    });
    const lockedCalls = SessionWorker.instances[1].calls;
    expect(lockedCalls[lockedCalls.length - 1]).toMatchObject({
      method: "importRecoveryMaterial", expectedFingerprint: undefined, pendingBackupFingerprints: [],
    });
    originalClient.terminateShieldedAssetWorker();

    // Lose every client/module variable and all browser storage, as on another device.
    sessionStorage.clear();
    const newClient = await freshClient();
    const newHandle = await unlock(newClient);
    const imported = await newClient.shieldedAssetWorkerCall("importRecoveryMaterial", {
      expectedCredentialsHandle: newHandle, format, material: backup.material, context,
    });
    expect(imported.independentKey).toMatchObject({
      keyFingerprint: backup.keyFingerprint, ownerCommitment: created.independentKey!.ownerCommitment,
      viewingKey: created.independentKey!.viewingKey,
      recoveryVerified: true, backupRequired: false, recoveryPath: format,
    });
    const newDeviceCalls = SessionWorker.instances[2].calls;
    expect(newDeviceCalls[newDeviceCalls.length - 1]).toMatchObject({
      method: "importRecoveryMaterial", expectedFingerprint: undefined, pendingBackupFingerprints: [],
    });
    expect((await newClient.shieldedAssetWorkerCall("exportRecoveryMaterial", { format, context })).material).toBe(backup.material);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects a conflicting explicit original fingerprint on a fresh device", async () => {
    const client = await freshClient();
    const expectedCredentialsHandle = await unlock(client);
    await expect(client.shieldedAssetWorkerCall("importRecoveryMaterial", {
      expectedCredentialsHandle, format: "shieldedKey", material: `0x${"29".repeat(32)}`,
      expectedFingerprint: `0x${"ff".repeat(32)}`, context,
    })).rejects.toThrow("fingerprint differs");
    expect(SessionWorker.instances[0].session.state().independentKey).toBeNull();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("restores an original signing wallet after full lock and on a new device without history or a fingerprint", async () => {
    let client = await freshClient();
    const expectedCredentialsHandle = await unlock(client);
    const signer = new Wallet(`0x${"11".repeat(32)}`);
    const message = buildShieldedIndependentKeySigningMessage(signer.address);
    const created = await client.shieldedAssetWorkerCall("createIndependentKey", {
      expectedCredentialsHandle, intent: "create", rootSource: "walletSignature",
      signerAddress: signer.address, signature: await signer.signMessage(message), context,
    });
    const backup = await client.shieldedAssetWorkerCall("exportRecoveryMaterial", { format: "shieldedKey", context });
    await client.shieldedAssetWorkerCall("clearIndependentKey", {});
    const verified = await client.shieldedAssetWorkerCall("importRecoveryMaterial", {
      expectedCredentialsHandle, format: "shieldedKey", material: backup.material,
      expectedFingerprint: backup.keyFingerprint, context,
    });
    expect(verified.independentKey).toMatchObject({ recoveryVerified: true, backupRequired: false });

    for (const newDevice of [false, true]) {
      client.terminateShieldedAssetWorker();
      if (newDevice) {
        sessionStorage.clear();
        client = await freshClient();
      }
      const restored = await client.shieldedAssetWorkerCall("restoreSignature", {
        expectedCredentialsHandle: await unlock(client),
        signerAddress: signer.address, signature: await signer.signMessage(message), context,
      });
      expect(restored.independentKey).toMatchObject({
        keyFingerprint: backup.keyFingerprint, ownerCommitment: created.independentKey!.ownerCommitment,
        viewingKey: created.independentKey!.viewingKey,
        recoveryVerified: true, recoveryPath: "signature",
      });
      expect(restored.independentKey?.backupRequired).not.toBe(true);
      const calls = SessionWorker.instances[SessionWorker.instances.length - 1].calls;
      expect(calls[calls.length - 1]).toMatchObject({
        method: "restoreSignature", expectedFingerprint: undefined, pendingBackupFingerprints: [],
      });
      expect((await client.shieldedAssetWorkerCall("exportRecoveryMaterial", {
        format: "shieldedKey", context,
      })).material).toBe(backup.material);
      expect(sessionStorage.length).toBe(0);
    }
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("rejects a signature from a different signer without installing a root", async () => {
    const client = await freshClient();
    const signer = new Wallet(`0x${"11".repeat(32)}`);
    const other = new Wallet(`0x${"22".repeat(32)}`);
    await expect(client.shieldedAssetWorkerCall("restoreSignature", {
      expectedCredentialsHandle: await unlock(client), signerAddress: signer.address,
      signature: await other.signMessage(buildShieldedIndependentKeySigningMessage(signer.address)), context,
    })).rejects.toThrow();
    expect(SessionWorker.instances[0].session.state().independentKey).toBeNull();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps a newly created signing wallet behind the manual backup gate after re-signing", async () => {
    const client = await freshClient();
    const signer = new Wallet(`0x${"11".repeat(32)}`);
    const message = buildShieldedIndependentKeySigningMessage(signer.address);
    const created = await client.shieldedAssetWorkerCall("createIndependentKey", {
      expectedCredentialsHandle: await unlock(client), intent: "create", rootSource: "walletSignature",
      signerAddress: signer.address, signature: await signer.signMessage(message), context,
    });
    client.terminateShieldedAssetWorker();
    const resigned = await client.shieldedAssetWorkerCall("restoreSignature", {
      expectedCredentialsHandle: await unlock(client),
      signerAddress: signer.address, signature: await signer.signMessage(message), context,
    });
    expect(resigned.independentKey).toMatchObject({
      keyFingerprint: created.independentKey!.keyFingerprint, recoveryVerified: false, backupRequired: true,
    });
    expect(resigned.independentKey?.recoveryPath).toBeUndefined();
    const calls = SessionWorker.instances[1].calls;
    expect(calls[calls.length - 1]).toMatchObject({
      method: "restoreSignature", expectedFingerprint: undefined,
      pendingBackupFingerprints: [created.independentKey!.keyFingerprint],
    });
    await expect(client.shieldedAssetWorkerCall("preview", {
      context, slot: "independent", action: "shield", amount: "100",
    })).rejects.toThrow("Verify recovery");
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
