import type { Ref } from "react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { MintNFTT, MintPersonInfo } from "../model/mintNftTypes";
import type { ProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";
import { ModalSectionHeading } from "../../../../../shared/ui";

export interface MintPersonProofSectionProps {
  t: MintNFTT;
  personCalcRef: Ref<PersonHashCalculatorHandle>;
  personInfo: MintPersonInfo | null;
  targetSelfSuiteId: number | null;
  onPersonInfoChange: (value: MintPersonInfo) => void;
  onPassphraseChange: (risk: ProtocolPassphraseRisk) => void;
}

export function MintPersonProofSection({
  t,
  personCalcRef,
  personInfo,
  targetSelfSuiteId,
  onPersonInfoChange,
  onPassphraseChange,
}: MintPersonProofSectionProps) {
  return (
    <>
      <div className="space-y-4">
        <ModalSectionHeading>{t("mintNFT.basicInfo", "Basic Information")}</ModalSectionHeading>

        <PersonHashCalculator
          ref={personCalcRef}
          showTitle={false}
          collapsible={false}
          className="bg-transparent border-0 shadow-none p-0!"
          identitySuiteId={targetSelfSuiteId ?? 1}
          requirePassphraseConfirmation
          onPassphraseChange={onPassphraseChange}
          initialValues={
            personInfo
              ? {
                  fullName: personInfo.fullName,
                  gender: personInfo.gender,
                  birthYear: personInfo.birthYear,
                  birthMonth: personInfo.birthMonth,
                  birthDay: personInfo.birthDay,
                  isBirthBC: personInfo.isBirthBC,
                }
              : undefined
          }
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
    </>
  );
}
