import { useLayoutEffect, useMemo, useRef } from "react";
import { useConfig } from "../../config";
import { getWalletConnectionGeneration, useWallet } from "../../wallet";
import type { TrustedEndorserAccess } from "../model/trustedEndorserTypes";
import { loadTrustedEndorsers, updateTrustedEndorser } from "../services/trustedEndorserService";

/** The page supplies the local cache action; the domain owns all chain interaction. */
export function useTrustedEndorserAccess(onChanged: () => void): TrustedEndorserAccess | undefined {
  const { rpcUrl, chainId, contractAddress, readerAddress } = useConfig();
  const { signer, address } = useWallet();
  const scope = useMemo(() => ({ rpcUrl, chainId, contractAddress, readerAddress, signer, address }),
    [rpcUrl, chainId, contractAddress, readerAddress, signer, address]);
  const active = useRef(scope);
  active.current = scope;
  const mounted = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useMemo(() => {
    if (!rpcUrl || !readerAddress) return undefined;
    const update = async (action: "add" | "remove", personHash: string, versionIndex: number, account: string) => {
      if (!signer || !address || !contractAddress) throw new Error("Wallet not connected");
      const generation = getWalletConnectionGeneration();
      const isCurrent = () => mounted.current && active.current === scope && generation === getWalletConnectionGeneration();
      await updateTrustedEndorser({
        signer, chainId, connectedAddress: address, contractAddress,
        personHash, versionIndex, account, action, isCurrent,
      });
      if (isCurrent()) onChangedRef.current();
    };
    return {
      connectedAddress: address,
      loadTrustedEndorsers: (personHash, versionIndex) => loadTrustedEndorsers({ ...scope, personHash, versionIndex }),
      addTrustedEndorser: (personHash, versionIndex, account) => update("add", personHash, versionIndex, account),
      removeTrustedEndorser: (personHash, versionIndex, account) => update("remove", personHash, versionIndex, account),
    };
  }, [scope, rpcUrl, readerAddress, signer, address, contractAddress, chainId]);
}
