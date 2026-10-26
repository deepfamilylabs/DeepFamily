import { describe, expect, it, vi } from "vitest";
import { toBeHex, type Contract } from "ethers";
import { poseidon3 } from "poseidon-lite";
import { SNARK_SCALAR_FIELD, planRevocationScans } from "@deepfamily/protocol-core";
import { readRoleRevocationState } from "./receiveRevocations";

function fixture(count = 19, checkedThrough = 0, role: 0 | 1 | 2 = 1, sourceAddress = toBeHex(0x12345n, 20)) {
  const chainId = 31337n;
  const nonce = 991n, tag = poseidon3([73301n + BigInt(role), 999999n, nonce]);
  const secrets = Array.from({ length: count }, (_, index) => BigInt(index) + 1000n);
  const checkpoints = [poseidon3([74300n + BigInt(role), chainId, BigInt(sourceAddress)])];
  for (const secret of secrets) checkpoints.push(poseidon3([74310n + BigInt(role), checkpoints[checkpoints.length - 1], secret]));
  const anchor = { blockNumber: 100, blockHash: toBeHex(100n, 32) };
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId })),
    getBlock: vi.fn(async (number: number) => ({ number, hash: anchor.blockHash })),
  };
  const source = {
    runner: { provider },
    getAddress: vi.fn(async () => sourceAddress),
    revokedRoleCount: vi.fn(async () => BigInt(count)),
    roleScanProgress: vi.fn(async () => BigInt(checkedThrough)),
    MAX_REVOCATION_BATCH: vi.fn(async () => 32n),
    MAX_REVOCATION_TAIL: vi.fn(async () => 8n),
    revocationCheckpoint: vi.fn(async (_role: number, index: bigint) => checkpoints[Number(index)]),
    getRevokedRolePage: vi.fn(async (_role: number, start: bigint, limit: number) => secrets.slice(Number(start), Number(start) + limit)),
    isRoleRevoked: vi.fn(async () => { throw new Error("RevocationStateNotPrepared"); }),
  };
  const request = () => ({ source: source as unknown as Contract, chainId, anchor, role, nonce, tag });
  return { source, provider, chainId, sourceAddress, anchor, secrets, checkpoints, request };
}

