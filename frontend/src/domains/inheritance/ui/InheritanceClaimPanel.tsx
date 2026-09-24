import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ethers } from "ethers";
import { EmptyState, modalField } from "../../../shared/ui";
import { Inbox } from "lucide-react";
import { formatDeepAmount } from "../model/inheritanceAmounts";
import type { ClaimRowView, ClaimState } from "../model/inheritanceTypes";
import {
  ErrorNotice,
  FactList,
  FieldBlock,
  IdentityBlock,
  PanelButton,
  PanelShell,
  StatusLine,
  SuccessNotice,
  formatBlockDate,
  shortHex,
} from "./inheritanceControls";

export interface InheritanceClaimPanelProps {
  /** The claimer's own identity form. */
  heirIdentityForm: ReactNode;
  /** The root person's identity form. */
  rootIdentityForm: ReactNode;
  state: ClaimState;
  /** The connected wallet: it sends the claim and pays its gas. */
  account: string;
  disabled: boolean;
  onSearch: (rootVersionIndex: number) => void;
  onClaim: (id: bigint, recipient: string) => void;
  onReset: () => void;
}

function parseVersion(text: string): number | null {
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function isRecipient(text: string): boolean {
  return ethers.isAddress(text) && BigInt(text) !== 0n;
}

function ClaimRow({
  row,
  busyStage,
  disabled,
  onClaim,
}: {
  row: ClaimRowView;
  busyStage: string | null;
  disabled: boolean;
  onClaim: () => void;
}) {
  const { t, i18n } = useTranslation();
  const short = row.owed > row.balance ? row.owed - row.balance : 0n;
  return (
    <li className="space-y-3 rounded-2xl border border-hairline p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">#{row.id.toString()}</span>
        {row.ready ? (
          <span className="text-sm font-semibold text-ink">
            {t("inheritance.claim.claimable", { amount: formatDeepAmount(row.claimable) })}
          </span>
        ) : (
          <span className="text-sm text-ink-muted">
            {t("inheritance.claim.opensOn", {
              date: formatBlockDate(row.eligibleFrom, i18n.language),
            })}
          </span>
        )}
      </div>
      <FactList
        items={[
          {
            label: t("inheritance.claim.perPeriod"),
            value: `${formatDeepAmount(row.amountPerPeriod)} DEEP`,
          },
          { label: t("inheritance.claim.balance"), value: `${formatDeepAmount(row.balance)} DEEP` },
          { label: t("inheritance.claim.claimed"), value: `${formatDeepAmount(row.claimed)} DEEP` },
        ]}
      />
      {short > 0n ? (
        <p className="text-xs text-ink-muted">
          {t("inheritance.claim.shortfall", { amount: formatDeepAmount(short) })}
        </p>
      ) : null}
      {busyStage ? <StatusLine>{busyStage}</StatusLine> : null}
      <PanelButton
        variant="primary"
        disabled={disabled || !row.ready || row.claimable === 0n}
        busy={busyStage !== null}
        onClick={onClaim}
      >
        {t("inheritance.claim.submit")}
      </PanelButton>
    </li>
  );
}

export function InheritanceClaimPanel({
  heirIdentityForm,
  rootIdentityForm,
  state,
  account,
  disabled,
  onSearch,
  onClaim,
  onReset,
}: InheritanceClaimPanelProps) {
  const { t } = useTranslation();
  const ids = useId();
  const [versionText, setVersionText] = useState("1");
  const [recipientText, setRecipientText] = useState("");
  const [attempted, setAttempted] = useState(false);

  const version = parseVersion(versionText);
  const recipient = recipientText.trim() || account;
  const recipientValid = isRecipient(recipient);
  const searching = state.step === "searching";
  const claiming = state.step === "claiming";
  const lookup = "lookup" in state ? state.lookup : undefined;

  const versionError =
    attempted && version === null ? t("inheritance.fields.invalidVersion") : undefined;
  const recipientError = !recipientValid ? t("inheritance.fields.invalidRecipient") : undefined;

  const search = () => {
    setAttempted(true);
    if (version !== null) onSearch(version);
  };

  return (
    <PanelShell
      title={t("inheritance.claim.title")}
      description={t("inheritance.claim.description")}
    >
      <div className="grid gap-4">
        <IdentityBlock title={t("inheritance.claim.heirIdentity")}>
          {heirIdentityForm}
        </IdentityBlock>
        <IdentityBlock title={t("inheritance.claim.rootIdentity")}>
          {rootIdentityForm}
        </IdentityBlock>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock
          label={t("inheritance.claim.rootVersion")}
          htmlFor={`${ids}-version`}
          hint={t("inheritance.claim.rootVersionHint")}
          error={versionError}
          errorId={`${ids}-version-error`}
        >
          <input
            id={`${ids}-version`}
            inputMode="numeric"
            className={modalField(Boolean(versionError))}
            value={versionText}
            disabled={searching || claiming}
            aria-invalid={Boolean(versionError) || undefined}
            aria-describedby={versionError ? `${ids}-version-error` : undefined}
            onChange={(event) => {
              setVersionText(event.target.value);
              if (state.step !== "idle") onReset();
            }}
          />
        </FieldBlock>
        <FieldBlock
          label={t("inheritance.claim.recipient")}
          htmlFor={`${ids}-recipient`}
          hint={t("inheritance.claim.recipientHint")}
          error={recipientError}
          errorId={`${ids}-recipient-error`}
        >
          <input
            id={`${ids}-recipient`}
            className={`${modalField(Boolean(recipientError))} font-mono`}
            placeholder={account}
            value={recipientText}
            disabled={claiming}
            spellCheck={false}
            aria-invalid={Boolean(recipientError) || undefined}
            aria-describedby={recipientError ? `${ids}-recipient-error` : undefined}
            onChange={(event) => setRecipientText(event.target.value)}
          />
        </FieldBlock>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <PanelButton
          variant={lookup ? "secondary" : "primary"}
          disabled={disabled || searching || claiming}
          busy={searching}
          onClick={search}
        >
          {t(lookup ? "inheritance.claim.searchAgain" : "inheritance.claim.search")}
        </PanelButton>
      </div>

      {state.step === "searching" ? (
        <StatusLine>{t(`inheritance.stage.${state.stage}`)}</StatusLine>
      ) : null}
      {state.step === "error" ? <ErrorNotice error={state.error} /> : null}
      {state.step === "claimed" ? (
        <SuccessNotice>
          <p className="font-semibold">
            {t("inheritance.claim.success", {
              amount: formatDeepAmount(state.amount),
              id: state.id.toString(),
            })}
          </p>
          <p className="break-all font-mono text-xs text-ink-muted">{state.transactionHash}</p>
        </SuccessNotice>
      ) : null}

      {lookup ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            {t("inheritance.claim.foundVia", {
              version: lookup.versionIndex,
              endorser: shortHex(lookup.endorser, 6, 4),
            })}
          </p>
          {lookup.rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" strokeWidth={1.75} />}
              title={t("inheritance.claim.noneTitle")}
              description={t("inheritance.claim.noneDescription")}
            />
          ) : (
            <ul className="space-y-3">
              {lookup.rows.map((row) => (
                <ClaimRow
                  key={row.id.toString()}
                  row={row}
                  busyStage={
                    state.step === "claiming" && state.id === row.id
                      ? t(`inheritance.stage.${state.stage}`)
                      : null
                  }
                  disabled={disabled || claiming || searching || !recipientValid}
                  onClaim={() => onClaim(row.id, recipient)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </PanelShell>
  );
}
