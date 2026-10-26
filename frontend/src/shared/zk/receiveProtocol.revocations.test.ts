// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  computeRevocationGenesis, computeRevocationDigest, computeRoleTag, planRevocationScans,
  SNARK_SCALAR_FIELD, type ProtocolProof,
} from "@deepfamily/protocol-core";
import type { ReceiveChain } from "../clients/receiveChain";
import { ReceiveService, type ProtocolProofProvider } from "./receiveProtocol";
import { publicWorkerResult } from "../../workers/receive.worker";

vi.mock("snarkjs", () => ({ groth16: {} }));
const deployment = { chainId: 31337n, registryAddress: "0x0000000000000000000000000000000000001234",
  poolAddress: "0x0000000000000000000000000000000000004321" };
const proof: ProtocolProof = { pi_a: [1n, 2n, 1n], pi_b: [[3n, 4n], [5n, 6n], [1n, 0n]], pi_c: [7n, 8n, 1n] };
const names = ["chainId", "sourceAddress", "role", "nonce", "tag", "start", "end", "startHash", "endHash"];
function setup(count = 41) {
  const nonce = 9001n, sourceAddress = "0x3333333333333333333333333333333333333333";
  const states = ([0, 1, 2] as const).map(role => {
    const end = Math.min(count, 32);
    const secrets = Array.from({ length: end }, (_, index) => BigInt(role * 10000 + index + 1000));
    const scope = { chainId: deployment.chainId, sourceAddress, role };
    const startHash = computeRevocationGenesis(scope);
    let endHash = startHash;
    for (const secret of secrets) endHash = computeRevocationDigest({ role, previousHash: endHash, secret });
    return { ...scope, nonce, tag: computeRoleTag({ role: ["child", "endorsement", "trusted"][role] as "child" | "endorsement" | "trusted", roleSecret: 999991n, nonce }),
      count: BigInt(count), checkedThrough: 0n, start: 0n, end: BigInt(end), startHash, endHash, secrets, revoked: false,
      blockNumber: 100, blockHash: "0x" + "1".repeat(64) };
  });
  const status = { issuanceRoot: 777n, nonce, childTag: states[0].tag, endorsementTag: states[1].tag, trustedTag: states[2].tag };
  const readQualificationRevocations = vi.fn(async () => states);
  const chain = { deployment, readQualificationRevocations } as unknown as ReceiveChain;
  const provider: ProtocolProofProvider = { prove: vi.fn(async (_circuit, witness) => ({ proof,
    publicSignals: names.map(name => witness[name] as bigint) })), verify: vi.fn(async () => true) };
  return { states, status, readQualificationRevocations, provider, service: new ReceiveService(chain, provider) };
}

