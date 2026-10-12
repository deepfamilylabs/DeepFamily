import { useId, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { formatUnits } from "ethers";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";
import {
  FieldBlock,
  PanelButton,
  PanelShell,
  WarningNotice,
  radioOptionClassName,
} from "./inheritanceControls";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

export type ShieldedWalletAction = "shield" | "privateTransfer" | "unshield" | "receiveCode";
export type ShieldedRecipientInputMethod = "receiveCode" | "credentials";
export type ShieldedValueBalance = { commitment: string; amount: string };

export interface ShieldedRecipientInputProps {
  method: ShieldedRecipientInputMethod;
  onMethodChange: (method: ShieldedRecipientInputMethod) => void;
  code: string;
  codeHint?: string;
  onCodeChange: (value: string) => void;
  credentialsFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  onGenerateCode: () => void;
  busy: boolean;
}

/** Recipient by receive code, or by complete identity credentials that generate one locally. */
export function ShieldedRecipientInput({
  method,
  onMethodChange,
  code,
  codeHint,
  onCodeChange,
  credentialsFormRef,
  onGenerateCode,
  busy,
}: ShieldedRecipientInputProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">
          {t("shielded.recipientMethodLabel")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {(["receiveCode", "credentials"] as const).map((option) => (
            <label
              key={option}
              className={`${radioOptionClassName(method === option, busy)} text-ink`}
            >
              <input
                type="radio"
                name="shielded-recipient-method"
                value={option}
                checked={method === option}
                disabled={busy}
                onChange={() => onMethodChange(option)}
              />
              {t(`shielded.recipientMethods.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        {method === "receiveCode" ? (
          <FieldBlock label={t("shielded.receiveCodeInputLabel")} hint={codeHint}>
            <textarea
              aria-label={t("shielded.receiveCodeInputLabel")}
              className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              spellCheck={false}
              rows={3}
            />
          </FieldBlock>
        ) : (
          <div className="space-y-3">
            <ShieldedRecipientCredentialsForm ref={credentialsFormRef} />
            <PanelButton busy={busy} disabled={busy} onClick={onGenerateCode}>
              {t("shielded.generateReceiveCode")}
            </PanelButton>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** Public balance summaries replace note openings without changing the balance picker. */
export function ShieldedValueNotePicker({
  notes,
  selectedCommitments,
  onChange,
  maxInputs,
  decimals,
  symbol,
  busy,
}: {
  notes: readonly ShieldedValueBalance[];
  selectedCommitments: readonly string[];
  onChange: (commitments: string[]) => void;
  maxInputs?: number;
  decimals: number;
  symbol: string;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const radioGroupName = useId();
  const singleChoice = maxInputs === 1;
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
    if (singleChoice && checked) onChange([commitment]);
    else if (!checked) onChange(selectedCommitments.filter((value) => value !== commitment));
    else if (
      (maxInputs === undefined || selectedCommitments.length < maxInputs) &&
      !selectedCommitments.includes(commitment)
    )
      onChange([...selectedCommitments, commitment]);
  };
  return (
    <fieldset
      disabled={busy}
      role={singleChoice ? "radiogroup" : undefined}
      className="min-w-0 space-y-3"
    >
      <legend className="text-sm font-medium text-ink">
        {t("shielded.fields.valueNote", { symbol })}
      </legend>
      <p className="text-xs text-ink-muted">
        {singleChoice
          ? t("shielded.singleValueSelectionHint", { symbol })
          : t("shielded.walletKeys.valueCandidatesHint", { symbol })}
      </p>
      {values.length === 0 && missing.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("shielded.noRecoveredNote", { symbol })}</p>
      ) : null}
      {values.map((item, index) => {
        const commitment = item.commitment;
        const checked = selectedCommitments.includes(commitment);
        return (
          <label
            key={commitment}
            className={
              singleChoice
                ? `${radioOptionClassName(checked, busy)} text-ink`
                : "flex items-center gap-3 text-sm text-ink"
            }
          >
            <input
              type={singleChoice ? "radio" : "checkbox"}
              name={singleChoice ? radioGroupName : undefined}
              value={commitment}
              className="shrink-0"
              checked={checked}
              disabled={
                !singleChoice &&
                !checked &&
                maxInputs !== undefined &&
                selectedCommitments.length >= maxInputs
              }
              onChange={(event) => toggle(commitment, event.target.checked)}
            />
            <span className="min-w-0 break-words">
              {t("shielded.valueOption", {
                symbol,
                index: index + 1,
                amount: formatUnits(BigInt(item.amount), decimals),
              })}
            </span>
          </label>
        );
      })}
      {missing.map((commitment) =>
        singleChoice ? (
          <div key={commitment} className={`${radioOptionClassName(true, busy)} text-danger`}>
            <input
              type="radio"
              name={radioGroupName}
              value={commitment}
              checked
              disabled
              aria-label={t("shielded.singleSelectedValueUnavailable", { symbol })}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 break-words">
              {t("shielded.singleSelectedValueUnavailable", { symbol })}
            </span>
            <button
              type="button"
              disabled={busy}
              className="shrink-0 text-primary hover:underline"
              onClick={() => onChange([])}
            >
              {t("shielded.clearValueSelection", { symbol })}
            </button>
          </div>
        ) : (
          <label key={commitment} className="flex items-center gap-3 text-sm text-danger">
            <input type="checkbox" checked onChange={() => toggle(commitment, false)} />
            <span>{t("shielded.selectedValueUnavailable", { symbol })}</span>
          </label>
        ),
      )}
      {selectedCommitments.length > 0 && missing.length === 0 ? (
        <p aria-live="polite" className="break-words text-xs text-ink-muted">
          {t(
            singleChoice
              ? "shielded.singleValueSelectionSummary"
              : "shielded.valueSelectionSummary",
            { symbol, count: selectedCommitments.length, amount: formatUnits(total, decimals) },
          )}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface ShieldedWalletActionsProps {
  action: ShieldedWalletAction;
  symbol: string;
  decimals: number;
  busy: boolean;
  amount: string;
  onAmountChange: (value: string) => void;
  ownReceiveCode: string;
  recipient: Omit<ShieldedRecipientInputProps, "busy"> & {
    targetHash?: string;
    targetName?: string;
    needsConfirmation: boolean;
    confirmed: boolean;
    onConfirmedChange: (value: boolean) => void;
  };
  withdrawalRecipient: string;
  onWithdrawalRecipientChange: (value: string) => void;
  values: readonly ShieldedValueBalance[];
  selectedCommitments: readonly string[];
  onSelectedCommitmentsChange: (commitments: string[]) => void;
  signerReady: boolean;
  /** An ERC20 deposit first approves the amount, then offers deposit confirmation. */
  approvalRequired?: boolean;
  submitDisabled?: boolean;
  /** The receive-code form replaces its action until the selected key is ready. */
  submitHidden?: boolean;
  onSubmit: () => void;
  feedback?: ReactNode;
  receivingSettings?: ReactNode;
  /** Explicit deposit destination or payment owner. */
  fundsSource?: ReactNode;
}

/** Deposit, private transfer, withdrawal and receive-code forms for the selected funds. */
export function ShieldedWalletActions({
  action,
  symbol,
  decimals,
  busy,
  amount,
  onAmountChange,
  ownReceiveCode,
  recipient,
  withdrawalRecipient,
  onWithdrawalRecipientChange,
  values,
  selectedCommitments,
  onSelectedCommitmentsChange,
  signerReady,
  approvalRequired = false,
  submitDisabled = false,
  submitHidden = false,
  onSubmit,
  feedback,
  receivingSettings,
  fundsSource,
}: ShieldedWalletActionsProps) {
  const { t } = useTranslation();
  const withdrawalSelectionAvailable =
    selectedCommitments.length > 0 &&
    selectedCommitments.every((commitment) =>
      values.some((note) => note.commitment === commitment && BigInt(note.amount) > 0n),
    );
  const recipientNeedsConfirmation = action === "privateTransfer" && recipient.needsConfirmation;
  return (
    <PanelShell
      title={
        action === "receiveCode"
          ? t("shielded.actions.receiveCode", { symbol })
          : t(`shielded.actionTitles.${action}`, { symbol })
      }
    >
      {action === "receiveCode" ? receivingSettings : fundsSource}
      {action === "receiveCode" && ownReceiveCode ? (
        <FieldBlock
          label={t("shielded.receiveCodeLabel", { symbol })}
          hint={t("shielded.receiveCodeShareHint", { symbol })}
        >
          <textarea
            aria-label={t("shielded.receiveCodeLabel", { symbol })}
            className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
            readOnly
            value={ownReceiveCode}
            rows={4}
          />
        </FieldBlock>
      ) : null}

      {action === "shield" ? (
        <FieldBlock label={t("shielded.fields.amount", { symbol })}>
          <input
            aria-label={t("shielded.fields.amount", { symbol })}
            className={INPUT_CLASS}
            inputMode="decimal"
            disabled={busy}
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder="100"
          />
        </FieldBlock>
      ) : null}

      {action === "privateTransfer" ? (
        <>
          <ShieldedRecipientInput {...recipient} busy={busy} />
          {recipient.method === "receiveCode" && recipient.targetHash ? (
            <div className="space-y-2 break-all rounded-xl bg-surface-alt p-3 text-sm text-ink">
              <p>
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
                  <p className="text-xs text-warning">
                    {t("shielded.recipientTargetUnverified", { symbol })}
                  </p>
                  <label className="flex items-start gap-3 break-normal">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={recipient.confirmed}
                      disabled={busy}
                      onChange={(event) => recipient.onConfirmedChange(event.target.checked)}
                    />
                    <span>{t("shielded.recipientConfirm", { symbol })}</span>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
          <FieldBlock label={t("shielded.fields.transferAmount", { symbol })}>
            <input
              aria-label={t("shielded.fields.transferAmount", { symbol })}
              className={INPUT_CLASS}
              inputMode="decimal"
              disabled={busy}
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
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

      {action === "unshield" ? (
        <>
          <FieldBlock label={t("shielded.fields.amount", { symbol })}>
            <input
              aria-label={t("shielded.fields.amount", { symbol })}
              className={INPUT_CLASS}
              inputMode="decimal"
              disabled={busy}
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={t("shielded.fields.exitRecipient", { symbol })}>
            <input
              aria-label={t("shielded.fields.exitRecipient", { symbol })}
              className={INPUT_CLASS}
              disabled={busy}
              value={withdrawalRecipient}
              onChange={(event) => onWithdrawalRecipientChange(event.target.value)}
              placeholder="0x…"
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

      {!signerReady && action !== "receiveCode" ? (
        <WarningNotice>{t("shielded.walletNotReady", { symbol })}</WarningNotice>
      ) : null}
      {submitHidden ? null : (
        <PanelButton
          variant="primary"
          busy={busy}
          disabled={
            busy ||
            submitDisabled ||
            (!signerReady && action !== "receiveCode") ||
            (recipientNeedsConfirmation && !recipient.confirmed) ||
            (action === "privateTransfer" && selectedCommitments.length === 0) ||
            (action === "unshield" && !withdrawalSelectionAvailable)
          }
          onClick={onSubmit}
        >
          {action === "shield" && approvalRequired
            ? t("shielded.walletKeys.approve")
            : t("shielded.submit", { symbol, action: t(`shielded.actions.${action}`, { symbol }) })}
        </PanelButton>
      )}
      {feedback}
    </PanelShell>
  );
}
