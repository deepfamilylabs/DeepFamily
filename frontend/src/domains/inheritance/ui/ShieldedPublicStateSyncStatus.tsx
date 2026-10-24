import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PublicStateSyncProgress } from "../../../shared/workers/publicStateSyncProgress";

type SyncStatusProps = {
  progress: readonly PublicStateSyncProgress[];
  paused: boolean;
  pauseDisabled: boolean;
  onPause: () => void;
};

export function ShieldedPublicStateSyncStatus(props: SyncStatusProps) {
  const { t } = useTranslation();
  if (props.paused) {
    return <p role="status" className="text-sm text-ink-muted">{t("shielded.publicStateSync.paused")}</p>;
  }
  // Verification completion ends this status even if proofs or a transaction are still busy.
  if (!props.progress.some((item) => item.phase !== "complete")) return null;
  return <ActiveSyncStatus {...props} />;
}

function ActiveSyncStatus({ progress, pauseDisabled, onPause }: SyncStatusProps) {
  const { t } = useTranslation();
  const id = useId();
  const container = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const verifying = progress.some((item) => item.phase === "verify" ||
    (item.phase === "download" && item.total > 0 && item.completed >= item.total));

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  return (
    <section
      ref={container}
      aria-label={t("shielded.publicStateSync.title")}
      className="relative inline-flex max-w-full items-center gap-1 text-xs text-ink-muted"
    >
      <button
        ref={trigger}
        type="button"
        aria-label={t("shielded.publicStateSync.details")}
        aria-describedby={`${id}-summary`}
        aria-expanded={expanded}
        aria-controls={`${id}-details`}
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
        <span id={`${id}-summary`} role="status" aria-live="polite" className="truncate">
          {t(`shielded.publicStateSync.${verifying ? "verifying" : "syncing"}`)}
        </span>
        <ChevronDown aria-hidden="true" className={`h-3 w-3 shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </button>
      <button
        type="button"
        disabled={pauseDisabled}
        onClick={() => { if (!pauseDisabled) onPause(); }}
        className="inline-flex h-9 shrink-0 items-center rounded-lg px-2 text-xs transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("shielded.publicStateSync.pause")}
      </button>
      {expanded ? (
        <div
          id={`${id}-details`}
          className="absolute right-0 top-full z-30 mt-1 max-h-[60dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-hairline-strong bg-surface p-4 shadow-lg"
        >
          <h3 className="mb-4 text-sm font-medium text-ink">{t("shielded.publicStateSync.title")}</h3>
          <div className="space-y-4 text-xs text-ink-muted">
            {progress.map((item) => {
              const phase = item.phase === "download" && item.total > 0 && item.completed >= item.total
                ? "downloaded" : item.phase;
              const label = `${t(`shielded.publicStateSync.domains.${item.domain}`)} · ${t(`shielded.publicStateSync.phases.${phase}`)}`;
              return (
                <div key={item.domain} className="space-y-1.5">
                  <p>{label}</p>
                  {item.total > 0 ? (
                    <>
                      <progress
                        aria-label={label}
                        max={item.total}
                        value={Math.min(Math.max(item.completed, 0), item.total)}
                        className="block h-1.5 w-full accent-primary"
                      />
                      <p>{t("shielded.publicStateSync.count", { completed: item.completed, total: item.total })}</p>
                    </>
                  ) : item.phase !== "complete" ? (
                    <progress aria-label={label} className="block h-1.5 w-full accent-primary" />
                  ) : null}
                  {item.resumed ? <p>{t("shielded.publicStateSync.resumed")}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
