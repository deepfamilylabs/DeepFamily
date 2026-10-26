import assert from "node:assert/strict";
import test from "node:test";
import { MAX_UINT128 } from "../constants.js";
import { computeShieldedOwnerCommitment } from "../shielded-inheritance.js";
import {
  computeShieldedDummyInputNullifierForSlot,
  planShieldedValueSpend,
} from "../shielded-value-capacity.js";

const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };
const notes = (amounts) =>
  amounts.map((amount, i) => ({ commitment: BigInt(i + 1), amount: BigInt(amount) }));
const sum = (values) => values.reduce((total, value) => total + value, 0n);
const selectedAmounts = (source, plan) => {
  const byCommitment = new Map(source.map((note) => [String(note.commitment), note.amount]));
  return plan.selectedCommitments.map((commitment) => byCommitment.get(commitment));
};
const assertConservation = (
  source,
  plan,
  permitted = source.map((note) => String(note.commitment)),
) => {
  const permittedSet = new Set(permitted);
  const running = new Map(
    source
      .filter((note) => permittedSet.has(String(note.commitment)))
      .map((note) => [String(note.commitment), note.amount]),
  );
  const originalInputs = new Set();
  for (const [index, step] of plan.steps.entries()) {
    assert(step.inputCommitments.length > 0 && step.inputCommitments.length <= 4);
    assert.equal(step.capacity, step.inputCommitments.length === 1 ? 1 : 4);
    assert.equal(new Set(step.inputCommitments).size, step.inputCommitments.length);
    assert(step.inputCommitments.every((commitment) => running.has(commitment)));
    assert.equal(
      sum(step.inputCommitments.map((commitment) => running.get(commitment))),
      step.inputAmount,
    );
    assert.equal(sum(step.outputAmounts), step.inputAmount);
    assert(step.outputAmounts.every((amount) => amount >= 0n && amount <= MAX_UINT128));
    assert.equal(step.kind, index === plan.steps.length - 1 ? "spend" : "merge");
    for (const commitment of step.inputCommitments) {
      if (permittedSet.has(commitment)) originalInputs.add(commitment);
      running.delete(commitment);
    }
    step.outputAmounts.forEach((amount, outputIndex) => {
      if (amount > 0n) running.set(step.outputCommitments[outputIndex], amount);
    });
  }
  const final = plan.steps.at(-1);
  assert(final.inputCommitments.length <= plan.maxInputs);
  assert.equal(final.outputAmounts[0], plan.amount);
  assert.deepEqual(new Set(plan.selectedCommitments), originalInputs);
  assert(plan.selectedCommitments.every((commitment) => permittedSet.has(commitment)));
};

