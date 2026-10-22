import { describe, expect, it, vi } from "vitest";
import { Contract, Interface } from "ethers";
import { buildShieldedIdentityAuthorizationState } from "@deepfamily/protocol-core";
import { IDENTITY_AUTHORIZATION_ABI, loadShieldedIdentityAuthorizationState } from "./shieldedIdentityAuthorizationChain";

function fixture() {
  const iface = new Interface(IDENTITY_AUTHORIZATION_ABI);
  const before = buildShieldedIdentityAuthorizationState();
  const after = buildShieldedIdentityAuthorizationState(new Map([[17n, 1n]]));
  const update = iface.encodeEventLog(iface.getEvent("CounterIncremented")!, [2, 17, 0, 1, before.root, after.root, 99]);
  const provider = { getBlockNumber: vi.fn(async () => 20), getBlock: vi.fn(async () => ({ hash: "0xanchor", timestamp: 1200 })),
    getLogs: vi.fn(async (_filter: { topics: unknown[] }) => [{ ...update, blockNumber: 15, index: 0 }]) };
  const contract = { interface: iface, runner: { provider }, getAddress: async () => "0x1111111111111111111111111111111111111111",
    creationBlock: async () => 10n, currentCheckpointId: async () => 2n, currentRoot: vi.fn(async () => after.root),
    getCheckpoint: async () => ({ root: after.root, createdAt: 1100n, retiredAt: 0n }) };
  return { provider, contract, after };
}
describe("identity authorization chain replay", () => {
  it("rebuilds the canonical dictionary from all updates without sending an identity or alias filter", async () => {
    const f = fixture();
    const result = await loadShieldedIdentityAuthorizationState(f.contract as unknown as Contract);
    expect(result.state.root).toBe(f.after.root);
    expect(result.state.entries.get(17n)).toBe(1n);
    expect(result.checkpointId).toBe(2n);
    expect(result.asOf).toBe(1200n);
    expect(f.provider.getLogs.mock.calls[0][0].topics).toEqual([f.contract.interface.getEvent("CounterIncremented")!.topicHash]);
  });
  it("rejects a missing update or a root that differs from the replayed dictionary", async () => {
    const f = fixture(); f.provider.getLogs.mockResolvedValueOnce([]);
    await expect(loadShieldedIdentityAuthorizationState(f.contract as unknown as Contract)).rejects.toThrow("does not match replay");
    const g = fixture(); g.contract.currentRoot.mockResolvedValueOnce(42n);
    await expect(loadShieldedIdentityAuthorizationState(g.contract as unknown as Contract)).rejects.toThrow("does not match replay");
  });
  it("rejects a reorganization after reading and replaying events", async () => {
    const f = fixture(); f.provider.getBlock.mockResolvedValueOnce({ hash: "0xanchor", timestamp: 1200 }).mockResolvedValueOnce({ hash: "0xother", timestamp: 1200 });
    await expect(loadShieldedIdentityAuthorizationState(f.contract as unknown as Contract)).rejects.toThrow("reorganized");
  });
});
