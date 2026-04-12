import { useMemo } from "react";
import { makeNodeId, type NodeId } from "../../../shared/model";
import { useConfig } from "../../config/context";

export function useTreeRoot(): NodeId | null {
  const { rootHash, rootVersionIndex } = useConfig();

  return useMemo(() => {
    const isValidHash = typeof rootHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(rootHash);
    const version = Number(rootVersionIndex);
    const isValidVersion = Number.isFinite(version) && version >= 1;
    if (!isValidHash || !isValidVersion) return null;
    return makeNodeId(rootHash, version);
  }, [rootHash, rootVersionIndex]);
}
