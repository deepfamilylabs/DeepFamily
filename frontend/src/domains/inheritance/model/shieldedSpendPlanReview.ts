import type { ShieldedActionPreview } from "../../../shared/workers/shieldedAssetWorkerTypes";

/** Rebase the remainder of the reviewed plan onto the outputs actually confirmed on chain. */
export function advanceReviewedSpendPlan(
  previous: ShieldedActionPreview,
  outputs: readonly string[],
  notes: readonly { commitment: string; amount: string }[],
  recipient?: string,
): ShieldedActionPreview | null {
  try {
    if (previous.steps.length < 2) return null;
    const amounts = new Map(notes.map((note) => [note.commitment, BigInt(note.amount).toString()]));
    previous.inputs.forEach((input, index) => amounts.set(input, BigInt(previous.inputAmounts[index]).toString()));
    const first = previous.steps[0];
    const rebase = (input: string) => {
      const planned = /^planned:(\d+):(\d+)$/.exec(input);
      if (!planned) return input;
      const step = Number(planned[1]), output = Number(planned[2]);
      if (step === 0) {
        if (!outputs[output] || first.outputAmounts[output] === undefined) throw new Error("Missing confirmed output");
        amounts.set(outputs[output], BigInt(first.outputAmounts[output]).toString());
        return outputs[output];
      }
      return `planned:${step - 1}:${output}`;
    };
    const steps = previous.steps.slice(1).map((step) => ({ ...step, inputs: step.inputs.map(rebase) }));
    const next = steps[0];
    const inputAmounts = next.inputs.map((input) => {
      const amount = amounts.get(input);
      if (amount === undefined) throw new Error("Unknown reviewed input");
      return amount;
    });
    return {
      ...previous,
      action: next.action as ShieldedActionPreview["action"],
      inputs: next.inputs,
      inputAmounts,
      outputAmounts: next.action === "unshield" ? [next.outputAmounts[1], "0"] : next.outputAmounts,
      steps,
      recipient: next.action === "unshield" ? recipient ?? previous.recipient : previous.recipient,
    };
  } catch {
    return null;
  }
}

/** A different plan needs a new review, even when its payment amount is unchanged. */
export function isReviewedSpendPlan(expected: ShieldedActionPreview | null, actual: ShieldedActionPreview): boolean {
  if (!expected) return false;
  const semantic = ({ action, amount, slot, inputs, inputAmounts, outputAmounts, steps, recipient, policyHandle }: ShieldedActionPreview) =>
    JSON.stringify({ action, amount, slot, inputs, inputAmounts, outputAmounts, steps: steps.map(({ action, inputs, outputAmounts }) => ({ action, inputs, outputAmounts })), recipient: recipient?.toLowerCase(), policyHandle });
  return semantic(expected) === semantic(actual);
}
