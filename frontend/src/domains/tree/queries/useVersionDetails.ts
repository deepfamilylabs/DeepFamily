import { useMemo } from "react";
import { usePersonDetails, type UsePersonDetailsResult } from "../../person/queries";

export function useVersionDetails(
  personHash: string | null | undefined,
  versionIndex: number | null | undefined,
): UsePersonDetailsResult {
  return usePersonDetails(personHash, versionIndex);
}

export function useTreeVersionDetailsKey(
  personHash: string | null | undefined,
  versionIndex: number | null | undefined,
) {
  return useMemo(
    () =>
      personHash && versionIndex && versionIndex > 0
        ? `${personHash.toLowerCase()}:${Number(versionIndex)}`
        : null,
    [personHash, versionIndex],
  );
}
