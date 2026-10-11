import { useTranslation } from "react-i18next";
import type { ShieldedAssetActionRequest } from "../../../shared/workers/shieldedAssetWorkerTypes";

type Action = ShieldedAssetActionRequest["action"] | "receiveCode";
const GROUPS = ["wallet", "inheritance", "receive"] as const;
const actionClass = (active: boolean) =>
  `min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"}`;

export function ShieldedTaskNavigation({
  id,
  action,
  walletAction,
  busy,
  symbol,
  onActionChange,
  fundsAction,
}: {
  id: string;
  action: Action;
  walletAction: Action;
  busy: boolean;
  symbol: string;
  onActionChange: (action: Action) => void;
  fundsAction?: { label: string; active: boolean; onClick: () => void };
}) {
  const { t } = useTranslation();
  const group = action === "fund" ? "inheritance" : action === "claim" ? "receive" : "wallet";
  const selectGroup = (next: (typeof GROUPS)[number]) => {
    if (fundsAction?.active && next === group) {
      onActionChange(action);
      return;
    }
    onActionChange(next === "inheritance" ? "fund" : next === "receive" ? "claim" : walletAction);
  };
  return (
    <>
      <div
        role="tablist"
        aria-label={t("shielded.actionsTitle", { symbol })}
        className="flex flex-wrap gap-x-5 border-b border-hairline"
      >
        {GROUPS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`${id}-tab-${item}`}
            aria-controls={`${id}-task-panel`}
            aria-selected={group === item}
            tabIndex={group === item ? 0 : -1}
            disabled={busy}
            onClick={() => selectGroup(item)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = GROUPS.indexOf(item);
              const next =
                GROUPS[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? GROUPS.length - 1
                      : (index + (event.key === "ArrowLeft" ? -1 : 1) + GROUPS.length) %
                        GROUPS.length
                ];
              selectGroup(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
            className={`-mb-px border-b-2 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ${
              group === item
                ? "border-primary text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`shielded.groups.${item}`)}
          </button>
        ))}
      </div>
      {group === "wallet" ? (
        <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-surface-alt p-1">
          {(["shield", "privateTransfer", "unshield", "receiveCode"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === action && !fundsAction?.active}
              disabled={busy}
              onClick={() => onActionChange(item)}
              className={actionClass(item === action && !fundsAction?.active)}
            >
              {t(`shielded.actions.${item}`, { symbol })}
            </button>
          ))}
          {fundsAction ? (
            <button
              type="button"
              aria-pressed={fundsAction.active}
              disabled={busy}
              onClick={fundsAction.onClick}
              className={actionClass(fundsAction.active)}
            >
              {fundsAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
