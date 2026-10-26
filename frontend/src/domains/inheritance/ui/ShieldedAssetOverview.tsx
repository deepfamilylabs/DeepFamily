import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, KeyRound, LockKeyhole, QrCode, RefreshCw, Settings2 } from "lucide-react";
import { CopyIconButton } from "../../../shared/ui";
import { shortHex } from "./inheritanceControls";

export type ShieldedWalletSheetState = "receiveCode" | "keys";

export type ShieldedOverviewWallet = {
  /** A family wallet is derived from a person; an ordinary wallet only receives. */
  family: boolean;
  title: string;
  available: string;
  budget: string;
  /** Only an actual balance recovery marks a wallet as loading or updating. */
  balanceState?: "loading" | "updating";
};

const WALLET_ACTION =
  "relative z-20 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8";

/** The unlocked person, the asset in use and the private wallet with its balances. */
export function ShieldedAssetOverview({
  person,
  assetControls,
  symbol,
  busy,
  onRecover,
  onLock,
  wallet,
  onReceiveCode,
  onOpenKeys,
  openSheet,
  footer,
}: {
  person: {
    name: string;
    /** Initials for a person; an ordinary wallet shows the key glyph instead. */
    avatar?: string;
    hash?: string;
    hashLabel?: string;
    copyLabel?: string;
    onCopy?: () => void;
  };
  assetControls?: ReactNode;
  symbol: string;
  busy: boolean;
  onRecover: () => void;
  onLock: () => void;
  wallet: ShieldedOverviewWallet;
  onReceiveCode: () => void;
  onOpenKeys: () => void;
  /** The wallet sheet that is open, so its trigger reports that it is expanded. */
  openSheet: ShieldedWalletSheetState | null;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const utility =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";
  const Icon = wallet.family ? Fingerprint : KeyRound;
  const longBalance = wallet.available.length > 14 || wallet.budget.length > 14;
  return (
    <section aria-label={t("shielded.balanceTitle", { symbol })} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[13px] font-semibold text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
          >
            {person.avatar ? person.avatar : <KeyRound className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p
              className="truncate text-[15px] font-semibold leading-snug text-ink"
              title={person.name}
            >
              {person.name}
            </p>
            {person.hash ? (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                <span className="shrink-0">{person.hashLabel}</span>
                <code className="min-w-0 truncate font-mono text-ink/80" title={person.hash}>
                  {shortHex(person.hash)}
                </code>
                {person.onCopy ? (
                  <CopyIconButton
                    size="xs"
                    label={person.copyLabel ?? ""}
                    onClick={person.onCopy}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {assetControls ? <div className="min-w-0">{assetControls}</div> : null}
          <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-hairline sm:block" />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={utility}
              disabled={busy}
              aria-label={t("shielded.actions.recover", { symbol })}
              title={t("shielded.actions.recover", { symbol })}
              onClick={onRecover}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 sm:border sm:border-hairline-strong sm:bg-surface sm:px-3"
              onClick={onLock}
            >
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("shielded.lock", { symbol })}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="sm:grid sm:grid-cols-2 sm:gap-4">
        <div
          role="group"
          aria-label={wallet.title}
          className="relative flex min-w-0 flex-col gap-5 rounded-[14px] border-[1.5px] border-hairline bg-surface px-4 pb-3 pt-4 sm:border-orange-400 sm:bg-orange-50/60 sm:px-5 sm:pt-[18px] sm:dark:border-orange-400/70 sm:dark:bg-orange-400/[0.06]"
        >
          <div className="space-y-2 max-sm:hidden">
            <div className="hidden min-h-7 min-w-0 items-center gap-3 sm:flex">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-semibold text-orange-700 dark:text-orange-300">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {wallet.title}
                </span>
              </span>
              <span className="sr-only">{tr("currentWallet")}</span>
            </div>
            <p className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              {tr("walletUnlocked")}
            </p>
          </div>
          <div className="mt-auto min-w-0">
            <dl
              aria-busy={wallet.balanceState ? true : undefined}
              className={`flex min-w-0 gap-x-6 gap-y-3 ${
                longBalance ? "flex-col" : "flex-wrap items-end justify-between"
              }`}
            >
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">
                  {t("shielded.balanceAmount", { symbol })}
                </dt>
                <dd className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums">
                  <span
                    className={`min-w-0 break-all font-display font-bold leading-none text-ink ${
                      longBalance ? "text-2xl sm:text-3xl" : "text-[34px] sm:text-[40px]"
                    }`}
                  >
                    {wallet.available}
                  </span>
                  {wallet.available !== "—" ? (
                    <span className="text-[13px] text-ink-muted">{symbol}</span>
                  ) : null}
                </dd>
              </div>
              <div className={`min-w-0 ${longBalance ? "" : "text-right"}`}>
                <dt className="text-xs text-ink-muted">{t("shielded.budgetAmount", { symbol })}</dt>
                <dd
                  className={`mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1 tabular-nums ${longBalance ? "" : "justify-end"}`}
                >
                  <span className="min-w-0 break-all font-display text-[22px] font-bold leading-none text-ink/80">
                    {wallet.budget}
                  </span>
                  {wallet.budget !== "—" ? (
                    <span className="text-xs text-ink-muted">{symbol}</span>
                  ) : null}
                </dd>
              </div>
            </dl>
            <div className="mt-2 min-h-4 text-xs leading-4 text-ink-muted">
              {wallet.balanceState ? (
                <span role="status">
                  {t(
                    wallet.balanceState === "loading"
                      ? "shielded.publicStateSync.balanceLoading"
                      : "shielded.publicStateSync.balanceUpdating",
                  )}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-hairline/70 pt-2.5">
            <button
              type="button"
              className={`${WALLET_ACTION} text-ink/80 hover:text-ink`}
              disabled={busy}
              aria-expanded={openSheet === "receiveCode"}
              onClick={onReceiveCode}
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              {t("shielded.actions.receiveCode", { symbol })}
            </button>
            <button
              type="button"
              className={`${WALLET_ACTION} text-ink/80 hover:text-ink`}
              disabled={busy}
              aria-expanded={openSheet === "keys"}
              onClick={onOpenKeys}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              {tr("keySettings")}
            </button>
          </div>
        </div>
      </div>
      {footer ? <div className="pt-3 text-xs">{footer}</div> : null}
    </section>
  );
}
