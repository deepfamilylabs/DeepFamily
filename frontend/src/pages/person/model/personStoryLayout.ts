/**
 * How the person page lays a story out for reading.
 *
 * Records are read in sections, one per record type, in the taxonomy's reading
 * order. A long section keeps its first few records in view and folds the rest
 * behind a single row; Contents still lists every record, and jumping to a
 * folded one opens its section first. Two types read better with their own
 * typesetting — a quote with its source on a line of its own, a reference with
 * its link — so their records are split here, before any markup sees them.
 */

import { RECORD_TYPE_GROUPS, getRecordTypeGroup } from "../../../domains/person";
import type { StoryRecord } from "../../../shared/model";
import type { GroupedStoryRecords } from "./personPageModel";

/** A section folds once it holds more records than this. */
export const SECTION_FOLD_THRESHOLD = 5;
/** Records a folded section keeps in view above its fold. */
export const SECTION_HEAD_COUNT = 3;

export interface SectionRecordSplit {
  visible: StoryRecord[];
  hidden: StoryRecord[];
}

export function splitSectionRecords(
  records: readonly StoryRecord[],
  expanded: boolean,
): SectionRecordSplit {
  if (expanded || records.length <= SECTION_FOLD_THRESHOLD) {
    return { visible: [...records], hidden: [] };
  }
  return {
    visible: records.slice(0, SECTION_HEAD_COUNT),
    hidden: records.slice(SECTION_HEAD_COUNT),
  };
}

/** Whether the record sits behind its section's fold while the section is collapsed. */
export function isRecordFolded(records: readonly StoryRecord[], recordIndex: number): boolean {
  if (records.length <= SECTION_FOLD_THRESHOLD) return false;
  return records.findIndex((record) => record.recordIndex === recordIndex) >= SECTION_HEAD_COUNT;
}

/** Titles of the records behind a fold, capped so the fold stays one line. */
export function summariseRecordTitles(
  records: readonly { title?: string }[],
  limit = 4,
): { titles: string[]; truncated: boolean } {
  const titled = records
    .map((record) => record.title?.trim() ?? "")
    .filter((title) => title.length > 0);
  return { titles: titled.slice(0, limit), truncated: titled.length > limit };
}

/**
 * The opening of a record, for places that name a record without a title.
 * Counted in code points so a CJK excerpt is not cut through a surrogate pair.
 */
export function getRecordExcerpt(content: string, maxLength = 24): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const characters = Array.from(flat);
  if (characters.length <= maxLength) return flat;
  return `${characters.slice(0, maxLength).join("").trimEnd()}…`;
}

export interface QuoteParts {
  quote: string;
  source?: string;
}

/** Splits “quote” ——source at the last em-dash pair; anything else stays whole. */
export function splitQuoteSource(content: string): QuoteParts {
  const text = content.trim();
  const at = text.lastIndexOf("——");
  if (at <= 0) return { quote: text };
  const quote = text.slice(0, at).trim();
  const source = text.slice(at + 2).trim();
  return quote && source ? { quote, source } : { quote: text };
}

export interface ReferenceParts {
  label: string;
  url?: string;
  displayUrl?: string;
}

const REFERENCE_URL = /https?:\/\/[^\s<>"'，。；、）)]+/i;

function decodeForDisplay(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * Finds the first http(s) link in a reference record. Only those two protocols
 * are ever returned as a link target; the label is the rest of the text.
 */
export function splitReferenceLink(content: string): ReferenceParts {
  const text = content.trim();
  const match = REFERENCE_URL.exec(text);
  if (!match) return { label: text };

  let parsed: URL;
  try {
    parsed = new URL(match[0]);
  } catch {
    return { label: text };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { label: text };

  const rest = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`
    .trim()
    .replace(/[:：\s]+$/u, "")
    .trim();
  const displayUrl = decodeForDisplay(`${parsed.host}${parsed.pathname}${parsed.search}`).replace(
    /\/$/,
    "",
  );
  return { label: rest || displayUrl, url: parsed.href, displayUrl };
}

/** Position of a type in reading order; types outside the taxonomy read last. */
function readingRank(type: number): number {
  const group = getRecordTypeGroup(type);
  return group ? RECORD_TYPE_GROUPS.indexOf(group) : RECORD_TYPE_GROUPS.length;
}

/** Sections in the order the page presents them. */
export function sortSectionsForReading(
  groups: readonly GroupedStoryRecords[],
): GroupedStoryRecords[] {
  return [...groups].sort((a, b) => readingRank(a.type) - readingRank(b.type) || a.type - b.type);
}

export type PersonContentsItem =
  | { kind: "group"; id: string; labelKey: string; fallbackLabel: string }
  | { kind: "section"; type: number; records: StoryRecord[] };

/** Contents rows: a heading wherever the reading order enters a new taxonomy group. */
export function buildPersonContents(groups: readonly GroupedStoryRecords[]): PersonContentsItem[] {
  const items: PersonContentsItem[] = [];
  let lastGroupId: string | null = null;
  for (const section of sortSectionsForReading(groups)) {
    const group = getRecordTypeGroup(section.type);
    const id = group?.id ?? "other";
    if (id !== lastGroupId) {
      items.push(
        group
          ? { kind: "group", id, labelKey: group.labelKey, fallbackLabel: group.fallbackLabel }
          : { kind: "group", id, labelKey: "recordTypes.unknown", fallbackLabel: "Unknown" },
      );
      lastGroupId = id;
    }
    items.push({ kind: "section", type: section.type, records: section.records });
  }
  return items;
}
