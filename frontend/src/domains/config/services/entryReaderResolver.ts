import { getChainEntryReaderAddress } from "../../../shared/config/env";
import type { NetworkOption } from "../model/customNetworksTypes";
import { loadCustomNetworks } from "./customNetworksStore";

export type EntryReaderLookup = {
  /**
   * The custom networks to consult. Pass the live list wherever one is already
   * held in state; omitting it reads the saved list.
   */
  customNetworks?: NetworkOption[];
  /** The chain `VITE_RPC_URL` names, when it could be identified at all. */
  envChainId?: number;
  /** The unsuffixed env pair, which describes that one chain and no other. */
  envReaderAddress?: string;
};

/**
 * The entry reader to read a chain through.
 *
 * A reader is deployed per chain, so an address only means anything alongside
 * the chain it was deployed on. Every answer here is derived — from the build's
 * address book or from a custom network's own declaration — and none of it is
 * ever persisted: a stored address outlives the deployment that produced it,
 * and a redeploy then leaves the app reading through an address that has since
 * become some other contract.
 *
 * `""` means the build knows no reader for this chain. That is a real answer,
 * and the caller must let it clear the address rather than leave the previous
 * chain's in place — reading one chain through another chain's entrypoint is
 * how a plain misconfiguration turns into "no contract deployed here".
 */
export function resolveEntryReaderForChain(chainId: number, lookup: EntryReaderLookup = {}): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return "";

  // A custom network is by definition absent from the build's address book, so
  // its own declaration is the only thing that can speak for it.
  const customNetworks = lookup.customNetworks ?? loadCustomNetworks();
  const declared = customNetworks.find((network) => network.chainId === chainId)?.readerAddress;
  if (declared) return declared.trim();

  const fromAddressBook = getChainEntryReaderAddress(chainId).trim();
  if (fromAddressBook) return fromAddressBook;

  const envChainId = lookup.envChainId;
  const envReaderAddress = (lookup.envReaderAddress || "").trim();
  if (envReaderAddress && Number.isSafeInteger(envChainId) && envChainId === chainId) {
    return envReaderAddress;
  }

  return "";
}