describe("revocation proving orchestration", () => {
  it("plans all three roles before proving and returns only public continuous submissions", async () => {
    const test = setup(), actual = await test.service.prepareRevocationScans(test.status);
    expect(test.readQualificationRevocations).toHaveBeenCalledWith(test.status, undefined, { maxEntries: 32 });
    expect(actual.map(scan => [scan.role, scan.start, scan.end])).toEqual([
      [0, 0n, 32n], [1, 0n, 32n], [2, 0n, 32n],
    ]);
    expect(test.provider.prove).toHaveBeenCalledTimes(3);
    for (const scan of actual) {
      expect(Object.keys(scan).sort()).toEqual(["sourceAddress", "role", "nonce", "tag", "start", "end", "startHash", "endHash", "proof", "publicSignals"].sort());
      expect(scan.publicSignals).toEqual([deployment.chainId, BigInt(scan.sourceAddress), BigInt(scan.role), scan.nonce,
        scan.tag, scan.start, scan.end, scan.startHash, scan.endHash]);
      expect(scan).not.toHaveProperty("witness");
      expect(scan).not.toHaveProperty("secrets");
    }
  });
  it("bounds a large-history worker round to three proofs and resumes from later authenticated progress", async () => {
    const test = setup(500);
    const first = await test.service.prepareRevocationScans(test.status);
    expect(first.map(scan => [scan.role, scan.start, scan.end])).toEqual([
      [0, 0n, 32n], [1, 0n, 32n], [2, 0n, 32n],
    ]);
    expect(test.provider.prove).toHaveBeenCalledTimes(3);
    for (const state of test.states) {
      state.start = state.checkedThrough = 32n;
      state.end = 64n;
      state.startHash = state.endHash;
      state.secrets = state.secrets.map(secret => secret + 32n);
      state.endHash = state.secrets.reduce((previousHash, secret) => computeRevocationDigest({
        role: state.role, previousHash, secret,
      }), state.startHash);
    }
    const second = await test.service.prepareRevocationScans(test.status);
    expect(second.map(scan => [scan.role, scan.start, scan.end])).toEqual([
      [0, 32n, 64n], [1, 32n, 64n], [2, 32n, 64n],
    ]);
    expect(test.provider.prove).toHaveBeenCalledTimes(6);
    expect(test.readQualificationRevocations.mock.calls).toHaveLength(2);
  });
  it("proves a short authenticated sample when the complete unprepared log still exceeds the live tail", async () => {
    const test = setup(5);
    for (const state of test.states) state.count = 500n;
    const actual = await test.service.prepareRevocationScans(test.status);
    expect(actual).toHaveLength(3);
    expect(actual.every(scan => scan.start === 0n && scan.end === 5n)).toBe(true);
  });
  it("rejects a reader that returns more than one proof batch before invoking the prover", async () => {
    const test = setup();
    test.states[2].secrets.push(123n);
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toThrow("one worker round");
    expect(test.provider.prove).not.toHaveBeenCalled();
  });
  it("does not prove anything when the last role is already revoked or corrupt", async () => {
    const test = setup();
    test.states[2].tag = computeRoleTag({ role: "trusted", roleSecret: test.states[2].secrets[31], nonce: test.status.nonce });
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toMatchObject({ code: "QUALIFICATION_REVOKED" });
    expect(test.provider.prove).not.toHaveBeenCalled();
    const corrupt = setup();
    corrupt.states[2].endHash += 1n;
    await expect(corrupt.service.prepareRevocationScans(corrupt.status)).rejects.toThrow("digest mismatch");
    expect(corrupt.provider.prove).not.toHaveBeenCalled();
  });
  it("avoids proving when all roles fit within the bounded live tail", async () => {
    const test = setup(8);
    expect(await test.service.prepareRevocationScans(test.status)).toEqual([]);
    expect(test.provider.prove).not.toHaveBeenCalled();
  });
  it.each(Array.from({ length: 9 }, (_, index) => index))("rejects a changed scan public coordinate %s", async index => {
    const test = setup();
    vi.mocked(test.provider.prove).mockImplementation(async (_circuit, witness) => ({ proof,
      publicSignals: names.map((name, current) => (witness[name] as bigint) + BigInt(current === index)) }));
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toThrow("different statement");
    expect(test.provider.prove).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong arity and noncanonical outputs and preserves prover failures", async () => {
    const test = setup();
    vi.mocked(test.provider.prove).mockResolvedValue({ proof, publicSignals: Array(8).fill(1n) });
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toThrow("count");
    vi.mocked(test.provider.prove).mockResolvedValue({ proof, publicSignals: [SNARK_SCALAR_FIELD, ...Array(8).fill(1n)] });
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toThrow("Noncanonical");
    const error = new Error("proving unavailable");
    vi.mocked(test.provider.prove).mockRejectedValue(error);
    await expect(test.service.prepareRevocationScans(test.status)).rejects.toBe(error);
  });
  it("scrubs private extra proof fields, including custom properties on coordinate arrays", async () => {
    const test = setup(9), secret = "private-witness-must-stay-in-worker";
    const poisoned = { ...proof, witness: { secret }, pi_a: Object.assign([1n, 2n, 1n], { private: secret }),
      pi_b: Object.assign([[3n, 4n], Object.assign([5n, 6n], { private: secret }), [1n, 0n]], { private: secret }) };
    vi.mocked(test.provider.prove).mockImplementation(async (_circuit, witness) => ({ proof: poisoned,
      publicSignals: names.map(name => witness[name] as bigint) }));
    const scans = await test.service.prepareRevocationScans(test.status);
    expect(scans[0].proof).toEqual(proof);
    expect(scans[0].proof).not.toHaveProperty("witness");
    expect(scans[0].proof.pi_a).not.toHaveProperty("private");
    expect(scans[0].proof.pi_b[1]).not.toHaveProperty("private");
    const scan = planRevocationScans(test.states[0]).scans[0];
    const result = await test.service.proveQualification({ circuit: "revocationScan", witness: scan.witness,
      expectedPublicSignals: scan.publicSignals });
    expect(result.proof).toEqual(proof);
    expect(result.proof.pi_a).not.toHaveProperty("private");
    expect(Object.keys(result)).toEqual(["proof", "publicSignals"]);
  });
  it.each(["walletPrepareDeposit", "walletPrepareClaim", "prepareDeposit", "prepareClaim"] as const)("worker strips scan openings and nested private proof fields for %s", method => {
    const secret = "private-witness-must-not-cross";
    const scan = { sourceAddress: "0x3333333333333333333333333333333333333333", role: 1, nonce: 1n, tag: 2n,
      start: 0n, end: 1n, startHash: 3n, endHash: 4n, publicSignals: [1n, 2n], proof: { ...proof, witness: secret, secret },
      witness: { secret }, secrets: [secret], credentialSalt: secret, ownerSecret: secret };
    const value = { revocationScans: [scan], witness: secret, proof: { ...proof, witness: secret } };
    const result = publicWorkerResult(method, value) as { revocationScans: object[] };
    expect(JSON.stringify(result, (_name, item) => typeof item === "bigint" ? String(item) : item)).not.toContain(secret);
    expect(result.revocationScans[0]).toHaveProperty("role", 1);
    expect(result.revocationScans[0]).toHaveProperty("proof", proof);
    expect(scan).toHaveProperty("witness");
  });
});
