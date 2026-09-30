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
  const ciphertextHashes = [hash(2), hash(3)];
  return {
    chainId: "31337",
    pool: String(0x1234n),
    inputShardId: "0",
    inputRoot: inputCommitment.toString(),
    inputNullifiers: strs([
      computeShieldedSpendNullifier({ ownerSecret, noteCommitment: inputCommitment }),
      computeShieldedDummyInputNullifier({ ownerSecret, noteCommitment: inputCommitment }),
    ]),
    outputCommitments: strs([
      poseidon4([1024n, policy, policyNonce, ciphertextHashes[0]]),
      valueNote(owner(ownerSecret), inputAmount, changeNonce, ciphertextHashes[1]),
    ]),
    ciphertextHashes: strs(ciphertextHashes),
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
  const inputs = inputAmounts.map((amount, i) =>
    valueNote(owner(inputOwnerSecrets[i]), amount, inputNonces[i], inputCiphertextHashes[i]),
  );
  return {
    chainId: "31337",
    pool: String(0x1234n),
    inputShardIds: ["0", "1"],
    inputRoots: strs(inputs),
    inputNullifiers: strs(
      inputs.map((noteCommitment, i) =>
        computeShieldedSpendNullifier({ ownerSecret: inputOwnerSecrets[i], noteCommitment }),
      ),
    ),
    outputCommitments: strs(
      outputAmounts.map((amount, i) =>
        valueNote(outputOwnerCommitments[i], amount, outputNonces[i], outputHashes[i]),
      ),
    ),
    ciphertextHashes: strs(outputHashes),
    hasSecondInput: "1",
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

function singleInputPrivateTransferFixture() {
  const witness = privateTransferFixture();
  const ownerSecret = BigInt(witness.inputOwnerSecrets[0]);
  const firstCommitment = BigInt(witness.inputRoots[0]);
  witness.inputShardIds[1] = witness.inputShardIds[0];
  witness.inputRoots[1] = witness.inputRoots[0];
  witness.inputNullifiers[1] = computeShieldedDummyInputNullifier({
    ownerSecret,
    noteCommitment: firstCommitment,
  }).toString();
  const secondOutputAmount = 10n;
  witness.outputCommitments[1] = valueNote(
    BigInt(witness.outputOwnerCommitments[1]),
    secondOutputAmount,
    BigInt(witness.outputNonces[1]),
    BigInt(witness.ciphertextHashes[1]),
  ).toString();
  witness.hasSecondInput = "0";
  witness.inputOwnerSecrets[1] = "0";
  witness.inputAmounts[1] = "0";
  witness.inputNonces[1] = "0";
  witness.inputCiphertextHashes[1] = "0";
  witness.inputDepths[1] = "0";
  witness.inputIndices[1] = "0";
  witness.inputSiblings[1] = Array(32).fill("0");
  witness.outputAmounts[1] = String(secondOutputAmount);
  return witness;
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
  const inputs = [0, 1].map((i) =>
    computeShieldedBudgetNoteCommitment({
      policyCommitment: i === 1 && mismatch ? secondPolicy : policyCommitment,
      enrollmentCommitment: i === 1 && mismatch ? secondEnrollment : enrollmentCommitment,
      heirOwnerCommitment: owner(ownerSecret),
      amountPerPeriod: rate,
      remaining: remaining[i],
      nonce: inputNonces[i],
      ciphertextHashField: inputCiphertextHashes[i],
    }),
  );
  const ciphertextHashes = [hash(10), hash(11)];
  return {
    chainId: "31337",
    pool: String(0x1234n),
    inputShardIds: ["0", "1"],
    inputRoots: strs(inputs),
    inputNullifiers: strs(
      inputs.map((noteCommitment) => computeShieldedSpendNullifier({ ownerSecret, noteCommitment })),
    ),
    outputCommitments: strs([
      poseidon8([
        1015n,
        policyCommitment,
        enrollmentCommitment,
        owner(ownerSecret),
        rate,
        remaining[0] + remaining[1],
        mergedNonce,
        ciphertextHashes[0],
      ]),
      valueNote(owner(ownerSecret), 0n, dummyNonce, ciphertextHashes[1]),
    ]),
    ciphertextHashes: strs(ciphertextHashes),
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
    const validSingleTransfer = singleInputPrivateTransferFixture();
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
          w.outputCommitments[0] = "123";
        }),
      );
      await policy.invalid(
        mutate(validPolicy, (w) => {
          w.ciphertextHashes[1] = "123";
        }),
      );
    });
    await t.test("private transfer conserves DEEP across independent owners", async () => {
      await transfer.valid(validTransfer);
      transfer.checkR1cs(validTransfer);
    });
    await t.test("single-note private transfer conserves DEEP with a bound dummy input", async () => {
      await transfer.valid(validSingleTransfer);
      transfer.checkR1cs(validSingleTransfer);
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
          w.inputRoots[1] = "123";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.outputOwnerCommitments[0] = "123";
        }),
      );
      await transfer.invalid(
        mutate(validTransfer, (w) => {
          w.ciphertextHashes[0] = "123";
        }),
      );
    });
    await t.test("single-note transfer rejects forged amount, root, nullifier, and mode", async () => {
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.inputAmounts[1] = "1"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.inputShardIds[1] = "1"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.inputRoots[1] = "123"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.inputNullifiers[1] = "123"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.inputOwnerSecrets[1] = "1"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.hasSecondInput = "2"; }));
      await transfer.invalid(mutate(validSingleTransfer, (w) => { w.outputAmounts[1] = "11"; }));
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
          w.outputCommitments[0] = "123";
        }),
      );
      await merge.invalid(
        mutate(validMerge, (w) => {
          w.ciphertextHashes[1] = "123";
        }),
      );
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
