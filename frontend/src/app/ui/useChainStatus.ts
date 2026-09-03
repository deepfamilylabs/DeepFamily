import { useEffect, useState } from "react";
import { useConfig } from "../../domains/config";
import { getReadonlyProvider } from "../../shared/clients/providerRegistry";

export type ChainLiveness = "connecting" | "live" | "offline";

export type ChainStatus = {
  liveness: ChainLiveness;
  /** Head block of the read RPC, or null before the first successful poll. */
  blockNumber: number | null;
  chainId: number;
  rpcUrl: string;
};

/** How often the status bar re-checks the read RPC. */
const POLL_MS = 20_000;

/**
 * Liveness of the RPC the app *reads* from — not the connected wallet's chain.
 * Everything on screen comes from this endpoint, so "is it answering" is what
 * the status bar reports; the wallet's own network is the connect button's job.
 */
export function useChainStatus(): ChainStatus {
  const { rpcUrl, chainId } = useConfig();
  const [liveness, setLiveness] = useState<ChainLiveness>("connecting");
  const [blockNumber, setBlockNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!rpcUrl) {
      setLiveness("offline");
      setBlockNumber(null);
      return;
    }

    let cancelled = false;
    setLiveness("connecting");
    setBlockNumber(null);

    const check = async () => {
      // A hidden tab has nothing to show; don't spend RPC budget on it.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const provider = getReadonlyProvider(rpcUrl, chainId || undefined);
        const head = await provider.getBlockNumber();
        if (cancelled) return;
        setBlockNumber(head);
        setLiveness("live");
      } catch {
        if (cancelled) return;
        setLiveness("offline");
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    // Coming back to the tab, the head is however many blocks stale — recheck.
    const onVisibilityChange = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [rpcUrl, chainId]);

  return { liveness, blockNumber, chainId, rpcUrl };
}
