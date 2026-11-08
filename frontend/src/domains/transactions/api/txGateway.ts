import type { ContractReceipt, ContractReceiptLog } from "../../../shared/clients/transactionTypes";
import { ethers } from "ethers";
import { runChainRead } from "@deepfamily/chain-client";
import {
  extractRevertReason,
  formatErrorSummaryForDev,
  sanitizeErrorForLogging,
} from "../../../shared/lib/errors";

type ContractMethod<TArgs extends readonly unknown[]> = ((...args: TArgs) => Promise<unknown>) & {
  estimateGas?: (...args: TArgs) => Promise<bigint>;
  staticCall?: (...args: TArgs) => Promise<unknown>;
};

export type ParsedReceiptEvent = { name: string; args: ethers.Result; log: ContractReceiptLog };

type EstimateGasOptions<TArgs extends readonly unknown[]> = {
  contractMethod: ContractMethod<TArgs>;
  args: TArgs;
  decodeContract?: { interface?: ethers.Interface } | null;
  fallbackGas: bigint;
  gasBumpPercent?: number;
  isDev?: boolean;
  label?: string;
};

export type GasEstimateDetails = {
  /** Buffered limit that will be sent with the transaction. */
  gasLimit: bigint;
} & (
  | {
      /** Raw value returned by eth_estimateGas. */
      estimatedGas: bigint;
      estimated: true;
    }
  | {
      /** The configured fallback is not presented as an estimate. */
      estimatedGas: null;
      estimated: false;
    }
);

export async function estimateGasWithFallbackDetails<TArgs extends readonly unknown[]>({
  contractMethod,
  args,
  decodeContract,
  fallbackGas,
  gasBumpPercent = 120,
  isDev = false,
  label = "transaction",
}: EstimateGasOptions<TArgs>): Promise<GasEstimateDetails> {
  try {
    if (typeof contractMethod.estimateGas === "function") {
      const estimatedGas = await runChainRead({ read: () => contractMethod.estimateGas!(...args), operation: "estimate" });
      return {
        estimatedGas,
        gasLimit: (estimatedGas * BigInt(gasBumpPercent)) / 100n,
        estimated: true,
      };
    }
  } catch (estimateError: any) {
    console.warn(
      `[txGateway] ${label} gas estimation failed, attempting static call fallback.`,
      sanitizeErrorForLogging(estimateError),
    );
    if (isDev) {
      console.debug(
        `[txGateway] ${label} estimateGas error detail\n${formatErrorSummaryForDev(estimateError)}`,
      );
    }
    const decodedReason = extractRevertReason(decodeContract ?? null, estimateError);
    if (decodedReason) {
      (estimateError as any).__dfDecodedReason = decodedReason;
    }

    if (typeof contractMethod.staticCall === "function") {
      try {
        await runChainRead({ read: () => contractMethod.staticCall!(...args), operation: "estimate" });
        return { estimatedGas: null, gasLimit: fallbackGas, estimated: false };
      } catch (staticError: any) {
        if (isDev) {
          console.debug(
            `[txGateway] ${label} staticCall error detail\n${formatErrorSummaryForDev(staticError)}`,
          );
        }
        const staticReason = extractRevertReason(decodeContract ?? null, staticError);
        if (staticReason) {
          (staticError as any).__dfDecodedReason = staticReason;
        }
        throw staticError;
      }
    }

    throw estimateError;
  }

  return { estimatedGas: null, gasLimit: fallbackGas, estimated: false };
}

export async function estimateGasWithFallback<TArgs extends readonly unknown[]>({
  contractMethod,
  args,
  decodeContract,
  fallbackGas,
  gasBumpPercent = 120,
  isDev = false,
  label = "transaction",
}: EstimateGasOptions<TArgs>): Promise<bigint> {
  const details = await estimateGasWithFallbackDetails({
    contractMethod,
    args,
    decodeContract,
    fallbackGas,
    gasBumpPercent,
    isDev,
    label,
  });
  return details.gasLimit;
}

export function parseReceiptEvents(
  receipt: ContractReceipt | null | undefined,
  eventInterface: ethers.Interface,
  contractAddress?: string | null,
): ParsedReceiptEvent[] {
  const normalizedContractAddress = contractAddress?.toLowerCase();
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const parsed: ParsedReceiptEvent[] = [];

  for (const log of logs) {
    if (!log || !Array.isArray(log.topics)) continue;
    if (
      normalizedContractAddress &&
      log.address &&
      String(log.address).toLowerCase() !== normalizedContractAddress
    ) {
      continue;
    }
    if (log.fragment?.name && log.args) {
      parsed.push({ name: log.fragment.name, args: log.args, log });
      continue;
    }
    try {
      if (typeof log.data !== "string" || !log.topics) continue;
      const result = eventInterface.parseLog({ data: log.data, topics: log.topics });
      if (result) {
        parsed.push({ name: result.name, args: result.args, log });
      }
    } catch {
      // ignore logs that are not part of the target ABI
    }
  }

  return parsed;
}
