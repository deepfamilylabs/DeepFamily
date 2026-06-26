import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../../../shared/ui/ToastProvider";
import type { PaperGenealogyStyle } from "../paperData";
import { exportPaperGenealogyPdf, NoPaperSpreadsError } from "./exportPaperGenealogyPdf";

function buildFileName(style: PaperGenealogyStyle): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `genealogy-${style}-${stamp}.pdf`;
}

export function usePaperPdfExport() {
  const { t } = useTranslation();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const exportPdf = useCallback(
    async (
      root: HTMLElement | null,
      style: PaperGenealogyStyle,
      cssVars?: CSSProperties,
      marginPx?: number,
    ) => {
      if (exporting) return;
      if (!root) {
        toast.error(t("genealogyBook.exportPdfEmpty", "Nothing to export"));
        return;
      }

      setExporting(true);
      try {
        await exportPaperGenealogyPdf({
          root,
          fileName: buildFileName(style),
          cssVars,
          marginPx,
        });
        toast.success(t("genealogyBook.exportPdfSuccess", "PDF exported"));
      } catch (error) {
        if (error instanceof NoPaperSpreadsError) {
          toast.error(t("genealogyBook.exportPdfEmpty", "Nothing to export"));
        } else {
          toast.error(t("genealogyBook.exportPdfError", "Export failed"));
        }
      } finally {
        setExporting(false);
      }
    },
    [exporting, t, toast],
  );

  return { exporting, exportPdf };
}
