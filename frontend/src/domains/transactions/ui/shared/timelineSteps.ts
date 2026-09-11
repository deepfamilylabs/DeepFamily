/**
 * Which declared step each flow is on.
 *
 * Kept together and free of React so the two can be read — and tested — side by
 * side: minting and adding a version share a spine and differ by exactly one
 * step, and that claim is easy to break by accident.
 *
 * One rule matters more than the rest. Only a flow's own `confirming` status
 * may reach the final step, because that is set when the transaction is
 * genuinely away. A signal that merely *precedes* submission must never be read
 * as submission: progress does not reverse, so a step reached too early is
 * reached permanently.
 */
export type TimelineSignals = {
  /** Where the local cryptographic work is, if any is running. */
  proofStep: string;
  /** The flow's own status, which alone knows when the transaction is away. */
  status: string;
  isBusy: boolean;
  hasPreview: boolean;
};

export const MINT_TIMELINE_STEPS = ["identity", "proof", "review", "confirm"] as const;

export function mintTimelineStep(input: TimelineSignals): string | null {
  if (input.hasPreview) return "review";
  if (input.status === "confirming") return "confirm";
  if (input.proofStep === "generating" || input.proofStep === "verifying") return "proof";
  if (input.proofStep === "preparing") return "identity";
  // Past the proof: the gas estimate that produces the preview is under way.
  if (input.isBusy) return "review";
  return null;
}

export const ADD_VERSION_TIMELINE_STEPS = [
  "identity",
  "proof",
  "encrypt",
  "review",
  "confirm",
] as const;

export function addVersionTimelineStep(input: TimelineSignals): string | null {
  if (input.hasPreview) return "review";
  if (input.status === "confirming") return "confirm";
  if (input.proofStep === "encrypting") return "encrypt";
  if (input.proofStep === "generating" || input.proofStep === "verifying") return "proof";
  if (input.proofStep === "preparing") return "identity";
  // Includes the "handoff" step, which names the moment the submit hook passes
  // the frozen package on — not the moment the transaction leaves.
  if (input.isBusy) return "review";
  return null;
}

export const ENDORSE_TIMELINE_STEPS = ["allowance", "approve", "submit", "confirm"] as const;

export function endorseTimelineStep(status: string): string | null {
  switch (status) {
    case "validating":
      return "allowance";
    case "approving":
      return "approve";
    case "submitting":
      return "submit";
    case "confirming":
      return "confirm";
    default:
      return null;
  }
}
