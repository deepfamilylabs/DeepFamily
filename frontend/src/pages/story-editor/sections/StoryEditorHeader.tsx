import { ArrowLeft, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { formatUnixSeconds } from "../../../shared/model";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Page header: who this profile belongs to, how much of it is already on chain,
 * and whether it still accepts writes. The seal action deliberately does not
 * live here — it sits in the record column beside its consequences.
 */
export function StoryEditorHeader({ editor }: { editor: StoryEditorController }) {
  const { t, meta } = editor;
  const backTo = editor.validTokenId ? `/person/${editor.validTokenId}` : "/people";

  return (
    <header className="flex flex-col gap-3.5">
      <Link
        to={backTo}
        className="inline-flex w-fit items-center gap-2 rounded-lg py-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <ArrowLeft size={15} aria-hidden />
        {t("storyChunkEditor.backToProfile", "Back to profile")}
      </Link>

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2.5 text-ink-subtle">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
              {t("person.profileData", "Profile Data")}
            </span>
            {editor.validTokenId && (
              <>
                <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-hairline-strong" />
                <span className="font-mono text-[11.5px] font-semibold">
                  {t("person.tokenId", "Token ID")} #{editor.validTokenId}
                </span>
              </>
            )}
          </div>

          <h1 className="truncate text-[2.125rem] font-bold tracking-tight text-ink sm:text-[2.875rem]">
            {editor.personName || t("storyChunkEditor.titleFallback", "Profile Data")}
          </h1>

          {meta && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-muted">
              <span>
                {t("storyChunkEditor.chunkCount", "{{total}} chunks", {
                  total: meta.totalChunks,
                })}
              </span>
              <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-hairline-strong" />
              <span>
                {t("storyChunkEditor.bytesOnChain", "{{bytes}} bytes on chain", {
                  bytes: meta.totalLength.toLocaleString(),
                })}
              </span>
              {meta.lastUpdateTime ? (
                <>
                  <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-hairline-strong" />
                  <span>
                    {t("person.lastUpdate", "Last Update")} {formatUnixSeconds(meta.lastUpdateTime)}
                  </span>
                </>
              ) : null}
            </div>
          )}
        </div>

        <StoryStatusPill editor={editor} />
      </div>
    </header>
  );
}

function StoryStatusPill({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  if (!editor.meta) return null;

  if (editor.isSealed) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
        <Lock size={12} aria-hidden />
        {t("storyChunkEditor.sealedReadOnly", "Sealed — read only")}
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
      <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-green-500 dark:bg-green-400" />
      {t("storyChunkEditor.openForWriting", "Open for writing")}
    </span>
  );
}
