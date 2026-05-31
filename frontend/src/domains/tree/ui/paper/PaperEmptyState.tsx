import { useTranslation } from "react-i18next";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_VARS,
} from "./paperStyles";

export function PaperEmptyState({
  loading,
  contractMessage,
}: {
  loading?: boolean;
  contractMessage?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-[520px] items-center justify-center p-6"
      style={PAPER_VARS}
      data-testid="paper-genealogy-empty"
    >
      <div
        className="max-w-md border px-6 py-5 text-center shadow-sm"
        style={{
          background: "var(--df-paper-sheet)",
          borderColor: "var(--df-paper-line-soft)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="text-lg font-semibold">
          {loading
            ? t("genealogyBook.empty.loading", "Loading genealogy data")
            : t("genealogyBook.empty.title", "No genealogy root available")}
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--df-paper-muted)" }}>
          {contractMessage || t("genealogyBook.empty.description", "Configure a root first.")}
        </div>
      </div>
    </div>
  );
}
