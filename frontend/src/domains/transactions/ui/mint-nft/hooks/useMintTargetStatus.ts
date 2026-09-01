import { useCallback, useEffect, useMemo, useState } from "react";
import { sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import {
  readMintTargetEnvelopeHeader,
  type MintMetadataCodeReader,
} from "../../../services/mintNftService";

interface UseMintTargetStatusArgs {
  isOpen: boolean;
  address?: string | null;
  contract?: any;
  getVersionDetails?: (personHash: string, versionIndex: number) => Promise<any>;
  getMetadataCode?: MintMetadataCodeReader;
  targetPersonHash: string;
  targetVersionIndex: number;
  hasValidTarget: boolean;
}

const defaultTargetStatus = {
  targetKey: "",
  isEndorsed: false,
  isAlreadyMinted: false,
  isCheckingStatus: false,
  selfSuiteId: null as number | null,
  envelopeHeaderError: null as string | null,
};

export function useMintTargetStatus({
  isOpen,
  address,
  contract,
  getVersionDetails,
  getMetadataCode,
  targetPersonHash,
  targetVersionIndex,
  hasValidTarget,
}: UseMintTargetStatusArgs) {
  const [status, setStatus] = useState(defaultTargetStatus);
  const targetKey = hasValidTarget ? `${targetPersonHash.toLowerCase()}:${targetVersionIndex}` : "";

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
    setStatus({ ...defaultTargetStatus, targetKey, isCheckingStatus: true });

    const loadStatus = async () => {
      if (
        !address ||
        !getVersionDetails ||
        !getMetadataCode ||
        !targetPersonHash ||
        !targetVersionIndex ||
        !contract
      ) {
        if (!cancelled) {
          setStatus({
            ...defaultTargetStatus,
            targetKey,
            envelopeHeaderError: "Target metadata envelope cannot be read",
          });
        }
        return;
      }

      try {
        const { selfSuiteId, versionDetails: details } = await readMintTargetEnvelopeHeader({
          personHash: targetPersonHash,
          versionIndex: targetVersionIndex,
          getVersionDetails,
          getCode: getMetadataCode,
        });
        const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash, address);
        if (cancelled) return;

        setStatus({
          targetKey,
          isEndorsed: Number(endorsedIdx) === Number(targetVersionIndex),
          isAlreadyMinted: Number(details?.tokenId ?? 0) > 0,
          isCheckingStatus: false,
          selfSuiteId,
          envelopeHeaderError: null,
        });
      } catch (error) {
        console.error("Failed to check status:", sanitizeErrorForLogging(error));
        if (!cancelled) {
          setStatus({
            targetKey,
            isEndorsed: false,
            isAlreadyMinted: false,
            isCheckingStatus: false,
            selfSuiteId: null,
            envelopeHeaderError: "Target metadata envelope header could not be verified",
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
    getMetadataCode,
    hasValidTarget,
    isOpen,
    reset,
    targetPersonHash,
    targetVersionIndex,
    targetKey,
  ]);

  return useMemo(() => {
    const currentStatus = status.targetKey === targetKey ? status : defaultTargetStatus;
    return {
      ...currentStatus,
      markMinted,
      reset,
    };
  }, [markMinted, reset, status, targetKey]);
}
