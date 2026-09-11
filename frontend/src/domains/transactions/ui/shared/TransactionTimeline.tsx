import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

export type TimelineStepState =
  | "done"
  /** The flow is working on it; nothing is being asked of the user. */
  | "current"
  /** Stopped here, waiting for the user to act. */
  | "awaiting"
  | "pending"
  | "failed";

export type TimelineStep = {
  id: string;
  label: string;
  /** Shown under the label while this step is the current one. */
  detail?: string;
  state: TimelineStepState;
};

export type TimelineStepSpec = { id: string; label: string; detail?: string };

/**
 * Resolves a flow's declared steps against the one it is on.
 *
 * Everything before the current step has been done, everything after is still
 * ahead. A flow that failed marks the step it failed on rather than pretending
 * to still be working on it.
 */
/** A detail that only restates its own label is noise, not information. */
const meaningfulDetail = (step: TimelineStepSpec) => {
  if (!step.detail) return undefined;
  const strip = (value: string) => value.replace(/[.。・…]+$/u, "").trim();
  return strip(step.detail) === strip(step.label) ? undefined : step.detail;
};

export function buildTimeline(input: {
  steps: TimelineStepSpec[];
  currentId: string | null;
  failed?: boolean;
  /** The current step is blocked on the user rather than on the flow. */
  awaiting?: boolean;
  /** The run finished: every step is behind it, with no current one. */
  complete?: boolean;
}): TimelineStep[] {
  const currentIndex = input.complete
    ? input.steps.length
    : input.steps.findIndex((step) => step.id === input.currentId);
  return input.steps.map((spec, index) => {
    const step = { ...spec, detail: meaningfulDetail(spec) };
    if (currentIndex === -1) return { ...step, state: "pending" as const };
    if (input.complete) return { ...step, state: "done" as const };
    if (index < currentIndex) return { ...step, state: "done" as const };
    if (index > currentIndex) return { ...step, state: "pending" as const };
    if (input.failed) return { ...step, state: "failed" as const };
    return { ...step, state: input.awaiting ? ("awaiting" as const) : ("current" as const) };
  });
}

/**
 * The furthest step a run has reached, which is the only thing that should ever
 * be shown as "where we are".
 *
 * A flow's signals do not arrive in step order — minting reports `submitting`
 * for everything from the gas estimate through the wallet, so reading the
 * current signal alone walks the marker backwards. Progress through a
 * transaction does not reverse, so neither does this.
 */
export function useTimelineProgress(
  stepIds: readonly string[],
  currentId: string | null,
): string | null {
  const [furthest, setFurthest] = useState(-1);

  useEffect(() => {
    const index = currentId ? stepIds.indexOf(currentId) : -1;
    // No current step means the run is over or has not started: begin again.
    setFurthest((previous) => (index === -1 ? -1 : Math.max(previous, index)));
  }, [currentId, stepIds]);

  return furthest === -1 ? null : (stepIds[furthest] ?? null);
}

function StepMarker({ state }: { state: TimelineStepState }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15">
        <Check className="h-3 w-3 text-success" aria-hidden />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/15">
        <X className="h-3 w-3 text-danger" aria-hidden />
      </span>
    );
  }
  if (state === "awaiting") {
    // Deliberately not a spinner: nothing is happening until the user acts.
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-primary bg-primary/10">
        <ArrowRight className="h-3 w-3 text-primary" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15">
        <Loader2
          className="h-3 w-3 animate-spin motion-reduce:animate-none text-primary"
          aria-hidden
        />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-hairline-strong" aria-hidden />
    </span>
  );
}

/**
 * Where a transaction is, and what is left.
 *
 * These flows are several minutes of work with no single thing to watch, and
 * swapping one sentence for another told the user neither how far along they
 * were nor how much remained. The steps are declared per flow, so the list is
 * the same length from start to finish and only the marks move.
 */
export function TransactionTimeline({ steps, label }: { steps: TimelineStep[]; label: string }) {
  const current = steps.find(
    (step) =>
      step.state === "current" || step.state === "awaiting" || step.state === "failed",
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={current ? `${label}: ${current.label}` : label}
      className="rounded-xl border border-hairline bg-surface p-4"
    >
      <ol className="space-y-0">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepMarker state={step.state} />
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`w-px flex-1 ${step.state === "done" ? "bg-success/40" : "bg-hairline"}`}
                />
              )}
            </div>
            <div className={`min-w-0 flex-1 ${index < steps.length - 1 ? "pb-3" : ""}`}>
              <div
                className={`text-[13px] leading-5 ${
                  step.state === "pending"
                    ? "text-ink-subtle"
                    : step.state === "failed"
                      ? "font-semibold text-danger"
                      : step.state === "current" || step.state === "awaiting"
                        ? "font-semibold text-ink"
                        : "text-ink-muted"
                }`}
              >
                {step.label}
              </div>
              {step.detail &&
              (step.state === "current" ||
                step.state === "awaiting" ||
                step.state === "failed") ? (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
