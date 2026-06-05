import { useTranslation } from "react-i18next";
import ToggleControl from "./ToggleControl";

export interface TrustedSourceFilterControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
  tooltipOpen: boolean;
  onToggleTooltip: () => void;
}

export default function TrustedSourceFilterControl({
  value,
  onChange,
  tooltipOpen,
  onToggleTooltip,
}: TrustedSourceFilterControlProps) {
  const { t } = useTranslation();
  return (
    <ToggleControl
      label={t("familyTree.ui.trustedSourceFilter", "Trusted Sources")}
      value={value}
      onChange={onChange}
      tooltipOpen={tooltipOpen}
      onToggleTooltip={onToggleTooltip}
      tooltip={
        value
          ? t(
              "familyTree.ui.trustedSourceFilterTooltip.enabled",
              "Only versions endorsed by recommended sources",
            )
          : t("familyTree.ui.trustedSourceFilterTooltip.disabled", "Show all versions")
      }
    />
  );
}
