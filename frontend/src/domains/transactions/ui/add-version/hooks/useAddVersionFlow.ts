import { useCallback, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { createDeepFamilyContract } from "../../../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../../../shared/clients/providerRegistry";
import { isDevMode } from "../../../../../shared/config/env";
import { getFriendlyError } from "../../../../../shared/lib/errors";
import { executeAddVersionFlow } from "../../../services/addVersionService";
import { addVersionReducer, initialAddVersionFlowState } from "../model/addVersionReducer";
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
  const [state, dispatch] = useReducer(addVersionReducer, initialAddVersionFlowState);
  const runIdRef = useRef(0);
  const latestRuntimeScopeRef = useRef({ signer, chainId, contractAddress, readerAddress });
  latestRuntimeScopeRef.current = { signer, chainId, contractAddress, readerAddress };
  const renderScopeKey = `${chainId}:${contractAddress.toLowerCase()}:${readerAddress.toLowerCase()}`;
  const renderScopeKeyRef = useRef(renderScopeKey);
  if (renderScopeKeyRef.current !== renderScopeKey) {
    renderScopeKeyRef.current = renderScopeKey;
    runIdRef.current += 1;
  }
  const submittedTransactionRef = useRef<{
    args: AddVersionFlowArgs;
    transactionHash: string;
    scope: AddVersionTransactionScope;
  } | null>(null);

  const stepMessage = useMemo(() => {
    switch (state.step) {
      case "validating":
        return t("addVersion.validating", "Validating version...");
      case "confirming":
        return t("transaction.submitted", "Transaction submitted...");
      default:
        return null;
    }
  }, [state.step, t]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    submittedTransactionRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const runOrThrow = useCallback(
    async (args: AddVersionFlowArgs): Promise<AddVersionResult> => {
      const thisRunId = ++runIdRef.current;
      dispatch({ type: "stage", step: "validating" });

      try {
        if (!signer || !contractAddress) {
          throw new Error(t("wallet.notConnected", "Please connect your wallet"));
        }

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
            submittedTransactionRef.current = { args, transactionHash, scope: transactionScope };
            if (runIdRef.current === thisRunId) {
              dispatch({ type: "stage", step: "confirming" });
            }
          },
          confirmTransactionPreview: options.confirmTransactionPreview,
        });

        await assertCurrentScope();
        if (runIdRef.current !== thisRunId) {
          throw new Error("Add Version flow was superseded by a newer request");
        }

        dispatch({ type: "success", result });
        submittedTransactionRef.current = null;
        return result;
      } catch (error) {
        if (
          (error as any)?.transactionReconciliationFinal === true ||
          (error as any)?.code === ADD_VERSION_SCOPE_CHANGED
        ) {
          submittedTransactionRef.current = null;
        }
        if (runIdRef.current !== thisRunId) {
          throw error;
        }

        dispatch({ type: "error", error: getFriendlyError(error, t) });
        throw error;
      }
    },
    [chainId, contractAddress, options.confirmTransactionPreview, readerAddress, rpcUrl, signer, t],
  );

  const run = useCallback(
    async (args: AddVersionFlowArgs) => {
      try {
        await runOrThrow(args);
      } catch {}
    },
    [runOrThrow],
  );

  return {
    state,
    status: state.step,
    stepMessage,
    error: state.step === "error" ? state.error : null,
    result: state.step === "success" ? state.result : null,
    reset,
    run,
    runOrThrow,
  };
}
