import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeId } from "../../../types/graph";
import { TTL } from "../../../shared/cache/ttl";
import { useTreeGateway } from "./useTreeGateway";

export interface UseChildrenUnionResult {
  childIds: NodeId[];
  totalVersions: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useChildrenUnion(
  parentHash: string | null | undefined,
  pageLimit: number,
): UseChildrenUnionResult {
  const gateway = useTreeGateway();
  const [childIds, setChildIds] = useState<NodeId[]>([]);
  const [totalVersions, setTotalVersions] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef(0);

  const refetch = useCallback(() => {
    triggerRef.current += 1;
    setError(null);
  }, []);

  useEffect(() => {
    if (!gateway || !parentHash) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    gateway
      .listChildrenUnionAll(parentHash, {
        pageLimit,
        totalVersionsOptions: { ttlMs: TTL.totalVersions },
      })
      .then((result) => {
        if (!cancelled) {
          setChildIds(result.childIds);
          setTotalVersions(result.totalVersions);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to fetch union children");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gateway, parentHash, pageLimit, triggerRef.current]);

  return { childIds, totalVersions, loading, error, refetch };
}
