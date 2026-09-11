import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../../../shared/clients/contractFactory";
import { getFriendlyError, type FriendlyError } from "../../../../../shared/lib/errors";
import { useTxFlow, type TxFlowRunner } from "../../../hooks/useTxFlow";
import { mintBiographyTransaction } from "../../../services/mintBiographyTransaction";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";
import { executeMintFlow } from "../../../services/mintNftService";
import type { ExecuteMintFlowResult, MintNftFlowArgs } from "../model/mintNftTypes";

export type { ExecuteMintFlowResult, MintNftFlowArgs };

interface UseMintNftFlowOptions {
  confirmTransactionPreview?: (preview: ArchiveTransactionPreview) => boolean | Promise<boolean>;
}

export function useMintNftFlow(options: UseMintNftFlowOptions = {}) {
  const { signer, address } = useWallet();
  const { contractAddress, readerAddress } = useConfig();
  const { t } = useTranslation();
  const { confirmTransactionPreview } = options;

  const runner: TxFlowRunner<ExecuteMintFlowResult, [MintNftFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !address || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("validating", t("mintNFT.checkingEndorsement", "Checking endorsement status..."));

      const contract = createDeepFamilyContract(contractAddress, signer);

      const mintPersonVersionNFT = async (
        proof: any,
        publicSignals: MintNftFlowArgs["publicSignals"],
        versionIndex: number,
        tokenURI: string,
        coreInfo: MintNftFlowArgs["coreInfo"],
        storyPayload: string,
        expectedStoryPayloadHash: string,
      ) => {
        update("submitting", t("mintNFT.submittingMintTx", "Submitting mint transaction..."));
        return mintBiographyTransaction({
          contract,
          signer,
          personHash: args.personHash,
          args: [
            proof,
            publicSignals,
            versionIndex,
            tokenURI,
            coreInfo,
            storyPayload,
            expectedStoryPayloadHash,
          ],
          // An abandoned run has nobody left to answer, and no custodian means
          // nobody can approve. Both are refusals — never a silent pass through
          // to the wallet, and never a decision left hanging.
          confirm: async (preview) =>
            update.isCurrent() ? ((await confirmTransactionPreview?.(preview)) ?? false) : false,
          // Past the point of no return: the transaction is away, so an
          // abandoned run must carry on to the receipt and the readback rather
          // than abort here and leave a mint nobody verified.
          onSubmitted: () => {
            if (update.isCurrent()) {
              update("confirming", t("mintNFT.waitingConfirmation", "Waiting for confirmation..."));
            }
          },
        });
      };

      const getVersionDetails = readerAddress
        ? async (personHash: string, versionIndex: number) => {
            const readContract = createDeepFamilyReaderContract(readerAddress, signer);
            return await readContract.getVersionDetails(personHash, versionIndex);
          }
        : undefined;

      return await executeMintFlow({
        contract,
        address,
        personHash: args.personHash,
        versionIndex: args.versionIndex,
        selfSuiteId: args.selfSuiteId,
        proofEnvelope: args.proofEnvelope,
        publicSignals: args.publicSignals,
        tokenURI: args.tokenURI,
        coreInfo: args.coreInfo,
        story: args.story,
        mintPersonVersionNFT,
        getVersionDetails,
      });
    },
    [address, confirmTransactionPreview, contractAddress, readerAddress, signer, t],
  );

  return useTxFlow<ExecuteMintFlowResult, [MintNftFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => getFriendlyError(error, t),
  });
}
