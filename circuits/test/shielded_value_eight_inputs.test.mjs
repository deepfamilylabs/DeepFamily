import assert from "node:assert/strict";
import fs from "node:fs";
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

const root = path.resolve(import.meta.dirname, "../..");
const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };
const secret = 5001n;
const owner = computeShieldedOwnerCommitment(secret);
const MAX = (1n << 128n) - 1n;
const note = (amount, nonce, hash) =>
  computeShieldedValueNoteCommitment(
    { ownerCommitment: owner, amount, nonce, ciphertextHashField: hash },
    scope,
  );
function fixture(count, unshield = false, amounts = Array(count).fill(10n)) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  const commitments = amounts.map((amount, i) => note(amount, BigInt(i + 1), BigInt(i + 101)));
  const outputAmount = unshield ? total - 1n : total;
  const outputAmounts = [outputAmount > MAX ? MAX : outputAmount, 0n];
  const outputNonces = [1001n, 1002n];
  const hashes = [201n, 202n];
  const inputArray = (values) => Array.from({ length: 8 }, (_, i) => String(values[i] ?? 0n));
  const witness = {
    chainId: String(scope.chainId),
    pool: String(BigInt(scope.poolAddress)),
    inputShardIds: Array(8).fill("0"),
    inputRoots: Array.from({ length: 8 }, (_, i) => String(commitments[i] ?? commitments[0])),
    inputNullifiers: Array.from({ length: 8 }, (_, i) =>
      String(
        i < count
          ? computeShieldedSpendNullifier(
              { ownerSecret: secret, noteCommitment: commitments[i] },
              scope,
            )
          : computeShieldedDummyInputNullifierForSlot(secret, commitments[0], i, scope),
      ),
    ),
    inputEnabled: Array.from({ length: 8 }, (_, i) => (i < count ? "1" : "0")),
    inputOwnerSecrets: inputArray(Array(count).fill(secret)),
    inputAmounts: inputArray(amounts),
    inputNonces: inputArray(amounts.map((_, i) => BigInt(i + 1))),
    inputCiphertextHashes: inputArray(amounts.map((_, i) => BigInt(i + 101))),
    inputDepths: Array(8).fill("0"),
    inputIndices: Array(8).fill("0"),
    inputSiblings: Array.from({ length: 8 }, () => Array(32).fill("0")),
    outputCommitments: outputAmounts.map((amount, i) =>
      String(note(amount, outputNonces[i], hashes[i])),
    ),
    ciphertextHashes: hashes.map(String),
  };
  return unshield
    ? {
        ...witness,
        amount: "1",
        recipient: "1234",
        changeAmount: String(outputAmounts[0]),
        changeNonce: "1001",
        dummyNonce: "1002",
      }
    : {
        ...witness,
        outputOwnerCommitments: [String(owner), String(owner)],
        outputAmounts: outputAmounts.map(String),
        outputNonces: outputNonces.map(String),
      };
}
const mutate = (original, change) => {
  const copy = structuredClone(original);
  change(copy);
  return copy;
};
test("eight-input VALUE constraints and capacity-stable nullifiers", async (t) => {
  const calculators = {};
  for (const circuit of ["shielded_private_transfer_8", "shielded_unshield_8"]) {
    const wasm = path.join(root, "zk-artifacts/shielded", `${circuit}_js`, `${circuit}.wasm`);
    assert(fs.existsSync(wasm), `Build ${circuit} before running circuit tests`);
    calculators[circuit] = await WitnessCalculatorBuilder(fs.readFileSync(wasm));
  }
  const transfer = calculators.shielded_private_transfer_8;
  const unshield = calculators.shielded_unshield_8;
  await t.test("all eight inputs support complete 32-sibling paths and enforce their bounds", async () => {
    for (const isExit of [false, true]) {
      const witness = fixture(8, isExit);
      for (let slot = 0; slot < 8; slot++) {
        const index = BigInt(slot * 71);
        const siblings = Array.from({length:32},(_,level)=>BigInt(10000+slot*32+level));
        let root = BigInt(witness.inputRoots[slot]);
        siblings.forEach((sibling,level)=> {
          root = ((index>>BigInt(level))&1n)===1n ? poseidon2([sibling,root]) : poseidon2([root,sibling]);
        });
        witness.inputDepths[slot] = "32";
        witness.inputIndices[slot] = String(index);
        witness.inputSiblings[slot] = siblings.map(String);
        witness.inputRoots[slot] = String(root);
      }
      const calculator = isExit ? unshield : transfer;
      await calculator.calculateWitness(witness,true);
      await assert.rejects(calculator.calculateWitness(mutate(witness,(copy)=>copy.inputDepths[7]="33"),true));
      await assert.rejects(calculator.calculateWitness(mutate(witness,(copy)=>copy.inputIndices[7]=String(1n<<32n)),true));
    }
  });
  for (let count = 1; count <= 8; count++)
    await t.test(`${count} contiguous inputs pass transfer and withdrawal`, async () => {
      await transfer.calculateWitness(fixture(count), true);
      await unshield.calculateWitness(fixture(count, true), true);
    });
  await t.test(
    "all eight inputs sum above uint128 while bounded outputs remain valid",
    async () => {
      const values = Array(8).fill(MAX / 8n);
      values[0] += 8n;
      const witness = fixture(8, false, values);
      witness.outputAmounts = [String(MAX), "1"];
      witness.outputCommitments = [String(note(MAX, 1001n, 201n)), String(note(1n, 1002n, 202n))];
      await transfer.calculateWitness(witness, true);
      await assert.rejects(transfer.calculateWitness(fixture(8, false, Array(8).fill(MAX)), true));
      await assert.rejects(unshield.calculateWitness(fixture(8, true, Array(8).fill(MAX)), true));
    },
  );
  for (const [label, change] of [
    ["owner mixing", (w) => (w.inputOwnerSecrets[1] = "5002")],
    ["zero real amount", (w) => (w.inputAmounts[1] = "0")],
    ["enabled gap", (w) => (w.inputEnabled[1] = "0")],
    ["nonboolean enable", (w) => (w.inputEnabled[1] = "2")],
    ["empty batch", (w) => w.inputEnabled.fill("0")],
    ["disabled private field", (w) => (w.inputNonces[7] = "1")],
    ["disabled public root", (w) => (w.inputRoots[7] = w.inputRoots[1])],
    ["duplicate nullifier", (w) => (w.inputNullifiers[7] = w.inputNullifiers[6])],
    ["real NF tampering", (w) => (w.inputNullifiers[0] = "1")],
    ["wrong chain", (w) => (w.chainId = "1")],
    ["amount conservation", (w) => (w.outputAmounts[0] = "29")],
  ])
    await t.test(`rejects ${label}`, async () => {
      await assert.rejects(transfer.calculateWitness(mutate(fixture(3), change), true));
    });
  await t.test("changing withdrawal value or recipient cannot reuse a proof opening", async () => {
    await assert.rejects(
      unshield.calculateWitness(
        mutate(fixture(3, true), (w) => (w.amount = "2")),
        true,
      ),
    );
    await assert.rejects(
      unshield.calculateWitness(
        mutate(fixture(3, true), (w) => (w.recipient = "0")),
        true,
      ),
    );
  });
});
