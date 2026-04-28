import { useCallback, useEffect, useMemo, useState } from "react";

interface UseEndorseTargetStatusArgs {
  isOpen: boolean;
  address?: string | null;
  contract?: any;
  getVersionDetails?: (personHash: string, versionIndex: number) => Promise<any>;
  getNFTDetails?: (tokenId: number) => Promise<any>;
  getOwnerOf?: (tokenId: string) => Promise<string | null>;
  targetPersonHash: string;
  targetVersionIndex: number;
  hasValidTarget: boolean;
}

const defaultTargetStatus = {
  currentEndorsementCount: 0,
  hasEndorsed: false,
  feeRecipient: "",
  isTargetValidOnChain: false,
  isNFTMinted: false,
  displayName: "",
};

function getVersionDisplayName(details: any) {
  return (
    details?.version?.coreInfo?.supplementInfo?.fullName ||
    details?.version?.coreInfo?.fullName ||
    details?.version?.fullName ||
    ""
  );
}

function getNftDisplayName(nftDetails: any) {
  return (
    nftDetails?.coreInfo?.supplementInfo?.fullName ||
    nftDetails?.coreInfo?.fullName ||
    ""
  );
}

export function useEndorseTargetStatus({
  isOpen,
  address,
  contract,
  getVersionDetails,
  getNFTDetails,
  getOwnerOf,
  targetPersonHash,
  targetVersionIndex,
  hasValidTarget,
}: UseEndorseTargetStatusArgs) {
  const [status, setStatus] = useState(defaultTargetStatus);

  const reset = useCallback(() => {
    setStatus(defaultTargetStatus);
  }, []);

  const markEndorsed = useCallback((options?: { increment?: boolean }) => {
    setStatus((current) => ({
      ...current,
      hasEndorsed: true,
      currentEndorsementCount: options?.increment
        ? current.currentEndorsementCount + 1
        : current.currentEndorsementCount,
    }));
  }, []);

  useEffect(() => {
    if (!isOpen || !hasValidTarget) {
      reset();
      return;
    }

    let cancelled = false;
    reset();

    const loadTargetStatus = async () => {
      if (!address || !contract || !contract.runner || !getVersionDetails || !targetPersonHash) return;

      try {
        const details = await getVersionDetails(targetPersonHash, targetVersionIndex);
        if (cancelled) return;

        if (details) {
          const tokenId = Number(details.tokenId);
          let displayName = getVersionDisplayName(details);
          let feeRecipient = details?.version?.addedBy || "";

          if (tokenId > 0) {
            if (getNFTDetails) {
              try {
                const nftDetails = await getNFTDetails(tokenId);
                if (cancelled) return;
                displayName = getNftDisplayName(nftDetails) || displayName;
              } catch {}
            }

            try {
              feeRecipient =
                (await getOwnerOf?.(String(tokenId))) ||
                (contract.ownerOf ? await contract.ownerOf(tokenId) : feeRecipient);
            } catch {}
          }

          if (cancelled) return;
          setStatus((current) => ({
            ...current,
            currentEndorsementCount: Number(details.endorsementCount),
            feeRecipient,
            isTargetValidOnChain: true,
            isNFTMinted: tokenId > 0,
            displayName,
          }));
        } else {
          setStatus((current) => ({ ...current, isTargetValidOnChain: false }));
        }
      } catch {
        if (!cancelled) {
          setStatus((current) => ({ ...current, isTargetValidOnChain: false }));
        }
      }

      try {
        const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash, address);
        if (!cancelled) {
          setStatus((current) => ({
            ...current,
            hasEndorsed: Number(endorsedIdx) === Number(targetVersionIndex),
          }));
        }
      } catch {
        if (!cancelled) {
          setStatus((current) => ({ ...current, hasEndorsed: false }));
        }
      }
    };

    loadTargetStatus();
    return () => {
      cancelled = true;
    };
  }, [
    address,
    contract,
    getNFTDetails,
    getOwnerOf,
    getVersionDetails,
    hasValidTarget,
    isOpen,
    reset,
    targetPersonHash,
    targetVersionIndex,
  ]);

  return useMemo(
    () => ({
      ...status,
      markEndorsed,
      reset,
    }),
    [markEndorsed, reset, status],
  );
}
