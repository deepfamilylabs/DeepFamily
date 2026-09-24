import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InheritanceBlocker } from "../model/inheritanceTypes";
import { PanelButton } from "./inheritanceControls";

/** What the feature is not, and what it reveals; shown above every panel. */
export function InheritanceNotice() {
  const { t } = useTranslation();
  const points = [
    t("inheritance.notice.legal"),
    t("inheritance.notice.irreversible"),
    t("inheritance.notice.gas"),
    t("inheritance.notice.rpc"),
  ];
  return (
    <aside className="rounded-3xl border border-hairline bg-surface-alt/50 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Info className="h-4 w-4 text-info" aria-hidden="true" />
        {t("inheritance.notice.title")}
      </h2>
      <ul className="mt-3 space-y-2">
        {points.map((point) => (
          <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle"
              aria-hidden="true"
            />
            {point}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Why the panels are disabled, with the one fix the page can offer itself. */
export function InheritanceGate({
  blocker,
  onSwitchNetwork,
}: {
  blocker: InheritanceBlocker;
  onSwitchNetwork: () => void;
}) {
  const { t } = useTranslation();
  if (blocker === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("inheritance.gate.loading")}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink"
    >
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        {t(`inheritance.gate.${blocker}`)}
      </span>
      {blocker === "wrong-network" ? (
        <PanelButton onClick={onSwitchNetwork}>{t("inheritance.gate.switchNetwork")}</PanelButton>
      ) : null}
    </div>
  );
}
