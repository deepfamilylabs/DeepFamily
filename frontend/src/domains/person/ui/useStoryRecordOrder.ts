import { useCallback, useState } from "react";
import type { StoryRecordOrder } from "../config/recordTypeGroups";

/**
 * Shared by the story editor and the person story modal, so one choice carries
 * across both. The key keeps its original editor-only name so a preference saved
 * before the modal gained the switch is still honoured.
 */
const STORAGE_KEY = "df-story-editor-record-order";

function readStoredOrder(): StoryRecordOrder {
  try {
    return localStorage.getItem(STORAGE_KEY) === "written" ? "written" : "reading";
  } catch {
    return "reading";
  }
}

/**
 * The viewer's record order: reading order unless they picked the order written.
 * Remembering it is a per-viewer convenience — storage that is missing or refuses
 * only means the choice is not kept, never that the switch stops working.
 */
export function useStoryRecordOrder(): [StoryRecordOrder, (next: StoryRecordOrder) => void] {
  const [order, setOrderState] = useState<StoryRecordOrder>(readStoredOrder);
  const setOrder = useCallback((next: StoryRecordOrder) => {
    setOrderState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered this time; the order still changes.
    }
  }, []);
  return [order, setOrder];
}
