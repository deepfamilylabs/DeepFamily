import assert from "node:assert/strict";
import test from "node:test";
import { poseidon3 } from "poseidon-lite";
import {
  REVOCATION_SCAN_BATCH_SIZE, REVOCATION_SCAN_TAIL_SIZE,
  computeRevocationGenesis, computeRevocationDigest, verifyRevocationPage,
  prepareRevocationScan, planRevocationScans, SNARK_SCALAR_FIELD,
} from "../index.js";

const context = { chainId: 31337n, sourceAddress: 0x3333333333333333333333333333333333333333n, role: 1n };
const nonce = 9001n, targetSecret = 999991n;
const tag = poseidon3([73302n, targetSecret, nonce]);
function input(count = 32, extra = {}) {
  const secrets = Array.from({ length: count }, (_, index) => 40000n + BigInt(index));
  const startHash = poseidon3([74301n, context.chainId, context.sourceAddress]);
  let endHash = startHash;
  for (const secret of secrets) endHash = poseidon3([74311n, endHash, secret]);
  return { ...context, nonce, tag, start: 0n, startHash, endHash, secrets, ...extra };
}
test("public revocation hashes match independent domain-separated role/source fixtures", () => {
  assert.equal(REVOCATION_SCAN_BATCH_SIZE, 32);
  assert.equal(REVOCATION_SCAN_TAIL_SIZE, 8);
  const example = input();
  assert.equal(computeRevocationGenesis(context), example.startHash);
  assert.equal(computeRevocationGenesis({ ...context, sourceAddress: "0x3333333333333333333333333333333333333333" }), example.startHash);
  assert.equal(computeRevocationDigest({ role: 1, previousHash: example.startHash, secret: 40000n }),
    poseidon3([74311n, example.startHash, 40000n]));
  for (const changed of [{ role: 0n }, { chainId: 31338n }, { sourceAddress: context.sourceAddress + 1n }])
    assert.notEqual(computeRevocationGenesis({ ...context, ...changed }), example.startHash);
});
test("ordered pages authenticate all entries and distinguish revoked from invalid data", () => {
  const example = input();
  const page = verifyRevocationPage(example);
  assert.equal(page.endHash, example.endHash);
  assert.equal(page.revoked, false);
  assert.equal(page.checkpoints.length, 33);
  const revoked = input(1, { tag: poseidon3([73302n, 40000n, nonce]) });
  assert.equal(verifyRevocationPage(revoked).revoked, true);
  for (const secrets of [example.secrets.slice(1), [...example.secrets.slice(0, 31), 1n],
    [example.secrets[1], example.secrets[0], ...example.secrets.slice(2)],
    [example.secrets[0], example.secrets[0], ...example.secrets.slice(2)]])
    assert.throws(() => verifyRevocationPage({ ...example, secrets }), /digest mismatch/u);
  assert.throws(() => verifyRevocationPage({ ...example, startHash: 1n }), /genesis/u);
  assert.throws(() => verifyRevocationPage({ ...example, role: 0n }), /genesis/u);
  assert.throws(() => verifyRevocationPage({ ...example, endHash: undefined }), /endHash/u);
});
test("scan witnesses contain only public log entries and canonical padding", () => {
  for (const count of [1, 8, 32]) {
    const example = input(count), prepared = prepareRevocationScan(example);
    assert.deepEqual(prepared.publicSignals, [context.chainId, context.sourceAddress, context.role, nonce, tag,
      0n, BigInt(count), example.startHash, example.endHash]);
    assert.deepEqual(prepared.witness.secrets, [...example.secrets, ...Array(32 - count).fill(0n)]);
    assert.deepEqual(Object.keys(prepared.witness), ["chainId", "sourceAddress", "role", "nonce", "tag", "start", "end", "startHash", "endHash", "secrets"]);
  }
  assert.throws(() => prepareRevocationScan(input(0)), /between one and 32/u);
  assert.throws(() => prepareRevocationScan(input(33)), /between one and 32/u);
  assert.throws(() => prepareRevocationScan(input(1, { tag: poseidon3([73302n, 40000n, nonce]) })),
    error => error.code === "QUALIFICATION_REVOKED");
});
test("plans cover continuous authenticated intervals and leave at most the chosen live tail", () => {
  for (const count of [0, 1, 8, 9, 32, 40, 41, 64, 72, 73, 257]) {
    const example = input(count), plan = planRevocationScans(example);
    let progress = 0n, digest = example.startHash;
    for (const scan of plan.scans) {
      assert.equal(scan.start, progress);
      assert.equal(scan.startHash, digest);
      assert.ok(scan.end - scan.start > 0n && scan.end - scan.start <= 32n);
      progress = scan.end; digest = scan.endHash;
    }
    assert.equal(progress, plan.checkedThrough);
    assert.equal(plan.end, BigInt(count));
    assert.equal(plan.endHash, example.endHash);
    assert.ok(BigInt(count) - progress <= 8n);
  }
  assert.equal(planRevocationScans({ ...input(40), tailSize: 0 }).checkedThrough, 40n);
  assert.equal(planRevocationScans({ ...input(40), tailSize: 8 }).checkedThrough, 32n);
});
test("plans resume verified progress and reject revoked entries in either proof batches or live tail", () => {
  const history = input(73), page = verifyRevocationPage(history);
  const resumed = planRevocationScans({ ...history, start: 32n, startHash: page.checkpoints[32], secrets: history.secrets.slice(32) });
  assert.equal(resumed.scans[0].start, 32n);
  assert.equal(resumed.checkedThrough, 73n);
  for (const position of [0, 31, 32, 72]) assert.throws(() => planRevocationScans({ ...history,
    tag: poseidon3([73302n, history.secrets[position], nonce]) }), error => error.code === "QUALIFICATION_REVOKED");
  assert.throws(() => planRevocationScans({ ...history, endHash: 1n }), /digest mismatch/u);
});
test("malformed ranges, fields, scopes and unsafe integers never produce plans", () => {
  for (const extra of [{ chainId: 0n }, { chainId: 1n << 64n }, { sourceAddress: 0n }, { sourceAddress: 1n << 160n },
    { role: 3n }, { nonce: 0n }, { tag: 0n }, { nonce: SNARK_SCALAR_FIELD },
    { start: 1n << 64n }, { start: (1n << 64n) - 1n }, { start: Number.MAX_SAFE_INTEGER + 1 },
    { secrets: [0n] }, { secrets: [SNARK_SCALAR_FIELD] }, { secrets: "bad" }, { tag: undefined }])
    assert.throws(() => prepareRevocationScan(input(1, extra)));
  for (const tailSize of [-1, 9, 1.5, "8"]) assert.throws(() => planRevocationScans({ ...input(), tailSize }), /tail size/u);
});
