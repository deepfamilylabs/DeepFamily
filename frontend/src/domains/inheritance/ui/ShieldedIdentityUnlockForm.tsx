import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { LockOpen } from "lucide-react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { PanelButton } from "./inheritanceControls";
import {
  ShieldedIdentityChooser,
  ShieldedManualSuitePicker,
  useShieldedSuiteResolution,
  type FindShieldedIdentities,
} from "./ShieldedIdentityChoice";
import type { ShieldedIdentityDraft } from "./useShieldedIdentitySession";

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
  find: FindShieldedIdentities;
  unlock: (suite: number, expectedPersonHash?: string) => void;
}) {
  const { t } = useTranslation();
  const resolution = useShieldedSuiteResolution({ busy, find, proceed: unlock });
  const { onlySuite } = resolution;
  const unlockLabel = busy ? t("shielded.walletKeys.unlocking") : t("shielded.unlock", { symbol });

  return (
    <>
      <PersonHashCalculator
        ref={form}
        initialValues={draft ?? undefined}
        identitySuiteId={onlySuite}
        computeHash={!busy && onlySuite !== undefined}
        onPublicFormChange={resolution.dismissChoices}
        autoResolveSuite
        independentKeyCredentials
        showTitle={false}
        collapsible={false}
        showPassphraseGuidance={false}
        className="border-0 bg-transparent p-0 shadow-none"
      />
      {resolution.canChooseSuite && (
        <ShieldedManualSuitePicker
          summary={t("shielded.manualWalletSuite")}
          label={t("search.hashCalculator.identitySuite")}
          automatic={t("shielded.autoWalletSuite")}
          value={resolution.manualSuite}
          disabled={busy}
          onChange={resolution.chooseManualSuite}
        />
      )}
      <PanelButton
        variant="primary"
        size="hero"
        className="w-full"
        busy={busy}
        disabled={busy}
        aria-label={unlockLabel}
        onClick={() => void resolution.submit()}
      >
        {busy ? null : <LockOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
        <span role="status">{unlockLabel}</span>
      </PanelButton>
      {resolution.choices && (
        <ShieldedIdentityChooser
          title={t("shielded.registeredIdentities")}
          matches={resolution.choices}
          onChoose={resolution.choose}
          onClose={resolution.dismissChoices}
        />
      )}
    </>
  );
}
