// Run with: node --test circuits/test/shielded_policy_transfer.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon4, poseidon8 } from "poseidon-lite";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
} from "@deepfamily/protocol-core";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const hash = (byte) =>
  computeShieldedCiphertextHashField(Uint8Array.from({ length: 512 }, () => byte));
const strs = (values) => values.map((value) => BigInt(value).toString());
const owner = (secret) => poseidon2([1013n, secret]);
const valueNote = (ownerCommitment, amount, nonce, ciphertextHashField) =>
  computeShieldedValueNoteCommitment({ ownerCommitment, amount, nonce, ciphertextHashField });
const mutate = (source, change) => {
  const copy = structuredClone(source);
  change(copy);
  return copy;
};

function createPolicyFixture() {
  const ownerSecret = 5001n;
  const inputAmount = 100n;
  const inputNonce = 3301n;
  const inputCiphertextHash = hash(1);
  const inputCommitment = valueNote(
    owner(ownerSecret),
    inputAmount,
    inputNonce,
    inputCiphertextHash,
  );
  const rootIdentityCommitment = 12345n;
  const rootVersionIndex = 1n;
  const rate = 10n;
  const policySalt = 98765n;
  const allocationKey = 24680n;
  const policyNonce = 4401n;
  const changeNonce = 4402n;
  const policy = computeShieldedPolicyCommitment({
    rootIdentityCommitment,
    rootVersionIndex,
    amountPerPeriod: rate,
    policySalt,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(allocationKey),
  });
  const signals = Array(32).fill(0n);
  signals[0] = 1n;
  signals[1] = 31337n;
  signals[2] = 0x1234n;
  signals[4] = inputCommitment;
  signals[6] = inputCommitment;
  signals[7] = computeShieldedSpendNullifier({ ownerSecret, noteCommitment: inputCommitment });
  signals[8] = computeShieldedDummyInputNullifier({
    ownerSecret,
    noteCommitment: inputCommitment,
  });
  signals[23] = hash(2);
  signals[24] = hash(3);
  signals[21] = poseidon4([1024n, policy, policyNonce, signals[23]]);
  signals[22] = valueNote(owner(ownerSecret), inputAmount, changeNonce, signals[24]);
  return {
    publicSignals: strs(signals),
    ownerSecret: ownerSecret.toString(),
    inputAmount: inputAmount.toString(),
    inputNonce: inputNonce.toString(),
    inputCiphertextHash: inputCiphertextHash.toString(),
    noteDepth: "0",
    noteIndex: "0",
    noteSiblings: Array(32).fill("0"),
    rootIdentityCommitment: rootIdentityCommitment.toString(),
    rootVersionIndex: rootVersionIndex.toString(),
    rate: rate.toString(),
    policySalt: policySalt.toString(),
    allocationKey: allocationKey.toString(),
    policyNonce: policyNonce.toString(),
    changeNonce: changeNonce.toString(),
  };
}

function privateTransferFixture() {
  const inputOwnerSecrets = [5001n, 5002n];
  const inputAmounts = [70n, 30n];
  const inputNonces = [3301n, 3302n];
  const inputCiphertextHashes = [hash(4), hash(5)];
  const outputOwnerCommitments = [owner(6001n), owner(6002n)];
  const outputAmounts = [60n, 40n];
  const outputNonces = [4401n, 4402n];
  const outputHashes = [hash(6), hash(7)];
  const signals = Array(32).fill(0n);
  signals[0] = 6n;
  signals[1] = 31337n;
  signals[2] = 0x1234n;
  signals[5] = 1n;
  for (let i = 0; i < 2; i += 1) {
    const input = valueNote(
      owner(inputOwnerSecrets[i]),
      inputAmounts[i],
      inputNonces[i],
      inputCiphertextHashes[i],
    );
    signals[4 + i * 2] = input;
    signals[7 + i] = computeShieldedSpendNullifier({
      ownerSecret: inputOwnerSecrets[i],
      noteCommitment: input,
    });
    signals[23 + i] = outputHashes[i];
    signals[21 + i] = valueNote(
      outputOwnerCommitments[i],
      outputAmounts[i],
      outputNonces[i],
      outputHashes[i],
    );
  }
  return {
    publicSignals: strs(signals),
    inputOwnerSecrets: strs(inputOwnerSecrets),
    inputAmounts: strs(inputAmounts),
    inputNonces: strs(inputNonces),
    inputCiphertextHashes: strs(inputCiphertextHashes),
    inputDepths: ["0", "0"],
    inputIndices: ["0", "0"],
    inputSiblings: [Array(32).fill("0"), Array(32).fill("0")],
    outputOwnerCommitments: strs(outputOwnerCommitments),
    outputAmounts: strs(outputAmounts),
    outputNonces: strs(outputNonces),
  };
}

