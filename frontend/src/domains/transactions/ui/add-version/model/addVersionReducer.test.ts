import { describe, expect, it } from "vitest";
import { addVersionReducer, initialAddVersionFlowState } from "./addVersionReducer";

describe("addVersionReducer", () => {
  it("represents add-version flow stages as a discriminated union", () => {
    expect(
      addVersionReducer(initialAddVersionFlowState, { type: "stage", step: "validating" }),
    ).toEqual({ step: "validating" });

    const result = {
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash: "0xtx",
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        TokenRewardDistributed: null,
      },
    };

    expect(addVersionReducer(initialAddVersionFlowState, { type: "success", result })).toEqual({
      step: "success",
      result,
    });

    const error = {
      type: "UNKNOWN_ERROR",
      message: "failed",
      details: "failed",
    };

    expect(addVersionReducer(initialAddVersionFlowState, { type: "error", error })).toEqual({
      step: "error",
      error,
    });
  });
});
