import { useTranslation } from "react-i18next";
import { PageHead } from "../../shared/ui";
import { SOCIAL_LINKS } from "../../app/config/socialLinks";

/**
 * The shell both legal routes render.
 *
 * Neither document is written yet. The routes exist so the footer and the
 * status bar can link somewhere real instead of `href="#"`, and this says the
 * document is pending rather than shipping placeholder legalese that would read
 * as binding.
 */
export default function LegalPlaceholder({ title, summary }: { title: string; summary: string }) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-3xl space-y-6 text-ink">
      <PageHead title={title} subtitle={summary} />

      <p className="rounded-2xl border border-hairline bg-surface p-5 text-sm text-ink-muted">
        {t(
          "legal.draftNotice",
          "This document has not been published yet. Until it is, nothing here should be read as a binding agreement.",
        )}
      </p>

      <p className="text-sm text-ink-muted">
        {t("legal.contact", "Questions in the meantime:")}{" "}
        <a className="text-primary hover:text-primary-hover" href={SOCIAL_LINKS.email}>
          DeepFamilyLabs@gmail.com
        </a>
      </p>
    </div>
  );
}
