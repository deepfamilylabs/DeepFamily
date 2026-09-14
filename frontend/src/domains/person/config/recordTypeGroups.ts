/**
 * Record type taxonomy groups.
 *
 * The 19 editable record types fall into seven reading-order groups. The help
 * dialog has always described them; the Contents outline and the composer's tag
 * picker now show them directly, so the grouping lives here rather than being
 * spelled out again in each surface. Reading order is derived from it too, so the
 * editor and the person story modal list records the same way.
 */

import type { RecordTypeOption } from "./recordTypes";

export interface RecordTypeGroup {
  id: string;
  /** i18n key, shared with the record type help dialog. */
  labelKey: string;
  fallbackLabel: string;
  values: readonly number[];
}

export const RECORD_TYPE_GROUPS: readonly RecordTypeGroup[] = [
  {
    id: "opening",
    labelKey: "storyRecordEditor.recordTypeHelp.opening",
    fallbackLabel: "Opening",
    values: [1],
  },
  {
    id: "earlyYears",
    labelKey: "storyRecordEditor.recordTypeHelp.earlyYears",
    fallbackLabel: "Early Years",
    values: [2, 3],
  },
  {
    id: "mainNarrative",
    labelKey: "storyRecordEditor.recordTypeHelp.mainNarrative",
    fallbackLabel: "Main Narrative",
    values: [4],
  },
  {
    id: "specializedTopics",
    labelKey: "storyRecordEditor.recordTypeHelp.specializedTopics",
    fallbackLabel: "Specialized Topics",
    values: [5, 6, 7, 8, 9],
  },
  {
    id: "personalLife",
    labelKey: "storyRecordEditor.recordTypeHelp.personalLife",
    fallbackLabel: "Personal Life",
    values: [10, 11, 12],
  },
  {
    id: "socialEngagement",
    labelKey: "storyRecordEditor.recordTypeHelp.socialEngagement",
    fallbackLabel: "Social Engagement",
    values: [13, 14, 15],
  },
  {
    id: "closing",
    labelKey: "storyRecordEditor.recordTypeHelp.closing",
    fallbackLabel: "Closing",
    values: [16, 17, 18, 19],
  },
] as const;

const GROUP_BY_VALUE = new Map<number, RecordTypeGroup>(
  RECORD_TYPE_GROUPS.flatMap((group) => group.values.map((value) => [value, group] as const)),
);

export function getRecordTypeGroup(value: number | null | undefined): RecordTypeGroup | undefined {
  if (value === null || value === undefined) return undefined;
  return GROUP_BY_VALUE.get(Number(value));
}

/** An option plus its index in the flat option list the listbox keyboard model uses. */
export interface GroupedRecordTypeOption {
  option: RecordTypeOption;
  index: number;
}

export interface GroupedRecordTypeOptions {
  id: string;
  label: string;
  options: GroupedRecordTypeOption[];
}

/**
 * Bucket the flat option list into groups while keeping each option's original
 * index, so `useListboxA11y` (which addresses options by flat index) still lines
 * up with what is rendered. Anything outside the known taxonomy is appended in
 * its own group rather than dropped.
 */
export function groupRecordTypeOptions(
  options: RecordTypeOption[],
  t: (key: string, fallback: string) => string,
): GroupedRecordTypeOptions[] {
  const buckets = new Map<string, GroupedRecordTypeOption[]>();
  const ungrouped: GroupedRecordTypeOption[] = [];

  options.forEach((option, index) => {
    const group = getRecordTypeGroup(option.value);
    if (!group) {
      ungrouped.push({ option, index });
      return;
    }
    const bucket = buckets.get(group.id);
    if (bucket) bucket.push({ option, index });
    else buckets.set(group.id, [{ option, index }]);
  });

  const grouped = RECORD_TYPE_GROUPS.map((group) => ({
    id: group.id,
    label: t(group.labelKey, group.fallbackLabel),
    options: buckets.get(group.id) ?? [],
  })).filter((group) => group.options.length > 0);

  if (ungrouped.length > 0) {
    grouped.push({
      id: "other",
      label: t("recordTypes.unknown", "Unknown"),
      options: ungrouped,
    });
  }

  return grouped;
}

/** Which order a profile's records are listed in. */
export type StoryRecordOrder = "reading" | "written";

/** Position of a type's group in reading order; types outside the taxonomy read last. */
function readingGroupRank(recordType: number): number {
  const group = getRecordTypeGroup(recordType);
  return group ? RECORD_TYPE_GROUPS.indexOf(group) : RECORD_TYPE_GROUPS.length;
}

/**
 * Reading order: how the published profile presents records — by taxonomy group,
 * then by type, then by the order the chain holds them (`aOrder` / `bOrder`,
 * normally the record index).
 */
export function compareRecordsForReading(
  a: { recordType: number },
  aOrder: number,
  b: { recordType: number },
  bOrder: number,
): number {
  return (
    readingGroupRank(a.recordType) - readingGroupRank(b.recordType) ||
    a.recordType - b.recordType ||
    aOrder - bOrder
  );
}

/** A copy of the records in reading order; the input keeps its chain order. */
export function sortRecordsForReading<T extends { recordType: number; recordIndex: number }>(
  records: readonly T[],
): T[] {
  return [...records].sort((a, b) => compareRecordsForReading(a, a.recordIndex, b, b.recordIndex));
}
