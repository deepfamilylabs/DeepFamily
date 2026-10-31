import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";
import {
  CHOICE_INPUT,
  FIELD_BASE,
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  PanelButton,
  TaskHeader,
  choiceCardClass,
} from "./inheritanceControls";

export type ShieldedWalletAction = "shield" | "privateTransfer" | "unshield";
export type ShieldedRecipientInputMethod = "receiveCode" | "credentials";
export type ShieldedValueBalance = { commitment: string; amount: string };

export interface ShieldedRecipientInputProps {
  purpose?: "receive" | "fund";
  method: ShieldedRecipientInputMethod;
  onMethodChange: (method: ShieldedRecipientInputMethod) => void;
  code: string;
  codeHint?: string;
  codeError?: string;
  onCodeChange: (value: string) => void;
  credentialsFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  onGenerateCode: () => void;
  busy: boolean;
  /** Shown under the code once it verifies, such as the recipient it belongs to. */
  verification?: ReactNode;
}

/** Recipient by receive code, or by complete identity credentials that generate one locally. */
export function ShieldedRecipientInput({
  purpose = "receive",
  method,
  onMethodChange,
  code,
  codeHint,
  codeError,
  onCodeChange,
  credentialsFormRef,
  onGenerateCode,
  busy,
  verification,
}: ShieldedRecipientInputProps) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-4">
      <fieldset className="min-w-0 space-y-2" disabled={busy}>
        <legend className="mb-2 text-[13px] font-medium text-ink/80">
          {t("shielded.recipientMethodLabel")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(["receiveCode", "credentials"] as const).map((option) => (
            <label
              key={option}
              className={`flex min-h-10 items-center gap-2 px-3 text-[13px] text-ink ${choiceCardClass(method === option, busy)}`}
            >
              <input
                type="radio"
                name="shielded-recipient-method"
                value={option}
                className={CHOICE_INPUT}
                checked={method === option}
                onChange={() => onMethodChange(option)}
              />
              {purpose === "fund"
                ? option === "receiveCode"
                  ? t("shielded.fundRecipientMethods.receiveCode")
                  : t("shielded.fundRecipientMethods.credentials")
                : option === "receiveCode"
                  ? t("shielded.recipientMethods.receiveCode")
                  : t("shielded.recipientMethods.credentials")}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="min-w-0">
        {method === "receiveCode" ? (
          <ShieldedReceiveCodeInput
            purpose={purpose}
            code={code}
            hint={codeHint}
            error={codeError}
            onChange={onCodeChange}
            verification={verification}
          />
        ) : (
          <div className="space-y-3">
            <ShieldedRecipientCredentialsForm ref={credentialsFormRef} />
            <PanelButton busy={busy} disabled={busy} onClick={onGenerateCode}>
              {t(purpose === "fund" ? "shielded.generateFundReceiveCredential" : "shielded.generateReceiveCode")}
            </PanelButton>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** The recipient's receive code, with its verification and its hint on one line beneath. */
export function ShieldedReceiveCodeInput({
  purpose = "receive",
  code,
  hint,
  error,
  onChange,
  verification,
  disabled,
}: {
  purpose?: "receive" | "fund";
  code: string;
  hint?: string;
  error?: string;
  onChange: (value: string) => void;
  verification?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-2">
      <FieldBlock label={t(purpose === "fund" ? "shielded.fundReceiveCredentialInputLabel" : "shielded.receiveCodeInputLabel")}>
        <textarea
          aria-label={t(purpose === "fund" ? "shielded.fundReceiveCredentialInputLabel" : "shielded.receiveCodeInputLabel")}
          className={`${FIELD_TEXTAREA} min-h-20`}
          value={code}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          rows={3}
        />
      </FieldBlock>
      {error ? (
        <p role="alert" className="break-words text-xs text-danger">
          {error}
        </p>
      ) : null}
      {verification || hint ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {verification}
          {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A verified recipient chip: the check and the colour both say it matched. */
export function ShieldedRecipientChip({ children }: { children: ReactNode }) {
  return (
    <span
      role="status"
      className="inline-flex min-w-0 items-center gap-1.5 break-all rounded-full border border-success/30 bg-success/5 py-1 pl-2 pr-2.5 text-[13px] font-medium text-ink"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Permitted balances for a spend; the Worker plan decides what is actually used. */
export function ShieldedValueNotePicker({
  notes,
  selectedCommitments,
  onChange,
  decimals,
  symbol,
  busy,
}: {
  notes: readonly ShieldedValueBalance[];
  selectedCommitments: readonly string[];
  onChange: (commitments: string[]) => void;
  decimals: number;
  symbol: string;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const values = notes.filter((item) => BigInt(item.amount) > 0n);
  const missing = selectedCommitments.filter(
    (commitment) => !values.some((item) => item.commitment === commitment),
  );
  const total = values.reduce(
    (amount, item) =>
      selectedCommitments.includes(item.commitment) ? amount + BigInt(item.amount) : amount,
    0n,
  );
  const toggle = (commitment: string, checked: boolean) => {
    if (!checked) onChange(selectedCommitments.filter((value) => value !== commitment));
    else if (!selectedCommitments.includes(commitment))
      onChange([...selectedCommitments, commitment]);
  };
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-2.5">
      <legend className="mb-1 text-[13px] font-medium text-ink/80">
        {t("shielded.fields.valueCandidates", { symbol })}
      </legend>
      <p className="text-xs leading-relaxed text-ink-muted">
        {t("shielded.walletKeys.valueCandidatesHint", { symbol })}
      </p>
      {values.length === 0 && missing.length === 0 ? (
        <p className="rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink-muted">
          {t("shielded.noRecoveredNote", { symbol })}
        </p>
      ) : null}
      {values.length > 0 || missing.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(9.5rem,100%),1fr))] gap-1.5">
          {values.map((item, index) => {
            const checked = selectedCommitments.includes(item.commitment);
            return (
              <label
                key={item.commitment}
                className={`flex min-h-11 items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-xs leading-snug text-ink ${
                  checked
                    ? "border-orange-300 bg-orange-50 dark:border-orange-400/50 dark:bg-orange-400/10"
                    : "border-hairline bg-surface-alt"
                } ${busy ? "cursor-default" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  value={item.commitment}
                  className={`${CHOICE_INPUT} rounded`}
                  checked={checked}
                  onChange={(event) => toggle(item.commitment, event.target.checked)}
                />
                <span className="min-w-0 break-words">
                  {t("shielded.valueOption", {
                    symbol,
                    index: index + 1,
                    amount: formatShieldedAmount(item.amount, decimals),
                  })}
                </span>
              </label>
            );
          })}
          {missing.map((commitment) => (
            <label
              key={commitment}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger"
            >
              <input
                type="checkbox"
                className={`${CHOICE_INPUT} rounded`}
                checked
                onChange={() => toggle(commitment, false)}
              />
              <span className="min-w-0 break-words">
                {t("shielded.selectedValueUnavailable", { symbol })}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {selectedCommitments.length > 0 && missing.length === 0 ? (
        <p aria-live="polite" className="break-words text-xs text-ink-muted">
          {t("shielded.valueSelectionSummary", {
            symbol,
            count: selectedCommitments.length,
            amount: formatShieldedAmount(total, decimals),
          })}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface ShieldedWalletActionsProps {
  titleId: string;
  action: ShieldedWalletAction;
  symbol: string;
  decimals: number;
  busy: boolean;
  amount: string;
  onAmountChange: (value: string) => void;
  recipient: Omit<ShieldedRecipientInputProps, "busy" | "verification" | "codeHint"> & {
    targetHash?: string;
    targetName?: string;
    /** The receive code's proof has been checked. */
    verified: boolean;
    needsConfirmation: boolean;
    confirmed: boolean;
    onConfirmedChange: (value: boolean) => void;
  };
  withdrawalRecipient: string;
  onWithdrawalRecipientChange: (value: string) => void;
  values: readonly ShieldedValueBalance[];
  selectedCommitments: readonly string[];
  onSelectedCommitmentsChange: (commitments: string[]) => void;
}

/** Deposit, private transfer and withdrawal forms; the receipt beside them confirms. */
export function ShieldedWalletActions({
  titleId,
  action,
  symbol,
  decimals,
  busy,
  amount,
  onAmountChange,
  recipient,
  withdrawalRecipient,
  onWithdrawalRecipientChange,
  values,
  selectedCommitments,
  onSelectedCommitmentsChange,
}: ShieldedWalletActionsProps) {
  const { t } = useTranslation();
  const amountField = (label: string) => (
    <div className="max-w-xs">
      <FieldBlock label={label}>
        <input
          aria-label={label}
          className={FIELD_INPUT}
          inputMode="decimal"
          disabled={busy}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder={action === "shield" ? "100" : undefined}
        />
      </FieldBlock>
    </div>
  );
  const recipientNeedsConfirmation = action === "privateTransfer" && recipient.needsConfirmation;
  const target =
    action === "privateTransfer" && recipient.method === "receiveCode" && recipient.targetHash ? (
      recipient.verified && recipient.targetName ? (
        <div
          role="status"
          className="space-y-1 rounded-xl border border-success/30 bg-success/5 px-3.5 py-3 text-sm text-ink"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            {t("shielded.recipientTarget", { symbol, identity: recipient.targetName })}
          </p>
          <p className="break-all font-mono text-xs text-ink-muted">{recipient.targetHash}</p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink">
          <p className="break-all">
            {t("shielded.recipientTarget", {
              symbol,
              identity: recipient.targetName ?? recipient.targetHash,
            })}
            {recipient.targetName ? (
              <span className="mt-1 block font-mono text-xs text-ink-muted">
                {recipient.targetHash}
              </span>
            ) : null}
          </p>
          {recipientNeedsConfirmation ? (
            <>
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("shielded.recipientTargetUnverified", { symbol })}
              </p>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className={`${CHOICE_INPUT} mt-0.5 rounded`}
                  checked={recipient.confirmed}
                  disabled={busy}
                  onChange={(event) => recipient.onConfirmedChange(event.target.checked)}
                />
                <span>{t("shielded.recipientConfirm", { symbol })}</span>
              </label>
            </>
          ) : null}
        </div>
      )
    ) : null;

  return (
    <>
      <TaskHeader id={titleId} title={t(`shielded.actionTitles.${action}`, { symbol })} />
      <div className="mt-6 min-w-0 space-y-6">
        {action === "shield" ? amountField(t("shielded.fields.amount", { symbol })) : null}

        {action === "privateTransfer" ? (
          <>
            <div className="space-y-3">
              <ShieldedRecipientInput {...recipient} busy={busy} />
              {target}
            </div>
            {amountField(t("shielded.fields.transferAmount", { symbol }))}
            <ShieldedValueNotePicker
              notes={values}
              selectedCommitments={selectedCommitments}
              onChange={onSelectedCommitmentsChange}
              decimals={decimals}
              symbol={symbol}
              busy={busy}
            />
          </>
        ) : null}

        {action === "unshield" ? (
          <>
            {amountField(t("shielded.fields.amount", { symbol }))}
            <FieldBlock label={t("shielded.fields.exitRecipient", { symbol })}>
              <input
                aria-label={t("shielded.fields.exitRecipient", { symbol })}
                className={`${FIELD_BASE} font-mono text-sm`}
                disabled={busy}
                value={withdrawalRecipient}
                onChange={(event) => onWithdrawalRecipientChange(event.target.value)}
                placeholder="0x…"
                spellCheck={false}
              />
            </FieldBlock>
            <ShieldedValueNotePicker
              notes={values}
              selectedCommitments={selectedCommitments}
              onChange={onSelectedCommitmentsChange}
              decimals={decimals}
              symbol={symbol}
              busy={busy}
            />
          </>
        ) : null}
      </div>
    </>
  );
}
