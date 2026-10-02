import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon5 } from "poseidon-lite";
import { buildShieldedPublicClaimFixture } from "./generate_shielded_claim_public_input.mjs";

const root = path.resolve(import.meta.dirname, "../..");
test("public budget claim identity and payout constraints", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-claim-public-"));
  try {
    execFileSync(
      path.join(root, "bin/circom"),
      [
        "circuits/shielded_claim_public.circom",
        "--r1cs",
        "--wasm",
        "--O2",
        "-l",
        "node_modules",
        "-l",
        "node_modules/circomlib/circuits",
        "-o",
        output,
      ],
      { cwd: root, stdio: "pipe" },
    );
    const calculator = await WitnessCalculatorBuilder(
      fs.readFileSync(path.join(output, "shielded_claim_public_js/shielded_claim_public.wasm")),
      { singleThread: true },
    );
    const { witness, ownerCommitment } = buildShieldedPublicClaimFixture();
    const valid = async (input) =>
      assert.equal((await calculator.calculateWitness(input, 1))[0], 1n);
    const invalid = async (input) => {
      const original = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(input, 1));
      } finally {
        console.error = original;
      }
    };
    await t.test("valid claim mints payout and zero VALUE to the identity owner", async () => {
      await valid(witness);
      for (const count of [1n, 12n])
        await valid(buildShieldedPublicClaimFixture({ claimCount: count }).witness);
      const inputFile = path.join(output, "input.json");
      const wtns = path.join(output, "witness.wtns");
      fs.writeFileSync(inputFile, JSON.stringify(witness));
      const cli = path.join(root, "node_modules/snarkjs/build/cli.cjs");
      execFileSync(
        process.execPath,
        [
          cli,
          "wtns",
          "calculate",
          path.join(output, "shielded_claim_public_js/shielded_claim_public.wasm"),
          inputFile,
          wtns,
        ],
        { stdio: "pipe" },
      );
      assert.match(
        execFileSync(
          process.execPath,
          [cli, "wtns", "check", path.join(output, "shielded_claim_public.r1cs"), wtns],
          { encoding: "utf8" },
        ),
        /WITNESS IS CORRECT/u,
      );
    });
    await t.test("rejects another identity secret or beneficiary commitment", async () => {
      await invalid({
        ...witness,
        derivedSecretField: String(BigInt(witness.derivedSecretField) + 1n),
      });
      await invalid({ ...witness, heirIdentityCommitment: "123" });
      await invalid({ ...witness, derivedSecretField: "0" });
    });
    await t.test(
      "rejects foreign-owner payout, nonzero padding, and ciphertext substitution",
      async () => {
        const foreign = structuredClone(witness);
        foreign.outputCommitments[0] = poseidon5([
          1014n,
          123n,
          BigInt(witness.amount),
          BigInt(witness.outputNonces[0]),
          BigInt(witness.ciphertextHashes[0]),
        ]).toString();
        await invalid(foreign);
        const padding = structuredClone(witness);
        padding.outputCommitments[1] = poseidon5([
          1014n,
          ownerCommitment,
          1n,
          BigInt(witness.outputNonces[1]),
          BigInt(witness.ciphertextHashes[1]),
        ]).toString();
        await invalid(padding);
        const ciphertext = structuredClone(witness);
        ciphertext.ciphertextHashes[0] = "123";
        await invalid(ciphertext);
        await invalid({ ...witness, outputNonces: ["0", witness.outputNonces[1]] });
      },
    );
    await t.test("range binds every public scalar context and payout", async () => {
      for (const [name, value] of [
        ["chainId", 1n << 64n],
        ["pool", 1n << 160n],
        ["budgetId", 0n],
        ["budgetId", 1n << 64n],
        ["firstPeriod", 1n << 64n],
        ["firstPeriod", (1n << 64n) - 1n],
        ["claimCount", 0n],
        ["claimCount", 13n],
        ["amount", 0n],
        ["amount", 1n << 128n],
      ])
        await invalid({ ...witness, [name]: String(value) });
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
