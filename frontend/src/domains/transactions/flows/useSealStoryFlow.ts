import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../wallet/context";
import { useConfig } from "../../config/context";
import { sealStoryService, type SealStoryResult } from "../services/sealStoryService";
import { useTxFlow, type TxFlowRunner } from "../hooks/useTxFlow";

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