// Exhaustive enumeration is intentionally independent of the production planner and restricted
// to small fixtures. Compare the objective, leaving equivalent commitment ordering unspecified.
const optimalDirectSpend = (source, amount) => {
  const singles = source.filter((note) => note.amount >= amount);
  if (singles.length)
    return {
      total: singles.reduce(
        (best, note) => (note.amount < best ? note.amount : best),
        singles[0].amount,
      ),
      count: 1,
    };
  let best;
  for (let mask = 1; mask < 2 ** source.length; mask++) {
    const selected = source.filter((_, index) => mask & (1 << index));
    if (selected.length > 4) continue;
    const total = sum(selected.map((note) => note.amount));
    if (total < amount) continue;
    if (!best || total < best.total || (total === best.total && selected.length < best.count)) {
      best = { total, count: selected.length };
    }
  }
  return best;
};
test("capacity placeholders preserve slot one and separate every further slot", () => {
  const first = computeShieldedDummyInputNullifierForSlot(17n, 19n, 1, scope);
  const all = Array.from({ length: 3 }, (_, i) =>
    computeShieldedDummyInputNullifierForSlot(17n, 19n, i + 1, scope),
  );
  assert.equal(all[0], first);
  assert.equal(new Set(all).size, 3);
});
test("planner minimizes change and then input count within one transaction", () => {
  assert.deepEqual(
    planShieldedValueSpend({ notes: notes([1, 7, 6, 20]), amount: 5n, maxInputs: 4 }).steps[0]
      .inputCommitments,
    ["3"],
  );
  const plan = planShieldedValueSpend({ notes: notes([3, 4, 5, 1]), amount: 9n, maxInputs: 4 });
  assert.deepEqual(plan.steps[0].inputCommitments, ["3", "2"]);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].capacity, 4);
});
test("a sufficient permitted note uses the single-input route even if a combination is exact", () => {
  const source = notes([10000, 1000, 100, 10, 1, 2, 20, 200, 2000, 20000]);
  const plan = planShieldedValueSpend({ notes: source, amount: 3n, maxInputs: 4 });
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.selectedCommitments, ["4"]);
  assert.equal(plan.steps[0].capacity, 1);
  assert.deepEqual(plan.steps[0].outputAmounts, [3n, 7n]);
  assertConservation(source, plan);
});
test("exact combinations cannot consume notes outside the allowed candidate boundary", () => {
  const source = notes([10000, 1000, 100, 10, 1, 2, 20, 200, 2000, 20000]);
  const permitted = ["4", "5"];
  const plan = planShieldedValueSpend({
    notes: source,
    candidateCommitments: permitted,
    amount: 3n,
    maxInputs: 4,
  });
  assert.deepEqual(plan.selectedCommitments, ["4"]);
  assert.deepEqual(plan.steps[0].outputAmounts, [3n, 7n]);
  assertConservation(source, plan, permitted);
});
test("equal exact amounts prefer fewer inputs", () => {
  const singleSource = notes([7, 4, 3, 6, 1]);
  const single = planShieldedValueSpend({ notes: singleSource, amount: 7n, maxInputs: 4 });
  assert.deepEqual(single.selectedCommitments, ["1"]);
  assertConservation(singleSource, single);

  const source = notes([5, 4, 3, 2, 1]);
  const plan = planShieldedValueSpend({ notes: source, amount: 7n, maxInputs: 4 });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.selectedCommitments.length, 2);
  assert.equal(sum(selectedAmounts(source, plan)), 7n);
  assertConservation(source, plan);
});
test("a covering single keeps the small circuit even when a pair has less change", () => {
  for (const [amounts, expectedInput] of [
    [[8, 5, 4], 8n],
    [[10, 4, 4], 10n],
  ]) {
    const source = notes(amounts);
    const plan = planShieldedValueSpend({ notes: source, amount: 7n, maxInputs: 4 });
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].inputAmount, expectedInput);
    assert.deepEqual(plan.steps[0].outputAmounts, [7n, expectedInput - 7n]);
    assertConservation(source, plan);
  }
});
test("an exact sum requiring nine inputs cannot add a merge when one note already suffices", () => {
  const source = notes([...Array(9).fill(1), 20]);
  const plan = planShieldedValueSpend({ notes: source, amount: 9n, maxInputs: 4 });
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.selectedCommitments, ["10"]);
  assert.deepEqual(plan.steps[0].outputAmounts, [9n, 11n]);
  assertConservation(source, plan);
});
test("an exact sum using the full four-input capacity still fits one transaction", () => {
  const source = notes(Array(4).fill(1));
  const plan = planShieldedValueSpend({ notes: source, amount: 4n, maxInputs: 4 });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].inputCommitments.length, 4);
  assert.deepEqual(plan.steps[0].outputAmounts, [4n, 0n]);
  assert.equal(plan.steps[0].capacity, 4);
  assertConservation(source, plan);
});
test("single-input funding keeps its direct transaction instead of merging an exact combination", () => {
  const source = notes([10, 1, 2]);
  const plan = planShieldedValueSpend({ notes: source, amount: 3n, maxInputs: 1 });
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.selectedCommitments, ["1"]);
  assert.deepEqual(plan.steps[0].outputAmounts, [3n, 7n]);
  assertConservation(source, plan);

  const mergeSource = notes([1, 2]);
  const mergePlan = planShieldedValueSpend({ notes: mergeSource, amount: 3n, maxInputs: 1 });
  assert.equal(mergePlan.steps.length, 2);
  assert.equal(mergePlan.steps[0].kind, "merge");
  assertConservation(mergeSource, mergePlan);
});
test("decimal token amounts remain exact above JavaScript integer precision", () => {
  const unit = 10n ** 18n;
  const source = notes([unit / 10n, unit / 5n]);
  const plan = planShieldedValueSpend({ notes: source, amount: (unit * 3n) / 10n, maxInputs: 4 });
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(new Set(plan.selectedCommitments), new Set(["1", "2"]));
  assert.deepEqual(plan.steps[0].outputAmounts, [(unit * 3n) / 10n, 0n]);
  assertConservation(source, plan);
});
test("selection is deterministic across note and candidate ordering, including equal-value ties", () => {
  const source = notes([5, 4, 3, 2, 1, 4, 3, 2]);
  const permitted = source.map((note) => String(note.commitment));
  const expected = planShieldedValueSpend({
    notes: source,
    candidateCommitments: permitted,
    amount: 7n,
    maxInputs: 4,
  });
  for (const reordered of [source.toReversed(), [...source.slice(3), ...source.slice(0, 3)]]) {
    const actual = planShieldedValueSpend({
      notes: reordered,
      candidateCommitments: permitted.toReversed(),
      amount: 7n,
      maxInputs: 4,
    });
    assert.deepEqual(actual, expected);
    assertConservation(source, actual);
  }
});
test("small fixtures match an exhaustive single-first, then minimum-change oracle", () => {
  let seed = 0x5eed;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let fixture = 0; fixture < 64; fixture++) {
    const source = notes(Array.from({ length: 5 + (next() % 6) }, () => 1 + (next() % 20)));
    const amount = 1n + (BigInt(next()) % sum(source.map((note) => note.amount)));
    const expected = optimalDirectSpend(source, amount);
    if (!expected) continue;
    const plan = planShieldedValueSpend({ notes: source, amount, maxInputs: 4 });
    assert.equal(plan.steps.length, 1, `fixture ${fixture} has a direct solution`);
    assert.equal(plan.steps[0].inputAmount, expected.total, `fixture ${fixture} change`);
    assert.equal(
      plan.steps[0].inputCommitments.length,
      expected.count,
      `fixture ${fixture} input count`,
    );
    assertConservation(source, plan);
  }
});
test(
  "large duplicate candidate sets stay bounded and deterministic while preserving balances",
  { timeout: 10000 },
  () => {
    const source = notes(Array.from({ length: 4096 }, (_, index) => 1 + ((index * 17) % 41)));
    const plan = planShieldedValueSpend({ notes: source, amount: 98n, maxInputs: 4 });
    const reversed = planShieldedValueSpend({
      notes: source.toReversed(),
      amount: 98n,
      maxInputs: 4,
    });
    assert.equal(plan.steps.length, 1);
    assert.deepEqual(reversed, plan);
    assertConservation(source, plan);
  },
);
test(
  "large distinct candidates with no exact sum keep the search bounded and one transaction",
  { timeout: 10000 },
  () => {
    const source = notes(Array.from({ length: 512 }, (_, index) => 4 * (index + 1)));
    const amount = 4097n;
    const plan = planShieldedValueSpend({ notes: source, amount, maxInputs: 4 });
    const reversed = planShieldedValueSpend({
      notes: source.toReversed(),
      amount,
      maxInputs: 4,
    });
    assert.equal(plan.steps.length, 1);
    assert(plan.steps[0].inputCommitments.length <= 4);
    assert(plan.steps[0].inputAmount >= amount);
    assert(plan.steps[0].outputAmounts[1] > 0n);
    assert.deepEqual(reversed, plan);
    assertConservation(source, plan);
  },
);
test("large candidate total does not force consumption beyond a sufficient subset", () => {
  const plan = planShieldedValueSpend({
    notes: notes(Array(9).fill(MAX_UINT128 / 3n + 1n)),
    amount: MAX_UINT128,
    maxInputs: 4,
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
  assert.equal(plan.steps.at(-1).capacity, 1);
  assert(plan.steps.filter((step) => step.kind === "merge").every((step) => step.capacity === 4));
  assert(
    plan.steps
      .filter((step) => step.kind === "merge")
      .every((step) => step.inputCommitments.length <= 4),
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
