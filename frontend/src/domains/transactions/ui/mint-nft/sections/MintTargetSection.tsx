import { AlertCircle } from "lucide-react";
import {
  MODAL_CHIP,
  MODAL_FIELD,
  ModalSectionHeading,
  getFieldErrorA11y,
  modalField,
} from "../../../../../shared/ui";
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
  targetSelfSuiteId: number | null;
  envelopeHeaderError: string | null;
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
  targetSelfSuiteId,
  envelopeHeaderError,
  onPersonHashChange,
  onVersionIndexChange,
}: MintTargetSectionProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "mint-nft-person-hash-error",
  });

  return (
    <div className="space-y-4">
      <ModalSectionHeading>{t("mintNFT.targetVersion", "Target Version")}</ModalSectionHeading>

      <div className="p-4 bg-surface border border-hairline rounded-xl">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5">
              {t("mintNFT.personHash", "Person Hash")} <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={personHash}
              onChange={(event) => onPersonHashChange(event.target.value)}
              {...personHashA11y.fieldProps}
              className={`${modalField(hashInputInvalid)} font-mono`}
              placeholder={t("search.versionsQuery.placeholder")}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5">
              {t("mintNFT.versionIndex", "Version Index")} <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              min="1"
              value={versionIndex}
              onChange={(event) => onVersionIndexChange(parseInt(event.target.value) || 1)}
              className={MODAL_FIELD}
              placeholder="1"
            />
          </div>
        </div>

        {hashInputInvalid && (
          <div
            {...personHashA11y.errorProps}
            className="mt-3 p-3 text-sm text-red-700 dark:text-red-300 bg-danger/15 rounded-lg flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4" />
            {t(
              "mintNFT.invalidPersonHashFormat",
              "Person hash must be 0x-prefixed 32-byte hex (64 hex chars).",
            )}
          </div>
        )}

        {!hashInputInvalid && hasValidTarget && (
          <div className="mt-4 pt-4 border-t border-hairline">
            {isCheckingStatus ? (
              <div className="text-sm font-medium text-primary flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("mintNFT.checkingStatus", "Checking status...")}
              </div>
            ) : envelopeHeaderError ? (
              <div
                className="p-3 text-sm text-red-700 dark:text-red-300 bg-danger/15 rounded-lg flex items-center gap-2"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {t(
                  "mintNFT.targetEnvelopeHeaderInvalid",
                  "The target metadata envelope header could not be verified. Minting is disabled.",
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`${MODAL_CHIP} ${isEndorsed ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                  {isEndorsed
                    ? t("mintNFT.endorsed", "Endorsed")
                    : t("mintNFT.notEndorsed", "Not Endorsed")}
                </span>
                <span
                  className={`${MODAL_CHIP} ${isAlreadyMinted ? "border-danger/25 bg-danger/10 text-danger" : "border-success/25 bg-success/10 text-success"}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                  {isAlreadyMinted
                    ? t("mintNFT.alreadyMinted", "Already Minted")
                    : t("mintNFT.canMint", "Can Mint")}
                </span>
                {targetSelfSuiteId !== null && (
                  <span className={`${MODAL_CHIP} border-hairline bg-surface-alt text-ink-muted`}>
                    {t("mintNFT.identitySuite", "Identity suite")}
                    <span className="font-mono text-ink">{targetSelfSuiteId}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {!isCheckingStatus &&
          hasMissingParents &&
          (hasMissingParents.father || hasMissingParents.mother) && (
            <div className="mt-3 p-3 bg-warning/10 border border-warning/25 rounded-xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 mb-1">
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
