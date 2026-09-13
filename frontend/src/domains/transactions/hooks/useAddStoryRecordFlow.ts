import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../config";
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
  const { contractAddress } = useConfig();
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
      );
    },
    [signer, contractAddress, t],
  );

  return useTxFlow<AddStoryRecordResult, [AddStoryRecordFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => normalizeFriendlyError(error, t),
  });
}
