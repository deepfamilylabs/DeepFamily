import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { createDeepFamilyContract } from "../../../../../shared/clients/contractFactory";
import { getFriendlyError, type FriendlyError } from "../../../../../shared/lib/errors";
import { useTxFlow, type TxFlowRunner } from "../../../hooks/useTxFlow";
import { waitForTransactionReceipt } from "../../../api/txGateway";
import { executeEndorseFlow } from "../../../services/endorseService";
import type {
  EndorseFeeQuote,
  EndorseFlowArgs,
  ExecuteEndorseFlowResult,
  EndorseServiceStage,
} from "../model/endorseTypes";

export type { EndorseFeeQuote, EndorseFlowArgs, ExecuteEndorseFlowResult, EndorseServiceStage };

export function useEndorseFlow() {
  const { signer, address } = useWallet();
  const { contractAddress } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<ExecuteEndorseFlowResult, [EndorseFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !address || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      const contract = createDeepFamilyContract(contractAddress, signer);

      const endorseVersion = async (
        personHash: string,
        versionIndex: number,
        overrides?: Record<string, unknown>,
      ) => {
        const tx =
          overrides && Object.keys(overrides).length > 0
            ? await contract.endorseVersion(personHash, versionIndex, overrides)
            : await contract.endorseVersion(personHash, versionIndex);
        // Past the point of no return: the transaction is away, so this run
        // carries on to the receipt whether or not anyone is still watching.
        if (update.isCurrent()) {
          update("confirming", t("transaction.submitted", "Transaction submitted..."));
        }
        return await waitForTransactionReceipt(tx);
      };

      return await executeEndorseFlow({
        contract,
        signer,
        address,
        personHash: args.personHash,
        versionIndex: args.versionIndex,
        endorseVersion,
        deepTokenAddress: args.deepTokenAddress,
        quotedFee: args.quotedFee,
        onFeeQuoteChange: args.onFeeQuoteChange,
        onStageChange: (stage) => {
          args.onStageChange?.(stage);
          // The service's own vocabulary, translated into the shared status
          // model plus the line the UI shows for it.
          switch (stage) {
            case "checking":
              return update(
                "validating",
                t("endorse.checkingAllowance", "Checking token allowance..."),
              );
            case "approving":
              return update("approving", t("endorse.approving", "Approving DEEP tokens..."));
            case "submitting":
              return update("submitting", t("endorse.processing", "Submitting endorsement..."));
          }
        },
      });
    },
    [address, contractAddress, signer, t],
  );

  return useTxFlow<ExecuteEndorseFlowResult, [EndorseFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => getFriendlyError(error, t),
  });
}
