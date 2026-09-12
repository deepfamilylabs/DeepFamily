import { Lock } from "lucide-react";
import { formatUnixSeconds } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Record column — what this write costs the chain and what the chain already
 * holds. Sealing lives at the bottom of it, stated with its consequence, rather
 * than as a button in the page header next to everything else.
 */
export function StoryRecordPanel({ editor }: { editor: StoryEditorController }) {
  return (
    <div className="flex flex-col gap-4">
      <PendingWriteCard editor={editor} />
      <OnChainRecordCard editor={editor} />
      <SealCard editor={editor} />
    </div>
  );
}

function PendingWriteCard({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const form = editor.form;
  if (!editor.showEditorForm || !form.data.content.trim()) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-primary bg-primary/5 px-4 py-[15px]">
      <h2 className="ui-heading flex items-center gap-2 text-[12.5px] text-ink">
        <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-primary" />
        {t("storyChunkEditor.thisWrite", "This write")}
      </h2>

      <dl className="flex flex-col gap-2">
        <RecordRow
          label={t("storyChunkEditor.landsAt", "Lands at")}
          value={`#${editor.draftDisplayIndex}`}
        />
        <RecordRow
          label={t("storyChunkEditor.chunkTypeLabel", "Chunk Type")}
          value={editor.getChunkTypeLabel(form.data.chunkType)}
          mono={false}
        />
        <RecordRow
          label={t("storyChunkEditor.payload", "Payload")}
          value={`${form.byteLength.toLocaleString()} B`}
        />
      </dl>

      {form.draftContentHash && (
        <HashBlock
          label={t("storyChunkEditor.contentHash", "Content hash")}
          value={form.draftContentHash}
          onCopy={() => editor.copyText(form.draftContentHash!)}
          copyLabel={t("search.copy", "Copy") as string}
        />
      )}
    </section>
  );
}

function OnChainRecordCard({ editor }: { editor: StoryEditorController }) {
  const { t, meta } = editor;
  if (!meta) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-[15px]">
      <h2 className="ui-heading text-[12.5px] text-ink">
        {t("storyChunkEditor.onChainRecord", "On-chain record")}
      </h2>

      <dl className="flex flex-col gap-2">
        <RecordRow
          label={t("person.tokenId", "Token ID")}
          value={`#${editor.validTokenId || "-"}`}
        />
        {editor.nodeDetails?.versionIndex !== undefined && editor.nodeDetails.versionIndex > 0 && (
          <RecordRow
            label={t("person.versionLabel", "Version Index")}
            value={`${editor.nodeDetails.versionIndex}`}
          />
        )}
        <RecordRow label={t("person.totalChunks", "Total Chunks")} value={`${meta.totalChunks}`} />
        <RecordRow
          label={t("person.totalLength", "Total Length")}
          value={`${meta.totalLength.toLocaleString()} B`}
        />
        <RecordRow
          label={t("person.lastUpdate", "Last Update")}
          value={
            meta.lastUpdateTime ? formatUnixSeconds(meta.lastUpdateTime) : t("common.na", "N/A")
          }
        />
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[11.5px] text-ink-muted">{t("person.status", "Status")}</dt>
          <dd
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              meta.isSealed
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            }`}
          >
            {meta.isSealed ? t("person.sealed", "Sealed") : t("person.editable", "Editable")}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2.5 border-t border-hairline pt-3">
        <HashBlock
          label={t("person.storyHash", "Profile Hash")}
          value={meta.fullStoryHash || "-"}
          onCopy={meta.fullStoryHash ? () => editor.copyText(meta.fullStoryHash!) : undefined}
          copyLabel={t("search.copy", "Copy") as string}
        />
        {editor.nodeDetails?.personHash && (
          <HashBlock
            label={t("person.personHashLabel", "Person Hash")}
            value={editor.nodeDetails.personHash}
            onCopy={() => editor.copyText(editor.nodeDetails!.personHash!)}
            copyLabel={t("search.copy", "Copy") as string}
          />
        )}
      </div>
    </section>
  );
}

function SealCard({ editor }: { editor: StoryEditorController }) {
  const { t, meta } = editor;
  if (!meta) return null;

  if (meta.isSealed) {
    return (
      <section className="flex flex-col gap-2.5 rounded-[18px] border border-blue-200 bg-blue-50/60 px-4 py-[15px] dark:border-blue-900/50 dark:bg-blue-900/15">
        <h2 className="ui-heading flex items-center gap-2 text-[12.5px] text-blue-700 dark:text-blue-300">
          <Lock size={14} aria-hidden />
          {t("person.sealed", "Sealed")}
        </h2>
        <p className="text-[11.5px] leading-relaxed text-blue-900/80 dark:text-blue-200/80">
          {t(
            "storyChunkEditor.sealedNotice",
            "This profile is final. It stays readable and verifiable forever, and no further writes are accepted.",
          )}
        </p>
      </section>
    );
  }

  if (meta.totalChunks === 0) return null;

  return (
    <section className="flex flex-col gap-2.5 rounded-[18px] border border-orange-200 bg-orange-50/70 px-4 py-[15px] dark:border-orange-900/50 dark:bg-orange-900/15">
      <h2 className="ui-heading flex items-center gap-2 text-[12.5px] text-orange-800 dark:text-orange-300">
        <Lock size={14} aria-hidden />
        {t("storyChunkEditor.sealCard.title", "Seal this profile")}
      </h2>
      <p className="text-[11.5px] leading-relaxed text-orange-900/80 dark:text-orange-200/80">
        {t(
          "storyChunkEditor.sealCard.body",
          "Writes the final profile hash on chain. After sealing, no chunk can ever be added, edited or removed — by anyone.",
        )}
      </p>
      <button
        type="button"
        onClick={editor.seal.handleSeal}
        disabled={editor.submitting}
        className="min-h-9 rounded-full border border-orange-300 bg-surface text-[12.5px] font-semibold text-orange-800 transition-colors hover:bg-orange-50 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-400/40 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/30"
      >
        {t("storyChunkEditor.sealCard.action", "Seal permanently")}
      </button>
    </section>
  );
}

function RecordRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd
        className={`truncate text-[11.5px] font-semibold text-ink ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function HashBlock({
  label,
  value,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-subtle">
        {label}
      </span>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 select-all break-all rounded-md bg-surface-alt px-1.5 py-1 font-mono text-[11px] leading-snug text-ink-muted">
          {value}
        </code>
        {onCopy && <CopyIconButton onClick={onCopy} label={copyLabel} size="xs" />}
      </div>
    </div>
  );
}
