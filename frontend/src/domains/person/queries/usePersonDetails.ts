import { useCallback, useEffect, useRef, useState } from "react";
import { TTL } from "../../../shared/cache/ttl";
import { defaultErrorTranslator, getFriendlyErrorMessage } from "../../../shared/lib/errors";
import {
  type ParsedVersionDetails,
} from "../api/personReadGateway";
import { usePersonGateway } from "./usePersonGateway";

export interface UsePersonDetailsResult {
  data: ParsedVersionDetails | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePersonDetails(
  personHash: string | null | undefined,
  versionIndex: number | null | undefined,
): UsePersonDetailsResult {
  const gateway = usePersonGateway();
  const [data, setData] = useState<ParsedVersionDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef(0);

  const refetch = useCallback(() => {
    triggerRef.current += 1;
    setData(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!gateway || !personHash || !versionIndex || versionIndex <= 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    gateway
      .getVersionDetails(personHash, versionIndex, { ttlMs: TTL.versionDetails })
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
              "Failed to fetch version details",
              { preferDetailsForUnknown: true },
            ),
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gateway, personHash, versionIndex, triggerRef.current]);

  return { data, loading, error, refetch };
}
