import { useCallback, useEffect, useRef, useState } from "react";
import { TTL } from "../../../shared/cache/ttl";
import { defaultErrorTranslator, getFriendlyErrorMessage } from "../../../shared/lib/errors";
import {
  buildStoryDataResult,
  mergeStoryChunkRecords,
  getMissingStoryOffset,
  type StoryDataResult,
} from "../model/storyData";
import type { StoryChunk } from "../../../shared/model";
import { usePersonGateway } from "./usePersonGateway";

const STORY_PAGE_SIZE = 50;

export interface UseStoryDataResult {
  data: StoryDataResult | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStoryData(
  tokenId: string | null | undefined,
): UseStoryDataResult {
  const gateway = usePersonGateway();
  const [data, setData] = useState<StoryDataResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef(0);

  const refetch = useCallback(() => {
    triggerRef.current += 1;
    setData(null);
    setError(null);
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

        if (metadata.totalChunks === 0) {
          setData(buildStoryDataResult([], metadata, Date.now()));
          setLoading(false);
          return;
        }

        let allChunks: StoryChunk[] = [];
        let offset = 0;
        while (offset < metadata.totalChunks) {
          if (cancelled) return;
          const batch = await gateway.getStoryChunks(tokenId, offset, STORY_PAGE_SIZE);
          allChunks = mergeStoryChunkRecords(allChunks, batch, metadata.totalChunks);
          if (batch.length === 0) break;
          offset = getMissingStoryOffset(allChunks);
          if (offset >= metadata.totalChunks) break;
        }

        if (!cancelled) {
          setData(buildStoryDataResult(allChunks, metadata, Date.now()));
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
  }, [gateway, tokenId, triggerRef.current]);

  return { data, loading, error, refetch };
}
