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
  /** The entry contract does not answer, so no lookup here could have succeeded. */
  readerBlocked?: boolean;
  /** The chain answered for this hash and carries no version of it. */
  rootAbsent?: boolean;
}

/**
 * The root's version index, offered as the list the hash actually carries —
 * the same trade the endorsement modal makes. A free-typed index could only be
 * checked by loading the tree and finding it empty.
 */
export default function VersionPicker({
  value,
  onChange,
  lookup,
  error,
  readerBlocked = false,
  rootAbsent = false,
}: VersionPickerProps) {
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
  // Not through a dead reader, and not for a hash the chain says it does not
  // have: either way nothing was confirmed, and offering the saved index as
  // "Version 1" would pass a leftover off as something this chain vouched for.
  if (
    !readerBlocked &&
    !rootAbsent &&
    value > 0 &&
    !options.some((option) => option.value === value)
  ) {
    // The saved index still needs a label while the lookup runs, and a root can
    // name a version this hash does not carry.
    options.push({
      value,
      label: t("familyTree.config.versionOptionBare", "Version {{index}}", { index: value }),
      meta: undefined,
    });
    options.sort((a, b) => a.value - b.value);
  }

  // Every lookup fails through a reader that does not answer, and the default
  // wording would send someone to re-enter a hash that was never the problem.
  // No field here can fix a missing contract — it comes from the environment —
  // so this only says why the list is empty. Which chain is missing it belongs
  // to the status bar, which names the chain on the chip itself.
  const note = readerBlocked
    ? t(
        "familyTree.config.versionNeedsContract",
        "No contract deployed, so versions cannot be read",
      )
    : // The root field above already names the hash the chain does not carry.
      rootAbsent
      ? undefined
      : lookup.status === "idle"
        ? t("familyTree.config.versionNeedsHash", "Enter a root hash to list its on-chain versions")
        : lookup.status === "loading"
          ? t("familyTree.config.versionLoading", "Looking up on-chain versions...")
          : lookup.status === "error"
            ? t(
                "familyTree.config.versionLookupFailed",
                "Version lookup failed. Re-enter the hash to retry",
              )
            : lookup.totalVersions === 0
              ? t("familyTree.config.versionNone", "This hash carries no on-chain version")
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
