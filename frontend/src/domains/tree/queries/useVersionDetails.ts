import { useMemo } from "react";

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
