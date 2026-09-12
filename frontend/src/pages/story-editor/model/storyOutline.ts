/**
 * Contents outline for the manuscript column.
 *
 * Rows follow document order — the outline is a map of the page you are
 * scrolling, not a re-sort of it. A group heading is emitted whenever the run of
 * chunks moves into a different taxonomy group, so a profile written in reading
 * order reads as Opening / Early Years / … while one that interleaves types
 * still lines up one-for-one with the manuscript.
 */

import { getChunkTypeGroup } from "./chunkTypeGroups";

export interface OutlineChunkInput {
  chunkIndex: number;
  displayIndex: number;
  chunkType: number;
}

export type StoryOutlineItem =
  | { kind: "group"; key: string; label: string }
  | {
      kind: "chunk";
      key: string;
      chunkIndex: number;
      displayIndex: number;
      chunkType: number;
      label: string;
    };

export function buildStoryOutline(
  chunks: readonly OutlineChunkInput[],
  getChunkTypeLabel: (value: number) => string,
  t: (key: string, fallback: string) => string,
): StoryOutlineItem[] {
  const items: StoryOutlineItem[] = [];
  let lastGroupId: string | null = null;
  let runIndex = 0;

  for (const chunk of chunks) {
    const group = getChunkTypeGroup(chunk.chunkType);
    const groupId = group?.id ?? "other";
    if (groupId !== lastGroupId) {
      runIndex += 1;
      items.push({
        kind: "group",
        key: `group-${groupId}-${runIndex}`,
        label: group ? t(group.labelKey, group.fallbackLabel) : t("chunkTypes.unknown", "Unknown"),
      });
      lastGroupId = groupId;
    }
    items.push({
      kind: "chunk",
      key: `chunk-${chunk.chunkIndex}`,
      chunkIndex: chunk.chunkIndex,
      displayIndex: chunk.displayIndex,
      chunkType: chunk.chunkType,
      label: getChunkTypeLabel(chunk.chunkType),
    });
  }

  return items;
}

/** DOM id a Contents row links to, and the manuscript entry answers with. */
export function storyChunkAnchorId(chunkIndex: number): string {
  return `story-chunk-${chunkIndex}`;
}
