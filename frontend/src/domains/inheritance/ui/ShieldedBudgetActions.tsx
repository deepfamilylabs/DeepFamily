import { useId, useState, type ReactNode, type RefObject } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useTranslation } from "react-i18next";
import type {
  ShieldedFundingEntry,
  ShieldedKeySlot,
  ShieldedWalletSummary,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { formatShieldedTimestamp, parseShieldedPeriodDays } from "../model/shieldedBudgetPeriod";
import { ShieldedRecipientPicker } from "./ShieldedRecipientPicker";
import type { ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";
import { ShieldedRecipientInput } from "./ShieldedWalletActions";
import { FieldBlock, PanelButton, WarningNotice, shortHex } from "./inheritanceControls";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";
const PERIOD_DAY_PRESETS = [1, 7, 14, 21, 30, 90, 180, 365] as const;

export interface ShieldedBudgetActionsProps {
  action: "fund" | "claim";
  symbol: string;
  decimals: number;
  busy: boolean;
  wallet: ShieldedWalletSummary | null;
  fundingSlot?: ShieldedKeySlot;
  entry: ShieldedFundingEntry;
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
  recipientInputMethod: "receiveCode" | "credentials";
  onRecipientInputMethodChange: (value: "receiveCode" | "credentials") => void;
  recipientFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  onGenerateRecipientCode: () => void;
  claimHandle: string;
  onClaimChange: (value: string) => void;
  claimPeriods: string[];
  onClaimPeriodsChange: (value: string[]) => void;
  receiveSlot: ShieldedKeySlot;
  onReceiveSlotChange: (value: ShieldedKeySlot) => void;
  independentKeyReady?: boolean;
  onRestoreIndependentKey?: () => void;
  localRecipientLabels?: ReadonlyMap<string, string>;
  parentPersonHash?: string;
  fundingDeficit?: string;
}

/** Budget funding with its three entries, and the budget claim form. */
export function ShieldedBudgetActions(props: ShieldedBudgetActionsProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const { symbol, decimals, busy, wallet } = props;
  const versionId = useId();
  const [customPeriodDays, setCustomPeriodDays] = useState(
    !PERIOD_DAY_PRESETS.some((days) => String(days) === props.periodDays),
  );
  const selectedPolicy = wallet?.policies.find((policy) => policy.handle === props.policyHandle);
  const fundingVersion = selectedPolicy?.rootVersionIndex ?? props.rootVersion;
  const familyUnavailable = wallet?.familyRecordsAvailable === false;
  const noParentVersions = !!wallet && !familyUnavailable && wallet.parentVersions.length === 0;
  const template = wallet?.templates.find(
    (item) =>
      item.policyHandle === props.policyHandle &&
      item.personHash.toLowerCase() === props.personHash.toLowerCase(),
  );
  const childOptions = Array.from(
    new Map(
      [
        ...(wallet?.children.filter(
          (child) => child.eligible && String(child.rootVersionIndex) === fundingVersion,
        ) ?? []),
        ...(wallet?.templates
          .filter((item) => item.policyHandle === props.policyHandle)
          .map((item) => ({ personHash: item.personHash, eligible: true })) ?? []),
      ].map((child) => [
        child.personHash.toLowerCase(),
        {
          personHash: child.personHash,
          eligible: child.eligible,
          label: props.localRecipientLabels?.get(child.personHash.toLowerCase()),
        },
      ]),
    ).values(),
  );
  const showAmount = (value: string) => formatUnits(BigInt(value), decimals);
  const fundingEntry: ShieldedFundingEntry = template
    ? template.bindingKind === 1
      ? "public"
      : template.keyMode === 1
        ? "privateIndependent"
        : "privateConvenient"
    : props.entry;
  const privateFunding = fundingEntry !== "public";
  const fundingBalance =
    wallet?.notes
      .filter((note) => note.kind === "value" && note.slot === (props.fundingSlot ?? "identity"))
      .reduce((sum, note) => sum + BigInt(note.amount), 0n) ?? 0n;
  let fundingRate: bigint | undefined;
  let fundingDays: bigint | undefined;
  try {
    fundingRate = selectedPolicy
      ? BigInt(selectedPolicy.amountPerPeriod)
      : parseUnits(props.amount, decimals);
    fundingDays = selectedPolicy
      ? BigInt(selectedPolicy.periodDays)
      : parseShieldedPeriodDays(props.periodDays);
  } catch {
    // Incomplete inputs have no preview until both are valid.
  }
  const fundingPeriods = /^[1-9][0-9]{0,19}$/.test(props.periods.trim())
    ? BigInt(props.periods)
    : undefined;
  const claims = wallet?.claims.filter((claim) => claim.slot === props.receiveSlot) ?? [];
  const defaultClaim = claims.find((claim) => claim.status === "claimable") ?? claims[0];
  const selectedClaim = claims.find((claim) => claim.handle === props.claimHandle) ?? defaultClaim;
  const budgets =
    wallet?.notes.filter((note) => note.kind === "budget" && note.slot === props.receiveSlot) ?? [];
  const claimBudget = budgets.find((note) => selectedClaim?.budgets.includes(note.commitment));
  const chosenClaimAmount = selectedClaim
    ? BigInt(selectedClaim.amountPerPeriod) * BigInt(props.claimPeriods.length)
    : 0n;
  const claimUnavailable =
    !!props.claimHandle && !claims.some((claim) => claim.handle === props.claimHandle);
  const claimSelectionUnavailable =
    !!selectedClaim &&
    props.claimPeriods.some((index) => !selectedClaim.periodIndices.includes(index));

  if (props.action === "fund") {
    return (
      <>
        <fieldset className="space-y-2" disabled={busy || !!template}>
          <legend className="text-sm font-medium text-ink">
            {t("shielded.fundingModeLabel", { symbol })}
          </legend>
          <div className="flex flex-wrap gap-4">
            {(["public", "privateConvenient", "privateIndependent"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="shielded-funding-mode"
                  aria-label={tr(
                    mode === "public"
                      ? "publicEntry"
                      : mode === "privateIndependent"
                        ? "independentEntry"
                        : "convenientEntry",
                  )}
                  checked={mode === fundingEntry}
                  onChange={() => props.onEntryChange(mode)}
                />
                {tr(
                  mode === "public"
                    ? "publicEntry"
                    : mode === "privateIndependent"
                      ? "independentEntry"
                      : "convenientEntry",
                )}
                {mode === "privateIndependent" && !template ? (
                  <span className="text-xs text-primary">{tr("recommended")}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
        {template ? <p className="text-xs text-ink-muted">{tr("fundingEntryFixed")}</p> : null}
        <p className="text-xs text-ink-muted">
          {tr(
            fundingEntry === "public"
              ? "publicHint"
              : fundingEntry === "privateIndependent"
                ? "independentHint"
                : "convenientHint",
          )}
        </p>
        {props.fundingDeficit !== undefined && fundingBalance > 0n ? (
          <WarningNotice>
            {t("shielded.fundingBalanceInsufficient", {
              symbol,
              amount: showAmount(props.fundingDeficit),
            })}
          </WarningNotice>
        ) : null}
        {wallet && wallet.policies.length > 0 ? (
          <FieldBlock
            label={t("shielded.fields.fundingRule", { symbol })}
            hint={t("shielded.fundingRuleHint", { symbol })}
          >
            <select
              aria-label={t("shielded.fields.fundingRule", { symbol })}
              className={INPUT_CLASS}
              value={props.policyHandle}
              disabled={busy}
              onChange={(event) => props.onPolicyChange(event.target.value)}
            >
              <option value="">{t("shielded.newFundingRule", { symbol })}</option>
              {wallet.policies.map((policy, index) => (
                <option key={policy.handle} value={policy.handle}>
                  {t("shielded.policyOption", {
                    symbol,
                    index: index + 1,
                    identity: props.parentPersonHash
                      ? (props.localRecipientLabels?.get(props.parentPersonHash.toLowerCase()) ??
                        shortHex(props.parentPersonHash))
                      : t("shielded.fundingVersionOption", {
                          symbol,
                          version: policy.rootVersionIndex,
                        }),
                    amount: showAmount(policy.amountPerPeriod),
                    days: policy.periodDays,
                  })}
                </option>
              ))}
            </select>
          </FieldBlock>
        ) : null}
        <FieldBlock
          label={t("shielded.fields.familyVersion", { symbol })}
          htmlFor={selectedPolicy ? undefined : versionId}
          error={familyUnavailable ? t("shielded.familyRecordsUnavailable") : undefined}
          hint={
            noParentVersions && !selectedPolicy ? t("search.storyRecordsQuery.noMatches") : undefined
          }
        >
          {selectedPolicy ? (
            <p className="text-sm text-ink" role="status">
              {t("shielded.fundingVersionOption", { symbol, version: fundingVersion })}
            </p>
          ) : (
            <select
              id={versionId}
              aria-label={t("shielded.fields.familyVersion", { symbol })}
              className={INPUT_CLASS}
              disabled={busy || !wallet || wallet.parentVersions.length === 0}
              value={props.rootVersion}
              onChange={(event) => props.onRootVersionChange(event.target.value)}
            >
              <option value="">{t("shielded.fundingVersionPlaceholder", { symbol })}</option>
              {props.rootVersion && !wallet?.parentVersions.includes(Number(props.rootVersion)) ? (
                <option value={props.rootVersion} disabled>
                  {t("shielded.fundingVersionOption", { symbol, version: props.rootVersion })}
                </option>
              ) : null}
              {wallet?.parentVersions.map((version) => (
                <option key={version} value={String(version)}>
                  {t("shielded.fundingVersionOption", { symbol, version })}
                </option>
              ))}
            </select>
          )}
        </FieldBlock>
        <ShieldedRecipientPicker
          label={t("shielded.fields.heirPersonHash", { symbol })}
          value={props.personHash}
          onChange={props.onPersonHashChange}
          options={childOptions}
          loading={!wallet}
          disabled={!fundingVersion || busy}
          placeholder={
            !fundingVersion ? t("shielded.fundingVersionRequired", { symbol }) : undefined
          }
        />
        {privateFunding && !template ? (
          <div className="space-y-3">
            {fundingEntry === "privateIndependent" ? (
              <FieldBlock label={t("shielded.receiveCodeInputLabel")}>
                <textarea
                  aria-label={t("shielded.receiveCodeInputLabel")}
                  className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
                  value={props.code}
                  disabled={busy}
                  onChange={(event) => props.onCodeChange(event.target.value)}
                  spellCheck={false}
                  rows={3}
                />
              </FieldBlock>
            ) : (
              <ShieldedRecipientInput
                method={props.recipientInputMethod}
                onMethodChange={props.onRecipientInputMethodChange}
                code={props.code}
                codeHint={t("shielded.receiveCodeInputHint", { symbol })}
                onCodeChange={props.onCodeChange}
                credentialsFormRef={props.recipientFormRef}
                onGenerateCode={props.onGenerateRecipientCode}
                busy={busy}
              />
            )}
          </div>
        ) : null}
        {template ? (
          <p className="break-all text-xs text-ink-muted">
            {tr("originalTemplate")}: {shortHex(template.handle)}
          </p>
        ) : null}
        {!selectedPolicy ? (
          <FieldBlock label={t("shielded.fields.rate", { symbol })}>
            <input
              aria-label={t("shielded.fields.rate", { symbol })}
              className={INPUT_CLASS}
              inputMode="decimal"
              value={props.amount}
              disabled={busy}
              onChange={(event) => props.onAmountChange(event.target.value)}
              placeholder="10"
            />
          </FieldBlock>
        ) : null}
        <FieldBlock label={t("shielded.fields.periodDays", { symbol })}>
          {selectedPolicy ? (
            <p className="text-sm text-ink" role="status">
              {t("shielded.periodDaysSummary", { symbol, days: selectedPolicy.periodDays })}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                aria-label={t("shielded.fields.periodDays", { symbol })}
                className={`${INPUT_CLASS} min-w-0`}
                disabled={busy}
                value={customPeriodDays ? "custom" : props.periodDays}
                onChange={(event) => {
                  const choice = event.target.value;
                  setCustomPeriodDays(choice === "custom");
                  props.onPeriodDaysChange(choice === "custom" ? "" : choice);
                }}
              >
                {PERIOD_DAY_PRESETS.map((days) => (
                  <option key={days} value={String(days)}>
                    {t("shielded.periodDaysSummary", { symbol, days })}
                  </option>
                ))}
                <option value="custom">{t("shielded.customPeriodDays", { symbol })}</option>
              </select>
              {customPeriodDays ? (
                <input
                  aria-label={t("shielded.fields.customPeriodDays", { symbol })}
                  className={`${INPUT_CLASS} min-w-0`}
                  inputMode="numeric"
                  disabled={busy}
                  value={props.periodDays}
                  onChange={(event) => props.onPeriodDaysChange(event.target.value)}
                  placeholder="30"
                />
              ) : null}
            </div>
          )}
        </FieldBlock>
        <FieldBlock label={t("shielded.fields.periods", { symbol })}>
          <input
            aria-label={t("shielded.fields.periods", { symbol })}
            className={INPUT_CLASS}
            inputMode="numeric"
            value={props.periods}
            disabled={busy}
            onChange={(event) => props.onPeriodsChange(event.target.value)}
          />
        </FieldBlock>
        {fundingRate !== undefined &&
        fundingRate > 0n &&
        fundingPeriods !== undefined &&
        fundingDays !== undefined ? (
          <p role="status" className="rounded-xl bg-primary/5 p-3 text-sm leading-relaxed text-ink">
            {t("shielded.fundingPreview", {
              symbol,
              amount: formatUnits(fundingRate * fundingPeriods, decimals),
              periods: String(fundingPeriods),
              rate: formatUnits(fundingRate, decimals),
              days: String(fundingDays),
            })}
          </p>
        ) : null}
      </>
    );
  }

  const claimFilter = (
    <fieldset disabled={busy} className="space-y-2">
      <legend className="text-sm font-medium text-ink">{tr("claimViewLabel")}</legend>
      <div className="flex flex-wrap gap-4">
        {(["identity", "asset"] as const).map((slot) => (
          <label key={slot} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="shielded-budget-key-mode"
              checked={props.receiveSlot === slot}
              onChange={() => props.onReceiveSlotChange(slot)}
            />
            {tr(slot === "asset" ? "independentBudgets" : "identityBudgets")}
          </label>
        ))}
      </div>
    </fieldset>
  );

  if (props.receiveSlot === "asset" && !props.independentKeyReady) {
    return (
      <>
        {claimFilter}
        {props.onRestoreIndependentKey ? (
          <PanelButton variant="primary" disabled={busy} onClick={props.onRestoreIndependentKey}>
            {tr("restoreBudgetKey")}
          </PanelButton>
        ) : null}
      </>
    );
  }

  return (
    <>
      {claimFilter}
      {claims.length > 1 ? (
        <FieldBlock label={t("shielded.fields.budgetNote", { symbol })}>
          <select
            aria-label={t("shielded.fields.budgetNote", { symbol })}
            className={INPUT_CLASS}
            disabled={busy}
            value={props.claimHandle || selectedClaim?.handle || ""}
            onChange={(event) => props.onClaimChange(event.target.value)}
          >
            {claimUnavailable ? (
              <option value={props.claimHandle} disabled>
                {t("shielded.unavailableBudget", { symbol })}
              </option>
            ) : null}
            {claims.map((claim, index) => {
              const notes = budgets.filter((note) => claim.budgets.includes(note.commitment));
              const remaining = notes.reduce((sum, note) => sum + BigInt(note.amount), 0n);
              return (
                <option key={claim.handle} value={claim.handle}>
                  {t("shielded.budgetOption", {
                    symbol,
                    index: index + 1,
                    amount: formatUnits(
                      claim.totalRemaining !== undefined
                        ? BigInt(claim.totalRemaining)
                        : notes.length
                          ? remaining
                          : BigInt(claim.amount),
                      decimals,
                    ),
                    days: claim.periodDays ?? notes[0]?.periodDays ?? "—",
                  })}
                </option>
              );
            })}
          </select>
        </FieldBlock>
      ) : null}
      <div
        role="status"
        className="space-y-1 break-words rounded-xl bg-surface-alt p-3 text-sm text-ink"
      >
        <p>
          {!wallet
            ? t("shielded.claimOverview.checking", { symbol })
            : budgets.length === 0
              ? t("shielded.claimOverview.noFunds", { symbol })
              : claims.length === 0
                ? t("shielded.claimOverview.ineligible", { symbol })
                : selectedClaim?.status === "claimable"
                  ? t("shielded.claimOverview.claimable", {
                      symbol,
                      amount: formatUnits(chosenClaimAmount, decimals),
                      periods: props.claimPeriods.length,
                    })
                  : t(`shielded.claimOverview.${selectedClaim?.status ?? "noFunds"}`, { symbol })}
        </p>
        {selectedClaim?.nextDueAt !== undefined ? (
          <p className="text-xs text-ink-muted">
            {t("shielded.claimOverview.nextDue", {
              symbol,
              date:
                formatShieldedTimestamp(BigInt(selectedClaim.nextDueAt)) ??
                t("shielded.dateOutOfRange", { symbol }),
            })}
          </p>
        ) : null}
      </div>
      {selectedClaim && selectedClaim.periodIndices.length > 0 ? (
        <fieldset disabled={busy} className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-medium text-ink">
            {t("shielded.claimPeriodsLabel", { symbol })}
          </legend>
          <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
            <span>{t("shielded.claimPeriodsHint", { symbol })}</span>
            <button
              type="button"
              className="shrink-0 text-primary hover:underline"
              onClick={() => props.onClaimPeriodsChange(selectedClaim.periodIndices)}
            >
              {t("shielded.selectAllClaimPeriods", { symbol })}
            </button>
          </div>
          {selectedClaim.periodIndices.map((index) => {
            const label = t("shielded.claimPeriodOption", {
              symbol,
              period: String(BigInt(index) + 1n),
              amount: showAmount(selectedClaim.amountPerPeriod),
            });
            const dueAt =
              claimBudget?.eligibleFrom !== undefined && claimBudget.periodDays !== undefined
                ? BigInt(claimBudget.eligibleFrom) +
                  (BigInt(index) + 1n) * BigInt(claimBudget.periodDays) * 86_400n
                : undefined;
            return (
              <label
                key={index}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline px-3 py-2"
              >
                <input
                  type="checkbox"
                  aria-label={label}
                  className="h-4 w-4 shrink-0 accent-primary"
                  checked={props.claimPeriods.includes(index)}
                  onChange={(event) =>
                    props.onClaimPeriodsChange(
                      event.target.checked
                        ? [...props.claimPeriods, index].sort((a, b) =>
                            BigInt(a) < BigInt(b) ? -1 : 1,
                          )
                        : props.claimPeriods.filter((value) => value !== index),
                    )
                  }
                />
                <span className="min-w-0 break-words text-sm text-ink">
                  <span>{label}</span>
                  {dueAt !== undefined ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {t("shielded.claimPeriodDue", {
                        symbol,
                        date:
                          formatShieldedTimestamp(dueAt, "date") ??
                          t("shielded.dateOutOfRange", { symbol }),
                      })}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {claimUnavailable || claimSelectionUnavailable ? (
        <WarningNotice>
          {t("shielded.claimSelectionUnavailable", { symbol })}
          <button
            type="button"
            disabled={busy}
            className="ml-2 text-primary hover:underline"
            onClick={() => {
              props.onClaimChange(defaultClaim?.handle ?? "");
              props.onClaimPeriodsChange(defaultClaim?.periodIndices ?? []);
            }}
          >
            {t("shielded.reselectClaim", { symbol })}
          </button>
        </WarningNotice>
      ) : selectedClaim?.status === "claimable" && props.claimPeriods.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("shielded.claimSelectionRequired", { symbol })}</p>
      ) : null}
    </>
  );
}
