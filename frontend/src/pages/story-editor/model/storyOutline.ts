/**
 * Contents outline for the manuscript column.
 *
 * Rows follow document order — the outline is a map of the page you are
 * scrolling, not a re-sort of it. A group heading is emitted whenever the run of
 * records moves into a different taxonomy group, so a profile written in reading
 * order reads as Opening / Early Years / … while one that interleaves types
 * still lines up one-for-one with the manuscript.
 */

import { getRecordTypeGroup } from "./recordTypeGroups";

export interface OutlineRecordInput {
  recordIndex: number;
  displayIndex: number;
  recordType: number;
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
    };

export function buildStoryOutline(
  records: readonly OutlineRecordInput[],
  getRecordTypeLabel: (value: number) => string,
  t: (key: string, fallback: string) => string,
): StoryOutlineItem[] {
  const items: StoryOutlineItem[] = [];
  let lastGroupId: string | null = null;
  let runIndex = 0;

  for (const record of records) {
    const group = getRecordTypeGroup(record.recordType);
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
    items.push({
      kind: "record",
      key: `record-${record.recordIndex}`,
      recordIndex: record.recordIndex,
      displayIndex: record.displayIndex,
      recordType: record.recordType,
      label: getRecordTypeLabel(record.recordType),
    });
  }

  return items;
}

/** DOM id a Contents row links to, and the manuscript entry answers with. */
export function storyRecordAnchorId(recordIndex: number): string {
  return `story-record-${recordIndex}`;
}
