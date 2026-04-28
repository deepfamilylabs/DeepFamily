import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { createDeepTokenContract } from "../../../../../shared/clients/contractFactory";
import type { ExecuteEndorseFlowResult } from "../model/endorseTypes";

interface UseEndorseFeeQuoteArgs {
  isOpen: boolean;
  address?: string | null;
  contract?: any;
}

const defaultFeeQuote = {
  deepTokenFee: "0",
  deepTokenFeeRaw: 0n,
  userDeepBalance: "0",
  userDeepBalanceRaw: 0n,
  deepTokenAddress: "",
  deepTokenDecimals: 18,
  deepTokenSymbol: "DEEP",
  protocolFeeBps: 500,
};

export function useEndorseFeeQuote({ isOpen, address, contract }: UseEndorseFeeQuoteArgs) {
  const [quote, setQuote] = useState(defaultFeeQuote);

  useEffect(() => {
    if (!isOpen || !address || !contract || !contract.runner) return;
    let cancelled = false;

    const loadFeeQuote = async () => {
      try {
        const deepTokenAddress = await contract.DEEP_FAMILY_TOKEN_CONTRACT();
        const tokenContract = createDeepTokenContract(deepTokenAddress, contract.runner);

        const fee = await tokenContract.recentReward();
        const decimals = Number(await tokenContract.decimals());
        const balance = await tokenContract.balanceOf(address);

        let symbol = "DEEP";
        try {
          const nextSymbol = await tokenContract.symbol();
          if (nextSymbol) symbol = nextSymbol;
        } catch {}

        let protocolFeeBps = defaultFeeQuote.protocolFeeBps;
        try {
          protocolFeeBps = Number(await contract.protocolEndorsementFeeBps());
        } catch {}

        if (cancelled) return;
        setQuote({
          deepTokenFee: ethers.formatUnits(fee, decimals),
          deepTokenFeeRaw: BigInt(fee),
          userDeepBalance: ethers.formatUnits(balance, decimals),
          userDeepBalanceRaw: BigInt(balance),
          deepTokenAddress,
          deepTokenDecimals: decimals,
          deepTokenSymbol: symbol,
          protocolFeeBps,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load endorsement fee quote:", error);
        }
      }
    };

    loadFeeQuote();
    return () => {
      cancelled = true;
    };
  }, [address, contract, isOpen]);

  const applySuccessResult = useCallback((result: Extract<ExecuteEndorseFlowResult, { alreadyEndorsed: false }>) => {
    setQuote((current) => {
      const nextBalance = result.balanceBefore - result.fee;
      return {
        ...current,
        deepTokenFee: result.feeFormatted,
        deepTokenFeeRaw: result.fee,
        deepTokenDecimals: result.decimals,
        deepTokenSymbol: result.symbol,
        userDeepBalance: nextBalance >= 0n ? ethers.formatUnits(nextBalance, result.decimals) : current.userDeepBalance,
        userDeepBalanceRaw: nextBalance >= 0n ? nextBalance : current.userDeepBalanceRaw,
      };
    });
  }, []);

  return useMemo(
    () => ({
      ...quote,
      canAffordEndorsement: quote.userDeepBalanceRaw >= quote.deepTokenFeeRaw,
      applySuccessResult,
    }),
    [applySuccessResult, quote],
  );
}
