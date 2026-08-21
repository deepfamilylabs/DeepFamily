import type { Ref } from "react";
import { Shield } from "lucide-react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { AddVersionT, PersonInfoPublic } from "../model/addVersionTypes";

export interface PersonIdentitySectionProps {
  t: AddVersionT;
  formResetKey: number;
  personCalcRef: Ref<PersonHashCalculatorHandle>;
  initialPersonData?: Partial<PersonInfoPublic>;
  onPersonInfoChange: (value: PersonInfoPublic) => void;
}

export function PersonIdentitySection({
  t,
  formResetKey,
  personCalcRef,
  initialPersonData,
  onPersonInfoChange,
}: PersonIdentitySectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t("addVersion.personInfo", "Person Information")}
      </h3>

      <div className="flex items-start gap-3 p-3 bg-green-50/50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-900/30">
        <Shield className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
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
        requirePassphraseConfirmation
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
        }}
      />
    </div>
  );
}
