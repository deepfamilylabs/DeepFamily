import { useTranslation } from "react-i18next";
import LegalPlaceholder from "./legal/LegalPlaceholder";

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <LegalPlaceholder
      title={t("footer.terms")}
      summary={t("legal.termsSummary", "The terms that will govern use of the DeepFamily dApp.")}
    />
  );
}
