import { useEffect, useState } from "react";
import { useConfig } from "../../config";
import { createDeepTokenContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { formatTokenAmount } from "./formatTokenAmount";

export type DeepBalanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; amount: string; symbol: string }
  | { status: "unavailable" };

const DEFAULT_SYMBOL = "DEEP";

/**
 * The account's DEEP balance, read from the token on the configured chain —
 * where the protocol lives, not whichever chain the wallet happens to be on.
 *
 * Only read while `enabled` (the account menu is open), and read afresh each
 * time it opens, so the header never polls the RPC and an endorsement or mint
 * made since is reflected the next time someone looks.
 */
export function useDeepBalance(address: string | null, enabled: boolean): DeepBalanceState {
  const { rpcUrl, chainId, tokenAddress } = useConfig();
  const [state, setState] = useState<DeepBalanceState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !address) return;
    // The token address arrives once the module addresses resolve; until then
    // (or on a chain without the protocol) there is nothing to read.
    if (!rpcUrl || !tokenAddress) {
      setState({ status: "unavailable" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    const load = async () => {
      try {
        const token = createDeepTokenContract(tokenAddress, getReadonlyProvider(rpcUrl, chainId));
        const [raw, decimals] = await Promise.all([token.balanceOf(address), token.decimals()]);

        let symbol = DEFAULT_SYMBOL;
        try {
          const nextSymbol = await token.symbol();
          if (nextSymbol) symbol = nextSymbol;
        } catch {}

        if (!cancelled) {
          setState({
            status: "ready",
            amount: formatTokenAmount(BigInt(raw), Number(decimals)),
            symbol,
          });
        }
      } catch {
        if (!cancelled) setState({ status: "unavailable" });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, address, rpcUrl, chainId, tokenAddress]);

  return state;
}
