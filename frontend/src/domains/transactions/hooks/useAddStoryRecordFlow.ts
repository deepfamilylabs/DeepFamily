import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../config";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { normalizeFriendlyError, type FriendlyError } from "../../../shared/lib/errors";
import {
  addStoryRecordService,
  type AddStoryRecordResult,
} from "../services/addStoryRecordService";
import { useWallet } from "../../wallet";
import { useTxFlow, type TxFlowRunner } from "./useTxFlow";

import type { ArchiveTransactionPreview } from "../services/archiveTransaction";

export type AddStoryRecordFlowArgs = {
  tokenId: string;
  recordIndex: number;
  title: string;
  content: string;
  expectedPayloadHash: string;
  recordType?: number;
  attachmentCID?: string;
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>;
};

export function useAddStoryRecordFlow() {
  const { signer } = useWallet();
  const { contractAddress, rpcUrl, chainId } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<AddStoryRecordResult, [AddStoryRecordFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("submitting", t("story.addingRecord", "Adding story record..."));

      return await addStoryRecordService(
        signer as any,
        contractAddress,
        args.tokenId,
        args.recordIndex,
        args.title,
        args.content,
        args.expectedPayloadHash,
        args.recordType,
        args.attachmentCID,
        args.confirmTransactionPreview,
        // The same endpoint the editor's snapshot was read from; see readProvider.
        rpcUrl ? getReadonlyProvider(rpcUrl, chainId) : undefined,
      );
    },
    [signer, contractAddress, rpcUrl, chainId, t],
  );

  return useTxFlow<AddStoryRecordResult, [AddStoryRecordFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => normalizeFriendlyError(error, t),
  });
}
