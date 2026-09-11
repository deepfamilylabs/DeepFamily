import { useEffect, useId, useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { useFocusOnMount } from "./useFocusOnMount";

export type SuccessRow = {
  label: string;
  value: string;
  /** Hashes and ids read as data; amounts and counts read as prose. */
  mono?: boolean;
  /** What the copy button yields, when the row shows more than one fact. */
  copyValue?: string;
};

/**
 * What a finished transaction leaves the user with.
 *
 * Deliberately short. The earlier version listed every field of every event —
 * including the parent hashes the user had just typed in and a version index of
 * 0 meaning "unknown" — which buried the two or three things they actually
 * need: what was created, what it cost or earned, and the hash to look it up
 * by. Everything else is on the explorer, one copy away.
 */
export function TransactionSuccessSummary({
  t,
  title,
  description,
  rows,
}: {
  t: (key: string, fallback: string) => string;
  title: string;
  description: string;
  rows: SuccessRow[];
}) {
  const panelRef = useFocusOnMount<HTMLDivElement>();
  const titleId = useId();

  return (
    <div
      ref={panelRef}
      role="status"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="rounded-xl border border-success/25 bg-success/8 outline-hidden"
    >
      <div className="flex items-center gap-3 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success">
          <Check className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold text-ink">
            {title}
          </h3>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
      </div>

      <dl className="space-y-2 border-t border-success/20 px-4 py-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-3">
            <dt className="w-20 shrink-0 text-xs text-ink-muted">{row.label}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`min-w-0 flex-1 truncate text-[13px] text-ink ${
                  row.mono ? "font-mono" : "font-medium"
                }`}
                title={row.mono ? row.value : undefined}
              >
                {row.value}
              </span>
              {row.mono ? (
                <CopyValueButton
                  label={`${t("common.copy", "Copy")} ${row.label}`}
                  value={row.copyValue ?? row.value}
                />
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Copies, and says so where the click happened.
 *
 * Self-contained on purpose: a summary that needed a toast provider could not
 * be rendered anywhere the provider was not, which is most of its tests.
 */
function CopyValueButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      className="shrink-0 rounded-md p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <Clipboard className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
