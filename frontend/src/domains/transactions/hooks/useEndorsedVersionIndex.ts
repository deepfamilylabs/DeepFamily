import { useEffect, useState } from "react";

/**
 * The version of a person this wallet has endorsed, or 0 when none.
 *
 * Minting requires a prior endorsement from the caller, so this is the only
 * version a mint target picker can sensibly preselect.
 */
export function useEndorsedVersionIndex(
  personHash: string | null,
  address?: string | null,
  contract?: any,
): number {
  const [versionIndex, setVersionIndex] = useState(0);

  useEffect(() => {
    if (!personHash || !address || !contract?.endorsedVersionIndex) {
      setVersionIndex(0);
      return;
    }
    let cancelled = false;
    setVersionIndex(0);
    void (async () => {
      try {
        const endorsed = await contract.endorsedVersionIndex(personHash, address);
        if (!cancelled) setVersionIndex(Number(endorsed) || 0);
      } catch {
        if (!cancelled) setVersionIndex(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, contract, personHash]);

  return versionIndex;
}
