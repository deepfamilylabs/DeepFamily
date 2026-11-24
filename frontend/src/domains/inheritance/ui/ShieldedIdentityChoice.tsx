import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_IDENTITY_SUITE_ID, SUPPORTED_IDENTITY_SUITE_IDS } from "@deepfamily/protocol-core";
import { ModalShell } from "../../../shared/ui/ModalShell";
import { MODAL_TITLE } from "../../../shared/ui/modalTokens";
import type {
  ShieldedIdentityHistory,
  ShieldedIdentityMatch,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { choiceCardClass } from "./inheritanceControls";

export type FindShieldedIdentities = (
  formUnchanged: () => boolean,
) => Promise<ShieldedIdentityMatch[] | undefined>;

const HISTORY_LABELS: Record<ShieldedIdentityHistory, string> = {
  registered: "shielded.identityHistory.registered",
  referenced: "shielded.identityHistory.referenced",
  used: "shielded.identityHistory.used",
};

/**
 * Picks the identity suite for credentials entered in a form, so the wallet that
 * already exists is the one used. A fixed, single or manually chosen suite
 * applies as given. Otherwise a lookup opens its only match, asks when there are
 * several, and uses the default when there are none.
 */
export function useShieldedSuiteResolution({
  busy,
  fixedSuite,
  find,
  proceed,
}: {
  busy: boolean;
  fixedSuite?: number;
  find: FindShieldedIdentities;
  proceed: (suite: number, expectedPersonHash?: string) => void;
}) {
  const [choices, setChoices] = useState<ShieldedIdentityMatch[]>();
  const [manualSuite, setManualSuite] = useState<number>();
  const revision = useRef(0);
  const onlySuite =
    SUPPORTED_IDENTITY_SUITE_IDS.length === 1 ? SUPPORTED_IDENTITY_SUITE_IDS[0] : undefined;

  useLayoutEffect(() => {
    return () => { revision.current += 1; };
  }, []);

  /** Any form edit invalidates a pending lookup and the matches it returned. */
  function dismissChoices() {
    revision.current += 1;
    setChoices(undefined);
  }

  function choose(match: ShieldedIdentityMatch) {
    dismissChoices();
    proceed(match.identitySuiteId, match.personHash);
  }

  function chooseManualSuite(suite: number | undefined) {
    dismissChoices();
    setManualSuite(suite);
  }

  async function submit() {
    if (busy || choices) return;
    const explicitSuite = fixedSuite ?? onlySuite ?? manualSuite;
    if (explicitSuite !== undefined) {
      proceed(explicitSuite);
      return;
    }
    const request = revision.current;
    const formUnchanged = () => request === revision.current;
    const matches = await find(formUnchanged);
    if (!matches || !formUnchanged()) return;
    if (matches.length > 1) {
      setChoices(matches);
    } else if (matches.length === 1) {
      choose(matches[0]);
    } else {
      proceed(DEFAULT_IDENTITY_SUITE_ID);
    }
  }

  return {
    onlySuite,
    /** Manual selection is offered only when the suite can differ. */
    canChooseSuite: fixedSuite === undefined && onlySuite === undefined,
    manualSuite,
    chooseManualSuite,
    choices,
    dismissChoices,
    choose,
    submit,
  };
}

/** A collapsed manual override for users who know the suite, or whose lookup cannot complete. */
export function ShieldedManualSuitePicker({
  summary,
  label,
  automatic,
  value,
  disabled,
  onChange,
}: {
  summary: string;
  label: string;
  automatic: string;
  value?: number;
  disabled: boolean;
  onChange: (suite: number | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <details className="text-sm text-ink-muted">
      <summary className="cursor-pointer">{summary}</summary>
      <label className="mt-2 block">
        {label}
        <select
          className="ml-2 rounded-lg border border-hairline bg-surface px-2 py-1"
          disabled={disabled}
          value={value ?? ""}
          onChange={event => onChange(event.target.value ? Number(event.target.value) : undefined)}
        >
          <option value="">{automatic}</option>
          {SUPPORTED_IDENTITY_SUITE_IDS.map(suite => (
            <option key={suite} value={suite}>{t("shielded.identitySuiteOption", { suite })}</option>
          ))}
        </select>
      </label>
    </details>
  );
}

/** Each match names its protocol, says in words why it is offered, and shows the full person hash. */
export function ShieldedIdentityChooser({
  title,
  matches,
  onChoose,
  onClose,
}: {
  title: string;
  matches: readonly ShieldedIdentityMatch[];
  onChoose: (match: ShieldedIdentityMatch) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <ModalShell isOpen onClose={onClose} ariaLabelledBy={titleId} closeLabel={t("common.close")}>
      <h2 id={titleId} className={`${MODAL_TITLE} pr-8`}>{title}</h2>
      <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
        {matches.map((match) => (
          <button
            key={match.personHash}
            type="button"
            aria-labelledby={`${titleId}-suite-${match.identitySuiteId} ${titleId}-hash-${match.identitySuiteId}`}
            className={`w-full space-y-1 px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${choiceCardClass(false)}`}
            onClick={() => onChoose(match)}
          >
            <span id={`${titleId}-suite-${match.identitySuiteId}`} className="block text-sm text-ink">
              <span className="font-semibold">
                {t("shielded.identitySuiteOption", { suite: match.identitySuiteId })}
              </span>
              {" · "}
              {t(HISTORY_LABELS[match.history])}
            </span>
            <code id={`${titleId}-hash-${match.identitySuiteId}`} className="block break-all text-xs text-ink-muted">
              {match.personHash}
            </code>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
