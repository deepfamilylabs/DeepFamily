import { useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type {
  ShieldedFundingEntry,
  ShieldedPolicySummary,
  ShieldedWalletSummary,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { ThemedSelect } from "../../../shared/ui/ThemedSelect";
import { parseShieldedPeriodDays } from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  SHIELDED_FUNDING_ENTRY_KEYS as ENTRY_KEYS,
  SHIELDED_PERIOD_DAY_PRESETS,
  type ShieldedFundingHeir,
} from "../model/shieldedFundingOptions";
import type { ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";
import type { FindShieldedIdentities } from "./ShieldedIdentityChoice";
import {
  ShieldedReceiveCodeInput,
  ShieldedRecipientChip,
  ShieldedRecipientInput,
  type ShieldedRecipientInputMethod,
} from "./ShieldedWalletActions";
import {
  BADGE_ACCENT,
  CHOICE_INPUT,
  FIELD_INPUT,
  FieldBlock,
  PanelButton,
  TaskHeader,
  TaskSection,
  WarningNotice,
  choiceCardClass,
  shortHex,
} from "./inheritanceControls";

const ENTRIES = ["public", "privateConvenient", "privateIndependent"] as const;

/** Whose direct children qualify: the unlocked identity, or another person looked up by hash. */
export type ShieldedFundingParentChoice = "self" | "other";

export interface ShieldedFundComposerProps {
  titleId: string;
  symbol: string;
  decimals: number;
  busy: boolean;
  wallet: ShieldedWalletSummary | null;
  /** Independent-key credentials can be unlocked while the identity proof suite is unavailable. */
  identityReady: boolean;
  heirs: readonly ShieldedFundingHeir[];
  parentChoice: ShieldedFundingParentChoice;
  onParentChoiceChange: (value: ShieldedFundingParentChoice) => void;
  /** The unlocked identity's label for the "myself" choice. */
  selfLabel?: string;
  otherParentInput: string;
  onOtherParentInputChange: (value: string) => void;
  onOtherParentLookup: () => void;
  /** The looked-up person's public records are loaded for the other-parent choice. */
  otherParentLoaded: boolean;
  otherParentError?: string;
  /** The chosen parent's versions and arrangements; the wallet's own family supplies "myself". */
  parentVersions: readonly number[];
  policies: readonly ShieldedPolicySummary[];
  /** The entry in effect: an existing heir keeps the entry and key it was first funded with. */
  entry: ShieldedFundingEntry;
  templateHandle?: string;
  onEntryChange: (value: ShieldedFundingEntry) => void;
  policyHandle: string;
  onPolicyChange: (value: string) => void;
  rootVersion: string;
  onRootVersionChange: (value: string) => void;
  personHash: string;
  onPersonHashChange: (value: string) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  periodDays: string;
  onPeriodDaysChange: (value: string) => void;
  periods: string;
  onPeriodsChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  codeError?: string;
  /** The verified receive code belongs to the chosen child and uses the chosen key. */
  recipientMatches: boolean;
  recipientMismatch: boolean;
  recipientInputMethod: ShieldedRecipientInputMethod;
  onRecipientInputMethodChange: (value: ShieldedRecipientInputMethod) => void;
  recipientFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  findRecipientIdentities: FindShieldedIdentities;
  onGenerateRecipientCode: (identitySuiteId: number, expectedPersonHash?: string) => void;
  /** The chosen parent's label, used to name existing arrangements. */
  parentLabel?: string;
}

/** Budget arrangement, then the child, then how privately the budget is held. */
export function ShieldedFundComposer(props: ShieldedFundComposerProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const { symbol, decimals, busy, wallet, titleId } = props;
  const versionLabelId = useId();
  const parentInputId = useId();
  const parentErrorId = useId();
  const periodLabelId = useId();
  const periodErrorId = useId();
  const [customPeriodDays, setCustomPeriodDays] = useState(
    !SHIELDED_PERIOD_DAY_PRESETS.some((days) => String(days) === props.periodDays),
  );
  const selectedPolicy = props.policies.find((policy) => policy.handle === props.policyHandle);
  let periodDaysError: string | undefined;
  if (!selectedPolicy && customPeriodDays) {
    try {
      parseShieldedPeriodDays(props.periodDays);
    } catch {
      periodDaysError = t("shielded.periodDaysInvalid", { symbol });
    }
  }
  const fundingVersion = selectedPolicy?.rootVersionIndex ?? props.rootVersion;
  const otherParent = props.parentChoice === "other";
  // The wallet's family records describe only the unlocked identity.
  const familyUnavailable = !otherParent && wallet?.familyRecordsAvailable === false;
  const awaitingParent = otherParent && !props.otherParentLoaded;
  const noParentVersions =
    !!wallet && !familyUnavailable && !awaitingParent && props.parentVersions.length === 0;
  const fixed = !!props.templateHandle;
  const privateFunding = props.entry !== "public";
  const heirName = (personHash: string) => {
    const index = props.heirs.findIndex(
      (heir) => heir.personHash.toLowerCase() === personHash.toLowerCase(),
    );
    const heir = props.heirs[index];
    return (
      heir?.label ??
      (index >= 0
        ? t("shielded.recipientPicker.childFallback", { index: index + 1 })
        : shortHex(personHash))
    );
  };
  const policies = props.policies;
  const placeholder = familyUnavailable
    ? null
    : !wallet
      ? t("shielded.recipientPicker.loading")
      : awaitingParent
        ? t("shielded.fundingParentLookupRequired")
        : noParentVersions && !selectedPolicy
          ? t(otherParent ? "shielded.fundingParentNotFound" : "shielded.fundingParentMissing")
          : !fundingVersion
            ? t("shielded.fundingVersionRequired", { symbol })
            : props.heirs.length === 0
              ? t("shielded.recipientPicker.emptyChildren")
              : null;
  const verification = props.recipientMatches ? (
    <ShieldedRecipientChip>
      {t("shielded.recipientTarget", { symbol, identity: heirName(props.personHash) })}
    </ShieldedRecipientChip>
  ) : null;
  const codeError =
    props.codeError ??
    (props.recipientMismatch ? t("shielded.recipientMismatch", { symbol }) : undefined);

  return (
    <>
      <TaskHeader
        id={titleId}
        title={t("shielded.actions.fund", { symbol })}
        description={t("shielded.descriptions.fund", { symbol })}
      >
        {!props.identityReady ? (
          <div className="pt-3">
            <WarningNotice>{tr("independentKeyRestoredIdentityHint")}</WarningNotice>
          </div>
        ) : null}
      </TaskHeader>

      <TaskSection id={`${titleId}-parent`} step={1} title={t("shielded.fields.fundingParent")}>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {t("shielded.fundingParentHint")}
        </p>
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-1.5">
          {(["self", "other"] as const).map((choice) => {
            const selected = props.parentChoice === choice;
            return (
              <label
                key={choice}
                className={`flex min-h-[52px] items-center gap-3 px-3.5 ${choiceCardClass(selected, busy)}`}
              >
                <input
                  type="radio"
                  name={`${titleId}-parent`}
                  className={CHOICE_INPUT}
                  checked={selected}
                  onChange={() => props.onParentChoiceChange(choice)}
                />
                <span className="flex-1 text-sm font-semibold text-ink">
                  {t(choice === "self" ? "shielded.fundingParentSelf" : "shielded.fundingParentOther")}
                </span>
                {choice === "self" && props.selfLabel ? (
                  <span className="min-w-0 truncate text-xs text-ink-muted">{props.selfLabel}</span>
                ) : null}
              </label>
            );
          })}
        </fieldset>
        {otherParent ? (
          <FieldBlock
            label={t("shielded.fundingParentPersonHash")}
            htmlFor={parentInputId}
            error={props.otherParentError}
            errorId={parentErrorId}
          >
            <div className="flex gap-2">
              <input
                id={parentInputId}
                aria-invalid={!!props.otherParentError}
                aria-describedby={props.otherParentError ? parentErrorId : undefined}
                className={`${FIELD_INPUT} min-w-0 flex-1 font-mono`}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                value={props.otherParentInput}
                onChange={(event) => props.onOtherParentInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onOtherParentLookup();
                }}
                placeholder="0x…"
              />
              <PanelButton
                disabled={busy || !props.otherParentInput.trim()}
                onClick={props.onOtherParentLookup}
              >
                {t("shielded.fundingParentLookup")}
              </PanelButton>
            </div>
          </FieldBlock>
        ) : null}
        {otherParent && props.otherParentLoaded && props.parentLabel ? (
          <p role="status" className="text-xs text-ink-muted">
            {t("shielded.fields.fundingParent")}:{" "}
            <span className="font-medium text-ink">{props.parentLabel}</span>
          </p>
        ) : null}
      </TaskSection>

      <TaskSection
        id={`${titleId}-rule`}
        step={2}
        title={t("shielded.fields.fundingRule", { symbol })}
        trailing={
          policies.length > 0 ? (
            <div className="w-full sm:w-72">
              <ThemedSelect
                labelledBy={`${titleId}-rule`}
                value={props.policyHandle}
                disabled={busy}
                onChange={props.onPolicyChange}
                options={[
                  { value: "", label: t("shielded.newFundingRule", { symbol }) },
                  ...policies.map((policy, index) => ({
                    value: policy.handle,
                    label: t("shielded.policyOption", {
                      symbol,
                      index: index + 1,
                      identity:
                        props.parentLabel ??
                        t("shielded.fundingVersionOption", {
                          symbol,
                          version: policy.rootVersionIndex,
                        }),
                      amount: formatShieldedAmount(policy.amountPerPeriod, decimals),
                      days: policy.periodDays,
                    }),
                  })),
                ]}
              />
            </div>
          ) : undefined
        }
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(8.25rem,100%),1fr))] gap-3">
          {selectedPolicy ? (
            <>
              <FieldBlock label={t("shielded.fields.rate", { symbol })}>
                <p
                  role="status"
                  className="flex h-11 items-center rounded-[10px] bg-surface-alt px-3 text-[15px] tabular-nums text-ink"
                >
                  {formatShieldedAmount(selectedPolicy.amountPerPeriod, decimals)}
                </p>
              </FieldBlock>
              <FieldBlock label={t("shielded.fields.periodDays", { symbol })}>
                <p
                  role="status"
                  className="flex h-11 items-center rounded-[10px] bg-surface-alt px-3 text-sm text-ink"
                >
                  {t("shielded.periodDaysSummary", { symbol, days: selectedPolicy.periodDays })}
                </p>
              </FieldBlock>
            </>
          ) : (
            <>
              <FieldBlock label={t("shielded.fields.rate", { symbol })}>
                <input
                  aria-label={t("shielded.fields.rate", { symbol })}
                  className={FIELD_INPUT}
                  inputMode="decimal"
                  value={props.amount}
                  disabled={busy}
                  onChange={(event) => props.onAmountChange(event.target.value)}
                  placeholder="10"
                />
              </FieldBlock>
              <FieldBlock
                label={t("shielded.fields.periodDays", { symbol })}
                labelId={periodLabelId}
              >
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
            </>
          )}
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
        {!selectedPolicy && customPeriodDays ? (
          <div className="max-w-[12.5rem]">
            <FieldBlock
              label={t("shielded.fields.customPeriodDays", { symbol })}
              error={periodDaysError}
              errorId={periodErrorId}
            >
              <input
                aria-label={t("shielded.fields.customPeriodDays", { symbol })}
                aria-invalid={!!periodDaysError}
                aria-describedby={periodDaysError ? periodErrorId : undefined}
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
        {policies.length > 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {t("shielded.fundingRuleHint", { symbol })}
          </p>
        ) : null}
      </TaskSection>

      <TaskSection
        id={`${titleId}-heir`}
        step={3}
        title={t("shielded.fields.heirPersonHash", { symbol })}
        trailing={
          <div className="flex items-center gap-2">
            {selectedPolicy ? (
              <p className="text-[13px] text-ink-muted" role="status">
                {t("shielded.fields.familyVersion", { symbol })}{" "}
                <span className="font-medium text-ink">
                  {t("shielded.fundingVersionOption", { symbol, version: fundingVersion })}
                </span>
              </p>
            ) : (
              <>
                <span id={versionLabelId} className="whitespace-nowrap text-[13px] text-ink-muted">
                  {t("shielded.fields.familyVersion", { symbol })}
                </span>
                <div className="w-40">
                  <ThemedSelect
                    labelledBy={versionLabelId}
                    disabled={busy || !wallet || props.parentVersions.length === 0}
                    value={props.rootVersion}
                    onChange={props.onRootVersionChange}
                    // A version that is no longer available stays shown but cannot be chosen.
                    placeholder={
                      props.rootVersion &&
                      !props.parentVersions.includes(Number(props.rootVersion))
                        ? t("shielded.fundingVersionOption", { symbol, version: props.rootVersion })
                        : t("shielded.fundingVersionPlaceholder", { symbol })
                    }
                    options={props.parentVersions.map((version) => ({
                      value: String(version),
                      label: t("shielded.fundingVersionOption", { symbol, version }),
                    }))}
                  />
                </div>
              </>
            )}
          </div>
        }
      >
        {familyUnavailable ? (
          <p role="alert" className="text-xs text-danger">
            {t(
              wallet.familyRecordsError === "incompatible"
                ? "shielded.familyRecordsIncompatible"
                : "shielded.familyRecordsUnavailable",
            )}
          </p>
        ) : null}
        {placeholder ? (
          <p className="rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink-muted">
            {placeholder}
          </p>
        ) : props.heirs.length > 0 ? (
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-1.5">
            {props.heirs.map((heir, index) => {
              const selected = heir.personHash.toLowerCase() === props.personHash.toLowerCase();
              return (
                <label
                  key={heir.personHash.toLowerCase()}
                  className={`flex min-h-[52px] items-center gap-3 px-3.5 ${choiceCardClass(selected, busy)}`}
                >
                  <input
                    type="radio"
                    name={`${titleId}-heir`}
                    value={heir.personHash}
                    className={CHOICE_INPUT}
                    checked={selected}
                    onChange={() => props.onPersonHashChange(heir.personHash)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {heir.label ??
                      t("shielded.recipientPicker.childFallback", { index: index + 1 })}
                  </span>
                  <code className="shrink-0 font-mono text-xs text-ink-muted">
                    {shortHex(heir.personHash)}
                  </code>
                </label>
              );
            })}
          </fieldset>
        ) : null}
        {props.personHash.trim() ? (
          <p className="break-all text-xs leading-relaxed text-ink-muted">
            {t("shielded.recipientPicker.identityHash")}:{" "}
            <code className="font-mono text-ink/80">{props.personHash.trim()}</code>
          </p>
        ) : null}
      </TaskSection>

      <TaskSection
        id={`${titleId}-entry`}
        step={4}
        title={t("shielded.fundingModeLabel", { symbol })}
      >
        <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={busy || fixed}>
          {ENTRIES.map((mode) => {
            const selected = mode === props.entry;
            return (
              <label
                key={mode}
                className={`flex flex-col gap-1.5 px-3.5 py-3 ${choiceCardClass(selected, busy || fixed)}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name={`${titleId}-entry`}
                    aria-label={tr(ENTRY_KEYS[mode].label)}
                    className={CHOICE_INPUT}
                    checked={selected}
                    onChange={() => props.onEntryChange(mode)}
                  />
                  <span className="flex-1 text-sm font-semibold text-ink">
                    {tr(ENTRY_KEYS[mode].label)}
                  </span>
                  {mode === "privateIndependent" && !fixed ? (
                    <span className={BADGE_ACCENT}>{tr("recommended")}</span>
                  ) : null}
                </span>
                {selected ? (
                  <span className="pl-7 text-[13px] leading-relaxed text-ink-muted">
                    {tr(ENTRY_KEYS[mode].hint)}
                  </span>
                ) : null}
              </label>
            );
          })}
        </fieldset>
        {fixed ? <p className="text-xs text-ink-muted">{tr("fundingEntryFixed")}</p> : null}
        {privateFunding ? (
          props.entry === "privateIndependent" ? (
            <ShieldedReceiveCodeInput
              purpose="fund"
              code={props.code}
              hint={t("shielded.privateLetters.fundPrivacy")}
              error={codeError}
              onChange={props.onCodeChange}
              verification={verification}
              disabled={busy}
            />
          ) : (
            <ShieldedRecipientInput
              purpose="fund"
              recipientSuiteId={props.heirs.find(heir => heir.personHash.toLowerCase() === props.personHash.toLowerCase())?.identitySuiteId}
              method={props.recipientInputMethod}
              onMethodChange={props.onRecipientInputMethodChange}
              code={props.code}
              codeHint={t("shielded.privateLetters.fundPrivacy")}
              codeError={codeError}
              onCodeChange={props.onCodeChange}
              credentialsFormRef={props.recipientFormRef}
              findRecipientIdentities={props.findRecipientIdentities}
              onGenerateCode={props.onGenerateRecipientCode}
              busy={busy}
              verification={verification}
            />
          )
        ) : null}
        {props.templateHandle ? (
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">{tr("originalTemplate")}</summary>
            <p className="mt-2 break-all font-mono">{props.templateHandle}</p>
          </details>
        ) : null}
      </TaskSection>
    </>
  );
}
