import { useTranslation } from "react-i18next";
import { SwitchRow } from "./ConfigControls";

export interface DeduplicateControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

export default function DeduplicateControl({ value, onChange }: DeduplicateControlProps) {
  const { t } = useTranslation();
  return (
    <SwitchRow
      label={t("familyTree.ui.deduplicateChildren", "Deduplicate Children")}
      value={value}
      onChange={onChange}
      description={
        value
          ? t(
              "familyTree.ui.deduplicateChildrenTooltip.enabled",
              "Keep one child version per person under each parent; before details load, choose the lower version, then prefer the highest endorsement count with lower version as the tie-breaker",
            )
          : t(
              "familyTree.ui.deduplicateChildrenTooltip.disabled",
              "Keep every child version returned for the current parent",
            )
      }
    />
  );
}
