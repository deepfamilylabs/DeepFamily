import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LockOpen,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { ShieldedKeySlot } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { CopyIconButton } from "../../../shared/ui";
import { BADGE_ACCENT, CHOICE_INPUT, shortHex } from "./inheritanceControls";

export type ShieldedFundsKeyFlow = "restore" | "create" | "backup";

export type ShieldedOverviewWallet = {
  slot: ShieldedKeySlot;
  unlocked: boolean;
  available: string;
  budget: string;
  /** The wallet every deposit, spend and claim uses. */
  current: boolean;
  /**
   * Its radio is checked only while the loaded funds key is the pinned one, so a
   * replacement key has to be accepted by choosing the wallet again.
   */
  checked: boolean;
  /** The funds key this wallet is pinned to, which a replacement key never takes over. */
  fingerprint?: string;
};

export type ShieldedWalletSheetState =
  | { kind: "receiveCode"; slot: ShieldedKeySlot }
  | { kind: "keys"; flow: ShieldedFundsKeyFlow };

const FUNDS_KEY_ACTIONS = {
  restore: { icon: LockOpen, label: "restoreTitle" },
  create: { icon: Plus, label: "createTitle" },
  backup: { icon: ShieldCheck, label: "backupTitle" },
} as const;

const WALLET_ACTION =
  "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink/80 transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50";

/** The unlocked person, the asset in use and both private wallets with their balances. */
export function ShieldedAssetOverview({
  person,
  assetControls,
  symbol,
  busy,
  onRecover,
  onLock,
  wallets,
  selectionDisabled,
  onSelectWallet,
  fundsKeyState,
  onReceiveCode,
  onOpenFundsKey,
  openSheet,
  footer,
}: {
  person: {
    name: string;
    /** Initials for a person; a funds-only session shows the key glyph instead. */
    avatar?: string;
    hash: string;
    hashLabel: string;
    copyLabel: string;
    onCopy: () => void;
  };
  assetControls?: ReactNode;
  symbol: string;
  busy: boolean;
  onRecover: () => void;
  onLock: () => void;
  wallets: readonly ShieldedOverviewWallet[];
  selectionDisabled: boolean;
  onSelectWallet: (slot: ShieldedKeySlot) => void;
  /**
   * Only a usable funds key offers receiving and its key settings. A new key first
   * offers its mandatory backup; otherwise the card offers unlocking or creating one.
   */
  fundsKeyState: "ready" | "backup" | "setup";
  onReceiveCode: (slot: ShieldedKeySlot) => void;
  onOpenFundsKey: (flow: ShieldedFundsKeyFlow) => void;
  /** The wallet sheet that is open, so its trigger reports that it is expanded. */
  openSheet: ShieldedWalletSheetState | null;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const selectionName = useId();
  const utility =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";
  return (
    <section
      aria-label={t("shielded.balanceTitle", { symbol })}
      className="min-w-0 rounded-[20px] border border-hairline bg-surface p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-2 pb-4 pt-2 sm:px-3">
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
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
              <span className="shrink-0">{person.hashLabel}</span>
              <code className="min-w-0 truncate font-mono text-ink/80" title={person.hash}>
                {shortHex(person.hash)}
              </code>
              <CopyIconButton size="xs" label={person.copyLabel} onClick={person.onCopy} />
            </div>
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
      <div
        role="radiogroup"
        aria-label={tr("walletBalances")}
        className="-mx-2 flex snap-x snap-mandatory gap-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {wallets.map((wallet) => {
          const title = tr(wallet.slot === "identity" ? "identityFunds" : "budgetFunds");
          const Icon = wallet.slot === "identity" ? Fingerprint : KeyRound;
          const longBalance = wallet.available.length > 14 || wallet.budget.length > 14;
          const receiveOpen = openSheet?.kind === "receiveCode" && openSheet.slot === wallet.slot;
          return (
            <div
              key={wallet.slot}
              role="group"
              aria-label={title}
              className={`flex w-[85%] min-w-0 shrink-0 snap-start flex-col gap-5 rounded-[14px] border-[1.5px] px-4 pb-3 pt-4 transition-colors sm:w-auto sm:px-5 sm:pt-[18px] ${
                wallet.current
                  ? "border-orange-300 bg-orange-50/70 dark:border-orange-400/40 dark:bg-orange-400/[0.06]"
                  : "border-hairline bg-surface"
              }`}
            >
              <label
                className={`flex min-w-0 items-center gap-3 ${selectionDisabled ? "cursor-default" : "cursor-pointer"}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                    wallet.current
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
                      : "bg-surface-alt text-ink-muted"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        wallet.unlocked ? "bg-success" : "border border-ink-subtle"
                      }`}
                    />
                    {tr(wallet.unlocked ? "walletUnlocked" : "walletLocked")}
                  </span>
                  {wallet.fingerprint ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                      <span className="shrink-0">{tr("fundsFingerprint")}</span>
                      <code
                        className="min-w-0 truncate font-mono text-ink/80"
                        title={wallet.fingerprint}
                      >
                        {shortHex(wallet.fingerprint)}
                      </code>
                    </span>
                  ) : null}
                </span>
                {wallet.current ? (
                  <span className={BADGE_ACCENT}>{tr("currentWallet")}</span>
                ) : null}
                <input
                  type="radio"
                  name={selectionName}
                  value={wallet.slot}
                  className={`${CHOICE_INPUT} h-[18px] w-[18px]`}
                  checked={wallet.checked}
                  disabled={selectionDisabled}
                  onChange={() => onSelectWallet(wallet.slot)}
                  aria-label={title}
                />
              </label>
              <dl
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
                  <dt className="text-xs text-ink-muted">
                    {t("shielded.budgetAmount", { symbol })}
                  </dt>
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
              <div
                className={`mt-auto flex flex-wrap gap-1 border-t pt-2.5 ${
                  wallet.current
                    ? "border-orange-200/70 dark:border-orange-400/20"
                    : "border-hairline/70"
                }`}
              >
                {wallet.slot === "asset" && fundsKeyState !== "ready" ? (
                  (fundsKeyState === "backup"
                    ? (["backup"] as const)
                    : (["restore", "create"] as const)
                  ).map((flow) => {
                    const { icon: FlowIcon, label } = FUNDS_KEY_ACTIONS[flow];
                    return (
                      <button
                        key={flow}
                        type="button"
                        className={WALLET_ACTION}
                        disabled={busy}
                        aria-expanded={openSheet?.kind === "keys" && openSheet.flow === flow}
                        onClick={() => onOpenFundsKey(flow)}
                      >
                        <FlowIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {tr(label)}
                      </button>
                    );
                  })
                ) : (
                  <>
                    <button
                      type="button"
                      className={WALLET_ACTION}
                      disabled={busy}
                      aria-expanded={receiveOpen}
                      aria-label={tr(
                        wallet.slot === "identity" ? "identityReceiveCode" : "fundsReceiveCode",
                      )}
                      onClick={() => onReceiveCode(wallet.slot)}
                    >
                      <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("shielded.actions.receiveCode", { symbol })}
                    </button>
                    {wallet.slot === "asset" ? (
                      <button
                        type="button"
                        className={WALLET_ACTION}
                        disabled={busy}
                        aria-expanded={openSheet?.kind === "keys"}
                        aria-label={tr("keySettings")}
                        onClick={() => onOpenFundsKey("backup")}
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {tr("keySettings")}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {footer ? <div className="px-2 pb-1 pt-3 text-xs sm:px-3">{footer}</div> : null}
    </section>
  );
}
