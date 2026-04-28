import { describe, expect, it } from "vitest";
import { initialMintNftFlowState, mintNftReducer } from "./mintNftReducer";

describe("mintNftReducer", () => {
  it("represents flow stages as a discriminated union", () => {
    expect(mintNftReducer(initialMintNftFlowState, { type: "stage", step: "validating" })).toEqual({
      step: "validating",
    });

    const result = {
      requiresEndorsement: false,
      receipt: { hash: "0xmint" },
      transactionHash: "0xmint",
      blockNumber: 12,
      tokenId: 7,
      event: null,
    } as const;

    expect(mintNftReducer(initialMintNftFlowState, { type: "success", result })).toEqual({
      step: "success",
      result,
    });

    const error = {
      type: "UNKNOWN_ERROR",
      message: "failed",
      details: "failed",
    };

    expect(mintNftReducer(initialMintNftFlowState, { type: "error", error })).toEqual({
      step: "error",
      error,
    });
  });
});
