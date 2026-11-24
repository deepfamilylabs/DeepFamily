import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { LockOpen } from "lucide-react";
import { SUPPORTED_IDENTITY_SUITE_IDS } from "@deepfamily/protocol-core";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { ModalShell } from "../../../shared/ui/ModalShell";
import { MODAL_TITLE } from "../../../shared/ui/modalTokens";
import type { ShieldedAssetWorkerCallMap } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { DEFAULT_IDENTITY_SUITE_ID } from "../../../shared/zk/zk";
import { PanelButton, choiceCardClass } from "./inheritanceControls";
import type { ShieldedIdentityDraft } from "./useShieldedIdentitySession";

type LookupResult = ShieldedAssetWorkerCallMap["findWalletIdentities"]["result"];
type IdentityMatch = LookupResult["matches"][number];

export function ShieldedIdentityUnlockForm({
  form,
  draft,
  symbol,
  busy,
  find,
  unlock,
}: {
  form: RefObject<PersonHashCalculatorHandle>;
  draft: ShieldedIdentityDraft | null;
  symbol: string;
  busy: boolean;
  find: (formUnchanged: () => boolean) => Promise<IdentityMatch[] | undefined>;
  unlock: (suite: number, expectedPersonHash?: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [choices, setChoices] = useState<IdentityMatch[]>();
  const [manualSuite, setManualSuite] = useState<number>();
  const revision = useRef(0);
  const onlySuite =
    SUPPORTED_IDENTITY_SUITE_IDS.length === 1 ? SUPPORTED_IDENTITY_SUITE_IDS[0] : undefined;
  const unlockLabel = busy ? t("shielded.walletKeys.unlocking") : t("shielded.unlock", { symbol });

  function dismissChoices() {
    revision.current += 1;
    setChoices(undefined);
  }
  useLayoutEffect(() => {
    return () => { revision.current += 1; };
  }, []);

  function unlockMatch(match: IdentityMatch) {
    dismissChoices();
    unlock(match.identitySuiteId, match.personHash);
  }

  async function submit() {
    if (busy || choices) return;
    const explicitSuite = onlySuite ?? manualSuite;
    if (explicitSuite !== undefined) {
      unlock(explicitSuite);
      return;
    }
    const request = revision.current;
    const formUnchanged = () => request === revision.current;
    const matches = await find(formUnchanged);
    if (!matches || !formUnchanged()) return;
    if (matches.length > 1) {
      setChoices(matches);
    } else if (matches.length === 1) {
      unlockMatch(matches[0]);
    } else {
      unlock(DEFAULT_IDENTITY_SUITE_ID);
    }
  }

  return (
    <>
      <PersonHashCalculator
        ref={form}
        initialValues={draft ?? undefined}
        identitySuiteId={onlySuite}
        computeHash={!busy && onlySuite !== undefined}
        onPublicFormChange={dismissChoices}
        autoResolveSuite
        independentKeyCredentials
        showTitle={false}
        collapsible={false}
        showPassphraseGuidance={false}
        className="border-0 bg-transparent p-0 shadow-none"
      />
      {onlySuite === undefined && (
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer">{t("shielded.manualWalletSuite")}</summary>
          <label className="mt-2 block">
            {t("search.hashCalculator.identitySuite")}
            <select className="ml-2 rounded-lg border border-hairline bg-surface px-2 py-1"
              disabled={busy} value={manualSuite ?? ""} onChange={event => {
                dismissChoices();
                setManualSuite(event.target.value ? Number(event.target.value) : undefined);
              }}>
              <option value="">{t("shielded.autoWalletSuite")}</option>
              {SUPPORTED_IDENTITY_SUITE_IDS.map(suite => (
                <option key={suite} value={suite}>{t("shielded.identitySuiteOption", { suite })}</option>
              ))}
            </select>
          </label>
        </details>
      )}
      <PanelButton
        variant="primary"
        size="hero"
        className="w-full"
        busy={busy}
        disabled={busy}
        aria-label={unlockLabel}
        onClick={() => void submit()}
      >
        {busy ? null : <LockOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
        <span role="status">{unlockLabel}</span>
      </PanelButton>
      {choices && (
        <ModalShell isOpen onClose={dismissChoices} ariaLabelledBy={titleId} closeLabel={t("common.close")}>
          <h2 id={titleId} className={`${MODAL_TITLE} pr-8`}>{t("shielded.registeredIdentities")}</h2>
          <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
            {choices.map((match) => (
              <button
                key={match.personHash}
                type="button"
                aria-labelledby={`${titleId}-suite-${match.identitySuiteId} ${titleId}-hash-${match.identitySuiteId}`}
                className={`w-full space-y-1 px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${choiceCardClass(false)}`}
                onClick={() => unlockMatch(match)}
              >
                <span id={`${titleId}-suite-${match.identitySuiteId}`} className="block text-sm font-semibold text-ink">
                  {t("shielded.identitySuiteOption", { suite: match.identitySuiteId })}
                </span>
                <code id={`${titleId}-hash-${match.identitySuiteId}`} className="block break-all text-xs text-ink-muted">
                  {match.personHash}
                </code>
              </button>
            ))}
          </div>
        </ModalShell>
      )}
    </>
  );
}
