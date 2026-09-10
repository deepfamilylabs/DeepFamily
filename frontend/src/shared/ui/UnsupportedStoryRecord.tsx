import { useTranslation } from "react-i18next";
import type { StoryChunk } from "../model";

export function UnsupportedStoryRecord({ record }: { record: StoryChunk }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 text-sm">
      <p>
        {t(
          "archive.unknownSchema",
          "This record uses a story format or compression method this app does not support yet. Its stored bytes have been verified.",
        )}
      </p>
      <code className="break-all text-xs">{record.schemaId}</code>
      <details>
        <summary>{t("archive.rawRecord", "View verified raw record")}</summary>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
          {record.rawPayload}
        </pre>
      </details>
    </div>
  );
}
