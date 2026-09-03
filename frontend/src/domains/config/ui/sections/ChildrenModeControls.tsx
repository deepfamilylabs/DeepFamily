import { useTranslation } from "react-i18next";
import { Field, SegmentedControl, SwitchRow } from "./ConfigControls";

export interface ChildrenModeControlsProps {
  mode: "union" | "strict";
  onModeChange: (v: "union" | "strict") => void;
  includeUnversioned: boolean;
  onIncludeUnversionedChange: (v: boolean) => void;
}

export default function ChildrenModeControls({
  mode,
  onModeChange,
  includeUnversioned,
  onIncludeUnversionedChange,
}: ChildrenModeControlsProps) {
  const { t } = useTranslation();
  const label = t("familyTree.ui.childrenMode", "Node Mode");

  return (
    <div className="flex flex-col gap-3.5">
      <Field
        label={label}
        hint={
          mode === "strict"
            ? t(
                "familyTree.ui.childrenModeTooltip.strict",
                "Exact: at every generation, query children linked to the current person version; unspecified parent versions are controlled separately",
              )
            : t(
                "familyTree.ui.childrenModeTooltip.union",
                "Merge: at every generation, combine children linked to all known versions of the current person, including unspecified parent-version references",
              )
        }
      >
        <SegmentedControl
          label={label}
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "union", label: t("familyTree.ui.childrenModeUnion", "Merge") },
            { value: "strict", label: t("familyTree.ui.childrenModeStrict", "Exact") },
          ]}
        />
      </Field>

      {/* Only "exact" has parent versions to be unspecified about. */}
      {mode === "strict" ? (
        <SwitchRow
          label={t("familyTree.ui.strictIncludeV0", "Unspecified Version")}
          value={includeUnversioned}
          onChange={onIncludeUnversionedChange}
          description={
            includeUnversioned
              ? t(
                  "familyTree.ui.strictIncludeV0Tooltip.on",
                  "Also show children linked to this parent person without a specific parent version (parentVersionIndex = 0)",
                )
              : t(
                  "familyTree.ui.strictIncludeV0Tooltip.off",
                  "Use only children attached to the exact current parent version",
                )
          }
        />
      ) : null}
    </div>
  );
}
