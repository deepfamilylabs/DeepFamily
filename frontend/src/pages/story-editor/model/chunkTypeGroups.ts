/**
 * Chunk type taxonomy groups.
 *
 * The 19 editable chunk types fall into seven reading-order groups. The help
 * dialog has always described them; the Contents outline and the composer's tag
 * picker now show them directly, so the grouping lives here rather than being
 * spelled out again in each surface.
 */

import type { ChunkTypeOption } from "../../../domains/person";

export interface ChunkTypeGroup {
  id: string;
  /** i18n key, shared with the chunk type help dialog. */
  labelKey: string;
  fallbackLabel: string;
  values: readonly number[];
}

export const CHUNK_TYPE_GROUPS: readonly ChunkTypeGroup[] = [
  {
    id: "opening",
    labelKey: "storyChunkEditor.chunkTypeHelp.opening",
    fallbackLabel: "Opening",
    values: [1],
  },
  {
    id: "earlyYears",
    labelKey: "storyChunkEditor.chunkTypeHelp.earlyYears",
    fallbackLabel: "Early Years",
    values: [2, 3],
  },
  {
    id: "mainNarrative",
    labelKey: "storyChunkEditor.chunkTypeHelp.mainNarrative",
    fallbackLabel: "Main Narrative",
    values: [4],
  },
  {
    id: "specializedTopics",
    labelKey: "storyChunkEditor.chunkTypeHelp.specializedTopics",
    fallbackLabel: "Specialized Topics",
    values: [5, 6, 7, 8, 9],
  },
  {
    id: "personalLife",
    labelKey: "storyChunkEditor.chunkTypeHelp.personalLife",
    fallbackLabel: "Personal Life",
    values: [10, 11, 12],
  },
  {
    id: "socialEngagement",
    labelKey: "storyChunkEditor.chunkTypeHelp.socialEngagement",
    fallbackLabel: "Social Engagement",
    values: [13, 14, 15],
  },
  {
    id: "closing",
    labelKey: "storyChunkEditor.chunkTypeHelp.closing",
    fallbackLabel: "Closing",
    values: [16, 17, 18, 19],
  },
] as const;

const GROUP_BY_VALUE = new Map<number, ChunkTypeGroup>(
  CHUNK_TYPE_GROUPS.flatMap((group) => group.values.map((value) => [value, group] as const)),
);

export function getChunkTypeGroup(value: number | null | undefined): ChunkTypeGroup | undefined {
  if (value === null || value === undefined) return undefined;
  return GROUP_BY_VALUE.get(Number(value));
}

/** An option plus its index in the flat option list the listbox keyboard model uses. */
export interface GroupedChunkTypeOption {
  option: ChunkTypeOption;
  index: number;
}

export interface GroupedChunkTypeOptions {
  id: string;
  label: string;
  options: GroupedChunkTypeOption[];
}

/**
 * Bucket the flat option list into groups while keeping each option's original
 * index, so `useListboxA11y` (which addresses options by flat index) still lines
 * up with what is rendered. Anything outside the known taxonomy is appended in
 * its own group rather than dropped.
 */
export function groupChunkTypeOptions(
  options: ChunkTypeOption[],
  t: (key: string, fallback: string) => string,
): GroupedChunkTypeOptions[] {
  const buckets = new Map<string, GroupedChunkTypeOption[]>();
  const ungrouped: GroupedChunkTypeOption[] = [];

  options.forEach((option, index) => {
    const group = getChunkTypeGroup(option.value);
    if (!group) {
      ungrouped.push({ option, index });
      return;
    }
    const bucket = buckets.get(group.id);
    if (bucket) bucket.push({ option, index });
    else buckets.set(group.id, [{ option, index }]);
  });

  const grouped = CHUNK_TYPE_GROUPS.map((group) => ({
    id: group.id,
    label: t(group.labelKey, group.fallbackLabel),
    options: buckets.get(group.id) ?? [],
  })).filter((group) => group.options.length > 0);

  if (ungrouped.length > 0) {
    grouped.push({
      id: "other",
      label: t("chunkTypes.unknown", "Unknown"),
      options: ungrouped,
    });
  }

  return grouped;
}
