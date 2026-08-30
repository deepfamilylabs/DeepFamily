import type { Ref } from "react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { AddVersionT, PersonInfoPublic } from "../model/addVersionTypes";
import { ModalSectionHeading } from "../../../../../shared/ui";

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
      <ModalSectionHeading>{t("addVersion.personInfo", "Person Information")}</ModalSectionHeading>

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
