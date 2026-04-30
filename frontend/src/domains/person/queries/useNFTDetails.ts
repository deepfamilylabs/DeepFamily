import { useCallback, useEffect, useRef, useState } from "react";
import { TTL } from "../../../shared/cache/ttl";
import { defaultErrorTranslator, getFriendlyErrorMessage } from "../../../shared/lib/errors";
import type { ParsedNftDetails } from "../api/personReadGateway";
import { usePersonGateway } from "./usePersonGateway";

export interface UseNFTDetailsResult {
  data: ParsedNftDetails | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useNFTDetails(
  tokenId: string | null | undefined,
): UseNFTDetailsResult {
  const gateway = usePersonGateway();
  const [data, setData] = useState<ParsedNftDetails | null>(null);
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

    gateway
      .getNFTDetails(tokenId, { ttlMs: TTL.nftDetails })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            getFriendlyErrorMessage(
              err,
              defaultErrorTranslator as any,
              "Failed to fetch NFT details",
              { preferDetailsForUnknown: true },
            ),
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gateway, tokenId, triggerRef.current]);

  return { data, loading, error, refetch };
}
