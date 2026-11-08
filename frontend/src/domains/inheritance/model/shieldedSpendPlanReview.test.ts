import { describe, expect, it } from "vitest";
import type { ShieldedActionPreview } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { advanceReviewedSpendPlan, isReviewedSpendPlan } from "./shieldedSpendPlanReview";

const plan: ShieldedActionPreview = {
  handle: "first", action: "privateTransfer", slot: "independent", amount: "9",
  inputs: ["11", "12"], inputAmounts: ["4", "4"], outputAmounts: ["8", "0"],
  recipient: "receiver",
  steps: [
    { action: "privateTransfer", inputs: ["11", "12"], outputAmounts: ["8", "0"] },
    { action: "privateTransfer", inputs: ["planned:0:0", "13"], outputAmounts: ["9", "1"] },
  ],
};
const notes = [{ commitment: "13", amount: "2" }];

describe("reviewed spend plan continuation", () => {
  it("continues the exact approved remainder using confirmed output commitments and reviewed original notes", () => {
    const expected = advanceReviewedSpendPlan(plan, ["101", "102"], notes)!;
    expect(expected.inputs).toEqual(["101", "13"]);
    expect(expected.inputAmounts).toEqual(["8", "2"]);
    expect(expected.steps).toEqual([{ action: "privateTransfer", inputs: ["101", "13"], outputAmounts: ["9", "1"] }]);
    expect(isReviewedSpendPlan(expected, { ...expected, handle: "fresh" })).toBe(true);
  });
  it.each([
    { amount: "10" }, { recipient: "other" }, { slot: "identity" as const },
    { inputs: ["101", "99"] }, { inputAmounts: ["8", "3"] },
    { outputAmounts: ["9", "0"] }, { action: "unshield" as const },
    { steps: [{ action: "privateTransfer", inputs: ["101", "99"], outputAmounts: ["9", "1"] }] },
  ])("requires another review when the remainder changes: %j", (change) => {
    const expected = advanceReviewedSpendPlan(plan, ["101", "102"], notes)!;
    expect(isReviewedSpendPlan(expected, { ...expected, ...change })).toBe(false);
  });
  it("fails closed if a reviewed input amount or confirmed output is unavailable", () => {
    expect(advanceReviewedSpendPlan(plan, [], notes)).toBeNull();
    expect(advanceReviewedSpendPlan(plan, ["101", "102"], [])).toBeNull();
    expect(isReviewedSpendPlan(null, plan)).toBe(false);
  });
  it("rebases future placeholders across more than two transactions", () => {
    const longer = { ...plan, steps: [plan.steps[0],
      { action: "privateTransfer", inputs: ["planned:0:0", "13"], outputAmounts: ["10", "0"] },
      { action: "unshield", inputs: ["planned:1:0"], outputAmounts: ["9", "1"] },
    ] };
    const remaining = advanceReviewedSpendPlan(longer, ["101", "102"], notes)!;
    expect(remaining.steps[1].inputs).toEqual(["planned:0:0"]);
    const final = advanceReviewedSpendPlan(remaining, ["201", "202"], notes, "0x1234")!;
    expect(final.inputs).toEqual(["201"]);
    expect(final.inputAmounts).toEqual(["10"]);
    expect(final.recipient).toBe("0x1234");
    expect(final.outputAmounts).toEqual(["1", "0"]);
  });
});
