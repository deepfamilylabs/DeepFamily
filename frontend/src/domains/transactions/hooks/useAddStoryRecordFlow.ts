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

import { archivePreviewRejectedError, type ArchiveTransactionPreview } from "../services/archiveTransaction";

export type AddStoryRecordFlowArgs = {
  tokenId: string;
  recordIndex: number;
  title: string;
  content: string;
  expectedPayloadHash: string;
  recordType?: number;
  attachmentURI?: string;
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

      return await addStoryRecordService({
        ...args, signer, contractAddress,
        readProvider: rpcUrl ? getReadonlyProvider(rpcUrl, chainId) : undefined,
        assertActive: () => { if (!update.isCurrent()) throw archivePreviewRejectedError("Story submission cancelled before wallet request"); },
        onSubmitted: update.submitted,
        onConfirmed: update.confirmed,
      });
    },
    [signer, contractAddress, rpcUrl, chainId, t],
  );

  return useTxFlow<AddStoryRecordResult, [AddStoryRecordFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => normalizeFriendlyError(error, t),
  });
}