describe("receive public revocation state", () => {
  it("authenticates the complete current suffix and produces SDK-ready range inputs", async () => {
    const test = fixture(), result = await readRoleRevocationState(test.request());
    expect(result).toEqual({ ...test.request().anchor, chainId: test.chainId, sourceAddress: test.sourceAddress, role: 1,
      nonce: test.request().nonce, tag: test.request().tag, count: 19n, checkedThrough: 0n, start: 0n, end: 19n,
      startHash: test.checkpoints[0], endHash: test.checkpoints[19], secrets: test.secrets, revoked: false });
    expect(planRevocationScans(result).checkedThrough).toBe(19n);
    expect(test.source.isRoleRevoked).not.toHaveBeenCalled();
    expect(test.source.roleScanProgress).toHaveBeenCalledWith(1, result.nonce, result.tag, { blockTag: 100 });
    expect(test.source.revocationCheckpoint).toHaveBeenCalledWith(1, 0n, { blockTag: 100 });
    expect(test.source.revocationCheckpoint).toHaveBeenCalledWith(1, 19n, { blockTag: 100 });
    expect(test.source.getRevokedRolePage).toHaveBeenCalledWith(1, 0n, 19, { blockTag: 100 });
    expect(test.source.MAX_REVOCATION_BATCH).toHaveBeenCalledWith({ blockTag: 100 });
    expect(test.source.MAX_REVOCATION_TAIL).toHaveBeenCalledWith({ blockTag: 100 });
  });
  it("uses previously proved prefix progress without rescanning it", async () => {
    const test = fixture(600, 512), result = await readRoleRevocationState(test.request());
    expect(result.start).toBe(512n);
    expect(result.secrets).toEqual(test.secrets.slice(512));
    expect(test.source.getRevokedRolePage).toHaveBeenCalledTimes(1);
    expect(test.source.getRevokedRolePage).toHaveBeenCalledWith(1, 512n, 88, { blockTag: 100 });
    expect(planRevocationScans({ ...result, chainId: test.chainId }).scans[0].start).toBe(512n);
  });
  it("authenticates only the requested bounded interval without treating it as the complete log", async () => {
    const test = fixture(500), result = await readRoleRevocationState({ ...test.request(), maxEntries: 32 });
    expect(result.count).toBe(500n);
    expect(result.start).toBe(0n);
    expect(result.end).toBe(32n);
    expect(result.endHash).toBe(test.checkpoints[32]);
    expect(result.secrets).toEqual(test.secrets.slice(0, 32));
    expect(test.source.revocationCheckpoint).toHaveBeenCalledWith(1, 32n, { blockTag: 100 });
    expect(test.source.revocationCheckpoint).not.toHaveBeenCalledWith(1, 500n, expect.anything());
    expect(test.source.getRevokedRolePage.mock.calls).toEqual([[1, 0n, 32, { blockTag: 100 }]]);
    const request = { ...test.request(), maxEntries: 32,
      tag: poseidon3([73302n, test.secrets[499], test.request().nonce]) };
    expect((await readRoleRevocationState(request)).revoked).toBe(false);
    expect((await readRoleRevocationState({ ...request, maxEntries: undefined })).revoked).toBe(true);
  });
  it("caps a bounded interval from a nonzero progress and truncates it at the current end", async () => {
    const test = fixture(75, 32), request = { ...test.request(), maxEntries: 32 };
    const result = await readRoleRevocationState(request);
    expect(result).toMatchObject({ count: 75n, checkedThrough: 32n, start: 32n, end: 64n,
      startHash: test.checkpoints[32], endHash: test.checkpoints[64], secrets: test.secrets.slice(32, 64) });
    expect(test.source.getRevokedRolePage.mock.calls).toEqual([[1, 32n, 32, { blockTag: 100 }]]);
    test.source.roleScanProgress.mockResolvedValue(64n);
    const last = await readRoleRevocationState(request);
    expect(last.end).toBe(75n);
    expect(last.secrets).toEqual(test.secrets.slice(64));
    expect(test.source.getRevokedRolePage).toHaveBeenLastCalledWith(1, 64n, 11, { blockTag: 100 });
  });
  it("keeps a bounded interval at a large uint64 index exact", async () => {
    const test = fixture(32), progress = (1n << 63n) + 7n, startHash = 17n;
    let endHash = startHash;
    for (const secret of test.secrets) endHash = poseidon3([74311n, endHash, secret]);
    test.source.revokedRoleCount.mockResolvedValue(progress + 64n);
    test.source.roleScanProgress.mockResolvedValue(progress);
    test.source.revocationCheckpoint.mockImplementation(async (_role, index) => index === progress ? startHash : endHash);
    test.source.getRevokedRolePage.mockResolvedValue(test.secrets);
    const result = await readRoleRevocationState({ ...test.request(), maxEntries: 32 });
    expect(result).toMatchObject({ start: progress, end: progress + 32n, count: progress + 64n, endHash });
    expect(test.source.revocationCheckpoint.mock.calls).toEqual([
      [1, progress, { blockTag: 100 }], [1, progress + 32n, { blockTag: 100 }],
    ]);
    expect(test.source.getRevokedRolePage).toHaveBeenCalledWith(1, progress, 32, { blockTag: 100 });
  });
  it.each([0, -1, 33, NaN, 1.5, Infinity])("rejects an invalid bounded limit %s before any RPC", async maxEntries => {
    const test = fixture();
    await expect(readRoleRevocationState({ ...test.request(), maxEntries })).rejects.toThrow("interval limit");
    expect(test.source.getAddress).not.toHaveBeenCalled();
    expect(test.provider.getNetwork).not.toHaveBeenCalled();
    expect(test.source.revokedRoleCount).not.toHaveBeenCalled();
  });
  it("retains uint64 progress positions without rounding through a JavaScript number", async () => {
    const test = fixture(1), progress = (1n << 64n) - 2n, startHash = 17n;
    const endHash = poseidon3([74311n, startHash, 1000n]);
    test.source.revokedRoleCount.mockResolvedValue(progress + 1n);
    test.source.roleScanProgress.mockResolvedValue(progress);
    test.source.revocationCheckpoint.mockImplementation(async (_role, index) => index === progress ? startHash : endHash);
    test.source.getRevokedRolePage.mockResolvedValue([1000n]);
    const result = await readRoleRevocationState(test.request());
    expect(result.start).toBe(progress);
    expect(result.count).toBe(progress + 1n);
    expect(test.source.getRevokedRolePage).toHaveBeenCalledWith(1, progress, 1, { blockTag: 100 });
  });
  it("requires exact pages of at most 256 entries at the same block", async () => {
    const test = fixture(521), result = await readRoleRevocationState(test.request());
    expect(result.secrets).toEqual(test.secrets);
    expect(test.source.getRevokedRolePage.mock.calls).toEqual([
      [1, 0n, 256, { blockTag: 100 }], [1, 256n, 256, { blockTag: 100 }], [1, 512n, 9, { blockTag: 100 }],
    ]);
  });
  it.each([0, 19])("authenticates an empty suffix at progress %s without reading pages", async checked => {
    const test = fixture(checked, checked), result = await readRoleRevocationState(test.request());
    expect(result.revoked).toBe(false);
    expect(result.secrets).toEqual([]);
    expect(test.source.getRevokedRolePage).not.toHaveBeenCalled();
  });
  it("returns revoked only after authenticating the complete log endpoint", async () => {
    const test = fixture(), request = test.request();
    request.tag = poseidon3([73302n, test.secrets[17], request.nonce]);
    expect((await readRoleRevocationState(request)).revoked).toBe(true);
    test.source.getRevokedRolePage.mockResolvedValue(test.secrets.map((secret, index) => index === 0 ? 1n : secret));
    await expect(readRoleRevocationState(request)).rejects.toThrow("digest mismatch");
  });
  it.each(["omit", "duplicate", "reorder", "replace", "extra", "nonarray"])("rejects %s page data", async mode => {
    const test = fixture();
    if (mode === "nonarray") test.source.getRevokedRolePage.mockResolvedValue({} as bigint[]);
    else {
      const changed = [...test.secrets];
      if (mode === "omit") changed.pop();
      else if (mode === "extra") changed.push(123n);
      else if (mode === "duplicate") changed[1] = changed[0];
      else if (mode === "reorder") [changed[0], changed[1]] = [changed[1], changed[0]];
      else changed[0] += 1n;
      test.source.getRevokedRolePage.mockResolvedValue(changed);
    }
    await expect(readRoleRevocationState(test.request())).rejects.toThrow();
  });
  it("rejects forged genesis and inconsistent empty endpoints", async () => {
    const test = fixture();
    test.source.revocationCheckpoint.mockImplementation(async (_role, index) => index === 0n ? 123n : test.checkpoints[Number(index)]);
    await expect(readRoleRevocationState(test.request())).rejects.toThrow("genesis");
    const empty = fixture(19, 19);
    empty.source.revocationCheckpoint.mockResolvedValueOnce(123n).mockResolvedValueOnce(124n);
    await expect(readRoleRevocationState(empty.request())).rejects.toThrow("digest mismatch");
  });
  it("rejects wrong network, zero source, absent provider and malformed anchors", async () => {
    const test = fixture();
    await expect(readRoleRevocationState({ ...test.request(), chainId: 1n })).rejects.toThrow("another chain");
    test.source.getAddress.mockResolvedValue(toBeHex(0n, 20));
    await expect(readRoleRevocationState(test.request())).rejects.toThrow("source");
    await expect(readRoleRevocationState({ ...test.request(), source: {} as Contract })).rejects.toThrow("provider");
    const badAnchor = fixture();
    await expect(readRoleRevocationState({ ...badAnchor.request(), anchor: { ...badAnchor.anchor, blockNumber: -1 } })).rejects.toThrow("anchor");
  });
  it("checks the anchor again after reads and rejects a reorganization", async () => {
    const test = fixture();
    test.provider.getBlock.mockResolvedValueOnce({ number: 100, hash: test.anchor.blockHash })
      .mockResolvedValueOnce({ number: 100, hash: toBeHex(101n, 32) });
    await expect(readRoleRevocationState(test.request())).rejects.toThrow("reorganized");
  });
  it.each(["count", "progress", "batch", "tail", "checkpoint", "secret", "nonce", "tag", "role"])("rejects noncanonical %s state", async mode => {
    const test = fixture(), request = test.request();
    if (mode === "count") test.source.revokedRoleCount.mockResolvedValue(1n << 64n);
    if (mode === "progress") test.source.roleScanProgress.mockResolvedValue(20n);
    if (mode === "batch") test.source.MAX_REVOCATION_BATCH.mockResolvedValue(31n);
    if (mode === "tail") test.source.MAX_REVOCATION_TAIL.mockResolvedValue(9n);
    if (mode === "checkpoint") test.source.revocationCheckpoint.mockResolvedValue(SNARK_SCALAR_FIELD);
    if (mode === "secret") test.source.getRevokedRolePage.mockResolvedValue(Array(19).fill(0n));
    if (mode === "nonce") request.nonce = 0n;
    if (mode === "tag") request.tag = SNARK_SCALAR_FIELD;
    if (mode === "role") Object.assign(request, { role: 3 });
    await expect(readRoleRevocationState(request)).rejects.toThrow();
  });
  it("preserves RPC errors and never treats a synchronization error as revoked", async () => {
    const test = fixture(), error = new Error("RevocationStateNotPrepared");
    test.source.roleScanProgress.mockRejectedValue(error);
    await expect(readRoleRevocationState(test.request())).rejects.toBe(error);
    test.source.roleScanProgress.mockResolvedValue(0n);
    const unavailable = new Error("RPC unavailable");
    test.source.getRevokedRolePage.mockRejectedValue(unavailable);
    await expect(readRoleRevocationState(test.request())).rejects.toBe(unavailable);
  });
  it("concurrent reads keep nonce, tag, role and source scopes independent", async () => {
    const first = fixture(), second = fixture(19, 0, 0, toBeHex(0x54321n, 20)),
      third = fixture(19, 0, 2, toBeHex(0x54322n, 20));
    const a = first.request(), b = second.request(), c = third.request();
    b.nonce += 1n;
    c.tag = poseidon3([73303n, third.secrets[0], c.nonce]);
    const results = await Promise.all([readRoleRevocationState(a), readRoleRevocationState(b), readRoleRevocationState(c)]);
    expect(results.map(result => result.revoked)).toEqual([false, false, true]);
    expect(results.map(result => result.nonce)).toEqual([a.nonce, b.nonce, c.nonce]);
    expect(results.map(result => result.role)).toEqual([1, 0, 2]);
    expect(new Set(results.map(result => result.sourceAddress)).size).toBe(3);
  });
});
