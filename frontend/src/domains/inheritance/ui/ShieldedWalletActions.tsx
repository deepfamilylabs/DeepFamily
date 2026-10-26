import { useTranslation } from "react-i18next";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  CHOICE_INPUT,
  FIELD_BASE,
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  TaskHeader,
} from "./inheritanceControls";

export type ShieldedWalletAction = "shield" | "privateTransfer" | "unshield";
export type ShieldedValueBalance = { commitment: string; amount: string };

/** The recipient's receive code, with its hint beneath. */
export function ShieldedReceiveCodeInput({
  code,
  hint,
  error,
  onChange,
  disabled,
  hideLabel = false,
}: {
  code: string;
  hint?: string;
  error?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Inside a section that already names the code. */
  hideLabel?: boolean;
}) {
  const { t } = useTranslation();
  const input = (
    <textarea
      aria-label={t("shielded.receiveCodeInputLabel")}
      className={`${FIELD_TEXTAREA} min-h-20`}
      value={code}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      rows={3}
    />
  );
  return (
    <div className="min-w-0 space-y-2">
      {hideLabel ? (
        input
      ) : (
        <FieldBlock label={t("shielded.receiveCodeInputLabel")}>{input}</FieldBlock>
      )}
      {error ? (
        <p role="alert" className="break-words text-xs text-danger">
          {error}
        </p>
      ) : null}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}

/** The balance a spend draws from; its unused part returns as change. */
export function ShieldedValueNotePicker({
  notes,
  selected,
  onChange,
  decimals,
  symbol,
  busy,
  legendHidden = false,
}: {
  notes: readonly ShieldedValueBalance[];
  selected: string;
  onChange: (commitment: string) => void;
  decimals: number;
  symbol: string;
  busy: boolean;
  /** Inside a section that already names the choice. */
  legendHidden?: boolean;
}) {
  const { t } = useTranslation();
  const values = notes.filter((item) => BigInt(item.amount) > 0n);
  const missing = selected && !values.some((item) => item.commitment === selected);
  const chosen = values.find((item) => item.commitment === selected);
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-2.5">
      <legend className={legendHidden ? "sr-only" : "mb-1 text-[13px] font-medium text-ink/80"}>
        {t("shielded.fields.valueCandidates", { symbol })}
      </legend>
      <p className="text-xs leading-relaxed text-ink-muted">
        {t("shielded.walletKeys.valueCandidatesHint", { symbol })}
      </p>
      {values.length === 0 && !missing ? (
        <p className="rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink-muted">
          {t("shielded.noRecoveredNote", { symbol })}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(9.5rem,100%),1fr))] gap-1.5">
          {values.map((item, index) => {
            const checked = item.commitment === selected;
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
                  type="radio"
                  value={item.commitment}
                  className={CHOICE_INPUT}
                  checked={checked}
                  onChange={() => onChange(item.commitment)}
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
          {missing ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger">
              <input type="radio" className={CHOICE_INPUT} checked onChange={() => onChange("")} />
              <span className="min-w-0 break-words">
                {t("shielded.selectedValueUnavailable", { symbol })}
              </span>
            </label>
          ) : null}
        </div>
      )}
      {chosen ? (
        <p aria-live="polite" className="break-words text-xs text-ink-muted">
          {t("shielded.valueSelectionSummary", {
            symbol,
            count: 1,
            amount: formatShieldedAmount(chosen.amount, decimals),
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
  code: string;
  onCodeChange: (value: string) => void;
  withdrawalRecipient: string;
  onWithdrawalRecipientChange: (value: string) => void;
  values: readonly ShieldedValueBalance[];
  selected: string;
  onSelectedChange: (commitment: string) => void;
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
  code,
  onCodeChange,
  withdrawalRecipient,
  onWithdrawalRecipientChange,
  values,
  selected,
  onSelectedChange,
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
  const picker = (
    <ShieldedValueNotePicker
      notes={values}
      selected={selected}
      onChange={onSelectedChange}
      decimals={decimals}
      symbol={symbol}
      busy={busy}
    />
  );

  return (
    <>
      <TaskHeader id={titleId} title={t(`shielded.actionTitles.${action}`, { symbol })} />
      <div className="mt-6 min-w-0 space-y-6">
        {action === "shield" ? amountField(t("shielded.fields.amount", { symbol })) : null}

        {action === "privateTransfer" ? (
          <>
            <ShieldedReceiveCodeInput code={code} onChange={onCodeChange} disabled={busy} />
            {amountField(t("shielded.fields.transferAmount", { symbol }))}
            {picker}
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
            {picker}
          </>
        ) : null}
      </div>
    </>
  );
}
