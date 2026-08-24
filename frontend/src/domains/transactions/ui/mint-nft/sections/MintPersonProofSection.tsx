import type { Ref } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { MintNFTT, MintPersonInfo } from "../model/mintNftTypes";
import type { ProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-100">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
          <p className="text-xs font-medium leading-relaxed opacity-90">
            {t(
              "mintNFT.legalTruthfulNotice",
              "Submit only lawful, truthful information you are authorized to disclose publicly; do not include private data outside the intended public scope.",
            )}
          </p>
        </div>

        <div className="flex gap-3 rounded-2xl border border-red-100 bg-red-50/50 p-4 text-red-900 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-100">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-500" />
          <p className="text-xs font-medium leading-relaxed opacity-90">
            {t(
              "mintNFT.ageRequirement",
              "The person minted into an NFT must be 18 years or older. Do not submit minors' identities.",
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("mintNFT.basicInfo", "Basic Information")}
        </h3>

        <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30">
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
