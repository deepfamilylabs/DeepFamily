import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Fingerprint,
  CalendarDays,
  KeyRound,
  LockKeyhole,
  LockOpen,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { ShieldedKeySlot } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { CopyIconButton } from "../../../shared/ui";
import { CHOICE_INPUT, shortHex } from "./inheritanceControls";

export type ShieldedIndependentKeyFlow = "restore" | "create" | "backup";

export type ShieldedOverviewWallet = {
  slot: ShieldedKeySlot;
  unlocked: boolean;
  available: string;
  budget: string;
  /** Only an actual balance recovery marks a wallet as loading or updating. */
  balanceState?: "loading" | "updating";
  /** The wallet every deposit, spend and claim uses. */
  current: boolean;
  /**
   * Its selector is checked only while the loaded independent key is the pinned one, so a
   * replacement key has to be accepted by choosing the wallet again.
   */
  checked: boolean;
  /** The independent key this wallet is pinned to, which a replacement key never takes over. */
  fingerprint?: string;
};

export type ShieldedWalletSheetState =
  | { kind: "receiveCode" | "fundReceiveCredential"; slot: ShieldedKeySlot }
  | { kind: "keys"; flow: ShieldedIndependentKeyFlow };

const WALLET_ICON = { identity: Fingerprint, independent: KeyRound } as const;

const INDEPENDENT_KEY_ACTIONS = {
  restore: { icon: LockOpen, label: "restoreTitle" },
  create: { icon: Plus, label: "createTitle" },
} as const;

const WALLET_ACTION =
  "relative z-20 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8";

