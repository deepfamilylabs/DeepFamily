import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronDown, Edit2, Hash, Network } from "lucide-react";
import { formatUnixSeconds, getStoryPresentation } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import type { PersonPageController } from "../hooks/usePersonPageController";

/**
 * Record column — what the chain holds for this person, then what a reader can
 * do from here. Below xl the column's content moves under the life facts: the two
 * actions as a row of buttons, the record behind a one-line disclosure.
 */

function useActions(person: PersonPageController) {
  const data = person.data;
  const sealed = Boolean(data?.storyMetadata?.isSealed);
  return {
    viewTree: data?.personHash && data.versionIndex !== undefined ? person.viewFamilyTree : null,
    edit: person.canEditStory && !sealed ? person.openEditorInNewTab : null,
  };
}

export function PersonRecordCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  if (!data) return null;

  const meta = data.storyMetadata;
  const presentation = getStoryPresentation(data.storyRecords, meta);
  const copyLabel = t("search.copy", "Copy") as string;

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-[15px]">
      <h2 className="ui-heading text-[12.5px] text-ink">
        {t("storyRecordEditor.onChainRecord", "On-chain record")}
      </h2>

      <dl className="flex flex-col gap-2">
        <RecordRow label={t("person.tokenId", "Token ID")} value={`#${data.tokenId}`} />
        {data.versionIndex !== undefined && data.versionIndex > 0 && (
          <RecordRow label={t("person.versionLabel", "Version Index")} value={`${data.versionIndex}`} />
        )}
        {meta && (
          <>
            <RecordRow
              label={t("person.totalRecords", "Total Records")}
              value={`${presentation.totalRecords}`}
            />
            <RecordRow
              label={t("person.totalPayloadLength", "Total payload bytes")}
              value={`${presentation.totalPayloadLength.toLocaleString()} B`}
            />
            <RecordRow
              label={t("person.lastUpdate", "Last Update")}
              value={meta.lastUpdateTime ? formatUnixSeconds(meta.lastUpdateTime) : t("common.na", "N/A")}
            />
          </>
        )}
      </dl>

      {(meta?.recordsHead || data.personHash || data.owner) && (
        <div className="flex flex-col gap-2.5 border-t border-hairline pt-3">
          {meta?.recordsHead && (
            <HashBlock
              label={t("person.recordsHead", "Record-chain head")}
              value={meta.recordsHead}
              onCopy={() => person.copyText(meta.recordsHead)}
              copyLabel={copyLabel}
            />
          )}
          {data.personHash && (
            <HashBlock
              label={t("person.personHashLabel", "Person Hash")}
              value={data.personHash}
              onCopy={() => person.copyText(data.personHash!)}
              copyLabel={copyLabel}
            />
          )}
          {data.owner && (
            <HashBlock
              label={t("person.owner", "Owner Address")}
              value={data.owner}
              onCopy={() => person.copyText(data.owner!)}
              copyLabel={copyLabel}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** The column's actions as rows — the quick-actions menu's tile, label and arrow. */
export function PersonActionsCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const { viewTree, edit } = useActions(person);
  if (!viewTree && !edit) return null;

  return (
    <div className="flex flex-col gap-0.5 rounded-[18px] border border-hairline bg-surface p-1.5">
      {viewTree && (
        <ActionRow
          icon={<Network className="h-[18px] w-[18px]" aria-hidden />}
          tileClass="bg-primary/12 text-primary"
          label={t("person.viewFamilyTree", "View Family Tree")}
          onClick={viewTree}
        />
      )}
      {edit && (
        <ActionRow
          icon={<Edit2 className="h-[18px] w-[18px]" aria-hidden />}
          tileClass="bg-surface-muted text-ink-muted"
          label={t("familyTree.nodeDetail.editStory", "Edit Story")}
          onClick={edit}
        />
      )}
    </div>
  );
}

/** Below xl: the actions as two buttons, then the on-chain record behind a disclosure. */
export function PersonMobileRecord({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const { viewTree, edit } = useActions(person);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const data = person.data;
  if (!data) return null;

  const buttonClass =
    "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-hairline-strong bg-surface text-[13.5px] font-semibold text-ink transition-colors hover:border-primary hover:text-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";
  const records = data.storyMetadata
    ? getStoryPresentation(data.storyRecords, data.storyMetadata).totalRecords
    : null;

  return (
    <div className="mt-4 flex flex-col gap-3 xl:hidden">
      {(viewTree || edit) && (
        <div className="flex gap-2.5">
          {viewTree && (
            <button type="button" onClick={viewTree} className={buttonClass}>
              <Network size={16} aria-hidden className="text-primary" />
              {t("person.viewFamilyTree", "View Family Tree")}
            </button>
          )}
          {edit && (
            <button type="button" onClick={edit} className={buttonClass}>
              <Edit2 size={16} aria-hidden className="text-ink-muted" />
              {t("familyTree.nodeDetail.editStory", "Edit Story")}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-12 w-full items-center gap-2.5 rounded-[14px] border border-hairline bg-surface px-3.5 text-left transition-colors hover:border-hairline-strong focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Hash size={15} aria-hidden className="shrink-0 text-ink-muted" />
        <span className="text-[13px] font-semibold text-ink">
          {t("storyRecordEditor.onChainRecord", "On-chain record")}
        </span>
        <span className="grow" />
        <span className="truncate font-mono text-[11.5px] text-ink-subtle">
          #{data.tokenId}
          {records !== null && ` · ${t("person.recordsCount", "{{count}} records", { count: records })}`}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id={panelId}>
          <PersonRecordCard person={person} />
        </div>
      )}
    </div>
  );
}

function ActionRow({
  icon,
  tileClass,
  label,
  onClick,
}: {
  icon: ReactNode;
  tileClass: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-12 w-full items-center gap-3 rounded-xl pl-2 pr-3 text-left transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${tileClass}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{label}</span>
      <ArrowRight
        size={14}
        strokeWidth={2.5}
        aria-hidden
        className="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd className="truncate font-mono text-[11.5px] font-semibold text-ink" title={value}>
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
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-subtle">{label}</span>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 select-all break-all rounded-md bg-surface-alt px-1.5 py-1 font-mono text-[11px] leading-snug text-ink-muted">
          {value}
        </code>
        <CopyIconButton onClick={onCopy} label={copyLabel} size="xs" />
      </div>
    </div>
  );
}
