import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import type { MintMissingParents } from "../model/mintNftTypes";

interface UseMintTargetStatusArgs {
  isOpen: boolean;
  address?: string | null;
  contract?: any;
  getVersionDetails?: (personHash: string, versionIndex: number) => Promise<any>;
  targetPersonHash: string;
  targetVersionIndex: number;
  hasValidTarget: boolean;
}

const defaultTargetStatus = {
  isEndorsed: false,
  isAlreadyMinted: false,
  isCheckingStatus: false,
  hasMissingParents: null as MintMissingParents,
};

function getMissingParents(details: any): MintMissingParents {
  const fatherMissing =
    !details?.version?.fatherHash || details.version.fatherHash === ethers.ZeroHash;
  const motherMissing =
    !details?.version?.motherHash || details.version.motherHash === ethers.ZeroHash;

  return fatherMissing || motherMissing ? { father: fatherMissing, mother: motherMissing } : null;
}

export function useMintTargetStatus({
  isOpen,
  address,
  contract,
  getVersionDetails,
  targetPersonHash,
  targetVersionIndex,
  hasValidTarget,
}: UseMintTargetStatusArgs) {
  const [status, setStatus] = useState(defaultTargetStatus);

  const reset = useCallback(() => {
    setStatus(defaultTargetStatus);
  }, []);

  const markMinted = useCallback(() => {
    setStatus((current) => ({ ...current, isAlreadyMinted: true }));
  }, []);

  useEffect(() => {
    if (!isOpen || !hasValidTarget) {
      reset();
      return;
    }

    let cancelled = false;
    setStatus((current) => ({ ...current, isCheckingStatus: true }));

    const loadStatus = async () => {
      if (!address || !getVersionDetails || !targetPersonHash || !targetVersionIndex || !contract) {
        if (!cancelled) {
          setStatus((current) => ({ ...current, isCheckingStatus: false }));
        }
        return;
      }

      try {
        const details = await getVersionDetails(targetPersonHash, targetVersionIndex);
        const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash, address);
        if (cancelled) return;

        setStatus({
          isEndorsed: Number(endorsedIdx) === Number(targetVersionIndex),
          isAlreadyMinted: Number(details?.tokenId ?? 0) > 0,
          isCheckingStatus: false,
          hasMissingParents: getMissingParents(details),
        });
      } catch (error) {
        console.error("Failed to check status:", sanitizeErrorForLogging(error));
        if (!cancelled) {
          setStatus({
            isEndorsed: false,
            isAlreadyMinted: false,
            isCheckingStatus: false,
            hasMissingParents: null,
          });
        }
      }
    };

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [
    address,
    contract,
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
      markMinted,
      reset,
    }),
    [markMinted, reset, status],
  );
}
