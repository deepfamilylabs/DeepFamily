import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../config";
import { normalizeFriendlyError, type FriendlyError } from "../../../shared/lib/errors";
import {
  addStoryChunkService,
  type AddStoryChunkResult,
} from "../services/addStoryChunkService";
import { useWallet } from "../../wallet";
import { useTxFlow, type TxFlowRunner } from "./useTxFlow";

export type AddStoryChunkFlowArgs = {
  tokenId: string;
  chunkIndex: number;
  content: string;
  expectedHash: string;
  chunkType?: number;
  attachmentCID?: string;
};

export function useAddStoryChunkFlow() {
  const { signer } = useWallet();
  const { contractAddress } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<AddStoryChunkResult, [AddStoryChunkFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("submitting", t("story.addingChunk", "Adding story chunk..."));

      return await addStoryChunkService(
        signer as any,
        contractAddress,
        args.tokenId,
        args.chunkIndex,
        args.content,
        args.expectedHash,
        args.chunkType,
        args.attachmentCID,
      );
    },
    [signer, contractAddress, t],
  );

  return useTxFlow<AddStoryChunkResult, [AddStoryChunkFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => normalizeFriendlyError(error, t),
  });
}
