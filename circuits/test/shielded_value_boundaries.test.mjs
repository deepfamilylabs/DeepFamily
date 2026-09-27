// Run with: node --test circuits/test/shielded_value_boundaries.test.mjs
// This builds temporary WASM/R1CS files. It does not create trusted keys or
// substitute for production Groth16 verification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2 } from "poseidon-lite";
import {
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
} from "@deepfamily/protocol-core";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const field = (bytes) =>
  computeShieldedCiphertextHashField(Uint8Array.from({ length: 512 }, () => bytes));
const asStrings = (values) => values.map((value) => BigInt(value).toString());
const ownerSecret = 5001n;
const ownerCommitment = poseidon2([1013n, ownerSecret]);
const valueNote = (amount, nonce, ciphertextHashField) =>
  computeShieldedValueNoteCommitment({
    ownerCommitment,
    amount,
    nonce,
    ciphertextHashField,
  });

function shieldFixture() {
  const outputAmounts = [70n, 30n];
  const outputNonces = [4001n, 4002n];
  const hashes = [field(1), field(2)];
  const signals = Array(32).fill(0n);
  signals[1] = 31337n;
  signals[2] = 0x1234n;
  for (let i = 0; i < 2; i += 1) {
    signals[21 + i] = valueNote(outputAmounts[i], outputNonces[i], hashes[i]);
    signals[23 + i] = hashes[i];
  }
  signals[25] = 100n;
  return {
    publicSignals: asStrings(signals),
    ownerSecret: ownerSecret.toString(),
    outputAmounts: asStrings(outputAmounts),
    outputNonces: asStrings(outputNonces),
  };
}

function unshieldFixture() {
  const inputAmount = 100n;
  const inputNonce = 3301n;
  const inputCiphertextHash = field(3);
  const inputCommitment = valueNote(inputAmount, inputNonce, inputCiphertextHash);
  const changeAmount = 70n;
  const changeNonce = 4401n;
  const dummyNonce = 4402n;
  const changeHash = field(4);
  const dummyHash = field(5);
  const signals = Array(32).fill(0n);
  signals[0] = 7n;
  signals[1] = 31337n;
  signals[2] = 0x1234n;
  signals[4] = inputCommitment;
  signals[6] = inputCommitment;
  signals[7] = computeShieldedSpendNullifier({ ownerSecret, noteCommitment: inputCommitment });
  signals[8] = computeShieldedDummyInputNullifier({
    ownerSecret,
    noteCommitment: inputCommitment,
  });
  signals[21] = valueNote(changeAmount, changeNonce, changeHash);
  signals[22] = valueNote(0n, dummyNonce, dummyHash);
  signals[23] = changeHash;
  signals[24] = dummyHash;
  signals[25] = 30n;
  signals[26] = 0x5678n;
  return {
    publicSignals: asStrings(signals),
    ownerSecret: ownerSecret.toString(),
    inputAmount: inputAmount.toString(),
    inputNonce: inputNonce.toString(),
    inputCiphertextHash: inputCiphertextHash.toString(),
    noteDepth: "0",
    noteIndex: "0",
    noteSiblings: Array(32).fill("0"),
    changeAmount: changeAmount.toString(),
    changeNonce: changeNonce.toString(),
    dummyNonce: dummyNonce.toString(),
  };
}

async function compileCircuit(directory, name) {
  execFileSync(
    path.join(repoRoot, "bin/circom"),
    [
      `circuits/${name}.circom`,
      "--r1cs",
      "--wasm",
      "--sym",
      "--O2",
      "--sanity_check",
      "2",
      "-l",
      "node_modules",
      "-l",
      "node_modules/circomlib/circuits",
      "-o",
      directory,
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
  const wasm = fs.readFileSync(path.join(directory, `${name}_js/${name}.wasm`));
  const calculator = await WitnessCalculatorBuilder(wasm, { singleThread: true });
  return {
    valid: async (witness) => {
      const wires = await calculator.calculateWitness(witness, 1);
      assert.equal(wires[0], 1n);
    },
    invalid: async (witness) => {
      const originalError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(witness, 1));
      } finally {
        console.error = originalError;
      }
    },
    r1csCheck: (witness) => {
      const inputPath = path.join(directory, `${name}.input.json`);
      const witnessPath = path.join(directory, `${name}.wtns`);
      const snarkjsCli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      fs.writeFileSync(inputPath, JSON.stringify(witness));
      execFileSync(
        process.execPath,
        [
          snarkjsCli,
          "wtns",
          "calculate",
          path.join(directory, `${name}_js/${name}.wasm`),
          inputPath,
          witnessPath,
        ],
        { cwd: repoRoot, stdio: "pipe" },
      );
      const output = execFileSync(
        process.execPath,
        [snarkjsCli, "wtns", "check", path.join(directory, `${name}.r1cs`), witnessPath],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.match(output, /WITNESS IS CORRECT/u);
    },
  };
}

const mutated = (fixture, change) => {
  const result = structuredClone(fixture);
  change(result);
  return result;
};

test("shield and unshield boundary circuits", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-value-"));
  try {
    const shield = await compileCircuit(directory, "shielded_shield");
    const unshield = await compileCircuit(directory, "shielded_unshield");
    const deposit = shieldFixture();
    const withdrawal = unshieldFixture();

    await t.test("valid shield witness satisfies R1CS", async () => {
      await shield.valid(deposit);
      shield.r1csCheck(deposit);
    });
    await t.test("shield rejects amount inflation and output substitution", async () => {
      await shield.invalid(
        mutated(deposit, (w) => {
          w.publicSignals[25] = "101";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.outputAmounts[0] = "71";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.publicSignals[21] = "123";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.publicSignals[23] = "123";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.ownerSecret = "0";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.publicSignals[7] = "1";
        }),
      );
    });

    await t.test("valid unshield witness satisfies R1CS", async () => {
      await unshield.valid(withdrawal);
      unshield.r1csCheck(withdrawal);
    });
    await t.test("unshield rejects theft, inflation, and bad change", async () => {
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.ownerSecret = "5002";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.publicSignals[4] = "123";
          w.publicSignals[6] = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.publicSignals[25] = "31";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.changeAmount = "71";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.publicSignals[21] = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.publicSignals[24] = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.publicSignals[26] = "0";
        }),
      );
    });

    await t.test("unshield accepts an exact 32-level LeanIMT path", async () => {
      const deep = structuredClone(withdrawal);
      let root = BigInt(deep.publicSignals[4]);
      for (let level = 0; level < 32; level += 1) {
        const sibling = BigInt(level + 1);
        deep.noteSiblings[level] = sibling.toString();
        root = level === 31 ? poseidon2([sibling, root]) : poseidon2([root, sibling]);
      }
      deep.noteDepth = "32";
      deep.noteIndex = (1n << 31n).toString();
      deep.publicSignals[4] = root.toString();
      deep.publicSignals[6] = root.toString();
      await unshield.valid(deep);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
