import type { CSSProperties } from "react";
import type { TFunction } from "i18next";
import { ArrowUpRight, Clock, Hash, Link2, User } from "lucide-react";
import { getRecordTypeBorderColorClass } from "../../../domains/person";
import {
  formatHashMiddle,
  formatUnixSeconds,
  shortAddress,
  type StoryRecord,
} from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import { splitQuoteSource, splitReferenceLink } from "../model/personStoryLayout";

/** Record types typeset differently from plain prose. */
const QUOTES_TYPE = 9;
const REFERENCES_TYPE = 18;

const PRETTY: CSSProperties = { textWrap: "pretty" } as CSSProperties;

export interface PersonStoryEntryProps {
  t: TFunction;
  record: StoryRecord;
  expanded: boolean;
  onToggle: (recordIndex: number) => void;
  copyText: (text: string) => void;
  entryRef: (element: HTMLElement | null) => void;
}

/**
 * One record hanging off the section's spine: its title when it has one, then
 * the body. The number at the right is the handle for the record's provenance —
 * author, time, size and hashes stay one tap away instead of on every line.
 */
export function PersonStoryEntry({
  t,
  record,
  expanded,
  onToggle,
  copyText,
  entryRef,
}: PersonStoryEntryProps) {
  const isQuote = record.recordType === QUOTES_TYPE && !record.unsupportedSchema;
  const ordinal = t("person.recordOrdinal", "No. {{index}}", {
    index: record.displayIndex ?? record.recordIndex + 1,
  }) as string;

  return (
    <article
      ref={entryRef}
      id={`person-record-${record.recordIndex}`}
      className="relative flex scroll-mt-40 items-start gap-3 sm:gap-4 xl:scroll-mt-24"
    >
      <span
        aria-hidden
        className={`absolute -left-7 box-border h-[9px] w-[9px] rounded-full border-2 bg-surface-body sm:-left-[34px] ${
          isQuote ? "top-[11px]" : "top-[9.5px]"
        } ${getRecordTypeBorderColorClass(record.recordType)}`}
      />

      <div className="min-w-0 flex-1">
        {record.title?.trim() && (
          <h4 className="ui-heading break-words text-base font-bold leading-7 text-ink">
            {record.title}
          </h4>
        )}
        <RecordBody record={record} />
        {expanded && <RecordProvenance t={t} record={record} copyText={copyText} />}
      </div>

      <button
        type="button"
        onClick={() => onToggle(record.recordIndex)}
        aria-expanded={expanded}
        aria-label={ordinal}
        title={ordinal}
        className={`min-w-6 shrink-0 rounded-md px-1.5 text-right font-mono text-[10.5px] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
          isQuote ? "leading-[30px]" : "leading-7"
        } ${
          expanded
            ? "bg-surface-muted text-ink"
            : "text-ink-subtle hover:bg-surface-muted hover:text-ink"
        }`}
      >
        {record.displayIndex ?? record.recordIndex + 1}
      </button>
    </article>
  );
}

function RecordBody({ record }: { record: StoryRecord }) {
  if (record.unsupportedSchema) {
    return <UnsupportedStoryRecord record={record} />;
  }

  if (record.recordType === QUOTES_TYPE) {
    const { quote, source } = splitQuoteSource(record.content);
    return (
      <>
        <p
          className="whitespace-pre-wrap break-words text-lg font-medium leading-[1.7] text-ink"
          style={PRETTY}
        >
          {quote}
        </p>
        {source && <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">——{source}</p>}
      </>
    );
  }

  if (record.recordType === REFERENCES_TYPE) {
    const { label, url, displayUrl } = splitReferenceLink(record.content);
    return (
      <>
        <p className="whitespace-pre-wrap break-words text-[15.5px] leading-[1.8] text-ink" style={PRETTY}>
          {label}
        </p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-[12.5px] leading-5 text-ink-muted underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-primary-hover hover:decoration-current"
          >
            <span className="truncate">{displayUrl}</span>
            <ArrowUpRight size={12} aria-hidden className="shrink-0" />
          </a>
        )}
      </>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words text-[15.5px] leading-[1.8] text-ink" style={PRETTY}>
      {record.content}
    </p>
  );
}

function RecordProvenance({
  t,
  record,
  copyText,
}: {
  t: TFunction;
  record: StoryRecord;
  copyText: (text: string) => void;
}) {
  const copyLabel = t("search.copy", "Copy") as string;
  const byteLength = record.payloadLength ?? new TextEncoder().encode(record.content).length;
  const row = "flex min-w-0 items-center gap-1.5 text-[11.5px] leading-6 text-ink-muted";

  return (
    <div className="mt-2 flex flex-col border-t border-hairline pt-1.5">
      {record.author && (
        <div className={row}>
          <User size={12} aria-hidden className="shrink-0" />
          <span className="truncate font-mono" title={record.author}>
            {shortAddress(record.author)}
          </span>
          <CopyIconButton label={copyLabel} onClick={() => copyText(record.author)} size="xs" />
        </div>
      )}
      <div className={row}>
        <Clock size={12} aria-hidden className="shrink-0" />
        <span>{formatUnixSeconds(record.timestamp)}</span>
        <span aria-hidden className="text-hairline-strong">
          ·
        </span>
        <span>{byteLength} B</span>
      </div>
      {record.attachmentCID?.trim() && (
        <div className={row}>
          <Link2 size={12} aria-hidden className="shrink-0" />
          <span className="truncate font-mono" title={record.attachmentCID}>
            {record.attachmentCID}
          </span>
          <CopyIconButton
            label={copyLabel}
            onClick={() => copyText(record.attachmentCID)}
            size="xs"
          />
        </div>
      )}
      <div className={row}>
        <Hash size={12} aria-hidden className="shrink-0" />
        <span className="truncate font-mono" title={record.payloadHash}>
          {formatHashMiddle(record.payloadHash)}
        </span>
        <CopyIconButton label={copyLabel} onClick={() => copyText(record.payloadHash)} size="xs" />
      </div>
    </div>
  );
}
