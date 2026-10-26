import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { poseidon3 } from "poseidon-lite";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { assertConstraintViolation } from "./constraint_assertions.mjs";
import { revocationScanFixture } from "./revocation_fixture.mjs";

const root = path.resolve(import.meta.dirname, "../..");
test("authenticated revocation ranges exclude the current code's role tag", async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-revocation-"));
  try {
    execFileSync(path.join(root, "bin/circom"), ["circuits/eligibility_revocation_scan.circom", "--r1cs", "--wasm",
      "--O2", "--sanity_check", "2", "-l", "node_modules", "-l", "node_modules/circomlib/circuits", "-o", out],
    { cwd: root, stdio: "pipe" });
    const calculator = await WitnessCalculatorBuilder(fs.readFileSync(path.join(out,
      "eligibility_revocation_scan_js/eligibility_revocation_scan.wasm")), { singleThread: true });
    const valid = async fixture => {
      const wires = await calculator.calculateWitness(fixture.witness, 1);
      assert.deepEqual(wires.slice(1, 10), fixture.publicSignals);
    };
    const invalid = (fixture, patch = {}) => assertConstraintViolation(() => calculator.calculateWitness({ ...fixture.witness, ...patch }, 1));
    await t.test("all three roles and partial/full batches bind the exact nine public inputs", async () => {
      for (const role of [0n, 1n, 2n]) for (const count of [1, 8, 32])
        await valid(revocationScanFixture({ role, secrets: Array.from({ length: count }, (_, index) => 100n + BigInt(index)) }));
    });
    await t.test("a following batch starts at the authenticated prior prefix", async () => {
      await valid(revocationScanFixture({ prefixSecrets: [111n, 222n, 333n], secrets: [444n, 555n] }));
      await valid(revocationScanFixture({ start: (1n << 64n) - 2n, startHash: 123n, secrets: [444n] }));
    });
    await t.test("revoked openings cannot pass at the beginning, middle or end of a batch", async () => {
      for (const role of [0n, 1n, 2n]) for (const position of [0, 15, 31]) {
        const secrets = Array.from({ length: 32 }, (_, index) => 40000n + BigInt(index));
        secrets[position] = 999991n;
        await invalid(revocationScanFixture({ role, secrets }));
      }
    });
    await t.test("omitted, duplicated, reordered or substituted entries cannot preserve the log endpoint", async () => {
      const fixture = revocationScanFixture();
      const original = fixture.witness.secrets;
      await invalid(fixture, { secrets: [...original.slice(1), "0"] });
      await invalid(fixture, { secrets: [original[0], original[0], ...original.slice(2)] });
      await invalid(fixture, { secrets: [original[1], original[0], ...original.slice(2)] });
      await invalid(fixture, { secrets: ["123", ...original.slice(1)] });
      await invalid(fixture, { endHash: String(BigInt(fixture.witness.endHash) + 1n) });
    });
    await t.test("genesis authenticates the source scope and role", async () => {
      const fixture = revocationScanFixture();
      for (const name of ["chainId", "sourceAddress", "role", "startHash"])
        await invalid(fixture, { [name]: String(BigInt(fixture.witness[name]) + 1n) });
      await invalid(fixture, { tag: String(poseidon3([73302n, 40000n, BigInt(fixture.witness.nonce)])) });
    });
    await t.test("range bounds reject empty, backward, overflowing and oversized batches", async () => {
      const fixture = revocationScanFixture();
      for (const patch of [{ end: "0" }, { end: "33" }, { start: "33", end: "32" },
        { start: String(1n << 64n) }, { end: String(1n << 64n) }]) await invalid(fixture, patch);
    });
    await t.test("zero openings and noncanonical padding cannot hide log entries", async () => {
      await invalid(revocationScanFixture({ secrets: [0n, 222n] }));
      const fixture = revocationScanFixture({ secrets: [111n] });
      const secrets = fixture.witness.secrets.slice();
      secrets[31] = "222";
      await invalid(fixture, { secrets });
    });
    await t.test("scope, role, nonce and tag bounds are enforced", async () => {
      const fixture = revocationScanFixture();
      for (const name of ["chainId", "sourceAddress", "nonce", "tag"]) await invalid(fixture, { [name]: "0" });
      for (const patch of [{ chainId: String(1n << 64n) }, { sourceAddress: String(1n << 160n) }, { role: "3" }, { role: "4" }])
        await invalid(fixture, patch);
    });
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
