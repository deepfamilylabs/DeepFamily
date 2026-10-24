import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { PublicStateSyncProgress } from "../../../shared/workers/publicStateSyncProgress";
import { PanelButton } from "./inheritanceControls";

export function ShieldedPublicStateSyncStatus({
  progress,
  paused,
  pauseDisabled,
  onPause,
}: {
  progress: readonly PublicStateSyncProgress[];
  paused: boolean;
  pauseDisabled: boolean;
  onPause: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const synchronizing = progress.some((item) => item.phase !== "complete");
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-[20px] border border-hairline bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-medium text-ink">
          {t("shielded.publicStateSync.title")}
        </h3>
        {!paused && synchronizing ? (
          <PanelButton size="compact" disabled={pauseDisabled} onClick={() => { if (!pauseDisabled) onPause(); }}>
            {t("shielded.publicStateSync.pause")}
          </PanelButton>
        ) : null}
      </div>
      <div role="status" aria-live="polite" className="mt-3 space-y-4 text-sm text-ink-muted">
        {paused ? (
          <p>{t("shielded.publicStateSync.paused")}</p>
        ) : progress.map((item) => {
          const phase = item.phase === "download" && item.total > 0 && item.completed >= item.total
            ? "downloaded" : item.phase;
          const label = `${t(`shielded.publicStateSync.domains.${item.domain}`)} · ${t(`shielded.publicStateSync.phases.${phase}`)}`;
          return (
            <div key={item.domain} className="space-y-1">
              <p>{label}</p>
              {item.total > 0 ? (
                <>
                  <progress
                    aria-label={label}
                    max={item.total}
                    value={Math.min(Math.max(item.completed, 0), item.total)}
                    className="block h-2 w-full accent-primary"
                  />
                  <p className="text-xs">{t("shielded.publicStateSync.count", { completed: item.completed, total: item.total })}</p>
                </>
              ) : item.phase !== "complete" ? (
                <progress aria-label={label} className="block h-2 w-full accent-primary" />
              ) : null}
              {item.resumed ? <p className="text-xs">{t("shielded.publicStateSync.resumed")}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
