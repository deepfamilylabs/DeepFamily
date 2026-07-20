import { useCallback, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { createDeepFamilyContract } from "../../../../../shared/clients/contractFactory";
import { getFriendlyError } from "../../../../../shared/lib/errors";
import { waitForTransactionReceipt } from "../../../api/txGateway";
import { executeEndorseFlow } from "../../../services/endorseService";
import { endorseReducer, initialEndorseFlowState } from "../model/endorseReducer";
import type {
  EndorseFlowArgs,
  ExecuteEndorseFlowResult,
  EndorseServiceStage,
} from "../model/endorseTypes";

export type { EndorseFlowArgs, ExecuteEndorseFlowResult, EndorseServiceStage };

function mapStageToStep(stage: EndorseServiceStage) {
  switch (stage) {
    case "checking":
      return "validating" as const;
    case "approving":
      return "approving" as const;
    case "submitting":
      return "submitting" as const;
  }
}

export function useEndorseFlow() {
  const { signer, address } = useWallet();
  const { contractAddress } = useConfig();
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(endorseReducer, initialEndorseFlowState);
  const runIdRef = useRef(0);

  const stepMessage = useMemo(() => {
    switch (state.step) {
      case "validating":
        return t("endorse.checkingAllowance", "Checking token allowance...");
      case "approving":
        return t("endorse.approving", "Approving DEEP tokens...");
      case "submitting":
        return t("endorse.processing", "Submitting endorsement...");
      default:
        return null;
    }
  }, [state.step, t]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    dispatch({ type: "reset" });
  }, []);

  const runOrThrow = useCallback(
    async (args: EndorseFlowArgs): Promise<ExecuteEndorseFlowResult> => {
      const thisRunId = ++runIdRef.current;
      dispatch({ type: "stage", step: "validating" });

      try {
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
            if (runIdRef.current !== thisRunId) return;
            dispatch({ type: "stage", step: mapStageToStep(stage) });
          },
        });

        if (runIdRef.current !== thisRunId) {
          throw new Error("Endorse flow was superseded by a newer request");
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
    [address, contractAddress, signer, t],
  );

  const run = useCallback(
    async (args: EndorseFlowArgs) => {
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
