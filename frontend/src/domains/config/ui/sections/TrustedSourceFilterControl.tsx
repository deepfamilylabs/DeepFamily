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
              "Use trusted sources configured on the exact root version and keep node versions endorsed by any source; no root sources means no filtering",
            )
          : t(
              "familyTree.ui.trustedSourceFilterTooltip.disabled",
              "Do not filter by root trusted sources; children mode and version deduplication still apply",
            )
      }
    />
  );
}
