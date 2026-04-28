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

export type { AddVersionFlowArgs, AddVersionResult };

export function useAddVersionFlow() {
  const { signer } = useWallet();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(addVersionReducer, initialAddVersionFlowState);
  const runIdRef = useRef(0);

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
        const submitContract = createDeepFamilyContract(contractAddress, signer);

        let preflightContract = submitContract;
        if (rpcUrl) {
          const readonlyProvider = getReadonlyProvider(rpcUrl, chainId);
          preflightContract = createDeepFamilyContract(contractAddress, readonlyProvider);
        }

        const result = await executeAddVersionFlow({
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
          isDev: isDevMode(),
          onTransactionSubmitted: () => {
            if (runIdRef.current === thisRunId) {
              dispatch({ type: "stage", step: "confirming" });
            }
          },
        });

        if (runIdRef.current !== thisRunId) {
          throw new Error("Add Version flow was superseded by a newer request");
        }

        dispatch({ type: "success", result });
        return result;
      } catch (error) {
        if (runIdRef.current !== thisRunId) {
          throw error;
        }

        dispatch({ type: "error", error: getFriendlyError(error, t) });
        throw error;
      }
    },
    [chainId, contractAddress, rpcUrl, signer, t],
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
