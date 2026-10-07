import { isDevMode } from "../../../shared/config/env";
import type { NetworkOption } from "../model/customNetworksTypes";

const STORAGE_KEY = "ft:customNetworks";

/**
 * The custom networks saved in this browser, on the dev server only. A custom network is a chain
 * no preset covers, and a built site's CSP (connect-src) admits only the RPC origins the build
 * was given, so outside dev none could ever be read: saved ones are ignored there, and the
 * network menu offers no way to add one.
 */
export function loadCustomNetworks(): NetworkOption[] {
  if (!isDevMode()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (n) =>
          n &&
          typeof n.chainId === "number" &&
          typeof n.name === "string" &&
          typeof n.rpcUrl === "string" &&
          typeof n.readerAddress === "string",
      )
      .map((n) => ({
        chainId: n.chainId as number,
        name: n.name as string,
        rpcUrl: n.rpcUrl as string,
        readerAddress: n.readerAddress as string,
        isCustom: true,
      }));
  } catch {
    return [];
  }
}

export function saveCustomNetworks(list: NetworkOption[]): void {
  try {
    const serialized = list.map(({ chainId, name, rpcUrl, readerAddress }) => ({
      chainId,
      name,
      rpcUrl,
      readerAddress,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    /* ignore quota / serialization errors */
  }
}
