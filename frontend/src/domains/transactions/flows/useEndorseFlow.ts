import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../wallet/context";
import { useConfig } from "../../config/context";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { waitForTransactionReceipt } from "../api/txGateway";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../shared/lib/errors";
import {
  executeEndorseFlow,
  type ExecuteEndorseFlowResult,
  type EndorseServiceStage,
} from "../services/endorseService";
import { useTxFlow, type TxFlowRunner } from "../hooks/useTxFlow";

export type { ExecuteEndorseFlowResult };

export type EndorseFlowArgs = {
  personHash: string;
  versionIndex: number;
  deepTokenAddress?: string;
  suppressToasts?: boolean;
  onStageChange?: (stage: EndorseServiceStage) => void;
};

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
        const tx = overrides && Object.keys(overrides).length > 0
          ? await contract.endorseVersion(personHash, versionIndex, overrides)
          : await contract.endorseVersion(personHash, versionIndex);
        return await waitForTransactionReceipt(tx);
      };

      const result = await executeEndorseFlow({
        contract,
        signer,
        address,
        personHash: args.personHash,
        versionIndex: args.versionIndex,
        endorseVersion,
        deepTokenAddress: args.deepTokenAddress,
        suppressToasts: args.suppressToasts,
        onStageChange: (stage) => {
          args.onStageChange?.(stage);
          switch (stage) {
            case "checking":
              update("validating", t("endorse.checkingAllowance", "Checking token allowance..."));
              break;
            case "approving":
              update("approving", t("endorse.approving", "Approving DEEP tokens..."));
              break;
            case "submitting":
              update("submitting", t("endorse.processing", "Submitting endorsement..."));
              break;
          }
        },
      });

      return result;
    },
    [signer, address, contractAddress, t],
  );

  return useTxFlow(runner);
}