function mergeBudgetFixture({
  rate = 10n,
  remainingPeriods = [3n, 2n],
  secondPolicy = 11112n,
  secondEnrollment = 22223n,
  mismatch = false,
  replay = false,
} = {}) {
  const ownerSecret = 5001n;
  const policyCommitment = 11111n;
  const enrollmentCommitment = 22222n;
  const inputNonces = replay ? [3301n, 3301n] : [3301n, 3302n];
  const inputCiphertextHashes = replay ? [hash(8), hash(8)] : [hash(8), hash(9)];
  const periods = replay ? [remainingPeriods[0], remainingPeriods[0]] : remainingPeriods;
  const remaining = periods.map((count) => count * rate);
  const mergedNonce = 4401n;
  const dummyNonce = 4402n;
  const signals = Array(32).fill(0n);
  signals[0] = 4n;
  signals[1] = 31337n;
  signals[2] = 0x1234n;
  signals[5] = 1n;
  for (let i = 0; i < 2; i += 1) {
    const input = computeShieldedBudgetNoteCommitment({
      policyCommitment: i === 1 && mismatch ? secondPolicy : policyCommitment,
      enrollmentCommitment: i === 1 && mismatch ? secondEnrollment : enrollmentCommitment,
      heirOwnerCommitment: owner(ownerSecret),
      amountPerPeriod: rate,
      remaining: remaining[i],
      nonce: inputNonces[i],
      ciphertextHashField: inputCiphertextHashes[i],
    });
    signals[4 + i * 2] = input;
    signals[7 + i] = computeShieldedSpendNullifier({
      ownerSecret,
      noteCommitment: input,
    });
  }
  signals[23] = hash(10);
  signals[24] = hash(11);
  signals[21] = poseidon8([
    1015n,
    policyCommitment,
    enrollmentCommitment,
    owner(ownerSecret),
    rate,
    remaining[0] + remaining[1],
    mergedNonce,
    signals[23],
  ]);
  signals[22] = valueNote(owner(ownerSecret), 0n, dummyNonce, signals[24]);
  return {
    publicSignals: strs(signals),
    ownerSecret: ownerSecret.toString(),
    policyCommitment: policyCommitment.toString(),
    enrollmentCommitment: enrollmentCommitment.toString(),
    rate: rate.toString(),
    remaining: strs(remaining),
    remainingPeriods: strs(periods),
    inputNonces: strs(inputNonces),
    inputCiphertextHashes: strs(inputCiphertextHashes),
    inputDepths: ["0", "0"],
    inputIndices: ["0", "0"],
    inputSiblings: [Array(32).fill("0"), Array(32).fill("0")],
    mergedNonce: mergedNonce.toString(),
    dummyNonce: dummyNonce.toString(),
  };
}

async function compile(directory, name) {
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
  const wasmPath = path.join(directory, `${name}_js/${name}.wasm`);
  const calculator = await WitnessCalculatorBuilder(fs.readFileSync(wasmPath), {
    singleThread: true,
  });
  return {
    valid: async (witness) => {
      const wires = await calculator.calculateWitness(witness, 1);
      assert.equal(wires[0], 1n);
    },
    invalid: async (witness) => {
      const oldError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(witness, 1));
      } finally {
        console.error = oldError;
      }
    },
    checkR1cs: (witness) => {
      const inputPath = path.join(directory, `${name}.input.json`);
      const witnessPath = path.join(directory, `${name}.wtns`);
      const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      fs.writeFileSync(inputPath, JSON.stringify(witness));
      execFileSync(process.execPath, [cli, "wtns", "calculate", wasmPath, inputPath, witnessPath], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      const output = execFileSync(
        process.execPath,
        [cli, "wtns", "check", path.join(directory, `${name}.r1cs`), witnessPath],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.match(output, /WITNESS IS CORRECT/u);
    },
  };
}

test("policy creation and private transfer circuits", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-policy-transfer-"));
  try {
    const policy = await compile(directory, "shielded_create_policy");
    const transfer = await compile(directory, "shielded_private_transfer");
    const merge = await compile(directory, "shielded_merge_budget");
    const validPolicy = createPolicyFixture();
    const validTransfer = privateTransferFixture();
    const validMerge = mergeBudgetFixture();
    await t.test("policy creation preserves all DEEP and satisfies R1CS", async () => {
      await policy.valid(validPolicy);
      policy.checkR1cs(validPolicy);
    });
    await t.test("policy creation rejects note theft or malformed policy", async () => {
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.ownerSecret = "5002";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.inputAmount = "101";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.rate = "0";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.allocationKey = "0";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.publicSignals[21] = "123";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.publicSignals[24] = "123";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.publicSignals[25] = "1";
        }),
      );
    });
    await t.test("private transfer conserves DEEP across independent owners", async () => {
      await transfer.valid(validTransfer);
      transfer.checkR1cs(validTransfer);
    });
    await t.test("private transfer rejects inflation and foreign-note spending", async () => {
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.outputAmounts[0] = "61";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.inputOwnerSecrets[1] = "5001";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.publicSignals[6] = "123";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.outputOwnerCommitments[0] = "123";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.publicSignals[23] = "123";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.publicSignals[26] = "1";
        }),
      );
    });
    await t.test("budget merge preserves whole-period value and satisfies R1CS", async () => {
      await merge.valid(validMerge);
      merge.checkR1cs(validMerge);
    });
    await t.test("budget merge rejects mismatched templates, replay, and overflow", async () => {
      await merge.invalid(mergeBudgetFixture({ mismatch: true }));
      await merge.invalid(mergeBudgetFixture({ replay: true }));
      await merge.invalid(
        mergeBudgetFixture({
          rate: 1n << 64n,
          remainingPeriods: [1n << 63n, 1n << 63n],
        }),
      );
      await merge.invalid(
        mutate(validMerge, (w) => {
          w.ownerSecret = "5002";
        }),
      );
      await merge.invalid(
        mutate(validMerge, (w) => {
          w.publicSignals[21] = "123";
        }),
      );
      await merge.invalid(
        mutate(validMerge, (w) => {
          w.publicSignals[24] = "123";
        }),
      );
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
