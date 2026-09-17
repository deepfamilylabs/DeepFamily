import { useLayoutEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { ChevronDown, Clock, Hash, Link2, User } from "lucide-react";
import { formatUnixSeconds, shortAddress, type StoryRecord } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import type { StoryRecordOrder } from "../config/recordTypeGroups";
import {
  getRecordTypeBorderColorClass,
  getRecordTypeColorClass,
  getRecordTypeIcon,
} from "../config/recordTypes";

type RecordTypeLabel = (type: number | string | null | undefined) => string;

/**
 * Where a marker hangs off the spine.
 *
 * The line runs at x = 6.5px inside the column, 7.5px from sm where the column
 * gains a pixel of padding, so a dot of width w sits at axis − w/2. Derived once
 * here per size: working it out at each call site is how three dot sizes ended
 * up on three different axes, the 7px fold marker three pixels off the line.
 */
export const STORY_SPINE_MARKER = {
  fold: "-left-[29px] sm:-left-[32px]",
  record: "-left-8 sm:-left-[35px]",
  draft: "-left-[33px] sm:-left-9",
} as const;

const RECORD_ORDERS = [
  { id: "reading", key: "storyRecordEditor.orderReading", fallback: "Reading order" },
  { id: "written", key: "storyRecordEditor.orderWritten", fallback: "Order written" },
] as const;

/**
 * Reading order is how the published profile presents the records — by group,
 * then type. Order written is the chain's own sequence.
 */
export function StoryRecordOrderToggle({
  t,
  value,
  onChange,
}: {
  t: TFunction;
  value: StoryRecordOrder;
  onChange: (next: StoryRecordOrder) => void;
}) {
  return (
    <div className="flex justify-end">
      <div
        role="group"
        aria-label={t("storyRecordEditor.orderLabel", "Record order")}
        className="inline-flex gap-1 rounded-full bg-surface-muted p-1"
      >
        {RECORD_ORDERS.map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.id)}
              className={`min-h-[30px] rounded-full px-3 text-[12px] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                active
                  ? "bg-surface font-semibold text-ink shadow-sm"
                  : "font-medium text-ink-muted hover:text-ink"
              }`}
            >
              {t(item.key, item.fallback)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface StoryTimelineEntryProps {
  t: TFunction;
  record: StoryRecord;
  isExpanded: boolean;
  onToggle: (recordIndex: number) => void;
  getRecordTypeLabel: RecordTypeLabel;
  copyText: (text: string) => void;
  /** Shortens hashes for display; the full hash is always on hover and copy. */
  formatHash?: (hash: string) => string;
  /** DOM id, for surfaces that link to entries (the editor's Contents). */
  anchorId?: string;
}

/**
 * One record as a manuscript entry: a type-coloured marker on the spine, the
 * number, tag, author and size on one line, then title and body read as a
 * document, with provenance one tap away.
 */
export function StoryTimelineEntry({
  t,
  record,
  isExpanded,
  onToggle,
  getRecordTypeLabel,
  copyText,
  formatHash = (hash) => hash,
  anchorId,
}: StoryTimelineEntryProps) {
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  // Whether the clamped body actually overflows. Measured rather than guessed
  // from a character count: 320 characters is three lines of English and seven
  // of Chinese, so a length threshold silently truncates CJK entries.
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || isExpanded) return;
    const measure = () => setOverflows(element.scrollHeight - element.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [record.content, isExpanded]);

  const RecordIcon = getRecordTypeIcon(record.recordType);
  const iconColor = getRecordTypeColorClass(record.recordType);
  const borderColor = getRecordTypeBorderColorClass(record.recordType);
  const byteLength = record.payloadLength ?? new TextEncoder().encode(record.content).length;
  const copyLabel = t("search.copy", "Copy") as string;

  return (
    <article id={anchorId} className="relative flex scroll-mt-24 flex-col gap-2.5">
      <span
        aria-hidden
        className={`absolute ${STORY_SPINE_MARKER.record} top-1 box-border h-[13px] w-[13px] rounded-full border-[3px] bg-surface-body ${borderColor}`}
      />

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-[11px] text-ink-subtle">
          {t("person.recordOrdinal", "No. {{index}}", {
            index: record.displayIndex ?? record.recordIndex + 1,
          })}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border bg-surface py-[3px] pl-2 pr-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] ${iconColor} ${borderColor}`}
        >
          <RecordIcon size={12} aria-hidden />
          {getRecordTypeLabel(record.recordType)}
        </span>
        <span className="grow" />
        {/* Author drops away on narrow screens — it stays one tap away in the
            expanded provenance, and keeping it here dangles a separator. */}
        {record.author && (
          <span className="hidden items-center gap-2.5 sm:flex">
            <span className="font-mono text-[11px] text-ink-subtle" title={record.author}>
              {shortAddress(record.author)}
            </span>
            <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-hairline-strong" />
          </span>
        )}
        <span className="flex items-center gap-2 whitespace-nowrap text-[11px] text-ink-subtle">
          <span>{formatUnixSeconds(record.timestamp)}</span>
          <span aria-hidden className="text-hairline-strong">
            ·
          </span>
          <span>{byteLength} B</span>
        </span>
      </div>

      {record.title?.trim() && (
        <h4 className="mt-3 break-words text-lg font-bold leading-snug text-ink">{record.title}</h4>
      )}
      {record.unsupportedSchema ? (
        <UnsupportedStoryRecord record={record} />
      ) : (
        <p
          ref={bodyRef}
          className={`text-[15.5px] leading-[1.8] text-ink ${
            isExpanded ? "whitespace-pre-wrap" : "line-clamp-4"
          }`}
          style={{ textWrap: "pretty" } as React.CSSProperties}
        >
          {record.content}
        </p>
      )}

      {(overflows || isExpanded) && !record.unsupportedSchema && (
        <button
          type="button"
          onClick={() => onToggle(record.recordIndex)}
          aria-expanded={isExpanded}
          className="flex w-fit items-center gap-1.5 rounded-lg py-0.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {isExpanded
            ? t("storyRecordEditor.collapseRecord", "Collapse")
            : t("storyRecordEditor.readFullRecord", "Read the full record")}
          <ChevronDown
            size={13}
            aria-hidden
            className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {isExpanded && (
        <div className="flex flex-col gap-1 border-t border-hairline pt-2">
          {record.author && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <User size={12} aria-hidden className="shrink-0" />
              <span className="truncate font-mono" title={record.author}>
                {shortAddress(record.author)}
              </span>
              <CopyIconButton
                label={copyLabel}
                onClick={() => copyText(record.author)}
                size="xs"
                stopPropagation
              />
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <Clock size={12} aria-hidden className="shrink-0" />
            <span>{formatUnixSeconds(record.timestamp)}</span>
          </div>
          {record.attachmentURI && record.attachmentURI.trim().length > 0 && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <Link2 size={12} aria-hidden className="shrink-0" />
              <span className="truncate font-mono">{record.attachmentURI}</span>
              <CopyIconButton
                label={copyLabel}
                onClick={() => copyText(record.attachmentURI)}
                size="xs"
                stopPropagation
              />
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <Hash size={12} aria-hidden className="shrink-0" />
            <span className="truncate font-mono" title={record.payloadHash}>
              {formatHash(record.payloadHash)}
            </span>
            <CopyIconButton
              label={copyLabel}
              onClick={() => copyText(record.payloadHash)}
              size="xs"
              stopPropagation
            />
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Every record on one spine, in the order given — the story editor's manuscript
 * without its composer or fold, for surfaces that only read.
 */
export function StoryRecordTimeline({
  t,
  records,
  expandedRecords,
  onToggleRecord,
  getRecordTypeLabel,
  copyText,
  formatHash,
}: {
  t: TFunction;
  records: StoryRecord[];
  expandedRecords: Set<number>;
  onToggleRecord: (recordIndex: number) => void;
  getRecordTypeLabel: RecordTypeLabel;
  copyText: (text: string) => void;
  formatHash?: (hash: string) => string;
}) {
  return (
    <div className="relative flex flex-col gap-7 pl-8 sm:pl-9">
      {/* the spine the entries hang off */}
      <div
        aria-hidden
        className="absolute bottom-2 left-[6px] top-2.5 w-px bg-hairline-strong/50 sm:left-[7px]"
      />
      {records.map((record) => (
        <StoryTimelineEntry
          key={record.recordIndex}
          t={t}
          record={record}
          isExpanded={expandedRecords.has(record.recordIndex)}
          onToggle={onToggleRecord}
          getRecordTypeLabel={getRecordTypeLabel}
          copyText={copyText}
          formatHash={formatHash}
        />
      ))}
    </div>
  );
}
