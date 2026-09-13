/**
 * Manuscript segmentation.
 *
 * A long profile reads better with its opening and its most recent entry in
 * view and the middle folded away — everything stays reachable from Contents,
 * which lists every record regardless. Short profiles are never folded.
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

export function segmentManuscript<T>(records: readonly T[]): ManuscriptSegments<T> {
  const middle = records.length - MANUSCRIPT_HEAD_COUNT - MANUSCRIPT_TAIL_COUNT;
  if (middle < MANUSCRIPT_MIN_COLLAPSED) {
    return { head: [...records], collapsed: [], tail: [] };
  }
  return {
    head: records.slice(0, MANUSCRIPT_HEAD_COUNT),
    collapsed: records.slice(MANUSCRIPT_HEAD_COUNT, records.length - MANUSCRIPT_TAIL_COUNT),
    tail: records.slice(records.length - MANUSCRIPT_TAIL_COUNT),
  };
}

/** Distinct type labels behind the fold, capped so the row stays one line. */
export function summariseCollapsedTypes(
  collapsed: readonly { recordType: number }[],
  getRecordTypeLabel: (value: number) => string,
  limit = 4,
): { labels: string[]; truncated: boolean } {
  const seen = new Set<number>();
  const labels: string[] = [];
  for (const record of collapsed) {
    if (seen.has(record.recordType)) continue;
    seen.add(record.recordType);
    if (labels.length < limit) labels.push(getRecordTypeLabel(record.recordType));
  }
  return { labels, truncated: seen.size > labels.length };
}
