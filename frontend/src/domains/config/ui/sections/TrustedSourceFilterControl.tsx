import { useTranslation } from "react-i18next";
import { SwitchRow } from "./ConfigControls";

export interface TrustedSourceFilterControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

export default function TrustedSourceFilterControl({
  value,
  onChange,
}: TrustedSourceFilterControlProps) {
  const { t } = useTranslation();
  return (
    <SwitchRow
      label={t("familyTree.ui.trustedSourceFilter", "Trusted Sources")}
      value={value}
      onChange={onChange}
      description={
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
