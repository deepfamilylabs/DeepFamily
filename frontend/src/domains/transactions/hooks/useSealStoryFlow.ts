import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../config";
import { sealStoryService, type SealStoryResult } from "../services/sealStoryService";
import { useWallet } from "../../wallet";
import { useTxFlow, type TxFlowRunner } from "./useTxFlow";

export type SealStoryFlowArgs = {
  tokenId: string;
};

export function useSealStoryFlow() {
  const { signer } = useWallet();
  const { contractAddress } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<SealStoryResult, [SealStoryFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("submitting", t("story.sealing", "Sealing story..."));

      return await sealStoryService(signer as any, contractAddress, args.tokenId);
    },
    [signer, contractAddress, t],
  );

  return useTxFlow(runner);
}
