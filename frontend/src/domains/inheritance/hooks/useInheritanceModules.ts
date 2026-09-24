import { useEffect, useState } from "react";
import { getInheritanceAddress } from "../../../shared/config/env";
import { InheritanceError } from "../model/inheritanceErrors";
import type { InheritanceBlocker } from "../model/inheritanceTypes";
import { resolveInheritanceModules, type InheritanceModules } from "../services/inheritanceModules";

export interface InheritanceModulesInput {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  tokenAddress: string;
}

export type InheritanceModulesState =
  | { status: "ready"; modules: InheritanceModules }
  | { status: "blocked"; blocker: Exclude<InheritanceBlocker, "wrong-network"> };

/** Resolves and checks the inheritance contracts for the configured network. */
export function useInheritanceModules(input: InheritanceModulesInput): InheritanceModulesState {
  const { rpcUrl, chainId, contractAddress, tokenAddress } = input;
  const inheritanceAddress = getInheritanceAddress(chainId);
  const [state, setState] = useState<InheritanceModulesState>({
    status: "blocked",
    blocker: "loading",
  });

  useEffect(() => {
    if (!inheritanceAddress) {
      setState({ status: "blocked", blocker: "not-configured" });
      return;
    }
    if (!rpcUrl || !contractAddress || !tokenAddress) {
      setState({ status: "blocked", blocker: "loading" });
      return;
    }
    let cancelled = false;
    setState({ status: "blocked", blocker: "loading" });
    resolveInheritanceModules({
      rpcUrl,
      chainId,
      contractAddress,
      tokenAddress,
      inheritanceAddress,
    }).then(
      (modules) => {
        if (!cancelled) setState({ status: "ready", modules });
      },
      (error: unknown) => {
        if (cancelled) return;
        const notWired = error instanceof InheritanceError && error.code === "notWired";
        setState({ status: "blocked", blocker: notWired ? "not-wired" : "unreachable" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpcUrl, chainId, contractAddress, tokenAddress, inheritanceAddress]);

  return state;
}
