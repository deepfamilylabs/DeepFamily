/**
 * Manuscript segmentation.
 *
 * A long profile reads better with its opening and its most recent entry in
 * view and the middle folded away — everything stays reachable from Contents,
 * which lists every chunk regardless. Short profiles are never folded.
 */

/** Entries kept visible at the start of the manuscript. */
export const MANUSCRIPT_HEAD_COUNT = 2;
/** Entries kept visible at the end, next to the composer. */
export const MANUSCRIPT_TAIL_COUNT = 1;
/** Below this the fold would hide too little to be worth a row of its own. */
export const MANUSCRIPT_MIN_COLLAPSED = 3;

export interface ManuscriptSegments<T> {
  head: T[];
  collapsed: T[];
  tail: T[];
}

export function segmentManuscript<T>(chunks: readonly T[]): ManuscriptSegments<T> {
  const middle = chunks.length - MANUSCRIPT_HEAD_COUNT - MANUSCRIPT_TAIL_COUNT;
  if (middle < MANUSCRIPT_MIN_COLLAPSED) {
    return { head: [...chunks], collapsed: [], tail: [] };
  }
  return {
    head: chunks.slice(0, MANUSCRIPT_HEAD_COUNT),
    collapsed: chunks.slice(MANUSCRIPT_HEAD_COUNT, chunks.length - MANUSCRIPT_TAIL_COUNT),
    tail: chunks.slice(chunks.length - MANUSCRIPT_TAIL_COUNT),
  };
}

/** Distinct type labels behind the fold, capped so the row stays one line. */
export function summariseCollapsedTypes(
  collapsed: readonly { chunkType: number }[],
  getChunkTypeLabel: (value: number) => string,
  limit = 4,
): { labels: string[]; truncated: boolean } {
  const seen = new Set<number>();
  const labels: string[] = [];
  for (const chunk of collapsed) {
    if (seen.has(chunk.chunkType)) continue;
    seen.add(chunk.chunkType);
    if (labels.length < limit) labels.push(getChunkTypeLabel(chunk.chunkType));
  }
  return { labels, truncated: seen.size > labels.length };
}
