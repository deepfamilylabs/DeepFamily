import type { Ref } from "react";
import { Link } from "react-router-dom";
import { MODAL_CHIP } from "../../../../../shared/ui";
import { Book, ChevronDown, ChevronRight, Users } from "lucide-react";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import { ThemedSelect } from "../../shared/ThemedSelect";
import { describeVersionOrigin } from "../../../model/personVersionMeta";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import type {
  AddVersionT,
  ParentKind,
  ParentStatus,
  PersonInfoPublic,
} from "../model/addVersionTypes";

interface ParentIdentitySectionProps {
  t: AddVersionT;
  kind: ParentKind;
  formResetKey: number;
  expanded: boolean;
  status: ParentStatus;
  /** One-line recap shown on the collapsed row (name · year · version). */
  summary?: string;
  calcRef: Ref<PersonHashCalculatorHandle>;
  versionIndex: number | "";
  versionLookup: PersonVersionLookup;
  passphraseConfirmed: boolean;
  onExpandedChange: (value: boolean) => void;
  onInfoChange: (value: PersonInfoPublic) => void;
  onComputedHashChange: (value: string) => void;
  onVersionIndexChange: (value: number) => void;
  onPassphraseChange: () => void;
  onPassphraseConfirmationChange: () => void;
}

export function ParentIdentitySection({
  t,
  kind,
  formResetKey,
  expanded,
  status,
  summary,
  calcRef,
  versionIndex,
  versionLookup,
  passphraseConfirmed,
  onExpandedChange,
  onInfoChange,
  onComputedHashChange,
  onVersionIndexChange,
  onPassphraseChange,
  onPassphraseConfirmationChange,
}: ParentIdentitySectionProps) {
  const isFather = kind === "father";
  const title = isFather
    ? t("addVersion.fatherInfo", "Father Information")
    : t("addVersion.motherInfo", "Mother Information");
  const hint =
    status === "empty"
      ? t("addVersion.parentNotProvided", "Not provided")
      : t("addVersion.parentNeedsVersion", "Version index still missing");

  const selectedVersion = versionIndex === "" ? 0 : versionIndex;

  // Index 0 stays offered at every status: the parent may not be on chain yet,
  // and a contributor who rejects the recorded versions is entitled to link
  // the identity without endorsing any of them.
  const versionOptions = [
    { value: 0, label: t("addVersion.parentVersionUnknown", "Unknown (0)"), meta: undefined },
    ...versionLookup.versions.map((version) => {
      const origin = describeVersionOrigin(version);
      return {
        value: version.versionIndex,
        label:
          version.tokenId > 0
            ? t(
                "addVersion.parentVersionOptionNft",
                "Version {{index}} · NFT · {{endorsements}} endorsements",
                { index: version.versionIndex, endorsements: version.endorsementCount },
              )
            : t(
                "addVersion.parentVersionOption",
                "Version {{index}} · {{endorsements}} endorsements",
                { index: version.versionIndex, endorsements: version.endorsementCount },
              ),
        meta: origin.submitter
          ? t("addVersion.parentVersionOptionMeta", "{{submitter}} · {{date}}", {
              submitter: origin.submitter,
              date: origin.date || t("addVersion.parentVersionDateUnknown", "date unknown"),
            })
          : undefined,
      };
    }),
  ];
  if (selectedVersion > 0 && !versionOptions.some((option) => option.value === selectedVersion)) {
    // A selection made for the previous hash outlives its options until the new
    // lookup resolves; keep it labelled rather than blanking the control.
    versionOptions.push({
      value: selectedVersion,
      label: t("addVersion.parentVersionOptionBare", "Version {{index}}", {
        index: selectedVersion,
      }),
      meta: undefined,
    });
    versionOptions.sort((a, b) => a.value - b.value);
  }

  const mintedVersions = versionLookup.versions.filter((version) => version.tokenId > 0);

  const lookupNote = !passphraseConfirmed
    ? t(
        "addVersion.parentVersionAwaitingConfirmation",
        "The repeated identity passphrase does not match yet, so the on-chain versions are not being looked up. Two empty fields count as a match.",
      )
    : versionLookup.status === "idle"
      ? t(
          "addVersion.parentVersionNeedsIdentity",
          "Enter the parent's name to look up their on-chain versions. Leave the identity passphrase empty if there is none.",
        )
      : versionLookup.status === "loading"
        ? t("addVersion.parentVersionLoading", "Looking up on-chain versions...")
        : versionLookup.status === "error"
          ? t(
              "addVersion.parentVersionLookupFailed",
              "Version lookup failed. You can still submit with the version left unknown (0).",
            )
          : versionLookup.totalVersions === 0
            ? t(
                "addVersion.parentVersionNone",
                "This hash has no on-chain version yet, so it will be submitted as unknown (0). If you expected a match, check the identity passphrase.",
              )
            : undefined;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-3.5 p-3.5 text-left rounded-xl bg-surface border transition-colors focus:outline-hidden focus:ring-3 focus:ring-primary/15 ${
          expanded ? "border-primary/40" : "border-hairline hover:border-hairline-strong"
        }`}
      >
        <span className="w-9 h-9 shrink-0 rounded-[10px] bg-surface-muted flex items-center justify-center">
          <Users className="w-[18px] h-[18px] text-ink-muted" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink truncate">{title}</span>
          <span className="block text-xs text-ink-muted truncate">{summary || hint}</span>
        </span>
        {status !== "empty" && (
          <span
            className={`${MODAL_CHIP} shrink-0 ${
              status === "complete"
                ? "border-success/25 bg-success/10 text-success"
                : "border-warning/25 bg-warning/10 text-warning"
            }`}
          >
            {status === "partial"
              ? t("addVersion.partial", "Partial")
              : t("addVersion.complete", "Complete")}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-[17px] h-[17px] shrink-0 text-ink-subtle" aria-hidden />
        ) : (
          <ChevronRight className="w-[17px] h-[17px] shrink-0 text-ink-subtle" aria-hidden />
        )}
      </button>

      <div
        className={`p-1 space-y-4 transition-all duration-300 ease-in-out ${expanded ? "opacity-100 max-h-[2000px]" : "opacity-0 max-h-0 overflow-hidden"}`}
      >
        <div className="bg-surface rounded-xl border border-hairline p-4 space-y-4">
          <PersonHashCalculator
            ref={calcRef}
            key={`${kind}-${formResetKey}`}
            showTitle={false}
            collapsible={false}
            className="border-0 shadow-none bg-transparent"
            requirePassphraseConfirmation
            onPassphraseChange={onPassphraseChange}
            onPassphraseConfirmationChange={onPassphraseConfirmationChange}
            onComputedHashChange={onComputedHashChange}
            initialValues={{
              fullName: "",
              gender: isFather ? 1 : 2,
              birthYear: 0,
              birthMonth: 0,
              birthDay: 0,
              isBirthBC: false,
            }}
            onPublicFormChange={(formData) => {
              onInfoChange({
                fullName: formData.fullName,
                gender: formData.gender,
                birthYear: formData.birthYear,
                birthMonth: formData.birthMonth,
                birthDay: formData.birthDay,
                isBirthBC: formData.isBirthBC,
              });
            }}
          />

          <div className="w-full space-y-1.5">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {t("addVersion.versionIndex", "Version Index")}
            </label>
            <ThemedSelect
              value={selectedVersion}
              onChange={onVersionIndexChange}
              options={versionOptions}
              className="w-full sm:w-72"
            />
            {mintedVersions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-xs text-ink-subtle">
                  {t("addVersion.parentVersionVerifyMinted", "Cross-check a minted version:")}
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
                    {t("addVersion.parentVersionOptionBare", "Version {{index}}", {
                      index: version.versionIndex,
                    })}
                  </Link>
                ))}
              </div>
            )}
            {lookupNote && <p className="text-xs text-ink-muted leading-relaxed">{lookupNote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
