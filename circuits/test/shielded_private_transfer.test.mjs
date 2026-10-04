// Run with: node --test circuits/test/shielded_private_transfer.test.mjs
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
const hash = (byte) =>
  computeShieldedCiphertextHashField(Uint8Array.from({ length: 512 }, () => byte));
const strs = (values) => values.map((value) => BigInt(value).toString());
const owner = (secret) => poseidon2([1013n, secret]);
const defaultScope = {
  chainId: 31337n,
  poolAddress: "0x0000000000000000000000000000000000001234",
};
const valueNote = (ownerCommitment, amount, nonce, ciphertextHashField, scope = defaultScope) =>
  computeShieldedValueNoteCommitment(
    { ownerCommitment, amount, nonce, ciphertextHashField },
    scope,
  );
const mutate = (source, change) => {
  const copy = structuredClone(source);
  change(copy);
  return copy;
};

function privateTransferFixture(scope = defaultScope) {
  const inputOwnerSecrets = [5001n, 5002n];
  const inputAmounts = [70n, 30n];
  const inputNonces = [3301n, 3302n];
  const inputCiphertextHashes = [hash(4), hash(5)];
  const outputOwnerCommitments = [owner(6001n), owner(6002n)];
  const outputAmounts = [60n, 40n];
  const outputNonces = [4401n, 4402n];
  const outputHashes = [hash(6), hash(7)];
  const inputs = inputAmounts.map((amount, i) =>
    valueNote(owner(inputOwnerSecrets[i]), amount, inputNonces[i], inputCiphertextHashes[i], scope),
  );
  return {
    chainId: String(scope.chainId),
    pool: String(BigInt(scope.poolAddress)),
    inputShardIds: ["0", "1"],
    inputRoots: strs(inputs),
    inputNullifiers: strs(
      inputs.map((noteCommitment, i) =>
        computeShieldedSpendNullifier({ ownerSecret: inputOwnerSecrets[i], noteCommitment }, scope),
      ),
    ),
    outputCommitments: strs(
      outputAmounts.map((amount, i) =>
        valueNote(outputOwnerCommitments[i], amount, outputNonces[i], outputHashes[i], scope),
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

function singleInputPrivateTransferFixture(scope = defaultScope) {
  const witness = privateTransferFixture(scope);
  const ownerSecret = BigInt(witness.inputOwnerSecrets[0]);
  const firstCommitment = BigInt(witness.inputRoots[0]);
  witness.inputShardIds[1] = witness.inputShardIds[0];
  witness.inputRoots[1] = witness.inputRoots[0];
  witness.inputNullifiers[1] = computeShieldedDummyInputNullifier(
    {
      ownerSecret,
      noteCommitment: firstCommitment,
    },
    scope,
  ).toString();
  const secondOutputAmount = 10n;
  witness.outputCommitments[1] = valueNote(
    BigInt(witness.outputOwnerCommitments[1]),
    secondOutputAmount,
    BigInt(witness.outputNonces[1]),
    BigInt(witness.ciphertextHashes[1]),
    scope,
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

test("private transfer circuit", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-policy-transfer-"));
  try {
    const transfer = await compile(directory, "shielded_private_transfer");
    const validTransfer = privateTransferFixture();
    const validSingleTransfer = singleInputPrivateTransferFixture();
    await t.test(
      "private transfer binds all notes and nullifiers to the chain and pool",
      async () => {
        for (const scope of [
          { ...defaultScope, chainId: 1030n },
          { ...defaultScope, poolAddress: "0x0000000000000000000000000000000000005678" },
        ]) {
          await transfer.valid(privateTransferFixture(scope));
          await transfer.valid(singleInputPrivateTransferFixture(scope));
          for (const witness of [validTransfer, validSingleTransfer]) {
            await transfer.invalid(
              mutate(witness, (w) => {
                w.chainId = String(scope.chainId);
                w.pool = String(BigInt(scope.poolAddress));
              }),
            );
          }
        }
      },
    );
    await t.test("private transfer conserves asset amounts across independent owners", async () => {
      await transfer.valid(validTransfer);
      transfer.checkR1cs(validTransfer);
    });
    await t.test(
      "single-note private transfer conserves asset amounts with a bound dummy input",
      async () => {
        await transfer.valid(validSingleTransfer);
        transfer.checkR1cs(validSingleTransfer);
      },
    );
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
    await t.test(
      "single-note transfer rejects forged amount, root, nullifier, and mode",
      async () => {
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.inputAmounts[1] = "1";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.inputShardIds[1] = "1";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.inputRoots[1] = "123";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.inputNullifiers[1] = "123";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.inputOwnerSecrets[1] = "1";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.hasSecondInput = "2";
          }),
        );
        await transfer.invalid(
          mutate(validSingleTransfer, (w) => {
            w.outputAmounts[1] = "11";
          }),
        );
      },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
