import type { Ref } from "react";
import type { PersonIdentityLookupContext } from "../../../../../shared/workers/cryptoWorkerClient";
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
  identityLookupContext?: PersonIdentityLookupContext;
  onIdentityChoiceChange: () => void;
}

export function PersonIdentitySection({
  t,
  formResetKey,
  personCalcRef,
  initialPersonData,
  onPersonInfoChange,
  onPassphraseChange,
  identityLookupContext,
  onIdentityChoiceChange,
}: PersonIdentitySectionProps) {
  return (
    <section aria-label={t("addVersion.personInfo", "Person Information")} className="space-y-4">
      <ModalSectionHeading>{t("addVersion.personInfo", "Person Information")}</ModalSectionHeading>

      <PersonHashCalculator
        ref={personCalcRef}
        key={`person-${formResetKey}`}
        showTitle={false}
        collapsible={false}
        requirePassphraseConfirmation
        identityRole="person"
        identityLookupContext={identityLookupContext}
        onIdentityChoiceChange={onIdentityChoiceChange}
        initialValues={initialPersonData}
        onPassphraseChange={onPassphraseChange}
        onPublicFormChange={(formData) => {
          onPersonInfoChange({
            identitySuiteId: formData.identitySuiteId,
            fullName: formData.fullName,
            gender: formData.gender,
            birthYear: formData.birthYear,
            birthMonth: formData.birthMonth,
            birthDay: formData.birthDay,
            isBirthBC: formData.isBirthBC,
          });
        }}
      />
    </section>
  );
}
