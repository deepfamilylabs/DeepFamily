import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../wallet/context";
import { useConfig } from "../../config/context";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import type { ProofEnvelope } from "../../../shared/zk/zk";
import {
  executeAddVersionFlow,
  type AddVersionPublicSignals,
  type AddVersionResult,
} from "../services/addVersionService";
import { useTxFlow, type TxFlowRunner } from "../hooks/useTxFlow";

export type AddVersionFlowArgs = {
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  tag: string;
  metadataCID: string;
};

export function useAddVersionFlow() {
  const { signer } = useWallet();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<AddVersionResult, [AddVersionFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      const submitterAddress = await signer.getAddress();
      update("validating", t("addVersion.validating", "Validating version..."));

      const submitContract = createDeepFamilyContract(contractAddress, signer);

      let preflightContract = submitContract;
      if (rpcUrl) {
        const readonlyProvider = getReadonlyProvider(rpcUrl, chainId);
        preflightContract = createDeepFamilyContract(contractAddress, readonlyProvider);
      }

      return await executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress,
        submitterAddress,
        proof: args.proof,
        publicSignals: args.publicSignals,
        fatherVersionIndex: args.fatherVersionIndex,
        motherVersionIndex: args.motherVersionIndex,
        tag: args.tag,
        metadataCID: args.metadataCID,
        isDev: import.meta.env.DEV,
        onTransactionSubmitted: () => {
          update("confirming", t("transaction.submitted", "Transaction submitted..."));
        },
      });
    },
    [signer, rpcUrl, chainId, contractAddress, t],
  );

  return useTxFlow(runner);
}
