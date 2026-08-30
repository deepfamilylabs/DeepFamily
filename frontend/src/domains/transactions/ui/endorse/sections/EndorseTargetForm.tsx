import { AlertCircle, Check } from "lucide-react";
import {
  MODAL_CHIP,
  MODAL_FIELD,
  ModalSectionHeading,
  getFieldErrorA11y,
  modalField,
} from "../../../../../shared/ui";
import type { EndorseT } from "../model/endorseTypes";

export interface EndorseTargetFormProps {
  t: EndorseT;
  personHash: string;
  versionIndex: number;
  hashInputInvalid: boolean;
  hasValidTarget: boolean;
  isTargetValidOnChain: boolean;
  displayName: string;
  currentEndorsementCount: number;
  onPersonHashChange: (value: string) => void;
  onVersionIndexChange: (value: number) => void;
}

export function EndorseTargetForm({
  t,
  personHash,
  versionIndex,
  hashInputInvalid,
  hasValidTarget,
  isTargetValidOnChain,
  displayName,
  currentEndorsementCount,
  onPersonHashChange,
  onVersionIndexChange,
}: EndorseTargetFormProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "endorse-person-hash-error",
  });

  return (
    <div className="space-y-4">
      <ModalSectionHeading>{t("endorse.targetVersion", "Target Version")}</ModalSectionHeading>

      <div className="bg-surface rounded-xl border border-hairline p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 space-y-2">
            <label className="block text-xs font-semibold text-ink">
              {t("endorse.personHash", "Person Hash")} <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={personHash}
              onChange={(event) => onPersonHashChange(event.target.value)}
              {...personHashA11y.fieldProps}
              className={`${modalField(hashInputInvalid)} font-mono`}
              placeholder={t("search.versionsQuery.placeholder", "Search by person hash")}
            />
            {hashInputInvalid && (
              <div
                {...personHashA11y.errorProps}
                className="flex items-center gap-2 text-xs font-medium text-danger p-2 bg-danger/10 rounded-lg border border-danger/25"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {t(
                  "endorse.invalidPersonHashFormat",
                  "Person hash must be 0x-prefixed 32-byte hex (64 hex chars).",
                )}
              </div>
            )}
            {!hashInputInvalid && hasValidTarget && (
              <div className="pt-2 animate-fade-in">
                {isTargetValidOnChain ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${MODAL_CHIP} border-success/25 bg-success/10 text-success`}>
                      <Check className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden />
                      {t("endorse.foundOnChain", "Found on chain")}
                    </span>
                    {displayName && (
                      <span className={`${MODAL_CHIP} border-hairline bg-surface text-ink`}>
                        {displayName}
                      </span>
                    )}
                    <span className={`${MODAL_CHIP} border-hairline bg-surface-alt text-ink`}>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                        {t("endorse.currentEndorsements", "Endorsements")}
                      </span>
                      <span className="font-mono">{currentEndorsementCount}</span>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/25 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">
                        {t("endorse.invalidTarget", "Invalid person hash or version index")}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {t(
                          "endorse.invalidTargetDesc",
                          "Please verify the hash and index refer to an existing version",
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-full sm:w-32 space-y-2">
            <label className="block text-xs font-semibold text-ink">
              {t("endorse.versionIndex", "Version Index")} <span className="text-danger">*</span>
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
      </div>
    </div>
  );
}
