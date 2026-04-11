import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../wallet/context";
import { useConfig } from "../../config/context";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { waitForTransactionReceipt } from "../api/txGateway";
import {
  executeMintFlow,
  type ExecuteMintFlowResult,
  type MintCoreInfo,
  type MintDisclosurePublicSignals,
} from "../services/mintNftService";
import { useTxFlow, type TxFlowRunner } from "../hooks/useTxFlow";

export type MintNftFlowArgs = {
  personHash: string;
  versionIndex: number;
  proofEnvelope: any;
  publicSignals: MintDisclosurePublicSignals;
  tokenURI: string;
  coreInfo: MintCoreInfo;
};

export function useMintNftFlow() {
  const { signer, address } = useWallet();
  const { contractAddress } = useConfig();
  const { t } = useTranslation();

  const runner: TxFlowRunner<ExecuteMintFlowResult, [MintNftFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !address || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("validating", t("mint.checkingEndorsement", "Checking endorsement status..."));

      const contract = createDeepFamilyContract(contractAddress, signer);

      const mintPersonVersionNFT = async (
        proof: any,
        publicSignals: MintDisclosurePublicSignals,
        versionIndex: number,
        tokenURI: string,
        coreInfo: MintCoreInfo,
      ) => {
        update("submitting", t("mint.submitting", "Submitting mint transaction..."));
        const tx = await contract.mintPersonVersionNFT(
          proof,
          publicSignals,
          versionIndex,
          tokenURI,
          coreInfo,
        );
        update("confirming", t("mint.confirming", "Waiting for confirmation..."));
        return await waitForTransactionReceipt(tx);
      };

      const getVersionDetails = async (personHash: string, versionIndex: number) => {
        const readContract = createDeepFamilyContract(contractAddress, signer);
        return await readContract.getVersionDetails(personHash, versionIndex);
      };

      return await executeMintFlow({
        contract,
        address,
        personHash: args.personHash,
        versionIndex: args.versionIndex,
        proofEnvelope: args.proofEnvelope,
        publicSignals: args.publicSignals,
        tokenURI: args.tokenURI,
        coreInfo: args.coreInfo,
        mintPersonVersionNFT,
        getVersionDetails,
      });
    },
    [signer, address, contractAddress, t],
  );

  return useTxFlow(runner);
}
