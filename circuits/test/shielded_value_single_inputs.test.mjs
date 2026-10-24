import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2 } from "poseidon-lite";
import {
  computeShieldedOwnerCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  computeShieldedDummyInputNullifierForSlot,
} from "@deepfamily/protocol-core";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };
const secret = 5001n;
const owner = computeShieldedOwnerCommitment(secret);
const note = (amount, nonce, ciphertextHashField) =>
  computeShieldedValueNoteCommitment(
    { ownerCommitment: owner, amount, nonce, ciphertextHashField },
    scope,
  );
function fixture(exit = false, capacity = 1, amount = 100n) {
  const commitment = note(amount, 101n, 201n);
  const amounts = exit ? [amount - 30n, 0n] : [amount, 0n];
  const inputArray = (value) => [String(value), ...Array(capacity - 1).fill("0")];
  const witness = {
    chainId: String(scope.chainId),
    pool: String(BigInt(scope.poolAddress)),
    inputShardIds: Array(capacity).fill("0"),
    inputRoots: Array(capacity).fill(String(commitment)),
    inputNullifiers: Array.from({ length: capacity }, (_, i) =>
      String(
        i === 0
          ? computeShieldedSpendNullifier(
              { ownerSecret: secret, noteCommitment: commitment },
              scope,
            )
          : computeShieldedDummyInputNullifierForSlot(secret, commitment, i, scope),
      ),
    ),
    inputEnabled: inputArray(1),
    inputOwnerSecrets: inputArray(secret),
    inputAmounts: inputArray(amount),
    inputNonces: inputArray(101),
    inputCiphertextHashes: inputArray(201),
    inputDepths: Array(capacity).fill("0"),
    inputIndices: Array(capacity).fill("0"),
    inputSiblings: Array.from({ length: capacity }, () => Array(32).fill("0")),
    outputCommitments: amounts.map((a, i) => String(note(a, BigInt(301 + i), BigInt(401 + i)))),
    ciphertextHashes: ["401", "402"],
  };
  return exit
    ? {
        ...witness,
        amount: "30",
        recipient: "1234",
        changeAmount: String(amounts[0]),
        changeNonce: "301",
        dummyNonce: "302",
      }
    : {
        ...witness,
        receiveBindings: ["0", "0"],
        receiveAuthorizationAliases: ["0", "0"],
        receiveSalts: ["0", "0"],
        receiveKeyModes: ["0", "0"],
        receiveViewKeyLo: ["0", "0"],
        receiveViewKeyHi: ["0", "0"],
        outputOwnerCommitments: [String(owner), String(owner)],
        outputAmounts: amounts.map(String),
        outputNonces: ["301", "302"],
      };
}

test("single-input VALUE circuits preserve authority, membership and value", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-value-single-test-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const calculators = {};
  for (const name of [
    "shielded_private_transfer",
    "shielded_unshield",
    "shielded_private_transfer_4",
    "shielded_unshield_4",
  ]) {
    execFileSync(
      path.join(root, "bin/circom"),
      [
        `circuits/${name}.circom`,
        "--wasm",
        "--O2",
        "--sanity_check",
        "2",
        "-l",
        "node_modules",
        "-l",
        "node_modules/circomlib/circuits",
        "-o",
        output,
      ],
      { cwd: root, stdio: "pipe" },
    );
    calculators[name] = await WitnessCalculatorBuilder(
      fs.readFileSync(path.join(output, `${name}_js/${name}.wasm`)),
      { singleThread: true },
    );
  }
  for (const exit of [false, true]) {
    const name = exit ? "shielded_unshield" : "shielded_private_transfer";
    const calculator = calculators[name];
    await t.test(`${name}: one real input and two outputs`, async () => {
      const single = fixture(exit),
        four = fixture(exit, 4);
      await calculator.calculateWitness(single, true);
      await calculators[name + "_4"].calculateWitness(four, true);
      assert.equal(single.inputNullifiers[0], four.inputNullifiers[0]);
      assert.deepEqual(single.outputCommitments, four.outputCommitments);
    });
    await t.test(`${name}: complete 32-level note path`, async () => {
      const witness = fixture(exit);
      const index = (1n << 31n) | 5n;
      let hash = BigInt(witness.inputRoots[0]);
      witness.inputSiblings[0] = Array.from({ length: 32 }, (_, i) => String(10000 + i));
      witness.inputSiblings[0].forEach((sibling, i) => {
        hash =
          (index >> BigInt(i)) & 1n
            ? poseidon2([BigInt(sibling), hash])
            : poseidon2([hash, BigInt(sibling)]);
      });
      witness.inputRoots[0] = String(hash);
      witness.inputDepths[0] = "32";
      witness.inputIndices[0] = String(index);
      await calculator.calculateWitness(witness, true);
      witness.inputDepths[0] = "33";
      await assertConstraintViolation(() => calculator.calculateWitness(witness, true));
    });
    await t.test(`${name}: reject forged spends and inactive first input`, async () => {
      for (const field of [
        "inputEnabled",
        "inputOwnerSecrets",
        "inputAmounts",
        "inputNonces",
        "inputCiphertextHashes",
        "inputNullifiers",
        "inputRoots",
      ]) {
        const witness = fixture(exit);
        witness[field][0] = field === "inputEnabled" ? "0" : String(BigInt(witness[field][0]) + 1n);
        await assertConstraintViolation(() => calculator.calculateWitness(witness, true));
      }
      const witness = fixture(exit);
      witness.chainId = "1";
      await assertConstraintViolation(() => calculator.calculateWitness(witness, true));
    });
    await t.test(`${name}: second input cannot fit the single-input statement`, async () => {
      await assert.rejects(() => calculator.calculateWitness(fixture(exit, 4), true));
    });
  }
  await t.test(
    "single transfer rejects zero-value funding and accepts uint128 maximum",
    async () => {
      await assertConstraintViolation(() =>
        calculators.shielded_private_transfer.calculateWitness(fixture(false, 1, 0n), true),
      );
      await calculators.shielded_private_transfer.calculateWitness(
        fixture(false, 1, (1n << 128n) - 1n),
        true,
      );
    },
  );
  await t.test("single withdrawal rejects zero recipient and unbalanced withdrawal", async () => {
    for (const [field, value] of [
      ["recipient", "0"],
      ["amount", "31"],
      ["changeAmount", "71"],
    ]) {
      const witness = fixture(true);
      witness[field] = value;
      await assertConstraintViolation(() =>
        calculators.shielded_unshield.calculateWitness(witness, true),
      );
    }
  });
});
