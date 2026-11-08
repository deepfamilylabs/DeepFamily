import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, type Signer } from "ethers";
import DeepFamily from "../../../abi/DeepFamily.json";
import { loadTrustedEndorsers, updateTrustedEndorser } from "./trustedEndorserService";

const mocks = vi.hoisted(() => ({ reader: vi.fn(), add: vi.fn(), remove: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", async (original) => ({
  ...await original<typeof import("../../../shared/clients/contractFactory")>(),
  createDeepFamilyContract: () => ({ addTrustedEndorser: mocks.add, removeTrustedEndorser: mocks.remove }),
  createDeepFamilyReaderContract: () => ({ listTrustedEndorsers: mocks.reader }),
}));
vi.mock("../../../shared/clients/providerRegistry", () => ({ getReadonlyProvider: () => ({}) }));

const iface = new Interface(DeepFamily.abi);
const family = `0x${"11".repeat(20)}`;
const owner = `0x${"22".repeat(20)}`;
const account = `0x${"33".repeat(20)}`;
const personHash = `0x${"44".repeat(32)}`;
const hash = `0x${"55".repeat(32)}`;
const nextHash = `0x${"66".repeat(32)}`;
const signer = {
  provider: { getNetwork: async () => ({ chainId: 31337n }), getBlockNumber: async () => 12 },
  getAddress: async () => owner,
} as unknown as Signer;
const input = {
  signer, chainId: 31337, connectedAddress: owner, contractAddress: family,
  personHash, versionIndex: 1, account, action: "add" as const, isCurrent: () => true,
};

function transaction(action: "add" | "remove" = "add", eventAccount = account) {
  const log = iface.encodeEventLog(iface.getEvent(action === "add" ? "TrustedEndorserAdded" : "TrustedEndorserRemoved")!,
    [personHash, 1, eventAccount]);
  const receipt = { status: 1, hash, blockNumber: 13, logs: [{ address: family, ...log }] };
  const tx = {
    hash, chainId: 31337n, from: owner, to: family, value: 0n, nonce: 2,
    data: iface.encodeFunctionData(action === "add" ? "addTrustedEndorser" : "removeTrustedEndorser", [personHash, 1, account]),
    wait: vi.fn(async () => receipt),
    replaceableTransaction: vi.fn(),
  };
  tx.replaceableTransaction.mockReturnValue(tx);
  return { tx, receipt };
}

describe("recommended source service", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["add", "remove"] as const)("validates the exact %s event", async (action) => {
    const { tx } = transaction(action);
    (action === "add" ? mocks.add : mocks.remove).mockResolvedValue(tx);
    const result = await updateTrustedEndorser({ ...input, action });
    expect(result.transactionHash).toBe(hash);
    expect(tx.replaceableTransaction).toHaveBeenCalledWith(12);
  });

  it("follows a fee-only replacement and exposes the replacement hash", async () => {
    const { tx, receipt } = transaction();
    tx.wait.mockRejectedValueOnce(Object.assign(new Error("repriced"), {
      code: "TRANSACTION_REPLACED", reason: "repriced", cancelled: false,
      replacement: { ...tx, hash: nextHash }, receipt: { ...receipt, hash: nextHash },
    }));
    mocks.add.mockResolvedValue(tx);
    const onSubmitted = vi.fn();
    expect((await updateTrustedEndorser({ ...input, onSubmitted })).transactionHash).toBe(nextHash);
    expect(onSubmitted.mock.calls.map(([value]) => value)).toEqual([hash, nextHash]);
  });

  it("retains confirmation and the public hash when the event account differs", async () => {
    mocks.add.mockResolvedValue(transaction("add", owner).tx);
    await expect(updateTrustedEndorser(input)).rejects.toMatchObject({ transactionHash: hash, transactionConfirmed: true, verificationFailure: "mismatch" });
  });

  it("stops before sending when the caller changes while wallet checks are awaited", async () => {
    let current = true;
    const changedSigner = {
      provider: signer.provider,
      getAddress: async () => { current = false; return owner; },
    } as unknown as Signer;
    await expect(updateTrustedEndorser({ ...input, signer: changedSigner, isCurrent: () => current })).rejects.toThrow("wallet changed");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("loads all pages and rejects a cursor that repeats", async () => {
    const scope = { rpcUrl: "rpc", chainId: 31337, contractAddress: family, readerAddress: family, personHash, versionIndex: 1 };
    mocks.reader.mockResolvedValueOnce([[owner], 2n, true, 1n]).mockResolvedValueOnce([[account], 2n, false, 2n]);
    expect(await loadTrustedEndorsers(scope)).toEqual([owner, account]);
    mocks.reader.mockResolvedValue([[owner], 2n, true, 0n]);
    await expect(loadTrustedEndorsers(scope)).rejects.toThrow("did not advance");
  });
});
