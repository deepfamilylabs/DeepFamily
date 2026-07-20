import { AlertCircle } from "lucide-react";
import { getFieldErrorA11y } from "../../../../../shared/ui";
import type { MintMissingParents, MintNFTT } from "../model/mintNftTypes";

export interface MintTargetSectionProps {
  t: MintNFTT;
  personHash: string;
  versionIndex: number;
  hashInputInvalid: boolean;
  hasValidTarget: boolean;
  isCheckingStatus: boolean;
  isEndorsed: boolean;
  isAlreadyMinted: boolean;
  hasMissingParents: MintMissingParents;
  onPersonHashChange: (value: string) => void;
  onVersionIndexChange: (value: number) => void;
}

export function MintTargetSection({
  t,
  personHash,
  versionIndex,
  hashInputInvalid,
  hasValidTarget,
  isCheckingStatus,
  isEndorsed,
  isAlreadyMinted,
  hasMissingParents,
  onPersonHashChange,
  onVersionIndexChange,
}: MintTargetSectionProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "mint-nft-person-hash-error",
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
        {t("mintNFT.targetVersion", "Target Version")}
      </h3>

      <div className="p-5 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("mintNFT.personHash", "Person Hash")} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={personHash}
              onChange={(event) => onPersonHashChange(event.target.value)}
              {...personHashA11y.fieldProps}
              className={`w-full h-11 rounded-xl border bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-hidden transition-all font-mono ${
                hashInputInvalid
                  ? "border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/10"
                  : "border-gray-200 dark:border-gray-700 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
              }`}
              placeholder={t("search.versionsQuery.placeholder")}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("mintNFT.versionIndex", "Version Index")} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="1"
              value={versionIndex}
              onChange={(event) => onVersionIndexChange(parseInt(event.target.value) || 1)}
              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all"
              placeholder="1"
            />
          </div>
        </div>

        {hashInputInvalid && (
          <div
            {...personHashA11y.errorProps}
            className="mt-3 p-3 text-sm text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4" />
            {t(
              "mintNFT.invalidPersonHashFormat",
              "Person hash must be 0x-prefixed 32-byte hex (64 hex chars).",
            )}
          </div>
        )}

        {!hashInputInvalid && hasValidTarget && (
          <div className="mt-4 pt-4 border-t border-orange-100 dark:border-orange-900/20">
            {isCheckingStatus ? (
              <div className="text-sm font-medium text-orange-600 dark:text-orange-400 flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("mintNFT.checkingStatus", "Checking status...")}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isEndorsed ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${isEndorsed ? "bg-green-500" : "bg-orange-500"}`}
                  />
                  {isEndorsed
                    ? t("mintNFT.endorsed", "Endorsed")
                    : t("mintNFT.notEndorsed", "Not Endorsed")}
                </div>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isAlreadyMinted ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${isAlreadyMinted ? "bg-red-500" : "bg-green-500"}`}
                  />
                  {isAlreadyMinted
                    ? t("mintNFT.alreadyMinted", "Already Minted")
                    : t("mintNFT.canMint", "Can Mint")}
                </div>
              </div>
            )}
          </div>
        )}

        {!isCheckingStatus &&
          hasMissingParents &&
          (hasMissingParents.father || hasMissingParents.mother) && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/30 rounded-xl border border-amber-100 dark:border-amber-900/30">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-1">
                    {t("mintNFT.missingParentsTitle", "Incomplete Parent Information")}
                  </h4>
                  <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed opacity-90">
                    {hasMissingParents.father && hasMissingParents.mother
                      ? t(
                          "mintNFT.missingBothParents",
                          "Both parent hashes are empty for this version. Publish a new ZK version with parent hashes; version index 0 defers picking the exact parent version.",
                        )
                      : hasMissingParents.father
                        ? t(
                            "mintNFT.missingFather",
                            "The father hash is empty for this version. Publish a new ZK version with the father hash; index 0 will use the highest-endorsed father version by default.",
                          )
                        : t(
                            "mintNFT.missingMother",
                            "The mother hash is empty for this version. Publish a new ZK version with the mother hash; index 0 will use the highest-endorsed mother version by default.",
                          )}
                  </p>
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
