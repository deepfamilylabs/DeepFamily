import type { Ref } from "react";
import { AlertTriangle, Check } from "lucide-react";
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

        <div className="p-3 bg-info/8 border border-info/20 rounded-xl">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed font-medium">
              {t(
                "mintNFT.basicInfoMustMatch",
                "The basic information you enter must exactly match the target version data. The contract will verify this on-chain before minting.",
              )}
            </p>
          </div>
        </div>

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
