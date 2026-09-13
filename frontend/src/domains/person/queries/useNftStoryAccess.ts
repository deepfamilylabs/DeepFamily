import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../../config";
import { useWallet } from "../../wallet";
import {
  createArchiveContract,
  createDeepFamilyContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

/** Resolve write access from the configured chain, without trusting prefetched NFT ownership. */
export function useNftStoryAccess(tokenId?: string | number | null) {
  const { rpcUrl, contractAddress, chainId } = useConfig();
  const { address, chainId: walletChainId } = useWallet();
  const context = useMemo(() => {
    if (!rpcUrl || !contractAddress || !tokenId || !/^[1-9]\d*$/.test(String(tokenId))) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    return {
      tokenId: String(tokenId),
      contract: createDeepFamilyContract(contractAddress, provider),
      provider,
      address,
      correctNetwork: walletChainId === chainId,
    };
  }, [rpcUrl, contractAddress, chainId, tokenId, address, walletChainId]);
  const activeContext = useRef(context);
  activeContext.current = context;
  const requestId = useRef(0);
  const [result, setResult] = useState<{
    context: typeof context;
    owner?: string;
    isSealed?: boolean;
    checking: boolean;
    error: boolean;
  } | null>(null);

  const recheck = useCallback(async () => {
    const request = ++requestId.current;
    if (!context) return false;
    setResult({ context, checking: true, error: false });
    try {
      const [owner, archiveAddress] = await Promise.all([
        context.contract.ownerOf(context.tokenId),
        context.contract.archive(),
      ]);
      const archive = createArchiveContract(archiveAddress, context.provider);
      const state = await archive.storyState(context.tokenId);
      if (request !== requestId.current || activeContext.current !== context) return false;
      setResult({ context, owner, isSealed: state.isSealed, checking: false, error: false });
      return Boolean(
        context.address &&
        context.correctNetwork &&
        owner.toLowerCase() === context.address.toLowerCase() &&
        !state.isSealed,
      );
    } catch {
      if (request === requestId.current && activeContext.current === context) {
        setResult({ context, checking: false, error: true });
      }
      return false;
    }
  }, [context]);

  const refresh = useCallback(() => {
    void recheck();
  }, [recheck]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      requestId.current += 1;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  // Transfers and sealing can revoke access while the editor is open.
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    const subscriptions: Array<() => Promise<unknown>> = [];
    const subscribe = async (
      contract: typeof context.contract,
      filter: ReturnType<typeof context.contract.filters.Transfer>,
    ) => {
      await contract.on(filter, refresh);
      if (cancelled) await contract.off(filter, refresh);
      else subscriptions.push(() => contract.off(filter, refresh));
    };
    void (async () => {
      try {
        await subscribe(
          context.contract,
          context.contract.filters.Transfer(null, null, context.tokenId),
        );
        const archiveAddress = await context.contract.archive();
        if (cancelled) return;
        const archive = createArchiveContract(archiveAddress, context.provider);
        await subscribe(archive, archive.filters.StorySealed(context.tokenId));
      } catch {
        // Focus refresh and submission rechecks remain available if subscriptions are unsupported.
      }
    })();
    return () => {
      cancelled = true;
      for (const unsubscribe of subscriptions) void unsubscribe().catch(() => undefined);
    };
  }, [context, refresh]);

  const current = result?.context === context ? result : null;
  const checking = Boolean(context && (!current || current.checking));
  const isOwner = Boolean(
    !checking && current?.owner && address && current.owner.toLowerCase() === address.toLowerCase(),
  );
  return {
    scope: context,
    owner: current?.owner,
    isSealed: current?.isSealed ?? false,
    checking,
    error: current?.error ?? false,
    isOwner,
    canEdit: Boolean(context?.correctNetwork && isOwner && !current?.isSealed),
    connected: Boolean(address),
    correctNetwork: context?.correctNetwork ?? false,
    refresh,
    recheck,
  };
}
