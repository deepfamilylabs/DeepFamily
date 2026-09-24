import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { modalField } from "../../../shared/ui";
import {
  MAX_AMOUNT_PER_PERIOD,
  formatDeepAmount,
  parseDeepAmount,
  parseMultiplier,
  suggestAmountPerPeriod,
  toDeepInput,
} from "../model/inheritanceAmounts";
import type { CreateState } from "../model/inheritanceTypes";
import type { CreateReviewInput } from "../hooks/useInheritanceCreate";
import {
  ErrorNotice,
  FactList,
  FieldBlock,
  HashList,
  IdentityBlock,
  PanelButton,
  PanelShell,
  StatusLine,
  SuccessNotice,
  WarningNotice,
  formatCredential,
  shortHex,
} from "./inheritanceControls";

export interface InheritanceCreatePanelProps {
  /** The root person's identity form; the page owns it so the passphrase stays in its input. */
  rootIdentityForm: ReactNode;
  state: CreateState;
  recentReward: bigint;
  disabled: boolean;
  onReview: (input: CreateReviewInput) => void;
  onConfirm: () => void;
  onReset: () => void;
}

const BUSY_STEPS = new Set<CreateState["step"]>([
  "deriving",
  "checking",
  "approving",
  "submitting",
]);

function parseVersion(text: string): number | null {
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function InheritanceCreatePanel({
  rootIdentityForm,
  state,
  recentReward,
  disabled,
  onReview,
  onConfirm,
  onReset,
}: InheritanceCreatePanelProps) {
  const { t } = useTranslation();
  const ids = useId();
  const [versionText, setVersionText] = useState("1");
  const [multiplierText, setMultiplierText] = useState("1");
  const [perPeriodText, setPerPeriodText] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [attempted, setAttempted] = useState(false);

  const multiplier = parseMultiplier(multiplierText);
  const suggestion =
    multiplier !== null && recentReward > 0n
      ? suggestAmountPerPeriod(recentReward, multiplier)
      : null;
  // Until the user types a per-period amount, it follows the suggestion.
  const perPeriodValue = perPeriodText ?? (suggestion !== null ? toDeepInput(suggestion) : "");
  const version = parseVersion(versionText);
  const perPeriod = parseDeepAmount(perPeriodValue);
  const amount = parseDeepAmount(amountText);

  const errors = useMemo(() => {
    if (!attempted) return {};
    return {
      version: version === null ? t("inheritance.fields.invalidVersion") : undefined,
      perPeriod:
        perPeriod === null
          ? t("inheritance.fields.invalidAmount")
          : perPeriod > MAX_AMOUNT_PER_PERIOD
            ? t("inheritance.fields.amountTooLarge")
            : undefined,
      amount: amount === null ? t("inheritance.fields.invalidAmount") : undefined,
    };
  }, [attempted, version, perPeriod, amount, t]);

  const busy = BUSY_STEPS.has(state.step);
  const locked = busy || state.step === "success";

  // Any edit makes an earlier review stale.
  const edit = (apply: () => void) => {
    apply();
    if (state.step !== "idle") onReset();
  };

  const submitReview = () => {
    setAttempted(true);
    if (version === null || perPeriod === null || amount === null) return;
    if (perPeriod > MAX_AMOUNT_PER_PERIOD) return;
    onReview({ rootVersionIndex: version, amountPerPeriod: perPeriod, amount });
  };

  const startOver = () => {
    setAmountText("");
    setAttempted(false);
    onReset();
  };

  const review = "review" in state ? state.review : null;

  return (
    <PanelShell
      title={t("inheritance.create.title")}
      description={t("inheritance.create.description")}
    >
      <IdentityBlock title={t("inheritance.create.rootIdentity")}>{rootIdentityForm}</IdentityBlock>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock
          label={t("inheritance.create.rootVersion")}
          htmlFor={`${ids}-version`}
          hint={t("inheritance.create.rootVersionHint")}
          error={errors.version}
          errorId={`${ids}-version-error`}
        >
          <input
            id={`${ids}-version`}
            inputMode="numeric"
            className={modalField(Boolean(errors.version))}
            value={versionText}
            disabled={locked}
            aria-invalid={Boolean(errors.version) || undefined}
            aria-describedby={errors.version ? `${ids}-version-error` : undefined}
            onChange={(event) => edit(() => setVersionText(event.target.value))}
          />
        </FieldBlock>

        <FieldBlock
          label={t("inheritance.create.multiplier")}
          htmlFor={`${ids}-multiplier`}
          hint={
            recentReward > 0n
              ? t("inheritance.create.suggestion", { reward: formatDeepAmount(recentReward) })
              : t("inheritance.create.noReward")
          }
        >
          <input
            id={`${ids}-multiplier`}
            inputMode="decimal"
            className={modalField(multiplier === null)}
            value={multiplierText}
            disabled={locked}
            aria-invalid={multiplier === null || undefined}
            onChange={(event) => edit(() => setMultiplierText(event.target.value))}
          />
        </FieldBlock>

        <FieldBlock
          label={t("inheritance.create.amountPerPeriod")}
          htmlFor={`${ids}-per-period`}
          error={errors.perPeriod}
          errorId={`${ids}-per-period-error`}
          hint={
            perPeriodText !== null && suggestion !== null ? (
              <button
                type="button"
                className="font-semibold text-primary hover:underline disabled:opacity-50"
                disabled={locked}
                onClick={() => edit(() => setPerPeriodText(null))}
              >
                {t("inheritance.create.useSuggestion")}
              </button>
            ) : undefined
          }
        >
          <input
            id={`${ids}-per-period`}
            inputMode="decimal"
            className={modalField(Boolean(errors.perPeriod))}
            value={perPeriodValue}
            disabled={locked}
            aria-invalid={Boolean(errors.perPeriod) || undefined}
            aria-describedby={errors.perPeriod ? `${ids}-per-period-error` : undefined}
            onChange={(event) => edit(() => setPerPeriodText(event.target.value))}
          />
        </FieldBlock>

        <FieldBlock
          label={t("inheritance.create.amount")}
          htmlFor={`${ids}-amount`}
          error={errors.amount}
          errorId={`${ids}-amount-error`}
        >
          <input
            id={`${ids}-amount`}
            inputMode="decimal"
            className={modalField(Boolean(errors.amount))}
            value={amountText}
            disabled={locked}
            aria-invalid={Boolean(errors.amount) || undefined}
            aria-describedby={errors.amount ? `${ids}-amount-error` : undefined}
            onChange={(event) => edit(() => setAmountText(event.target.value))}
          />
        </FieldBlock>
      </div>

      {review && state.step !== "success" ? (
        <div className="space-y-4 rounded-2xl border border-hairline p-4">
          <h3 className="text-sm font-semibold text-ink">{t("inheritance.create.reviewTitle")}</h3>
          <FactList
            items={[
              { label: t("inheritance.create.reviewRoot"), value: shortHex(review.rootPersonHash) },
              { label: t("inheritance.create.reviewVersion"), value: review.rootVersionIndex },
              {
                label: t("inheritance.create.reviewTrusted"),
                value: review.trustedEndorserCount,
              },
              {
                label: t("inheritance.create.reviewPerPeriod"),
                value: `${formatDeepAmount(review.amountPerPeriod)} DEEP`,
              },
              {
                label: t("inheritance.create.reviewAmount"),
                value: `${formatDeepAmount(review.amount)} DEEP`,
              },
            ]}
          />
          {review.trustedEndorserCount === 0 ? (
            <WarningNotice>{t("inheritance.create.noTrusted")}</WarningNotice>
          ) : null}
          <WarningNotice>{t("inheritance.create.irreversible")}</WarningNotice>
        </div>
      ) : null}

      {busy ? <StatusLine>{t(`inheritance.stage.${state.step}`)}</StatusLine> : null}
      {state.step === "error" ? <ErrorNotice error={state.error} /> : null}
      {state.step === "success" ? (
        <SuccessNotice>
          <p className="font-semibold">
            {t("inheritance.create.success", { id: state.id.toString() })}
          </p>
          <p className="text-ink-muted">
            {t("inheritance.create.successHint", { id: state.id.toString() })}
          </p>
          <HashList
            items={[
              {
                label: t("inheritance.create.credential"),
                value: formatCredential(state.review.credential),
              },
              { label: t("transaction.rowTransaction"), value: state.transactionHash },
            ]}
          />
        </SuccessNotice>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        {state.step === "success" ? (
          <PanelButton onClick={startOver}>{t("inheritance.create.createAnother")}</PanelButton>
        ) : review ? (
          <>
            <PanelButton
              variant="primary"
              busy={busy}
              disabled={disabled || busy}
              onClick={onConfirm}
            >
              {t("inheritance.create.confirm")}
            </PanelButton>
            <PanelButton disabled={busy} onClick={onReset}>
              {t("inheritance.create.cancel")}
            </PanelButton>
          </>
        ) : (
          <PanelButton
            variant="primary"
            busy={busy}
            disabled={disabled || busy}
            onClick={submitReview}
          >
            {t("inheritance.create.review")}
          </PanelButton>
        )}
      </div>
    </PanelShell>
  );
}
