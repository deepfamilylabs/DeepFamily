import type { Ref } from "react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { AddVersionT, PersonInfoPublic } from "../model/addVersionTypes";

export interface PersonIdentitySectionProps {
  t: AddVersionT;
  formResetKey: number;
  personCalcRef: Ref<PersonHashCalculatorHandle>;
  initialPersonData?: Partial<PersonInfoPublic>;
  onPersonInfoChange: (value: PersonInfoPublic) => void;
  onPassphraseChange: () => void;
}

export function PersonIdentitySection({
  t,
  formResetKey,
  personCalcRef,
  initialPersonData,
  onPersonInfoChange,
  onPassphraseChange,
}: PersonIdentitySectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t("addVersion.personInfo", "Person Information")}
      </h3>

      <PersonHashCalculator
        ref={personCalcRef}
        key={`person-${formResetKey}`}
        showTitle={false}
        collapsible={false}
        requirePassphraseConfirmation
        initialValues={initialPersonData}
        onPassphraseChange={onPassphraseChange}
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
