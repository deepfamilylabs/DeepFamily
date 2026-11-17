import { useCallback, useEffect, useState } from "react";
import { defaultErrorTranslator, getFriendlyErrorMessage } from "../../../shared/lib/errors";
import type { NodeId } from "../../../shared/model";
import { useTreeGateway } from "./useTreeGateway";

export interface UseChildrenStrictResult {
  childIds: NodeId[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useChildrenStrict(
  parentHash: string | null | undefined,
  parentVersionIndex: number | null | undefined,
  pageLimit: number,
): UseChildrenStrictResult {
  const gateway = useTreeGateway();
  const [childIds, setChildIds] = useState<NodeId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);

  const refetch = useCallback(() => {
    setRefreshRevision((revision) => revision + 1);
    setError(null);
  }, []);

  useEffect(() => {
    if (!gateway || !parentHash || !parentVersionIndex || parentVersionIndex < 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    gateway
      .listChildrenStrictAll(parentHash, parentVersionIndex, { pageLimit })
      .then((result) => {
        if (!cancelled) {
          setChildIds(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            getFriendlyErrorMessage(
              err,
              defaultErrorTranslator as any,
              "Failed to fetch strict children",
              { preferDetailsForUnknown: true },
            ),
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gateway, parentHash, parentVersionIndex, pageLimit, refreshRevision]);

  return { childIds, loading, error, refetch };
}
