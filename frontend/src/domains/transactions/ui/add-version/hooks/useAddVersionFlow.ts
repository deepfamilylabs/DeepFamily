import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { createDeepFamilyContract } from "../../../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../../../shared/clients/providerRegistry";
import { isDevMode } from "../../../../../shared/config/env";
import { getFriendlyError, type FriendlyError } from "../../../../../shared/lib/errors";
import { useTxFlow, type TxFlowRunner } from "../../../hooks/useTxFlow";
import { executeAddVersionFlow } from "../../../services/addVersionService";
import type { AddVersionFlowArgs, AddVersionResult } from "../model/addVersionTypes";
import type { AddVersionTransactionPreview } from "../model/addVersionTypes";
import {
  ADD_VERSION_SCOPE_CHANGED,
  addVersionScopeChangedError,
  assertAddVersionTransactionScope,
  createAddVersionTransactionScope,
  sameAddVersionTransactionScope,
  type AddVersionTransactionScope,
} from "../model/addVersionTransactionScope";

export type { AddVersionFlowArgs, AddVersionResult };

interface UseAddVersionFlowOptions {
  confirmTransactionPreview?: (preview: AddVersionTransactionPreview) => boolean | Promise<boolean>;
}

export function useAddVersionFlow(options: UseAddVersionFlowOptions = {}) {
  const { signer } = useWallet();
  const { rpcUrl, chainId, contractAddress, readerAddress } = useConfig();
  const { t } = useTranslation();
  const latestRuntimeScopeRef = useRef({ signer, chainId, contractAddress, readerAddress });
  latestRuntimeScopeRef.current = { signer, chainId, contractAddress, readerAddress };
  // Survives a run: an uncertain send is reconciled by the next attempt rather
  // than resubmitted, so this outlives the flow state and only `reset` clears it.
  const submittedTransactionRef = useRef<{
    args: AddVersionFlowArgs;
    transactionHash: string;
    scope: AddVersionTransactionScope;
  } | null>(null);

  const { confirmTransactionPreview } = options;

  const runner: TxFlowRunner<AddVersionResult, [AddVersionFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("validating", t("addVersion.validating", "Validating version..."));

      try {
        const submitterAddress = await signer.getAddress();
        const transactionScope = createAddVersionTransactionScope({
          chainId,
          contractAddress,
          readerAddress,
          submitterAddress,
        });
        const assertCurrentScope = async () => {
          const current = latestRuntimeScopeRef.current;
          if (!current.signer) throw addVersionScopeChangedError();
          await assertAddVersionTransactionScope({
            expected: transactionScope,
            chainId: current.chainId,
            contractAddress: current.contractAddress,
            readerAddress: current.readerAddress,
            signer: current.signer,
          });
        };
        await assertCurrentScope();
        const submitContract = createDeepFamilyContract(contractAddress, signer);

        let preflightContract = submitContract;
        let receiptProvider = (signer as any).provider;
        if (rpcUrl) {
          const readonlyProvider = getReadonlyProvider(rpcUrl, chainId);
          preflightContract = createDeepFamilyContract(contractAddress, readonlyProvider);
          receiptProvider = readonlyProvider;
        }

        const priorSubmission = submittedTransactionRef.current;
        if (priorSubmission && priorSubmission.args !== args) {
          submittedTransactionRef.current = null;
        } else if (
          priorSubmission &&
          !sameAddVersionTransactionScope(priorSubmission.scope, transactionScope)
        ) {
          submittedTransactionRef.current = null;
          throw addVersionScopeChangedError();
        }
        const reconcileTransactionHash =
          submittedTransactionRef.current?.args === args
            ? submittedTransactionRef.current.transactionHash
            : undefined;
        const getTransactionReceipt =
          typeof receiptProvider?.getTransactionReceipt === "function"
            ? (txHash: string) => receiptProvider.getTransactionReceipt(txHash)
            : undefined;

        const result = await executeAddVersionFlow({
          submitContract,
          preflightContract,
          contractAddress,
          submitterAddress,
          proof: args.proof,
          publicSignals: args.publicSignals,
          fatherVersionIndex: args.fatherVersionIndex,
          motherVersionIndex: args.motherVersionIndex,
          metadataEnvelope: args.metadataEnvelope,
          isDev: isDevMode(),
          expectedChainId: chainId,
          reconcileTransactionHash,
          getTransactionReceipt,
          assertWalletScope: assertCurrentScope,
          onTransactionSubmitted: (transactionHash) => {
            // Recorded even for an abandoned run: the transaction is already on
            // its way, and only this hash lets the next attempt reconcile it
            // instead of sending a second one.
            submittedTransactionRef.current = { args, transactionHash, scope: transactionScope };
            if (update.isCurrent()) {
              update("confirming", t("transaction.submitted", "Transaction submitted..."));
            }
          },
          confirmTransactionPreview,
        });

        await assertCurrentScope();
        submittedTransactionRef.current = null;
        return result;
      } catch (error) {
        // A settled outcome, however bad, leaves nothing to reconcile.
        if (
          (error as any)?.transactionReconciliationFinal === true ||
          (error as any)?.code === ADD_VERSION_SCOPE_CHANGED
        ) {
          submittedTransactionRef.current = null;
        }
        throw error;
      }
    },
    [chainId, confirmTransactionPreview, contractAddress, readerAddress, rpcUrl, signer, t],
  );

  const flow = useTxFlow<AddVersionResult, [AddVersionFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => getFriendlyError(error, t),
  });

  const resetFlow = flow.reset;
  const reset = useCallback(() => {
    submittedTransactionRef.current = null;
    resetFlow();
  }, [resetFlow]);

  return useMemo(() => ({ ...flow, reset }), [flow, reset]);
}
