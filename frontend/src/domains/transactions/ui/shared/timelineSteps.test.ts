import { describe, expect, it } from "vitest";
import {
  ADD_VERSION_TIMELINE_STEPS,
  MINT_TIMELINE_STEPS,
  addVersionTimelineStep,
  endorseTimelineStep,
  mintTimelineStep,
} from "./timelineSteps";

const idle = { proofStep: "", status: "idle", isBusy: false, hasPreview: false };

describe("timeline step derivation", () => {
  it("gives minting and adding a version the same spine, differing by the envelope", () => {
    const mint: readonly string[] = MINT_TIMELINE_STEPS;
    const addVersion: readonly string[] = ADD_VERSION_TIMELINE_STEPS;

    expect(addVersion.filter((step) => step !== "encrypt")).toEqual(mint);
    expect(addVersion).toContain("encrypt");
    expect(mint).not.toContain("encrypt");
  });

  it.each([
    ["mint", mintTimelineStep],
    ["addVersion", addVersionTimelineStep],
  ])("only lets %s reach the final step once the flow says the transaction is away", (_name, derive) => {
    // Every signal short of the flow's own `confirming` must stop short of it.
    for (const proofStep of ["", "preparing", "generating", "verifying", "encrypting", "handoff"]) {
      expect(derive({ ...idle, proofStep, isBusy: true })).not.toBe("confirm");
    }
    expect(derive({ ...idle, isBusy: true, status: "confirming" })).toBe("confirm");
  });

  it("holds adding a version at the review step while the package is handed off", () => {
    // The handoff precedes the gas estimate and the preview; reading it as
    // submission would run the timeline to the end before the user has even
    // been asked, and progress does not come back.
    expect(addVersionTimelineStep({ ...idle, proofStep: "handoff", isBusy: true })).toBe("review");
    expect(
      addVersionTimelineStep({ ...idle, proofStep: "handoff", isBusy: true, hasPreview: true }),
    ).toBe("review");
  });

  it("walks each flow's steps in declared order as its signals arrive", () => {
    expect(mintTimelineStep({ ...idle, proofStep: "preparing", isBusy: true })).toBe("identity");
    expect(mintTimelineStep({ ...idle, proofStep: "generating", isBusy: true })).toBe("proof");
    expect(mintTimelineStep({ ...idle, isBusy: true })).toBe("review");

    expect(addVersionTimelineStep({ ...idle, proofStep: "encrypting", isBusy: true })).toBe(
      "encrypt",
    );
  });

  it("maps endorsing straight from its own status", () => {
    expect(endorseTimelineStep("validating")).toBe("allowance");
    expect(endorseTimelineStep("approving")).toBe("approve");
    expect(endorseTimelineStep("submitting")).toBe("submit");
    expect(endorseTimelineStep("confirming")).toBe("confirm");
    expect(endorseTimelineStep("success")).toBeNull();
  });
});
