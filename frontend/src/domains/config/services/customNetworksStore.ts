import type { NetworkOption } from "../model/customNetworksTypes";

const STORAGE_KEY = "ft:customNetworks";

export function loadCustomNetworks(): NetworkOption[] {
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
          typeof n.rpcUrl === "string",
      )
      .map((n) => ({
        chainId: n.chainId as number,
        name: n.name as string,
        rpcUrl: n.rpcUrl as string,
        isCustom: true,
      }));
  } catch {
    return [];
  }
}

export function saveCustomNetworks(list: NetworkOption[]): void {
  try {
    const serialized = list.map(({ chainId, name, rpcUrl }) => ({ chainId, name, rpcUrl }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    /* ignore quota / serialization errors */
  }
}