/** The unlocked person, the asset in use and both private wallets with their balances. */
export function ShieldedAssetOverview({
  person,
  assetControls,
  syncStatus,
  symbol,
  busy,
  onRecover,
  onLock,
  wallets,
  selectionDisabled,
  onSelectWallet,
  independentKeyState,
  onReceiveCode,
  onReceiveBudget,
  onOpenIndependentKey,
  openSheet,
  footer,
}: {
  person: {
    name: string;
    /** Initials for a person; a independent-key-only session shows the key glyph instead. */
    avatar?: string;
    hash: string;
    hashLabel: string;
    copyLabel: string;
    onCopy: () => void;
  };
  assetControls?: ReactNode;
  syncStatus?: ReactNode;
  symbol: string;
  busy: boolean;
  onRecover: () => void;
  onLock: () => void;
  wallets: readonly ShieldedOverviewWallet[];
  selectionDisabled: boolean;
  onSelectWallet: (slot: ShieldedKeySlot) => void;
  /**
   * Until setup is completed, the card keeps its original unlock/create actions.
   * Intermediate backup steps belong to key management, not the overview.
   */
  independentKeyState: "ready" | "setup";
  onReceiveCode: (slot: ShieldedKeySlot) => void;
  onReceiveBudget: (slot: ShieldedKeySlot) => void;
  onOpenIndependentKey: (flow: ShieldedIndependentKeyFlow) => void;
  /** The wallet sheet that is open, so its trigger reports that it is expanded. */
  openSheet: ShieldedWalletSheetState | null;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const selectionName = useId();
  const tabsId = useId();
  // Mobile tabs and desktop wallet cards choose the wallet used by the task below.
  const shown = wallets.find((wallet) => wallet.current)?.slot ?? wallets[0]?.slot;
  const activateWallet = (wallet: ShieldedOverviewWallet) => {
    // Clicking the current tab preserves the draft. A replacement independent key
    // still requires an explicit selection, even when its slot is already current.
    if (!selectionDisabled && !wallet.checked) onSelectWallet(wallet.slot);
  };
  const walletTitle = (slot: ShieldedKeySlot) =>
    tr(slot === "identity" ? "identityCredentials" : "independentKey");
  const utility =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";
  // Phone tabs share an edge with their content; desktop cards are selectable in full.
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
        <div className="flex h-8 w-full min-w-0 items-center justify-end">
          {syncStatus}
        </div>
      </div>
      <div
        role="tablist"
        aria-label={tr("walletBalances")}
        className="flex overflow-hidden rounded-t-[14px] border-x-[1.5px] border-t-[1.5px] border-b border-hairline bg-surface sm:hidden"
      >
        {wallets.map((wallet, index) => {
          const selected = wallet.slot === shown;
          const Icon = WALLET_ICON[wallet.slot];
          return (
            <button
              key={wallet.slot}
              type="button"
              role="tab"
              id={`${tabsId}-${wallet.slot}-tab`}
              aria-selected={selected}
              aria-controls={`${tabsId}-${wallet.slot}`}
              tabIndex={selected ? 0 : -1}
              disabled={selectionDisabled}
              className={`relative flex min-h-[52px] min-w-0 flex-1 basis-0 items-center justify-center gap-2 px-3 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "font-semibold text-orange-700 dark:text-orange-300"
                  : "font-medium text-ink-muted hover:bg-surface-alt hover:text-ink"
              }`}
              onClick={() => activateWallet(wallet)}
              onKeyDown={(event) => {
                if (selectionDisabled) return;
                let nextIndex: number;
                switch (event.key) {
                  case "ArrowLeft":
                    nextIndex = (index - 1 + wallets.length) % wallets.length;
                    break;
                  case "ArrowRight":
                    nextIndex = (index + 1) % wallets.length;
                    break;
                  case "Home":
                    nextIndex = 0;
                    break;
                  case "End":
                    nextIndex = wallets.length - 1;
                    break;
                  default:
                    return;
                }
                event.preventDefault();
                const next = wallets[nextIndex];
                activateWallet(next);
                document.getElementById(`${tabsId}-${next.slot}-tab`)?.focus();
              }}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{walletTitle(wallet.slot)}</span>
              {selected ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 left-1/2 h-[3px] w-9 -translate-x-1/2 rounded-full bg-orange-600 dark:bg-primary"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        role="radiogroup"
        aria-label={tr("walletBalances")}
        className="sm:grid sm:grid-cols-2 sm:gap-4"
      >
        {wallets.map((wallet) => {
          const title = walletTitle(wallet.slot);
          const Icon = WALLET_ICON[wallet.slot];
          const longBalance = wallet.available.length > 14 || wallet.budget.length > 14;
          const receiveOpen = openSheet?.kind === "receiveCode" && openSheet.slot === wallet.slot;
          const budgetReceiveOpen = openSheet?.kind === "fundReceiveCredential" && openSheet.slot === wallet.slot;
          const selectionId = `${selectionName}-${wallet.slot}`;
          const needsKeySetup = wallet.slot === "independent" && independentKeyState !== "ready";
          const canReceive = wallet.unlocked && !needsKeySetup;
          const unavailableHint = tr(
            wallet.slot === "identity"
              ? "receiveCodeNeedsIdentity"
              : "receiveCodeNeedsKey",
          );
          return (
            <div
              key={wallet.slot}
              id={`${tabsId}-${wallet.slot}`}
              role="group"
              aria-label={title}
              className={`relative flex min-w-0 flex-col gap-5 rounded-b-[14px] border-x-[1.5px] border-b-[1.5px] border-hairline bg-surface px-4 pb-3 pt-4 transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary/40 sm:rounded-[14px] sm:border-[1.5px] sm:px-5 sm:pt-[18px] ${
                wallet.slot === shown ? "" : "max-sm:hidden"
              } ${selectionDisabled ? "sm:cursor-not-allowed" : "sm:cursor-pointer"} ${
                wallet.checked
                  ? "sm:border-orange-400 sm:bg-orange-50/60 sm:dark:border-orange-400/70 sm:dark:bg-orange-400/[0.06]"
                  : selectionDisabled
                    ? ""
                    : "sm:hover:border-orange-300 sm:hover:bg-surface-alt sm:dark:hover:border-orange-400/50"
              }`}
            >
              <label
                htmlFor={selectionId}
                className={`absolute inset-0 z-10 hidden rounded-[inherit] sm:block ${selectionDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span className="sr-only">{title}</span>
              </label>
              <div
                className={`space-y-2 ${wallet.unlocked && !wallet.fingerprint && !needsKeySetup ? "max-sm:hidden" : ""}`}
              >
                <div className="hidden min-h-7 min-w-0 items-center gap-3 sm:flex">
                  <span className="min-w-0 flex-1">
                    <span
                      className={`flex items-center gap-2 text-[15px] font-semibold ${
                        wallet.checked ? "text-orange-700 dark:text-orange-300" : "text-ink"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {title}
                    </span>
                  </span>
                  {wallet.current ? <span className="sr-only">{tr("currentWallet")}</span> : null}
                  <input
                    id={selectionId}
                    type="radio"
                    name={selectionName}
                    value={wallet.slot}
                    className={`${CHOICE_INPUT} h-[18px] w-[18px]`}
                    checked={wallet.checked}
                    disabled={selectionDisabled}
                    onChange={() => activateWallet(wallet)}
                    aria-label={title}
                  />
                </div>
                {needsKeySetup ? (
                  <div className="-ml-2 flex min-w-0 flex-wrap gap-1">
                    {(["restore", "create"] as const).map((flow) => {
                      const { icon: FlowIcon, label } = INDEPENDENT_KEY_ACTIONS[flow];
                      return (
                        <button
                          key={flow}
                          type="button"
                          className={`${WALLET_ACTION} text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200`}
                          disabled={busy}
                          aria-expanded={openSheet?.kind === "keys" && openSheet.flow === flow}
                          onClick={() => onOpenIndependentKey(flow)}
                        >
                          <FlowIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {tr(label)}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p
                    className={`items-center gap-1.5 text-xs text-ink-muted ${wallet.unlocked ? "hidden sm:flex" : "flex"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${wallet.unlocked ? "bg-success" : "border border-ink-subtle"}`}
                    />
                    {tr(wallet.unlocked ? "walletUnlocked" : "walletLocked")}
                  </p>
                )}
                {wallet.fingerprint ? (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                    <span className="shrink-0">{tr("keyFingerprint")}</span>
                    <code
                      className="min-w-0 truncate font-mono text-ink/80"
                      title={wallet.fingerprint}
                    >
                      {shortHex(wallet.fingerprint)}
                    </code>
                  </p>
                ) : null}
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
                <div className="mt-2 min-h-4 text-xs leading-4 text-ink-muted">
                  {wallet.balanceState ? (
                    <span role="status">
                      {t(wallet.balanceState === "loading"
                        ? "shielded.publicStateSync.balanceLoading"
                        : "shielded.publicStateSync.balanceUpdating")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-hairline/70 pt-2.5">
                {canReceive ? (
                  <>
                    <button
                      type="button"
                      className={`${WALLET_ACTION} text-ink/80 hover:text-ink`}
                      disabled={busy}
                      aria-expanded={receiveOpen}
                      aria-label={tr(
                        wallet.slot === "identity"
                          ? "identityReceiveCode"
                          : "independentKeyReceiveCode",
                      )}
                      onClick={() => onReceiveCode(wallet.slot)}
                    >
                      <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("shielded.actions.receiveCode", { symbol })}
                    </button>
                    <button
                      type="button"
                      className={`${WALLET_ACTION} text-ink/80 hover:text-ink`}
                      disabled={busy}
                      aria-expanded={budgetReceiveOpen}
                      aria-label={tr(wallet.slot === "identity" ? "identityFundReceiveCredential" : "independentKeyFundReceiveCredential")}
                      onClick={() => onReceiveBudget(wallet.slot)}
                    >
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      {tr("receiveBudget")}
                    </button>
                    {wallet.slot === "independent" ? (
                      <button
                        type="button"
                        className={`${WALLET_ACTION} text-ink/80 hover:text-ink`}
                        disabled={busy}
                        aria-expanded={openSheet?.kind === "keys"}
                        aria-label={tr("keySettings")}
                        onClick={() => onOpenIndependentKey("backup")}
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {tr("keySettings")}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div
                    role="status"
                    aria-label={tr(
                      wallet.slot === "identity"
                        ? "identityReceiveCode"
                        : "independentKeyReceiveCode",
                    )}
                    aria-describedby={`${selectionId}-receive-unavailable`}
                    title={unavailableHint}
                    className="relative z-20 inline-flex min-h-11 cursor-default items-center gap-1.5 px-2 text-[13px] text-ink-muted sm:min-h-8"
                  >
                    <QrCode className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                    <span>{t("shielded.actions.receiveCode", { symbol })}</span>
                    <span className="text-xs">{tr("receiveCodeUnavailable")}</span>
                    <span id={`${selectionId}-receive-unavailable`} className="sr-only">
                      {unavailableHint}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {footer ? <div className="pt-3 text-xs">{footer}</div> : null}
    </section>
  );
}
