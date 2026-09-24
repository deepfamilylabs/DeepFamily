import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { modalField } from "../../../shared/ui";
import { formatDeepAmount, parseDeepAmount } from "../model/inheritanceAmounts";
import type { DepositState } from "../model/inheritanceTypes";
import {
  ErrorNotice,
  FactList,
  FieldBlock,
  PanelButton,
  PanelShell,
  StatusLine,
  SuccessNotice,
  formatBlockDate,
} from "./inheritanceControls";

export interface InheritanceDepositPanelProps {
  state: DepositState;
  disabled: boolean;
  onLookup: (id: bigint) => void;
  onDeposit: (amount: bigint) => void;
  onReset: () => void;
}

const ID_PATTERN = /^\d+$/;

export function InheritanceDepositPanel({
  state,
  disabled,
  onLookup,
  onDeposit,
  onReset,
}: InheritanceDepositPanelProps) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const [idText, setIdText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [attempted, setAttempted] = useState(false);

  const idValid = ID_PATTERN.test(idText.trim());
  const amount = parseDeepAmount(amountText);
  const info = "info" in state ? state.info : undefined;
  const busy =
    state.step === "loading" || state.step === "approving" || state.step === "submitting";

  const lookup = () => {
    setAttempted(false);
    if (idValid) onLookup(BigInt(idText.trim()));
  };

  const deposit = () => {
    setAttempted(true);
    if (amount !== null) onDeposit(amount);
  };

  const amountError =
    attempted && amount === null ? t("inheritance.fields.invalidAmount") : undefined;

  return (
    <PanelShell
      title={t("inheritance.deposit.title")}
      description={t("inheritance.deposit.description")}
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[12rem] flex-1">
          <FieldBlock label={t("inheritance.deposit.id")} htmlFor={`${ids}-id`}>
            <input
              id={`${ids}-id`}
              inputMode="numeric"
              className={modalField(idText !== "" && !idValid)}
              value={idText}
              disabled={busy}
              onChange={(event) => {
                setIdText(event.target.value);
                if (state.step !== "idle") onReset();
              }}
            />
          </FieldBlock>
        </div>
        <PanelButton
          disabled={disabled || busy || !idValid}
          busy={state.step === "loading"}
          onClick={lookup}
        >
          {t("inheritance.deposit.lookup")}
        </PanelButton>
      </div>

      {info ? (
        <div className="space-y-4 rounded-2xl border border-hairline p-4">
          <FactList
            items={[
              { label: t("inheritance.deposit.idLabel"), value: `#${info.id.toString()}` },
              {
                label: t("inheritance.deposit.perPeriod"),
                value: `${formatDeepAmount(info.amountPerPeriod)} DEEP`,
              },
              {
                label: t("inheritance.deposit.balance"),
                value: `${formatDeepAmount(info.balance)} DEEP`,
              },
              {
                label: t("inheritance.deposit.startedOn"),
                value: formatBlockDate(info.startTime, i18n.language),
              },
            ]}
          />
          {state.step !== "success" ? (
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="min-w-[12rem] flex-1">
                <FieldBlock
                  label={t("inheritance.deposit.amount")}
                  htmlFor={`${ids}-amount`}
                  error={amountError}
                  errorId={`${ids}-amount-error`}
                >
                  <input
                    id={`${ids}-amount`}
                    inputMode="decimal"
                    className={modalField(Boolean(amountError))}
                    value={amountText}
                    disabled={busy}
                    aria-invalid={Boolean(amountError) || undefined}
                    aria-describedby={amountError ? `${ids}-amount-error` : undefined}
                    onChange={(event) => setAmountText(event.target.value)}
                  />
                </FieldBlock>
              </div>
              <PanelButton
                variant="primary"
                disabled={disabled || busy}
                busy={state.step === "approving" || state.step === "submitting"}
                onClick={deposit}
              >
                {t("inheritance.deposit.submit")}
              </PanelButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {busy && state.step !== "loading" ? (
        <StatusLine>{t(`inheritance.stage.${state.step}`)}</StatusLine>
      ) : null}
      {state.step === "error" ? <ErrorNotice error={state.error} /> : null}
      {state.step === "success" ? (
        <SuccessNotice>
          <p className="font-semibold">
            {t("inheritance.deposit.success", {
              amount: formatDeepAmount(state.amount),
              id: state.info.id.toString(),
            })}
          </p>
          <p className="break-all font-mono text-xs text-ink-muted">{state.transactionHash}</p>
        </SuccessNotice>
      ) : null}
      {state.step === "success" ? (
        <PanelButton
          disabled={disabled}
          onClick={() => {
            setAmountText("");
            setAttempted(false);
            onLookup(state.info.id);
          }}
        >
          {t("inheritance.deposit.again")}
        </PanelButton>
      ) : null}
    </PanelShell>
  );
}
