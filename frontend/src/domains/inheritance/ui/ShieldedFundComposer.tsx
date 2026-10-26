import { useTranslation } from "react-i18next";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  ShieldedReceiveCodeInput,
  ShieldedValueNotePicker,
  type ShieldedValueBalance,
} from "./ShieldedWalletActions";
import {
  CHOICE_INPUT,
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  TaskHeader,
  TaskSection,
} from "./inheritanceControls";

export interface ShieldedFundComposerProps {
  titleId: string;
  symbol: string;
  decimals: number;
  busy: boolean;
  rule: string;
  onRuleChange: (value: string) => void;
  /** The schedule the pasted rule fixes, once it parses. */
  rate?: bigint;
  periodDays?: bigint;
  periods: string;
  onPeriodsChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  values: readonly ShieldedValueBalance[];
  selected: string;
  onSelectedChange: (commitment: string) => void;
  letterEnabled: boolean;
  onLetterEnabledChange: (enabled: boolean) => void;
  letterBody: string;
  onLetterBodyChange: (body: string) => void;
  lettersConfigured: boolean;
}

/** The family's budget rule, then the child's receive code, then the balance it is paid from. */
export function ShieldedFundComposer(props: ShieldedFundComposerProps) {
  const { t } = useTranslation();
  const { symbol, decimals, busy, titleId } = props;

  return (
    <>
      <TaskHeader
        id={titleId}
        title={t("shielded.actions.fund", { symbol })}
        description={t("shielded.descriptions.fund", { symbol })}
      />

      <section
        aria-labelledby={`${titleId}-letter`}
        className="space-y-3 rounded-xl bg-surface-alt p-4"
      >
        <h3 id={`${titleId}-letter`} className="text-sm font-semibold text-ink">
          {t("shielded.privateLetters.budgetLetterTitle")}
        </h3>
        {props.lettersConfigured ? (
          <>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className={CHOICE_INPUT}
                checked={props.letterEnabled}
                disabled={busy}
                onChange={(event) => props.onLetterEnabledChange(event.target.checked)}
              />
              {t("shielded.privateLetters.includeLetter")}
            </label>
            {props.letterEnabled ? (
              <>
                <FieldBlock label={t("shielded.privateLetters.body")}>
                  <textarea
                    aria-label={t("shielded.privateLetters.body")}
                    className={FIELD_TEXTAREA}
                    rows={6}
                    value={props.letterBody}
                    disabled={busy}
                    onChange={(event) => props.onLetterBodyChange(event.target.value)}
                  />
                </FieldBlock>
                <p className="text-xs text-ink-muted">
                  {t("shielded.privateLetters.twoTransactions")}
                </p>
              </>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-muted">{t("shielded.privateLetters.notConfigured")}</p>
        )}
      </section>

      <TaskSection
        id={`${titleId}-rule`}
        step={1}
        title={t("shielded.fields.fundingRule", { symbol })}
      >
        <FieldBlock label={t("walletProtocol.rule")}>
          <textarea
            aria-label={t("walletProtocol.rule")}
            className={`${FIELD_TEXTAREA} min-h-20`}
            value={props.rule}
            disabled={busy}
            spellCheck={false}
            rows={3}
            onChange={(event) => props.onRuleChange(event.target.value)}
          />
        </FieldBlock>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(8.25rem,100%),1fr))] gap-3">
          {props.rate !== undefined && props.periodDays !== undefined ? (
            <>
              <FieldBlock label={t("shielded.fields.rate", { symbol })}>
                <p
                  role="status"
                  className="flex h-11 items-center rounded-[10px] bg-surface-alt px-3 text-[15px] tabular-nums text-ink"
                >
                  {formatShieldedAmount(props.rate, decimals)}
                </p>
              </FieldBlock>
              <FieldBlock label={t("shielded.fields.periodDays", { symbol })}>
                <p
                  role="status"
                  className="flex h-11 items-center rounded-[10px] bg-surface-alt px-3 text-sm text-ink"
                >
                  {t("shielded.periodDaysSummary", { symbol, days: String(props.periodDays) })}
                </p>
              </FieldBlock>
            </>
          ) : null}
          <FieldBlock label={t("shielded.fields.periods", { symbol })}>
            <input
              aria-label={t("shielded.fields.periods", { symbol })}
              className={FIELD_INPUT}
              inputMode="numeric"
              value={props.periods}
              disabled={busy}
              onChange={(event) => props.onPeriodsChange(event.target.value)}
            />
          </FieldBlock>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {t("shielded.fundingRuleHint", { symbol })}
        </p>
      </TaskSection>

      <TaskSection
        id={`${titleId}-code`}
        step={2}
        title={t("shielded.receiveCodeInputLabel", { symbol })}
      >
        <ShieldedReceiveCodeInput
          code={props.code}
          onChange={props.onCodeChange}
          disabled={busy}
          hideLabel
        />
      </TaskSection>

      <TaskSection
        id={`${titleId}-balance`}
        step={3}
        title={t("shielded.fields.valueCandidates", { symbol })}
      >
        <ShieldedValueNotePicker
          notes={props.values}
          selected={props.selected}
          onChange={props.onSelectedChange}
          decimals={decimals}
          symbol={symbol}
          busy={busy}
          legendHidden
        />
      </TaskSection>
    </>
  );
}
