import { useCallback, useMemo, useReducer, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../../../shared/clients/contractFactory";
import { getFriendlyError } from "../../../../../shared/lib/errors";
import { mintBiographyTransaction } from "../../../services/mintBiographyTransaction";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";
import { executeMintFlow } from "../../../services/mintNftService";
import { initialMintNftFlowState, mintNftReducer } from "../model/mintNftReducer";
import type { ExecuteMintFlowResult, MintNftFlowArgs } from "../model/mintNftTypes";

export type { ExecuteMintFlowResult, MintNftFlowArgs };

export function useMintNftFlow() {
  const { signer, address } = useWallet();
  const { contractAddress, readerAddress } = useConfig();
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(mintNftReducer, initialMintNftFlowState);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [transactionPreview, setTransactionPreview] = useState<ArchiveTransactionPreview | null>(
    null,
  );
  const previewResolver = useRef<((value: boolean) => void) | null>(null);
  const resolveTransactionPreview = useCallback((approved: boolean) => {
    previewResolver.current?.(approved);
    previewResolver.current = null;
    setTransactionPreview(null);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      previewResolver.current?.(false);
      previewResolver.current = null;
    };
  }, []);
  const confirmPreview = useCallback(async (preview: ArchiveTransactionPreview, runId: number) => {
    if (!mountedRef.current || runIdRef.current !== runId) return false;
    const approved = await new Promise<boolean>((resolve) => {
      previewResolver.current?.(false);
      previewResolver.current = resolve;
      setTransactionPreview(preview);
    });
    return approved && mountedRef.current && runIdRef.current === runId;
  }, []);

  const stepMessage = useMemo(() => {
    switch (state.step) {
      case "validating":
        return t("mintNFT.checkingEndorsement", "Checking endorsement status...");
      case "submitting":
        return t("mintNFT.submittingMintTx", "Submitting mint transaction...");
      case "confirming":
        return t("mintNFT.waitingConfirmation", "Waiting for confirmation...");
      default:
        return null;
    }
  }, [state.step, t]);

  const reset = useCallback(() => {
    resolveTransactionPreview(false);
    runIdRef.current += 1;
    dispatch({ type: "reset" });
  }, [resolveTransactionPreview]);

  const runOrThrow = useCallback(
    async (args: MintNftFlowArgs): Promise<ExecuteMintFlowResult> => {
      if (!mountedRef.current) throw new Error("Mint NFT flow was closed");
      const thisRunId = ++runIdRef.current;
      resolveTransactionPreview(false);
      dispatch({ type: "stage", step: "validating" });

      try {
        if (!signer || !address || !contractAddress) {
          throw new Error(t("wallet.notConnected", "Please connect your wallet"));
        }

        const contract = createDeepFamilyContract(contractAddress, signer);

        const mintPersonVersionNFT = async (
          proof: any,
          publicSignals: MintNftFlowArgs["publicSignals"],
          versionIndex: number,
          tokenURI: string,
          coreInfo: MintNftFlowArgs["coreInfo"],
          storyPayload: string,
          expectedStoryPayloadHash: string,
        ) => {
          if (!mountedRef.current || runIdRef.current !== thisRunId)
            throw new Error("Mint NFT flow was superseded by a newer request");
          dispatch({ type: "stage", step: "submitting" });
          return mintBiographyTransaction({
            contract,
            signer,
            personHash: args.personHash,
            args: [
              proof,
              publicSignals,
              versionIndex,
              tokenURI,
              coreInfo,
              storyPayload,
              expectedStoryPayloadHash,
            ],
            confirm: (preview) => confirmPreview(preview, thisRunId),
            onSubmitted: () => {
              if (runIdRef.current === thisRunId) dispatch({ type: "stage", step: "confirming" });
            },
          });
        };

        const getVersionDetails = readerAddress
          ? async (personHash: string, versionIndex: number) => {
              const readContract = createDeepFamilyReaderContract(readerAddress, signer);
              return await readContract.getVersionDetails(personHash, versionIndex);
            }
          : undefined;

        const result = await executeMintFlow({
          contract,
          address,
          personHash: args.personHash,
          versionIndex: args.versionIndex,
          selfSuiteId: args.selfSuiteId,
          proofEnvelope: args.proofEnvelope,
          publicSignals: args.publicSignals,
          tokenURI: args.tokenURI,
          coreInfo: args.coreInfo,
          story: args.story,
          mintPersonVersionNFT,
          getVersionDetails,
        });

        if (runIdRef.current !== thisRunId) {
          throw new Error("Mint NFT flow was superseded by a newer request");
        }

        dispatch({ type: "success", result });
        return result;
      } catch (error) {
        if (runIdRef.current !== thisRunId) {
          throw error;
        }

        dispatch({ type: "error", error: getFriendlyError(error, t) });
        throw error;
      }
    },
    [address, contractAddress, readerAddress, signer, t, confirmPreview, resolveTransactionPreview],
  );

  const run = useCallback(
    async (args: MintNftFlowArgs) => {
      try {
        await runOrThrow(args);
      } catch {}
    },
    [runOrThrow],
  );

  return {
    transactionPreview,
    resolveTransactionPreview,
    state,
    status: state.step,
    stepMessage,
    error: state.step === "error" ? state.error : null,
    result: state.step === "success" ? state.result : null,
    reset,
    run,
    runOrThrow,
  };
}
