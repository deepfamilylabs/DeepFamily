import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { CopyIconButton } from "../../../shared/ui";
import { PanelButton } from "./inheritanceControls";

export function ShieldedAssetOverview({
  assetControls,
  fullName,
  personHash,
  symbol,
  availableBalance,
  budgetBalance,
  busy,
  onRecover,
  onLock,
  onCopyIdentityHash,
}: {
  assetControls?: ReactNode;
  fullName: string;
  personHash: string;
  symbol: string;
  availableBalance: string;
  budgetBalance: string;
  busy: boolean;
  onRecover: () => void;
  onLock: () => void;
  onCopyIdentityHash: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("shielded.balanceTitle", { symbol })}
      className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1 basis-64">
          {assetControls ?? (
            <p className="py-2 text-xs text-ink-muted">{t("shielded.balanceTitle", { symbol })}</p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PanelButton size="compact" disabled={busy} onClick={onRecover}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("shielded.actions.recover", { symbol })}
          </PanelButton>
          <PanelButton size="compact" disabled={busy} onClick={onLock}>
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            {t("shielded.lock", { symbol })}
          </PanelButton>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)] md:items-center">
        <div className="min-w-0 space-y-1.5">
          <p className="break-words text-base font-semibold text-ink">{fullName}</p>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 text-ink-muted">{t("shielded.identityHash", { symbol })}</span>
            <code className="min-w-0 truncate font-mono text-ink-muted" title={personHash}>
              {personHash}
            </code>
            <CopyIconButton
              size="xs"
              label={t("shielded.copyIdentityHash", { symbol })}
              onClick={onCopyIdentityHash}
            />
          </div>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-4 border-t border-hairline pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
          {[
            { label: "balanceAmount", amount: availableBalance },
            { label: "budgetAmount", amount: budgetBalance },
          ].map(({ label, amount }) => (
            <div key={label} className="min-w-0 space-y-1">
              <dt className="text-xs text-ink-muted">{t(`shielded.${label}`, { symbol })}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="min-w-0 break-all text-lg font-semibold tabular-nums leading-snug text-ink">
                  {amount}
                </span>
                <span className="text-xs text-ink-muted">{symbol}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
