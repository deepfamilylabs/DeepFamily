import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, toBeHex, type ContractRunner } from "ethers";
import {
  computeRevocationGenesis, computeRevocationDigest, computeRoleTag, planRevocationScans,
  computeShieldedCiphertextHashField, type ReceiveCode, type Capability,
} from "@deepfamily/protocol-core";
import { ReceiveChain, ELIGIBILITY_SOURCE_ABI, RECEIVE_REGISTRY_ABI,
  type DepositSubmission, type ClaimSubmission, type RevocationScanSubmission } from "./receiveChain";

const hooks = vi.hoisted(() => ({ contracts: new Map<string, object>(), readState: vi.fn() }));
vi.mock("./receiveRevocations", () => ({ readRoleRevocationState: hooks.readState }));
vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return { ...actual, Contract: vi.fn(function (address: string, abi: string[]) {
    const contract = hooks.contracts.get(address.toLowerCase());
    if (!contract) throw new Error(`Unexpected contract ${address}`);
    return { ...contract, interface: new actual.Interface(abi) };
  }) };
});
const proof = { pi_a: [1n, 2n, 1n], pi_b: [[3n, 4n], [5n, 6n], [1n, 0n]], pi_c: [7n, 8n, 1n] };
const sourceErrors = new Interface(ELIGIBILITY_SOURCE_ABI), registryErrors = new Interface(RECEIVE_REGISTRY_ABI);
function fixture(count = 64, options: ConstructorParameters<typeof ReceiveChain>[2] = {}) {
  const sourceAddress = "0x3333333333333333333333333333333333333333";
  const deployment = { chainId: 31337n, registryAddress: "0x0000000000000000000000000000000000001234",
    poolAddress: "0x0000000000000000000000000000000000004321" };
  const nonce = 9001n;
  const states = ([0, 1, 2] as const).map(role => {
    const secrets = Array.from({ length: count }, (_, index) => 1000n + BigInt(role * 10000 + index));
    const startHash = computeRevocationGenesis({ chainId: deployment.chainId, sourceAddress, role });
    const checkpoints = [startHash];
    for (const secret of secrets) checkpoints.push(computeRevocationDigest({ role, previousHash: checkpoints[checkpoints.length - 1], secret }));
    return { chainId: deployment.chainId, sourceAddress, role, nonce,
      tag: computeRoleTag({ role: ["child", "endorsement", "trusted"][role] as "child" | "endorsement" | "trusted", roleSecret: 999991n, nonce }),
      start: 0n, count: BigInt(count), checkedThrough: 0n, startHash, endHash: checkpoints[count], secrets, revoked: false,
      blockNumber: 100, blockHash: toBeHex(100n, 32), checkpoints };
  });
  const status = { issuanceRoot: 777n, nonce, childTag: states[0].tag, endorsementTag: states[1].tag, trustedTag: states[2].tag };
  const progress = new Map<number, bigint>();
  const provider = { getNetwork: vi.fn(async () => ({ chainId: deployment.chainId })),
    getBlockNumber: vi.fn(async () => 100), getBlock: vi.fn(async (number: number) => ({ number, hash: toBeHex(100n, 32) })) };
  const registry = { SOURCE: vi.fn(async () => sourceAddress), isKnownIssuanceRoot: vi.fn(async () => true),
    validateBudgetRoleStatus: vi.fn(async () => true), verifyBudgetCapability: vi.fn(async () => true),
    verifyReceive: vi.fn(async (..._args: unknown[]) => true) };
  const record = { exists: true, commonBinding: 12n, policyCommitment: 15n, eligibleFrom: 1n,
    codeAlias: 11n, nonce, ownerCommitment: 14n, viewKeyLo: 2n, viewKeyHi: 3n };
  const pool = { RECEIVE_REGISTRY: vi.fn(async () => deployment.registryAddress), protocolVersion: vi.fn(async () => 1n),
    budgetRecords: vi.fn(async () => record), depositBudget: vi.fn(async () => ({ hash: "deposit" })),
    claimBudget: vi.fn(async () => ({ hash: "claim" })) };
  const source = { runner: { provider }, getAddress: vi.fn(async () => sourceAddress),
    roleScanProgress: vi.fn(async (role: number) => progress.get(role) ?? 0n),
    revokedRoleCount: vi.fn(async () => BigInt(count)),
    revocationCheckpoint: vi.fn(async (role: number, index: bigint) => states[role].checkpoints[Number(index)]),
    prepareRoleScan: vi.fn(async (role: number, _nonce: bigint, _tag: bigint, _start: bigint, end: bigint) => ({
      wait: vi.fn(async () => { progress.set(role, end); return { status: 1 }; }),
    })) };
  hooks.contracts.set(deployment.registryAddress.toLowerCase(), registry);
  hooks.contracts.set(deployment.poolAddress.toLowerCase(), pool);
  hooks.contracts.set(sourceAddress.toLowerCase(), source);
  hooks.readState.mockImplementation(async ({ role }) => states[role]);
  const chain = new ReceiveChain(deployment, { provider } as unknown as ContractRunner, options);
  const scans: RevocationScanSubmission[] = states.flatMap(state => planRevocationScans(state).scans.map(scan => ({
    sourceAddress, role: state.role, nonce, tag: state.tag, start: scan.start, end: scan.end,
    startHash: scan.startHash, endHash: scan.endHash, proof, publicSignals: scan.publicSignals,
  })));
  const cap = { issuanceRoot: status.issuanceRoot, parentVersion: 1n, capabilityBinding: 333n, familyTag: 444n,
    childTag: status.childTag, endorsementTag: status.endorsementTag, trustedTag: status.trustedTag, proof, publicSignals: Array(10).fill(1n) } as Capability;
  const code = { chainId: deployment.chainId, authorizerScope: BigInt(deployment.registryAddress), codeAlias: 11n,
    commonBinding: 12n, revocationTag: 13n, nonce, ownerCommitment: 14n, viewingKey: new Uint8Array(32).fill(37),
    expiresAt: 2000000000n, proof, capabilities: [cap], publicSignals: Array(10).fill(1n), version: 1 } as ReceiveCode;
  const outputCiphertexts = [new Uint8Array(512).fill(1), new Uint8Array(512).fill(2)];
  const shared = { outputCiphertexts, ciphertextHashes: outputCiphertexts.map(computeShieldedCiphertextHashField),
    outputCommitments: [31n, 37n], proof, revocationScans: scans };
  const deposit = { ...shared, code, capabilityIndex: 0, policyCommitment: 15n, budgetKey: 55n, eligibleFrom: 1n,
    publicInput: { inputRoot: 41n, inputNullifier: 43n } } as unknown as DepositSubmission;
  const claim = { ...shared, periodNullifier: 17n,
    publicInput: { ...status, budgetKey: 55n, asOf: 100n, inputRoot: 41n, inputNullifier: 43n } } as unknown as ClaimSubmission;
  return { sourceAddress, deployment, states, status, progress, provider, source, registry, pool, chain, scans, code, cap, deposit, claim };
}
const unavailable = (role = 0, checked = 0n, total = 64n) => ({ code: "CALL_EXCEPTION",
  data: sourceErrors.encodeErrorResult("RevocationStateNotPrepared", [role, checked, total]) });
