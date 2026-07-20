import type { Ref } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { IdentitySaltMode } from "../../../../../shared/crypto/identityHash";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type { MintNFTT, MintPersonInfo } from "../model/mintNftTypes";

export interface MintPersonProofSectionProps {
  t: MintNFTT;
  personCalcRef: Ref<PersonHashCalculatorHandle>;
  personInfo: MintPersonInfo | null;
  personHasPassphrase: boolean;
  personIdentityMode: IdentitySaltMode;
  personRecoverySaltHex: string;
  onPersonInfoChange: (value: MintPersonInfo) => void;
  onPersonHasPassphraseChange: (value: boolean) => void;
  onPersonIdentityModeChange: (value: IdentitySaltMode) => void;
  onPersonRecoverySaltHexChange: (value: string) => void;
}

export function MintPersonProofSection({
  t,
  personCalcRef,
  personInfo,
  personHasPassphrase,
  personIdentityMode,
  personRecoverySaltHex,
  onPersonInfoChange,
  onPersonHasPassphraseChange,
  onPersonIdentityModeChange,
  onPersonRecoverySaltHexChange,
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
          identityMode={personIdentityMode}
          identitySaltHex={personIdentityMode === "random" ? personRecoverySaltHex : undefined}
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
            onPersonHasPassphraseChange(formData.hasPassphrase);
            if (!formData.hasPassphrase) {
              onPersonIdentityModeChange("deterministic");
            }
          }}
        />

        {personHasPassphrase && (
          <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {t("mintNFT.identityMode", "Identity Recovery Mode")}
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                {t(
                  "mintNFT.identityModeHint",
                  "Use standard mode for deterministic recovery. Use enhanced mode only when this identity was originally created with a saved random recovery salt.",
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onPersonIdentityModeChange("deterministic")}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  personIdentityMode === "deterministic"
                    ? "border-blue-500 bg-white dark:bg-gray-800 shadow-xs"
                    : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                }`}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("mintNFT.identityModeStandard", "Standard")}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t(
                    "mintNFT.identityModeStandardHint",
                    "Deterministic identity salt from public fields.",
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onPersonIdentityModeChange("random")}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  personIdentityMode === "random"
                    ? "border-blue-500 bg-white dark:bg-gray-800 shadow-xs"
                    : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                }`}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("mintNFT.identityModeEnhanced", "Enhanced")}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t(
                    "mintNFT.identityModeEnhancedHint",
                    "Paste the previously saved recovery salt for this identity. Do not create a new salt here.",
                  )}
                </div>
              </button>
            </div>

            {personIdentityMode === "random" && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                  {t("mintNFT.identityRecoverySalt", "Recovery Salt")}
                </label>
                <input
                  type="text"
                  value={personRecoverySaltHex}
                  onChange={(event) => onPersonRecoverySaltHexChange(event.target.value)}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-hidden focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  placeholder={t(
                    "mintNFT.identityRecoverySaltPlaceholder",
                    "Paste the saved recovery salt for this identity",
                  )}
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t(
                    "mintNFT.identityRecoverySaltNotice",
                    "Minting in enhanced mode only succeeds when this is the exact recovery salt originally saved for the target identity.",
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
