import { useId, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CalendarClock,
  HandCoins,
  Inbox,
  MailPlus,
  type LucideProps,
} from "lucide-react";
import type { ShieldedAssetActionRequest } from "../../../shared/workers/shieldedAssetWorkerTypes";

export type ShieldedTask = ShieldedAssetActionRequest["action"] | "writeLetter" | "letterInbox";

const GROUPS: readonly { key: "wallet" | "inheritance" | "letters"; actions: readonly ShieldedTask[] }[] =
  [
    { key: "wallet", actions: ["shield", "privateTransfer", "unshield"] },
    { key: "inheritance", actions: ["fund", "claim"] },
    { key: "letters", actions: ["writeLetter", "letterInbox"] },
  ];

const ICONS: Record<ShieldedTask, ComponentType<LucideProps>> = {
  shield: ArrowDownToLine,
  privateTransfer: ArrowLeftRight,
  unshield: ArrowUpFromLine,
  fund: HandCoins,
  claim: CalendarClock,
  writeLetter: MailPlus,
  letterInbox: Inbox,
};

/**
 * Every task in one list: a rail grouped by purpose on wide screens, a row of
 * chips on a phone. The claim entry counts the periods that can be claimed now.
 */
export function ShieldedTaskNavigation({
  action,
  busy,
  symbol,
  claimablePeriods,
  onActionChange,
}: {
  action: ShieldedTask;
  busy: boolean;
  symbol: string;
  claimablePeriods: number;
  onActionChange: (action: ShieldedTask) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <nav
      aria-label={t("shielded.actionsTitle", { symbol })}
      className="min-w-0 basis-full lg:sticky lg:top-[calc(var(--app-header-h)+1.5rem)] lg:max-w-[13.75rem] lg:flex-[1_1_12.5rem]"
    >
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-[18px] lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-1">
        {GROUPS.map((group) => (
          <div
            key={group.key}
            role="group"
            aria-labelledby={`${id}-${group.key}`}
            className="flex shrink-0 gap-2 lg:flex-col lg:gap-0.5"
          >
            <span
              id={`${id}-${group.key}`}
              className="hidden px-3 pb-1.5 text-xs font-semibold text-ink-muted lg:block"
            >
              {group.key === "letters" ? t("shielded.privateLetters.title") : t(`shielded.groups.${group.key}`)}
            </span>
            {group.actions.map((item) => {
              const Icon = ICONS[item];
              const active = item === action;
              const count = item === "claim" ? claimablePeriods : 0;
              return (
                <button
                  key={item}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  aria-describedby={count > 0 ? `${id}-count` : undefined}
                  disabled={busy}
                  onClick={() => onActionChange(item)}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-11 lg:rounded-[10px] lg:border-0 lg:px-3 ${
                    active
                      ? "border-orange-300 bg-orange-50 font-semibold text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300"
                      : "border-hairline bg-surface font-medium text-ink/80 hover:bg-surface-alt hover:text-ink lg:bg-transparent"
                  }`}
                >
                  <Icon
                    className={`hidden h-[18px] w-[18px] shrink-0 lg:block ${
                      active ? "text-orange-600 dark:text-orange-300" : "text-ink-muted"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="lg:flex-1 lg:text-left">
                    {item === "writeLetter" ? t("shielded.privateLetters.write")
                      : item === "letterInbox" ? t("shielded.privateLetters.inbox")
                      : t(`shielded.actions.${item}`, { symbol })}
                  </span>
                  {count > 0 ? (
                    <span
                      aria-hidden="true"
                      className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-orange-700 px-1.5 text-xs font-semibold tabular-nums text-white dark:bg-primary dark:text-orange-950"
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {claimablePeriods > 0 ? (
        <span id={`${id}-count`} hidden>
          {`${t("shielded.claimPeriodsLabel", { symbol })} ${claimablePeriods}`}
        </span>
      ) : null}
    </nav>
  );
}
