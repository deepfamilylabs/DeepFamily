import { useCallback, useRef } from "react";
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
  // Each immutable package retains its own hash across retries and resets.
  // A background completion or replacement must not overwrite a newer run's
  // reconciliation state; discarded packages can be garbage-collected.
  const submittedTransactionsRef = useRef(
    new WeakMap<
      AddVersionFlowArgs,
      { transactionHash: string; scope: AddVersionTransactionScope }
    >(),
  );

  const { confirmTransactionPreview } = options;

  const runner: TxFlowRunner<AddVersionResult, [AddVersionFlowArgs]> = useCallback(
    async (update, args) => {
      if (!signer || !contractAddress) {
        throw new Error(t("wallet.notConnected", "Please connect your wallet"));
      }

      update("validating", t("addVersion.validating", "Validating version..."));

      try {
        const assertActiveRequest = () => {
          if (!update.isCurrent()) {
            throw Object.assign(new Error("Add Version request cancelled before wallet request"), {
              code: "ADD_VERSION_PREVIEW_REJECTED",
            });
          }
        };
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
        assertActiveRequest();
        await assertCurrentScope();
        assertActiveRequest();
        const submitContract = createDeepFamilyContract(contractAddress, signer);

        let preflightContract = submitContract;
        let receiptProvider = (signer as any).provider;
        if (rpcUrl) {
          const readonlyProvider = getReadonlyProvider(rpcUrl, chainId);
          preflightContract = createDeepFamilyContract(contractAddress, readonlyProvider);
          receiptProvider = readonlyProvider;
        }

        const priorSubmission = submittedTransactionsRef.current.get(args);
        if (
          priorSubmission &&
          !sameAddVersionTransactionScope(priorSubmission.scope, transactionScope)
        ) {
          submittedTransactionsRef.current.delete(args);
          throw addVersionScopeChangedError();
        }
        const reconcileTransactionHash = priorSubmission?.transactionHash;
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
          assertWalletScope: async () => {
            assertActiveRequest();
            await assertCurrentScope();
            // Closing can supersede the request while the wallet's chain or
            // account RPC is pending, immediately before the send boundary.
            assertActiveRequest();
          },
          onTransactionSubmitted: (transactionHash) => {
            // Recorded even for an abandoned run: the transaction is already on
            // its way, and only this hash lets the next attempt reconcile it
            // instead of sending a second one.
            submittedTransactionsRef.current.set(args, {
              transactionHash,
              scope: transactionScope,
            });
            if (update.isCurrent()) {
              update("confirming", t("transaction.submitted", "Transaction submitted..."));
            }
          },
          confirmTransactionPreview: confirmTransactionPreview
            ? async (preview) => {
                if (!update.isCurrent()) return false;
                const approved = await confirmTransactionPreview(preview);
                return update.isCurrent() && approved;
              }
            : undefined,
        });

        // An exact receipt is enough to settle a cancelled modal's public
        // record. Its original chain result survives later wallet changes;
        // foreground completion still enforces the current scope.
        if (update.isCurrent()) {
          try {
            await assertCurrentScope();
          } catch (error) {
            if (update.isCurrent()) throw error;
          }
        }
        submittedTransactionsRef.current.delete(args);
        return result;
      } catch (error) {
        // A settled outcome, however bad, leaves nothing to reconcile.
        if (
          (error as any)?.transactionReconciliationFinal === true ||
          (error as any)?.code === ADD_VERSION_SCOPE_CHANGED
        ) {
          submittedTransactionsRef.current.delete(args);
        }
        throw error;
      }
    },
    [chainId, confirmTransactionPreview, contractAddress, readerAddress, rpcUrl, signer, t],
  );

  const flow = useTxFlow<AddVersionResult, [AddVersionFlowArgs], FriendlyError>(runner, {
    normalizeError: (error) => getFriendlyError(error, t),
    allowBackgroundCompletion: true,
  });

  return flow;
}
