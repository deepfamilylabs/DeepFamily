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
  return {
    chainId: "31337",
    pool: String(0x1234n),
    outputCommitments: asStrings(
      outputAmounts.map((amount, i) => valueNote(amount, outputNonces[i], hashes[i])),
    ),
    ciphertextHashes: asStrings(hashes),
    amount: "100",
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
  return {
    chainId: "31337",
    pool: String(0x1234n),
    inputShardId: "0",
    inputRoot: inputCommitment.toString(),
    inputNullifiers: asStrings([
      computeShieldedSpendNullifier({ ownerSecret, noteCommitment: inputCommitment }),
      computeShieldedDummyInputNullifier({ ownerSecret, noteCommitment: inputCommitment }),
    ]),
    outputCommitments: asStrings([
      valueNote(changeAmount, changeNonce, changeHash),
      valueNote(0n, dummyNonce, dummyHash),
    ]),
    ciphertextHashes: asStrings([changeHash, dummyHash]),
    amount: "30",
    recipient: String(0x5678n),
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
          w.amount = "101";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.outputAmounts[0] = "71";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.outputCommitments[0] = "123";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.ciphertextHashes[0] = "123";
        }),
      );
      await shield.invalid(
        mutated(deposit, (w) => {
          w.ownerSecret = "0";
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
          w.inputRoot = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.amount = "31";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.changeAmount = "71";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.outputCommitments[0] = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.ciphertextHashes[1] = "123";
        }),
      );
      await unshield.invalid(
        mutated(withdrawal, (w) => {
          w.recipient = "0";
        }),
      );
    });

    await t.test("unshield accepts an exact 32-level LeanIMT path", async () => {
      const deep = structuredClone(withdrawal);
      let root = BigInt(deep.inputRoot);
      for (let level = 0; level < 32; level += 1) {
        const sibling = BigInt(level + 1);
        deep.noteSiblings[level] = sibling.toString();
        root = level === 31 ? poseidon2([sibling, root]) : poseidon2([root, sibling]);
      }
      deep.noteDepth = "32";
      deep.noteIndex = (1n << 31n).toString();
      deep.inputRoot = root.toString();
      await unshield.valid(deep);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
