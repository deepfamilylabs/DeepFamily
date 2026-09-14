import { useCallback, useEffect, useState } from "react";
import { TTL } from "../../../shared/cache/ttl";
import { defaultErrorTranslator, getFriendlyErrorMessage } from "../../../shared/lib/errors";
import {
  buildStoryDataResult,
  mergeStoryRecords,
  getMissingStoryOffset,
  type StoryRecord,
  type StoryDataResult,
} from "../../../shared/model";
import { usePersonGateway } from "./usePersonGateway";

const STORY_PAGE_SIZE = 50;

export interface UseStoryDataResult {
  data: StoryDataResult | null;
  loading: boolean;
  error: string | null;
  /**
   * Refetch from the chain. By default the current data is dropped first, so
   * consumers fall back to their loading state; `keepData` revalidates in place
   * instead, for refreshes the reader did not ask for and should not have to
   * watch.
   */
  refetch: (options?: { keepData?: boolean }) => void;
}

export function useStoryData(tokenId: string | null | undefined): UseStoryDataResult {
  const gateway = usePersonGateway();
  const [data, setData] = useState<StoryDataResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State, not a ref: the effect re-runs on the value changing, and a `keepData`
  // refetch may change nothing else to re-render on.
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback((options?: { keepData?: boolean }) => {
    if (!options?.keepData) setData(null);
    setError(null);
    setTrigger((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!gateway || !tokenId || tokenId === "0") return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const metadata = await gateway.getStoryMetadata(tokenId, { ttlMs: TTL.story });
        if (cancelled) return;

        if (metadata.totalRecords === 0) {
          setData(buildStoryDataResult([], metadata, Date.now()));
          setLoading(false);
          return;
        }

        let allRecords: StoryRecord[] = [];
        let offset = 0;
        while (offset < metadata.totalRecords) {
          if (cancelled) return;
          const batch = await gateway.getStoryRecords(tokenId, offset, STORY_PAGE_SIZE);
          allRecords = mergeStoryRecords(allRecords, batch, metadata.totalRecords);
          if (batch.length === 0) break;
          offset = getMissingStoryOffset(allRecords);
          if (offset >= metadata.totalRecords) break;
        }

        if (!cancelled) {
          setData(buildStoryDataResult(allRecords, metadata, Date.now()));
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(
            getFriendlyErrorMessage(
              err,
              defaultErrorTranslator as any,
              "Failed to fetch story data",
              { preferDetailsForUnknown: true },
            ),
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gateway, tokenId, trigger]);

  return { data, loading, error, refetch };
}
