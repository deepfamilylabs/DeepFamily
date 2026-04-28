import type { Ref } from "react";
import { Shield } from "lucide-react";
import type { IdentitySaltMode } from "../../../../../shared/crypto/identityHash";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { AddVersionT, PersonInfoPublic } from "../model/addVersionTypes";
import { IdentityRecoveryModePanel } from "./IdentityRecoveryModePanel";

export interface PersonIdentitySectionProps {
  t: AddVersionT;
  formResetKey: number;
  personCalcRef: Ref<PersonHashCalculatorHandle>;
  personHasPassphrase: boolean;
  personIdentityMode: IdentitySaltMode;
  personRecoverySaltHex: string;
  initialPersonData?: Partial<PersonInfoPublic>;
  onPersonInfoChange: (value: PersonInfoPublic) => void;
  onPersonHasPassphraseChange: (value: boolean) => void;
  onPersonIdentityModeChange: (value: IdentitySaltMode) => void;
  onPersonRecoverySaltHexChange: (value: string) => void;
}

export function PersonIdentitySection({
  t,
  formResetKey,
  personCalcRef,
  personHasPassphrase,
  personIdentityMode,
  personRecoverySaltHex,
  initialPersonData,
  onPersonInfoChange,
  onPersonHasPassphraseChange,
  onPersonIdentityModeChange,
  onPersonRecoverySaltHexChange,
}: PersonIdentitySectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t("addVersion.personInfo", "Person Information")}
      </h3>

      <div className="flex items-start gap-3 p-3 bg-green-50/50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-900/30">
        <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
          {t(
            "addVersion.personInfoPrivacy",
            "Person information is only used locally to generate zero-knowledge proofs. Plain text will not be stored on-chain, only the hash value is permanently recorded.",
          )}
        </p>
      </div>

      <PersonHashCalculator
        ref={personCalcRef}
        key={`person-${formResetKey}`}
        showTitle={false}
        collapsible={false}
        identityMode={personIdentityMode}
        identitySaltHex={personIdentityMode === "random" ? personRecoverySaltHex : undefined}
        initialValues={initialPersonData}
        onPublicFormChange={(formData) => {
          onPersonInfoChange({
            fullName: formData.fullName,
            gender: formData.gender,
            birthYear: formData.birthYear,
            birthMonth: formData.birthMonth,
            birthDay: formData.birthDay,
            isBirthBC: formData.isBirthBC,
          });
          onPersonHasPassphraseChange(formData.hasPassphrase);
          if (!formData.hasPassphrase) {
            onPersonIdentityModeChange("deterministic");
          }
        }}
      />

      {personHasPassphrase && (
        <IdentityRecoveryModePanel
          t={t}
          mode={personIdentityMode}
          recoverySaltHex={personRecoverySaltHex}
          onModeChange={onPersonIdentityModeChange}
          onRecoverySaltHexChange={onPersonRecoverySaltHexChange}
          title={t("addVersion.identityMode", "Identity Recovery Mode")}
          hint={t(
            "addVersion.identityModeHint",
            "Standard mode recomputes the identity salt from public fields. Enhanced mode uses a recovery salt you must keep to continue this identity on other devices.",
          )}
          saltLabel={t("addVersion.identityRecoverySalt", "Recovery Salt")}
          saltPlaceholder={t(
            "addVersion.identityRecoverySaltPlaceholder",
            "Paste saved recovery salt or keep the generated value",
          )}
          notice={t(
            "addVersion.identityRecoverySaltNotice",
            "If this is a brand-new identity, keep the generated salt. If this identity was created earlier in enhanced mode, replace it with the saved recovery salt before submitting.",
          )}
        />
      )}
    </div>
  );
}
