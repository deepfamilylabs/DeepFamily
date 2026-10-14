import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Fingerprint,
  KeyRound,
  LockOpen,
  Plus,
  QrCode,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { ShieldedKeySlot } from "../../../shared/workers/shieldedAssetWorkerTypes";

type FundsKeyFlow = "restore" | "create" | "backup";

const FUNDS_KEY_ACTIONS = {
  restore: { icon: LockOpen, label: "restoreTitle" },
  create: { icon: Plus, label: "createTitle" },
  backup: { icon: ShieldCheck, label: "backupTitle" },
} as const;

export type ShieldedWalletBalance = {
  slot: ShieldedKeySlot;
  available: string;
  budget: string;
  unlocked: boolean;
};

/** The current wallet and its balances, alongside the other available wallet. */
export function ShieldedWalletBalances({
  balances,
  symbol,
  selectedSlot,
  selectionMatches,
  disabled,
  expandedReceiveSlot = null,
  fundsKeyState,
  expandedKeyFlow = null,
  onSelect,
  onReceiveCode,
  onOpenFundsKey,
}: {
  balances: readonly ShieldedWalletBalance[];
  symbol: string;
  selectedSlot: ShieldedKeySlot;
  selectionMatches: boolean;
  disabled: boolean;
  expandedReceiveSlot?: ShieldedKeySlot | null;
  /**
   * Only a usable funds key offers receiving and its key settings. A new key first
   * offers its mandatory backup; otherwise the card offers unlocking or creating one.
   */
  fundsKeyState: "ready" | "backup" | "setup";
  expandedKeyFlow?: FundsKeyFlow | null;
  onSelect: (slot: ShieldedKeySlot) => void;
  onReceiveCode: (slot: ShieldedKeySlot) => void;
  onOpenFundsKey: (flow: FundsKeyFlow) => void;
}) {
  const { t } = useTranslation();
  const selectionName = useId();
  const actionClassName =
    "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";
  return (
    <div
      className="grid min-w-0 gap-3 sm:grid-cols-2"
      role="group"
      aria-label={t("shielded.walletKeys.walletBalances")}
    >
      {balances.map(({ slot, available, budget, unlocked }) => {
        const title = t(
          `shielded.walletKeys.${slot === "identity" ? "identityFunds" : "budgetFunds"}`,
        );
        const selected =
          selectedSlot === slot && (slot === "identity" || selectionMatches || !unlocked);
        const longBalance = available.length > 14 || budget.length > 14;
        const Icon = slot === "identity" ? Fingerprint : KeyRound;
        return (
          <div
            key={slot}
            role="group"
            aria-label={title}
            className={`flex min-w-0 flex-col rounded-xl border p-4 transition-colors ${
              selected
                ? "border-primary/40 bg-primary/[0.03]"
                : "border-hairline bg-surface hover:border-hairline-strong"
            }`}
          >
            <label
              className={`flex min-w-0 items-center gap-3 ${disabled ? "cursor-default" : "cursor-pointer"}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  selected ? "bg-primary/10 text-primary" : "bg-surface-alt text-ink-muted"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{title}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {t(`shielded.walletKeys.${unlocked ? "walletUnlocked" : "walletLocked"}`)}
                </span>
              </span>
              <input
                type="radio"
                name={selectionName}
                value={slot}
                className="h-4 w-4 shrink-0 accent-primary text-primary focus:ring-primary/30 focus:ring-offset-0"
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(slot)}
                aria-label={title}
              />
            </label>
            <dl
              className={`mt-5 grid min-w-0 items-end gap-4 ${longBalance ? "grid-cols-1" : "grid-cols-2"}`}
            >
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">
                  {t("shielded.balanceAmount", { symbol })}
                </dt>
                <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 tabular-nums">
                  <span
                    className={`min-w-0 break-all font-semibold leading-tight text-ink ${longBalance ? "text-xl" : "text-2xl"}`}
                  >
                    {available}
                  </span>
                  {available !== "—" ? (
                    <span className="text-xs text-ink-muted">{symbol}</span>
                  ) : null}
                </dd>
              </div>
              <div className={`min-w-0 ${longBalance ? "" : "text-right"}`}>
                <dt className="text-xs text-ink-muted">{t("shielded.budgetAmount", { symbol })}</dt>
                <dd
                  className={`mt-1 flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm tabular-nums text-ink-muted ${longBalance ? "" : "justify-end"}`}
                >
                  <span className="min-w-0 break-all font-medium">{budget}</span>
                  {budget !== "—" ? <span className="text-xs">{symbol}</span> : null}
                </dd>
              </div>
            </dl>
            <div className="mt-auto flex flex-wrap gap-1 pt-4">
              {slot === "asset" && fundsKeyState !== "ready" ? (
                (fundsKeyState === "backup"
                  ? (["backup"] as const)
                  : (["restore", "create"] as const)
                ).map((flow) => {
                  const { icon: FlowIcon, label } = FUNDS_KEY_ACTIONS[flow];
                  return (
                    <button
                      key={flow}
                      type="button"
                      className={actionClassName}
                      disabled={disabled}
                      aria-expanded={expandedKeyFlow === flow}
                      onClick={() => onOpenFundsKey(flow)}
                    >
                      <FlowIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t(`shielded.walletKeys.${label}`)}
                    </button>
                  );
                })
              ) : (
                <>
                  <button
                    type="button"
                    className={actionClassName}
                    disabled={disabled}
                    aria-expanded={expandedReceiveSlot === slot}
                    aria-label={t(
                      `shielded.walletKeys.${slot === "identity" ? "identityReceiveCode" : "fundsReceiveCode"}`,
                    )}
                    onClick={() => onReceiveCode(slot)}
                  >
                    <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("shielded.actions.receiveCode", { symbol })}
                  </button>
                  {slot === "asset" ? (
                    <button
                      type="button"
                      className={actionClassName}
                      disabled={disabled}
                      aria-expanded={expandedKeyFlow === "backup"}
                      aria-label={t("shielded.walletKeys.keySettings")}
                      onClick={() => onOpenFundsKey("backup")}
                    >
                      <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("shielded.walletKeys.keySettings")}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
