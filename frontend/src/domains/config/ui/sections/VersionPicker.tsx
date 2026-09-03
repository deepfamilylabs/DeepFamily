import { useTranslation } from "react-i18next";
import { Field } from "./ConfigControls";
import { ThemedSelect } from "../../../transactions/ui/shared/ThemedSelect";
import { describeVersionOrigin } from "../../../transactions/model/personVersionMeta";
import type { PersonVersionLookup } from "../../../transactions/hooks/usePersonVersionOptions";

export interface VersionPickerProps {
  value: number;
  onChange: (v: number) => void;
  /** On-chain versions behind the root hash currently typed above. */
  lookup: PersonVersionLookup;
  error?: string;
}

/**
 * The root's version index, offered as the list the hash actually carries —
 * the same trade the endorsement modal makes. A free-typed index could only be
 * checked by loading the tree and finding it empty.
 */
export default function VersionPicker({ value, onChange, lookup, error }: VersionPickerProps) {
  const { t } = useTranslation();

  const options = lookup.versions.map((version) => {
    // An unminted version publishes no identity, so who recorded it and when is
    // all there is to tell two versions of the same person apart.
    const origin = describeVersionOrigin(version);
    return {
      value: version.versionIndex,
      label:
        version.tokenId > 0
          ? t(
              "familyTree.config.versionOptionNft",
              "Version {{index}} · NFT · {{endorsements}} endorsements",
              { index: version.versionIndex, endorsements: version.endorsementCount },
            )
          : t(
              "familyTree.config.versionOption",
              "Version {{index}} · {{endorsements}} endorsements",
              { index: version.versionIndex, endorsements: version.endorsementCount },
            ),
      meta: origin.submitter
        ? t("familyTree.config.versionOptionMeta", "{{submitter}} · {{date}}", {
            submitter: origin.submitter,
            date: origin.date || t("familyTree.config.versionDateUnknown", "date unknown"),
          })
        : undefined,
    };
  });
  if (value > 0 && !options.some((option) => option.value === value)) {
    // The saved index still needs a label while the lookup runs, and a root can
    // name a version this hash does not carry.
    options.push({
      value,
      label: t("familyTree.config.versionOptionBare", "Version {{index}}", { index: value }),
      meta: undefined,
    });
    options.sort((a, b) => a.value - b.value);
  }

  const note =
    lookup.status === "idle"
      ? t("familyTree.config.versionNeedsHash", "Enter a root hash to list its on-chain versions.")
      : lookup.status === "loading"
        ? t("familyTree.config.versionLoading", "Looking up on-chain versions...")
        : lookup.status === "error"
          ? t(
              "familyTree.config.versionLookupFailed",
              "Version lookup failed. Re-enter the hash to retry.",
            )
          : lookup.totalVersions === 0
            ? t("familyTree.config.versionNone", "This hash carries no on-chain version.")
            : undefined;

  return (
    <Field
      label={t("familyTree.ui.versionNumber")}
      hint={note}
      error={error ? t(error, "Select an on-chain version") : undefined}
      errorProps={{ id: "config-root-version-error", role: "alert" }}
    >
      <ThemedSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={options.length === 0}
        placeholder={
          lookup.status === "loading"
            ? t("familyTree.config.versionLoading", "Looking up on-chain versions...")
            : t("familyTree.config.versionUnchosen", "Select a version")
        }
      />
    </Field>
  );
}
