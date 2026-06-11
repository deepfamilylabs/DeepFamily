import { useTranslation } from "react-i18next";
import ToggleControl from "./ToggleControl";

export interface DeduplicateControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
  tooltipOpen: boolean;
  onToggleTooltip: () => void;
}

export default function DeduplicateControl({
  value,
  onChange,
  tooltipOpen,
  onToggleTooltip,
}: DeduplicateControlProps) {
  const { t } = useTranslation();
  return (
    <ToggleControl
      label={t("familyTree.ui.deduplicateChildren", "Deduplicate Children")}
      value={value}
      onChange={onChange}
      tooltipOpen={tooltipOpen}
      onToggleTooltip={onToggleTooltip}
      tooltip={
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
