import { useTranslation } from "react-i18next";
import LegalPlaceholder from "./legal/LegalPlaceholder";

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <LegalPlaceholder
      title={t("footer.privacy")}
      summary={t(
        "legal.privacySummary",
        "What this dApp reads, what stays in your browser, and what is public on-chain.",
      )}
    />
  );
}