beforeEach(() => { hooks.contracts.clear(); hooks.readState.mockReset(); });

describe("revocation preparation chain boundary", () => {
  it("uses authenticated public suffixes only for a canonical preparation-needed revert", async () => {
    const test = fixture();
    test.registry.validateBudgetRoleStatus.mockRejectedValue(unavailable());
    expect(await test.chain.checkClaimQualification(test.status)).toBe(true);
    expect(hooks.readState).toHaveBeenCalledTimes(3);
    test.states[2].revoked = true;
    expect(await test.chain.checkClaimQualification(test.status)).toBe(false);
    test.registry.verifyBudgetCapability.mockRejectedValue(unavailable(1));
    expect(await test.chain.checkEligibility(test.code, test.cap)).toBe(false);
    test.states[2].revoked = false;
    expect(await test.chain.checkEligibility(test.code, test.cap)).toBe(true);
    expect(test.registry.verifyReceive).toHaveBeenCalledTimes(2);
    for (const call of test.registry.verifyReceive.mock.calls) expect(call[2]).toEqual({ blockTag: 100 });
  });
  it.each(["CodeRevoked", "CodeExpired"])("preserves %s detected at the fallback anchor before trusting a public suffix", async name => {
    const test = fixture();
    test.registry.verifyBudgetCapability.mockRejectedValue(unavailable());
    const failure = { code: "CALL_EXCEPTION", data: new Interface([`error ${name}()`]).encodeErrorResult(name) };
    test.registry.verifyReceive.mockRejectedValue(failure);
    await expect(test.chain.checkEligibility(test.code, test.cap)).rejects.toBe(failure);
    expect(test.registry.verifyReceive.mock.calls[0][2]).toEqual({ blockTag: 100 });
    expect(hooks.readState).not.toHaveBeenCalled();
  });
  it("rejects a false receive verification and preserves its RPC failure during fallback", async () => {
    const test = fixture();
    test.registry.verifyBudgetCapability.mockRejectedValue(unavailable());
    test.registry.verifyReceive.mockResolvedValue(false);
    await expect(test.chain.checkEligibility(test.code, test.cap)).rejects.toThrow("authorization is no longer valid");
    const failure = new Error("receive verification RPC unavailable");
    test.registry.verifyReceive.mockRejectedValue(failure);
    await expect(test.chain.checkEligibility(test.code, test.cap)).rejects.toBe(failure);
    expect(hooks.readState).not.toHaveBeenCalled();
  });
  it("preserves malformed, impossible and unrelated reverts instead of treating them as revocation or synchronization", async () => {
    const test = fixture();
    const canonical = unavailable();
    for (const error of [
      { ...canonical, data: canonical.data + "00" }, { ...canonical, data: canonical.data.slice(0, -2) },
      unavailable(3), unavailable(0, 32n, 40n), unavailable(0, 0n, 1n << 64n),
      { ...canonical, code: "NETWORK_ERROR" }, new Error("RPC unavailable"),
      { code: "CALL_EXCEPTION", data: new Interface(["error InvalidField()"]).encodeErrorResult("InvalidField") },
    ]) {
      test.registry.validateBudgetRoleStatus.mockRejectedValue(error);
      await expect(test.chain.checkClaimQualification(test.status)).rejects.toBe(error);
    }
    expect(hooks.readState).not.toHaveBeenCalled();
  });
  it("does not swallow an RPC error or unknown root during authenticated fallback", async () => {
    const test = fixture(), error = new Error("public log unavailable");
    test.registry.validateBudgetRoleStatus.mockRejectedValue(unavailable());
    hooks.readState.mockRejectedValue(error);
    await expect(test.chain.checkClaimQualification(test.status)).rejects.toBe(error);
    hooks.readState.mockClear();
    test.registry.isKnownIssuanceRoot.mockResolvedValue(false);
    await expect(test.chain.checkClaimQualification(test.status)).rejects.toThrow("root is not registered");
    expect(hooks.readState).not.toHaveBeenCalled();
  });
  it.each(["source", "nonce", "tag", "role", "signals", "proof", "checkpoint", "gap"])("rejects a later %s mismatch before sending any transaction", async mode => {
    const test = fixture(), scans = structuredClone(test.scans), later = scans[1];
    if (mode === "source") later.sourceAddress = toBeHex(123n, 20);
    if (mode === "nonce") later.nonce += 1n;
    if (mode === "tag") later.tag += 1n;
    if (mode === "role") Object.assign(later, { role: 3 });
    if (mode === "signals") later.publicSignals[8] += 1n;
    if (mode === "proof") later.proof = { ...proof, pi_a: [0n, 0n] };
    if (mode === "checkpoint") { later.startHash += 1n; later.publicSignals[7] = later.startHash; }
    if (mode === "gap") { later.start = 33n; later.startHash = test.states[0].checkpoints[33];
      later.publicSignals[5] = later.start; later.publicSignals[7] = later.startHash; }
    await expect(test.chain.sendRevocationScans(scans, test.status)).rejects.toThrow();
    expect(test.source.prepareRoleScan).not.toHaveBeenCalled();
  });
  it("sends each continuous range and waits for success before moving to the next", async () => {
    const progress = vi.fn(), test = fixture(64, { onRevocationPreparation: progress });
    await test.chain.sendRevocationScans(test.scans, test.status);
    expect(test.source.prepareRoleScan).toHaveBeenCalledTimes(6);
    expect([...test.progress.values()]).toEqual([64n, 64n, 64n]);
    expect(progress.mock.calls).toEqual(Array.from({ length: 7 }, (_, completed) => [completed, 6]));
    for (const [, , , start, end] of test.source.prepareRoleScan.mock.calls) expect(end - start).toBe(32n);
  });
  it("skips concurrently completed ranges but rejects partial overlapping progress before any send", async () => {
    const complete = fixture();
    for (const role of [0, 1, 2]) complete.progress.set(role, 64n);
    await complete.chain.sendRevocationScans(complete.scans, complete.status);
    expect(complete.source.prepareRoleScan).not.toHaveBeenCalled();
    const partial = fixture();
    partial.progress.set(0, 17n);
    await expect(partial.chain.sendRevocationScans(partial.scans, partial.status)).rejects.toThrow("refresh");
    expect(partial.source.prepareRoleScan).not.toHaveBeenCalled();
  });
  it.each(["deposit", "claim"] as const)("stops %s after a failed preparation receipt", async operation => {
    const test = fixture();
    test.source.prepareRoleScan.mockResolvedValue({ wait: vi.fn(async () => ({ status: 0 })) });
    await expect(operation === "deposit" ? test.chain.sendDeposit(test.deposit, 0n) : test.chain.sendClaim(test.claim, 0n))
      .rejects.toThrow("preparation transaction failed");
    expect(test.source.prepareRoleScan).toHaveBeenCalledTimes(1);
    expect(test.pool.depositBudget).not.toHaveBeenCalled();
    expect(test.pool.claimBudget).not.toHaveBeenCalled();
  });
  it("guards again if the wallet changes while reading the fresh progress", async () => {
    let changed = false;
    const test = fixture(64, { beforeTransaction: () => { if (changed) throw new Error("wallet changed"); } });
    test.source.roleScanProgress.mockImplementation(async (_role, ...args: unknown[]) => {
      if (args.length === 2) changed = true;
      return 0n;
    });
    await expect(test.chain.sendDeposit(test.deposit, 0n)).rejects.toThrow("wallet changed");
    expect(test.source.prepareRoleScan).not.toHaveBeenCalled();
    expect(test.pool.depositBudget).not.toHaveBeenCalled();
  });
  it("does not submit funds when the wallet changes during the final preparation receipt", async () => {
    let changed = false;
    const test = fixture(32, { beforeTransaction: () => { if (changed) throw new Error("wallet changed"); } });
    test.deposit.revocationScans = [test.scans[0]];
    test.source.prepareRoleScan.mockImplementation(async () => ({ wait: vi.fn(async () => { changed = true; return { status: 1 }; }) }));
    await expect(test.chain.sendDeposit(test.deposit, 0n)).rejects.toThrow("wallet changed");
    expect(test.source.prepareRoleScan).toHaveBeenCalledTimes(1);
    expect(test.pool.depositBudget).not.toHaveBeenCalled();
  });
  it.each(["deposit", "claim"] as const)("submits %s only after every required preparation succeeds", async operation => {
    const test = fixture();
    await (operation === "deposit" ? test.chain.sendDeposit(test.deposit, 0n) : test.chain.sendClaim(test.claim, 0n));
    expect(test.source.prepareRoleScan).toHaveBeenCalledTimes(6);
    expect(operation === "deposit" ? test.pool.depositBudget : test.pool.claimBudget).toHaveBeenCalledTimes(1);
    expect(test.source.prepareRoleScan.mock.invocationCallOrder[5]).toBeLessThan(
      (operation === "deposit" ? test.pool.depositBudget : test.pool.claimBudget).mock.invocationCallOrder[0]);
  });
  it.each(["deposit", "claim"] as const)("submits bounded proof rounds before continuing %s preparation", async operation => {
    const test = fixture(64);
    const next = test.scans.filter(scan => scan.start === 32n);
    const callback = vi.fn().mockResolvedValue([]);
    const streamed = new ReceiveChain(test.deployment, { provider: test.provider } as unknown as ContractRunner,
      { prepareRevocationScans: callback });
    const prepared = operation === "deposit" ? test.deposit : test.claim;
    prepared.revocationScans = test.scans.filter(scan => scan.start === 0n);
    callback.mockImplementationOnce(async status => {
      expect(status.nonce).toBe(test.status.nonce);
      expect([...test.progress.values()]).toEqual([32n, 32n, 32n]);
      return next;
    });
    await (operation === "deposit" ? streamed.sendDeposit(test.deposit, 0n) : streamed.sendClaim(test.claim, 0n));
    expect(callback).toHaveBeenCalledTimes(2);
    expect([...test.progress.values()]).toEqual([64n, 64n, 64n]);
    expect(operation === "deposit" ? test.pool.depositBudget : test.pool.claimBudget).toHaveBeenCalledOnce();
  });
  it("retains confirmed progress and stops funds when a later proof round fails", async () => {
    const failure = new Error("next proof round cancelled");
    const test = fixture(64, { prepareRevocationScans: async () => { throw failure; } });
    test.deposit.revocationScans = test.scans.filter(scan => scan.start === 0n);
    await expect(test.chain.sendDeposit(test.deposit, 0n)).rejects.toBe(failure);
    expect([...test.progress.values()]).toEqual([32n, 32n, 32n]);
    expect(test.pool.depositBudget).not.toHaveBeenCalled();
  });
  it("does not loop indefinitely if a worker repeats the already confirmed ranges", async () => {
    let repeated: RevocationScanSubmission[] = [];
    const test = fixture(32, { prepareRevocationScans: async () => repeated });
    repeated = test.scans;
    await expect(test.chain.sendDeposit(test.deposit, 0n)).rejects.toThrow("no progress");
    expect(test.source.prepareRoleScan).toHaveBeenCalledTimes(3);
    expect(test.pool.depositBudget).not.toHaveBeenCalled();
  });
});
