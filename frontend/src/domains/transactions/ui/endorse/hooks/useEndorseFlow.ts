import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getWalletConnectionGeneration, useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { createDeepFamilyContract } from "../../../../../shared/clients/contractFactory";
import { getFriendlyError, type FriendlyError } from "../../../../../shared/lib/errors";
import { useTxFlow, type TxFlowRunner } from "../../../hooks/useTxFlow";
import { assertChainWalletScope, executeChainTransaction } from "@deepfamily/chain-client";
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
  const { contractAddress, chainId } = useConfig();
  const { t } = useTranslation();
  const scope = useMemo(() => ({ signer, address, contractAddress, chainId }), [signer, address, contractAddress, chainId]);
  const latestScope = useRef(scope);
  latestScope.current = scope;

  const runner: TxFlowRunner<ExecuteEndorseFlowResult, [EndorseFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !address || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      const contract = createDeepFamilyContract(contractAddress, signer);
      const generation = getWalletConnectionGeneration();
      const assertActive = () => {
        if (!update.isCurrent()) {
          throw Object.assign(new Error("Endorsement cancelled before wallet request"), {
            code: "ENDORSEMENT_CANCELLED",
          });
        }
        if (latestScope.current !== scope || generation !== getWalletConnectionGeneration()) {
          throw Object.assign(new Error("The wallet, account or network changed before endorsement submission"), {
            code: "CHAIN_WALLET_SCOPE_CHANGED",
            reason: "CHAIN_WALLET_SCOPE_CHANGED",
          });
        }
      };
      const assertWalletScope = () => assertChainWalletScope({ signer, chainId, account: address, assertActive });
      await assertWalletScope();

      const endorseVersion = async (
        personHash: string,
        versionIndex: number,
        overrides?: Record<string, unknown>,
      ) => {
        const { receipt } = await executeChainTransaction({
          provider: signer.provider,
          assertActive,
          beforeSend: assertWalletScope,
          send: () => overrides && Object.keys(overrides).length > 0
            ? contract.endorseVersion(personHash, versionIndex, overrides)
            : contract.endorseVersion(personHash, versionIndex),
          onSubmitted: (hash) => {
            update.submitted(hash);
            if (update.isCurrent()) update("confirming", t("transaction.submitted", "Transaction submitted..."));
          },
          onConfirmed: update.confirmed,
          expected: {
            chainId,
            from: address,
            to: contractAddress,
            data: contract.interface?.encodeFunctionData("endorseVersion", [
              personHash,
              versionIndex,
            ]),
            value: 0n,
          },
        });
        return receipt;
      };

      return await executeEndorseFlow({
        contract,
        signer,
        chainId,
        address,
        personHash: args.personHash,
        versionIndex: args.versionIndex,
        endorseVersion,
        deepTokenAddress: args.deepTokenAddress,
        quotedFee: args.quotedFee,
        assertActive,
        onSubmitted: update.submitted,
        onApprovalConfirmed: update.confirmed,
        onFeeQuoteChange: (quote) => {
          if (update.isCurrent()) args.onFeeQuoteChange?.(quote);
        },
        onStageChange: (stage) => {
          assertActive();
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
    [address, chainId, contractAddress, scope, signer, t],
  );

  return useTxFlow<ExecuteEndorseFlowResult, [EndorseFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => getFriendlyError(error, t),
    allowBackgroundCompletion: true,
  });
}
