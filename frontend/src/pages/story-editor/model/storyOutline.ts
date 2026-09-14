/**
 * Contents outline for the editor's left column, in either of two orders.
 *
 * Reading order is how the published profile presents its records (the person
 * page's default sections view): by taxonomy group, then by type, then by the
 * order the chain holds them — a Summary written last is still read first.
 * Order written is the chain's own append sequence, with a heading wherever the
 * run of records moves into a different group.
 *
 * The manuscript uses the same order the writer picked, so Contents always maps
 * the page being scrolled. The record being composed takes its place in that
 * order too: inside its group, after the records of its type, when reading; at
 * the end, where the chain will append it, when following the order written.
 */

import { getStoryRecordTitle } from "../../../shared/model/storyPresentation";
import { RECORD_TYPE_GROUPS, getRecordTypeGroup } from "./recordTypeGroups";

export type StoryRecordOrder = "reading" | "written";

export interface OutlineRecordInput {
  title?: string;
  recordIndex: number;
  displayIndex: number;
  recordType: number;
}

/** The composer's draft, placed in the outline before it exists on chain. */
export interface OutlineDraftInput {
  title?: string;
  recordType: number;
  displayIndex: number;
}

export interface BuildStoryOutlineOptions {
  order?: StoryRecordOrder;
  draft?: OutlineDraftInput | null;
}

export type StoryOutlineItem =
  | { kind: "group"; key: string; label: string }
  | {
      kind: "record";
      key: string;
      recordIndex: number;
      displayIndex: number;
      recordType: number;
      label: string;
    }
  | {
      kind: "draft";
      key: string;
      displayIndex: number;
      recordType: number;
      label: string;
    };

/** Position of a type's group in reading order; types outside the taxonomy read last. */
function groupRank(recordType: number): number {
  const group = getRecordTypeGroup(recordType);
  return group ? RECORD_TYPE_GROUPS.indexOf(group) : RECORD_TYPE_GROUPS.length;
}

function compareForReading(
  a: { recordType: number },
  aOrder: number,
  b: { recordType: number },
  bOrder: number,
): number {
  return (
    groupRank(a.recordType) - groupRank(b.recordType) ||
    a.recordType - b.recordType ||
    aOrder - bOrder
  );
}

/** Records in the order the published profile reads them. */
export function sortRecordsForReading<T extends { recordType: number; recordIndex: number }>(
  records: readonly T[],
): T[] {
  return [...records].sort((a, b) => compareForReading(a, a.recordIndex, b, b.recordIndex));
}

export function buildStoryOutline(
  records: readonly OutlineRecordInput[],
  getRecordTypeLabel: (value: number) => string,
  t: (key: string, fallback: string) => string,
  { order = "reading", draft = null }: BuildStoryOutlineOptions = {},
): StoryOutlineItem[] {
  type Entry =
    | { draft: false; record: OutlineRecordInput; order: number }
    | { draft: true; record: OutlineDraftInput; order: number };

  const entries: Entry[] = records.map((record) => ({
    draft: false,
    record,
    order: record.recordIndex,
  }));
  // Not yet on chain, so it follows every written record — of its type when
  // reading, of the whole story when following the order written.
  if (draft) entries.push({ draft: true, record: draft, order: Number.POSITIVE_INFINITY });

  if (order === "reading") {
    entries.sort((a, b) => compareForReading(a.record, a.order, b.record, b.order));
  }

  const items: StoryOutlineItem[] = [];
  let lastGroupId: string | null = null;
  let runIndex = 0;

  for (const entry of entries) {
    const group = getRecordTypeGroup(entry.record.recordType);
    const groupId = group?.id ?? "other";
    if (groupId !== lastGroupId) {
      runIndex += 1;
      items.push({
        kind: "group",
        key: `group-${groupId}-${runIndex}`,
        label: group ? t(group.labelKey, group.fallbackLabel) : t("recordTypes.unknown", "Unknown"),
      });
      lastGroupId = groupId;
    }

    const label = getStoryRecordTitle(entry.record, getRecordTypeLabel(entry.record.recordType));
    if (entry.draft) {
      items.push({
        kind: "draft",
        key: "draft",
        displayIndex: entry.record.displayIndex,
        recordType: entry.record.recordType,
        label,
      });
    } else {
      items.push({
        kind: "record",
        key: `record-${entry.record.recordIndex}`,
        recordIndex: entry.record.recordIndex,
        displayIndex: entry.record.displayIndex,
        recordType: entry.record.recordType,
        label,
      });
    }
  }

  return items;
}

/** DOM id a Contents row links to, and the manuscript entry answers with. */
export function storyRecordAnchorId(recordIndex: number): string {
  return `story-record-${recordIndex}`;
}
