import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyIconButton } from "../../../shared/ui";
import { ThemedSelect } from "../../transactions/ui/shared/ThemedSelect";
import type { WalletQualificationView } from "../../../shared/workers/walletWorkerTypes";
import {
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  PanelButton,
  TaskHeader,
  TaskSection,
} from "./inheritanceControls";

export const SHIELDED_PERIOD_DAY_PRESETS = [1, 7, 14, 21, 30, 90, 180, 365] as const;

export interface ShieldedRuleComposerProps {
  titleId: string;
  symbol: string;
  busy: boolean;
  qualifications: readonly WalletQualificationView[];
  credentialIndex: string;
  onCredentialChange: (value: string) => void;
  rate: string;
  onRateChange: (value: string) => void;
  periodDays: string;
  onPeriodDaysChange: (value: string) => void;
  /** Whether the inputs describe a rule that can be created. */
  ready: boolean;
  onCreate: () => void;
  rule: string;
  onCopy: (rule: string) => void;
}

/** A qualified family member fixes a budget schedule and shares it with payers. */
export function ShieldedRuleComposer(props: ShieldedRuleComposerProps) {
  const { t } = useTranslation();
  const { symbol, busy, titleId } = props;
  const periodLabelId = useId();
  const [customPeriodDays, setCustomPeriodDays] = useState(
    !SHIELDED_PERIOD_DAY_PRESETS.some((days) => String(days) === props.periodDays),
  );
  return (
    <>
      <TaskHeader
        id={titleId}
        title={t("walletProtocol.createRule")}
        description={t("walletProtocol.ruleDescription")}
      />
      <TaskSection
        id={`${titleId}-qualification`}
        step={1}
        title={t("walletProtocol.familyQualification")}
      >
        <div className="w-full sm:w-72">
          <ThemedSelect
            labelledBy={`${titleId}-qualification`}
            value={props.credentialIndex}
            disabled={busy}
            onChange={props.onCredentialChange}
            options={props.qualifications.map((item) => ({
              value: String(item.index),
              label: `${t("walletProtocol.qualification", { index: item.index + 1 })}${
                item.current ? "" : ` · ${t("walletProtocol.qualificationWithdrawn")}`
              }`,
            }))}
          />
        </div>
      </TaskSection>
      <TaskSection
        id={`${titleId}-schedule`}
        step={2}
        title={t("shielded.fields.fundingRule", { symbol })}
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(8.25rem,100%),1fr))] gap-3">
          <FieldBlock label={t("shielded.fields.rate", { symbol })}>
            <input
              aria-label={t("shielded.fields.rate", { symbol })}
              className={FIELD_INPUT}
              inputMode="decimal"
              value={props.rate}
              disabled={busy}
              onChange={(event) => props.onRateChange(event.target.value)}
              placeholder="10"
            />
          </FieldBlock>
          <FieldBlock label={t("shielded.fields.periodDays", { symbol })} labelId={periodLabelId}>
            <ThemedSelect
              size="md"
              labelledBy={periodLabelId}
              disabled={busy}
              value={customPeriodDays ? "custom" : props.periodDays}
              onChange={(choice) => {
                setCustomPeriodDays(choice === "custom");
                props.onPeriodDaysChange(choice === "custom" ? "" : choice);
              }}
              options={[
                ...SHIELDED_PERIOD_DAY_PRESETS.map((days) => ({
                  value: String(days),
                  label: t("shielded.periodDaysSummary", { symbol, days }),
                })),
                { value: "custom", label: t("shielded.customPeriodDays", { symbol }) },
              ]}
            />
          </FieldBlock>
        </div>
        {customPeriodDays ? (
          <div className="max-w-[12.5rem]">
            <FieldBlock label={t("shielded.fields.customPeriodDays", { symbol })}>
              <input
                aria-label={t("shielded.fields.customPeriodDays", { symbol })}
                className={FIELD_INPUT}
                inputMode="numeric"
                disabled={busy}
                value={props.periodDays}
                onChange={(event) => props.onPeriodDaysChange(event.target.value)}
                placeholder="30"
              />
            </FieldBlock>
          </div>
        ) : null}
      </TaskSection>
      <div className="mt-6 space-y-4 border-t border-hairline/70 pt-6">
        <PanelButton
          variant="primary"
          busy={busy}
          disabled={busy || !props.ready}
          onClick={props.onCreate}
        >
          {t("walletProtocol.createRule")}
        </PanelButton>
        {props.rule ? (
          <FieldBlock label={t("walletProtocol.rule")}>
            <div className="relative">
              <textarea
                aria-label={t("walletProtocol.rule")}
                className={`${FIELD_TEXTAREA} min-h-24 resize-none pr-10`}
                readOnly
                value={props.rule}
                rows={4}
              />
              <div className="absolute right-1.5 top-1.5">
                <CopyIconButton
                  label={t("walletProtocol.copyRule")}
                  onClick={() => props.onCopy(props.rule)}
                />
              </div>
            </div>
          </FieldBlock>
        ) : null}
      </div>
    </>
  );
}
