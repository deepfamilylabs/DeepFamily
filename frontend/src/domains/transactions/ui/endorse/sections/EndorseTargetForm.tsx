import { AlertCircle, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { ModalSectionHeading, getFieldErrorA11y, modalField } from "../../../../../shared/ui";
import { ThemedSelect } from "../../shared/ThemedSelect";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { describeVersionOrigin } from "../../../model/personVersionMeta";
import type { EndorseT } from "../model/endorseTypes";

export interface EndorseTargetFormProps {
  t: EndorseT;
  personHash: string;
  versionIndex: number;
  hashInputInvalid: boolean;
  hasValidTarget: boolean;
  isTargetValidOnChain: boolean;
  versionLookup: PersonVersionLookup;
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
  versionLookup,
  onPersonHashChange,
  onVersionIndexChange,
}: EndorseTargetFormProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "endorse-person-hash-error",
  });

  const versionOptions = versionLookup.versions.map((version) => {
    const origin = describeVersionOrigin(version);
    return {
      value: version.versionIndex,
      label:
        version.tokenId > 0
          ? t(
              "endorse.versionOptionNft",
              "Version {{index}} · NFT · {{endorsements}} endorsements",
              {
                index: version.versionIndex,
                endorsements: version.endorsementCount,
              },
            )
          : t("endorse.versionOption", "Version {{index}} · {{endorsements}} endorsements", {
              index: version.versionIndex,
              endorsements: version.endorsementCount,
            }),
      meta: origin.submitter
        ? t("endorse.versionOptionMeta", "{{submitter}} · {{date}}", {
            submitter: origin.submitter,
            date: origin.date || t("endorse.versionDateUnknown", "date unknown"),
          })
        : undefined,
    };
  });
  if (versionIndex > 0 && !versionOptions.some((option) => option.value === versionIndex)) {
    // Until the lookup resolves the target still needs a label, and a caller can
    // hand in a version this hash does not carry. Index 0 is deliberately absent:
    // it means nothing has been chosen, not a version to offer.
    versionOptions.push({
      value: versionIndex,
      label: t("endorse.versionOptionBare", "Version {{index}}", { index: versionIndex }),
      meta: undefined,
    });
    versionOptions.sort((a, b) => a.value - b.value);
  }

  const mintedVersions = versionLookup.versions.filter((version) => version.tokenId > 0);

  const versionPlaceholder =
    versionLookup.status === "loading"
      ? t("endorse.versionLoading", "Looking up on-chain versions...")
      : t("endorse.versionUnchosen", "Select a version");

  const versionNote =
    versionLookup.status === "idle"
      ? t("endorse.versionNeedsHash", "Enter a person hash to list its on-chain versions.")
      : versionLookup.status === "loading"
        ? t("endorse.versionLoading", "Looking up on-chain versions...")
        : versionLookup.status === "error"
          ? t("endorse.versionLookupFailed", "Version lookup failed. Re-enter the hash to retry.")
          : versionLookup.totalVersions === 0
            ? t("endorse.versionNone", "This hash carries no on-chain version.")
            : undefined;

  return (
    <div className="space-y-4">
      <ModalSectionHeading>{t("endorse.targetVersion", "Target Version")}</ModalSectionHeading>

      {/* Stacked, not side by side: a 66-character hash needs the card's full
          width to stay readable, and the version list grows downwards. */}
      <div className="bg-surface rounded-xl border border-hairline p-4 space-y-4">
        <div className="space-y-2">
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
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-ink">
            {t("endorse.versionIndex", "Version Index")} <span className="text-danger">*</span>
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
                {t("endorse.versionVerifyMinted", "Cross-check a minted version:")}
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
                  <BookOpen size={12} aria-hidden="true" />
                  {t("endorse.versionOptionBare", "Version {{index}}", {
                    index: version.versionIndex,
                  })}
                </Link>
              ))}
            </div>
          )}
          {!hashInputInvalid && hasValidTarget && !isTargetValidOnChain && (
            <div className="pt-1 animate-fade-in">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
