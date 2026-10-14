import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, LockKeyhole, RefreshCw, Shield } from "lucide-react";
import { CopyIconButton } from "../../../shared/ui";
import { shortHex } from "./inheritanceControls";

export function ShieldedAssetOverview({
  assetControls,
  fullName,
  personHash,
  hashLabel,
  copyHashLabel,
  currentWallet,
  symbol,
  availableBalance,
  budgetBalance,
  busy,
  onRecover,
  onLock,
  onCopyIdentityHash,
  onManageWallets,
  walletDetailsOpen,
  walletDetailsId,
  walletDetails,
  footer,
}: {
  assetControls?: ReactNode;
  fullName: string;
  personHash: string;
  hashLabel?: string;
  copyHashLabel?: string;
  currentWallet?: ReactNode;
  symbol: string;
  availableBalance: string;
  budgetBalance: string;
  busy: boolean;
  onRecover: () => void;
  onLock: () => void;
  onCopyIdentityHash: () => void;
  onManageWallets: () => void;
  walletDetailsOpen: boolean;
  walletDetailsId: string;
  walletDetails?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const utilityClass =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";
  const longBalance = availableBalance.length > 14 || budgetBalance.length > 14;
  return (
    <section
      aria-label={t("shielded.balanceTitle", { symbol })}
      className="min-w-0 rounded-2xl border border-hairline bg-surface p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {assetControls ?? <p className="py-2 text-sm font-medium text-ink">{symbol}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={utilityClass}
            disabled={busy}
            aria-label={t("shielded.actions.recover", { symbol })}
            title={t("shielded.actions.recover", { symbol })}
            onClick={onRecover}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={utilityClass}
            aria-label={t("shielded.lock", { symbol })}
            title={t("shielded.lock", { symbol })}
            onClick={onLock}
          >
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mt-6 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">{currentWallet}</div>
        <button
          type="button"
          className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 ${
            walletDetailsOpen
              ? "bg-primary/8 text-primary"
              : "bg-surface-alt text-ink-muted hover:bg-surface-muted hover:text-ink"
          }`}
          disabled={busy}
          aria-expanded={walletDetailsOpen}
          aria-controls={walletDetailsId}
          onClick={onManageWallets}
        >
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
          {t("shielded.walletKeys.manageIndependentFunds")}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${walletDetailsOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <dl
        className={`mt-4 grid min-w-0 items-end gap-5 sm:gap-8 ${longBalance ? "grid-cols-1 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : "grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"}`}
      >
        {[
          { label: "balanceAmount", amount: availableBalance },
          { label: "budgetAmount", amount: budgetBalance },
        ].map(({ label, amount }) => (
          <div key={label} className="min-w-0 space-y-2">
            <dt className="text-xs text-ink-muted">{t(`shielded.${label}`, { symbol })}</dt>
            <dd className="flex min-h-10 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums sm:min-h-14">
              <span
                className={`min-w-0 break-all font-semibold leading-tight text-ink ${
                  label === "balanceAmount"
                    ? longBalance
                      ? "text-2xl tracking-tight sm:text-3xl"
                      : "text-[2rem] tracking-[-0.04em] sm:text-[2.75rem]"
                    : longBalance
                      ? "text-xl tracking-tight sm:text-2xl"
                      : "text-2xl tracking-tight sm:text-3xl"
                }`}
              >
                {amount}
              </span>
              {amount !== "—" ? <span className="text-xs text-ink-muted">{symbol}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-hairline pt-4 text-xs">
        <span className="min-w-0 max-w-full truncate font-medium text-ink" title={fullName}>
          {fullName}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <span className="sr-only">{hashLabel ?? t("shielded.identityHash", { symbol })}</span>
          <code className="min-w-0 truncate font-mono text-ink-muted" title={personHash}>
            {shortHex(personHash)}
          </code>
          <CopyIconButton
            size="xs"
            label={copyHashLabel ?? t("shielded.copyIdentityHash", { symbol })}
            onClick={onCopyIdentityHash}
          />
        </div>
      </div>
      {walletDetails ? (
        <div className="mt-5 border-t border-hairline pt-5">{walletDetails}</div>
      ) : null}
      {footer ? <div className="mt-4 text-xs">{footer}</div> : null}
    </section>
  );
}
