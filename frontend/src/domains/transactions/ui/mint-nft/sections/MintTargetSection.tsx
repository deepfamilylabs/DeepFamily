import { AlertCircle, Book } from "lucide-react";
import { Link } from "react-router-dom";
import { ModalSectionHeading, getFieldErrorA11y, modalField } from "../../../../../shared/ui";
import { ThemedSelect } from "../../shared/ThemedSelect";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { describeVersionOrigin } from "../../../model/personVersionMeta";
import type { MintNFTT } from "../model/mintNftTypes";

export interface MintTargetSectionProps {
  t: MintNFTT;
  personHash: string;
  versionIndex: number;
  hashInputInvalid: boolean;
  hasValidTarget: boolean;
  isCheckingStatus: boolean;
  envelopeHeaderError: string | null;
  versionLookup: PersonVersionLookup;
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
  envelopeHeaderError,
  versionLookup,
  onPersonHashChange,
  onVersionIndexChange,
}: MintTargetSectionProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "mint-nft-person-hash-error",
  });

  const versionOptions = versionLookup.versions.map((version) => {
    const origin = describeVersionOrigin(version);
    return {
      value: version.versionIndex,
      label:
        version.tokenId > 0
          ? t(
              "mintNFT.versionOptionNft",
              "Version {{index}} · minted · {{endorsements}} endorsements",
              { index: version.versionIndex, endorsements: version.endorsementCount },
            )
          : t("mintNFT.versionOption", "Version {{index}} · {{endorsements}} endorsements", {
              index: version.versionIndex,
              endorsements: version.endorsementCount,
            }),
      meta: origin.submitter
        ? t("mintNFT.versionOptionMeta", "{{submitter}} · {{date}}", {
            submitter: origin.submitter,
            date: origin.date || t("mintNFT.versionDateUnknown", "date unknown"),
          })
        : undefined,
    };
  });
  if (versionIndex > 0 && !versionOptions.some((option) => option.value === versionIndex)) {
    // Until the lookup resolves the target still needs a label, and a caller can
    // hand in a version this hash does not carry.
    versionOptions.push({
      value: versionIndex,
      label: t("mintNFT.versionOptionBare", "Version {{index}}", { index: versionIndex }),
      meta: undefined,
    });
    versionOptions.sort((a, b) => a.value - b.value);
  }

  const mintedVersions = versionLookup.versions.filter((version) => version.tokenId > 0);

  const versionPlaceholder =
    versionLookup.status === "loading"
      ? t("mintNFT.versionLoading", "Looking up on-chain versions...")
      : t("mintNFT.versionUnchosen", "Select a version");

  const versionNote =
    versionLookup.status === "idle"
      ? t("mintNFT.versionNeedsHash", "Enter a person hash to list its on-chain versions.")
      : versionLookup.status === "loading"
        ? t("mintNFT.versionLoading", "Looking up on-chain versions...")
        : versionLookup.status === "error"
          ? t("mintNFT.versionLookupFailed", "Version lookup failed. Re-enter the hash to retry.")
          : versionLookup.totalVersions === 0
            ? t("mintNFT.versionNone", "This hash carries no on-chain version.")
            : undefined;

  return (
    <div className="space-y-4">
      <ModalSectionHeading>{t("mintNFT.targetVersion", "Target Version")}</ModalSectionHeading>

      {/* Stacked, not side by side: a 66-character hash needs the card's full
          width to stay readable, and the version list grows downwards. */}
      <div className="p-4 bg-surface border border-hairline rounded-xl">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-ink">
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

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-ink">
              {t("mintNFT.versionIndex", "Version Index")} <span className="text-danger">*</span>
            </label>
            <ThemedSelect
              value={versionIndex}
              onChange={onVersionIndexChange}
              options={versionOptions}
              disabled={versionOptions.length === 0}
              placeholder={versionPlaceholder}
              size="md"
              className="sm:max-w-sm"
            />
            {versionNote && <p className="text-xs text-ink-muted leading-relaxed">{versionNote}</p>}
            {mintedVersions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-xs text-ink-subtle">
                  {t("mintNFT.versionVerifyMinted", "Cross-check a minted version:")}
                </span>
                {mintedVersions.map((version) => (
                  <Link
                    key={version.versionIndex}
                    to={`/person/${version.tokenId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-xs text-ink-muted transition-colors hover:text-ink"
                    title={t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
                  >
                    <Book size={12} aria-hidden="true" />
                    {t("mintNFT.versionOptionBare", "Version {{index}}", {
                      index: version.versionIndex,
                    })}
                  </Link>
                ))}
              </div>
            )}
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

        {!hashInputInvalid && hasValidTarget && (isCheckingStatus || envelopeHeaderError) && (
          <div className="mt-4 pt-4 border-t border-hairline">
            {isCheckingStatus ? (
              <div className="text-sm font-medium text-primary flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("mintNFT.checkingStatus", "Checking status...")}
              </div>
            ) : (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
