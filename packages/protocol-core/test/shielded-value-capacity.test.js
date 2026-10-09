import assert from "node:assert/strict";
import test from "node:test";
import { MAX_UINT128 } from "../constants.js";
import {
  computeShieldedDummyInputNullifier,
  computeShieldedOwnerCommitment,
} from "../shielded-inheritance.js";
import {
  computeShieldedDummyInputNullifierForSlot,
  planShieldedValueSpend,
} from "../shielded-value-capacity.js";

const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };
const notes = (amounts) =>
  amounts.map((amount, i) => ({ commitment: BigInt(i + 1), amount: BigInt(amount) }));
test("capacity placeholders preserve slot one and separate every further slot", () => {
  const first = computeShieldedDummyInputNullifier(
    { ownerSecret: 17n, noteCommitment: 19n },
    scope,
  );
  const all = Array.from({ length: 7 }, (_, i) =>
    computeShieldedDummyInputNullifierForSlot(17n, 19n, i + 1, scope),
  );
  assert.equal(all[0], first);
  assert.equal(new Set(all).size, 7);
});
test("planner consumes the smallest sufficient single note and otherwise the fewest inputs", () => {
  assert.deepEqual(
    planShieldedValueSpend({ notes: notes([1, 7, 6, 20]), amount: 5n, maxInputs: 8 }).steps[0]
      .inputCommitments,
    ["3"],
  );
  const plan = planShieldedValueSpend({ notes: notes([3, 4, 5, 1]), amount: 9n, maxInputs: 8 });
  assert.deepEqual(plan.steps[0].inputCommitments, ["3", "2"]);
  assert.equal(plan.steps.length, 1);
});
test("large candidate total does not force consumption beyond a sufficient subset", () => {
  const plan = planShieldedValueSpend({
    notes: notes(Array(9).fill(MAX_UINT128 / 3n + 1n)),
    amount: MAX_UINT128,
    maxInputs: 8,
  });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].inputCommitments.length, 3);
  assert(plan.steps[0].outputAmounts.every((amount) => amount <= MAX_UINT128));
});
test("planner previews all merges and single-input funding without importing unselected assets", () => {
  const plan = planShieldedValueSpend({
    notes: notes(Array(20).fill(1)),
    candidateCommitments: Array.from({ length: 19 }, (_, i) => String(i + 1)),
    amount: 18n,
    maxInputs: 1,
  });
  assert.equal(plan.steps.at(-1).inputCommitments.length, 1);
  assert(
    plan.steps
      .filter((step) => step.kind === "merge")
      .every((step) => step.inputCommitments.length <= 8),
  );
  assert(!plan.selectedCommitments.includes("20"));
  const running = new Map(
    notes(Array(19).fill(1)).map((note) => [String(note.commitment), note.amount]),
  );
  for (const step of plan.steps) {
    assert.equal(
      step.inputCommitments.reduce((sum, id) => sum + running.get(id), 0n),
      step.inputAmount,
    );
    assert.equal(step.outputAmounts[0] + step.outputAmounts[1], step.inputAmount);
    for (const id of step.inputCommitments) running.delete(id);
    step.outputAmounts.forEach((amount, i) => {
      if (amount) running.set(step.outputCommitments[i], amount);
    });
  }
});
test("planner rejects insufficient selected balance and owner/pool mixing before any step", () => {
  assert.deepEqual(
    planShieldedValueSpend({ notes: notes([3, 4]), candidateCommitments: ["0x2"], amount: 4n })
      .selectedCommitments,
    ["2"],
  );
  assert.throws(
    () =>
      planShieldedValueSpend({
        notes: notes([3, 4]),
        candidateCommitments: ["0x2", "2"],
        amount: 4n,
      }),
    /unique/,
  );
  assert.throws(
    () =>
      planShieldedValueSpend({
        notes: notes([2, 3, 100]),
        candidateCommitments: ["1", "2"],
        amount: 6n,
      }),
    /Insufficient/,
  );
  assert.throws(
    () =>
      planShieldedValueSpend({
        notes: [
          { commitment: 1n, amount: 3n, ownerCommitment: computeShieldedOwnerCommitment(1n) },
          { commitment: 2n, amount: 4n, ownerCommitment: computeShieldedOwnerCommitment(2n) },
        ],
        amount: 5n,
      }),
    /share owner/,
  );
  assert.throws(
    () => planShieldedValueSpend({ notes: notes([MAX_UINT128 + 1n]), amount: 1n }),
    /uint128/,
  );
});
