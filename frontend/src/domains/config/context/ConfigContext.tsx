import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import { NETWORK_PRESETS } from "../../../shared/config";
import {
  getDefaultRootHash,
  getDefaultRootVersionIndex,
  getDefaultRpcUrl,
  getDefaultReaderAddress,
} from "../../../shared/config/env";
import { resolveModuleAddresses } from "../services";

type ConfigValues = {
  rpcUrl: string;
  contractAddress: string;
  readerAddress: string;
  attestationRegistryAddress: string;
  tokenAddress: string;
  rootHash: string;
  rootVersionIndex: number;
  chainId: number;
};

export type AppConfig = ConfigValues & {
  update: (partial: Partial<ConfigValues>) => void;
  reset: () => void;
  defaults: ConfigValues;
  moduleResolutionError: string | null;
  rootHistory: string[];
  addRootToHistory: (hash: string) => void;
  removeRootFromHistory: (hash: string) => void;
  clearRootHistory: () => void;
};

const STORAGE_KEY = "ft:config";
const ROOT_HISTORY_KEY = "ft:rootHistory";
const ConfigContext = createContext<AppConfig | null>(null);

function getEnvDefaults(): ConfigValues {
  const rootVersionIndex = getDefaultRootVersionIndex();
  const rpcUrl = getDefaultRpcUrl();
  const readerAddress = getDefaultReaderAddress();
  const rootHash = getDefaultRootHash();

  const inferChainId = () => {
    if (!rpcUrl) return 0;
    const normalize = (v: string) => v.trim().toLowerCase().replace(/\/+$/, "");
    const normalizedRpc = normalize(rpcUrl);
    const matched = NETWORK_PRESETS.find((p) => normalize(p.rpcUrl) === normalizedRpc);
    if (matched) return matched.chainId;
    return 0;
  };
  return {
    rpcUrl,
    contractAddress: "",
    readerAddress,
    attestationRegistryAddress: "",
    tokenAddress: "",
    rootHash,
    rootVersionIndex,
    chainId: inferChainId(),
  };
}

function loadStoredConfig(): Partial<ConfigValues> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ConfigValues>) : null;
  } catch {
    return null;
  }
}

function normalizeStoredConfig(defaults: ConfigValues): ConfigValues {
  const stored = loadStoredConfig() || {};
  const readerAddress = String(stored.readerAddress || defaults.readerAddress || "").trim();

  return {
    ...defaults,
    ...stored,
    readerAddress,
    contractAddress: "",
    attestationRegistryAddress: "",
    tokenAddress: "",
  };
}

function persistConfig(next: ConfigValues): void {
  try {
    const {
      rpcUrl,
      contractAddress,
      readerAddress,
      attestationRegistryAddress,
      tokenAddress,
      rootHash,
      rootVersionIndex,
      chainId,
    } = next;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rpcUrl,
        contractAddress,
        readerAddress,
        attestationRegistryAddress,
        tokenAddress,
        rootHash,
        rootVersionIndex,
        chainId,
      }),
    );
  } catch {}
}

function sameAddress(a: string, b: string): boolean {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const defaults = useMemo(() => getEnvDefaults(), []);
  const [state, setState] = useState<ConfigValues>(() => normalizeStoredConfig(defaults));
  const [moduleResolutionError, setModuleResolutionError] = useState<string | null>(null);
  const [rootHistory, setRootHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(ROOT_HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      const safeArr = Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : [];
      // Ensure initial default/stored rootHash is included at first load
      const storedCfg = (() => {
        try {
          const r = localStorage.getItem(STORAGE_KEY);
          return r ? (JSON.parse(r) as Partial<ConfigValues>) : null;
        } catch {
          return null;
        }
      })();
      const initialRoot =
        storedCfg?.rootHash && typeof storedCfg.rootHash === "string"
          ? storedCfg.rootHash
          : getEnvDefaults().rootHash;
      if (typeof initialRoot === "string" && /^0x[a-fA-F0-9]{64}$/.test(initialRoot.trim())) {
        const normalized = initialRoot.trim();
        if (!safeArr.some((h) => h.toLowerCase() === normalized.toLowerCase())) {
          return [normalized, ...safeArr].slice(0, 20);
        }
      }
      return safeArr;
    } catch {
      return [];
    }
  });

  // Persist computed initial history (including default root) once on mount
  useEffect(() => {
    try {
      localStorage.setItem(ROOT_HISTORY_KEY, JSON.stringify(rootHistory));
    } catch {}
  }, []);

  useEffect(() => {
    const rpcUrl = state.rpcUrl.trim();
    const readerAddress = state.readerAddress.trim();
    if (!rpcUrl || !readerAddress) {
      setModuleResolutionError(null);
      return;
    }

    let cancelled = false;
    resolveModuleAddresses({
      rpcUrl,
      chainId: state.chainId,
      readerAddress,
    })
      .then((resolved) => {
        if (cancelled) return;
        setModuleResolutionError(null);
        setState((prev) => {
          if (prev.rpcUrl.trim() !== rpcUrl || prev.readerAddress.trim() !== readerAddress) {
            return prev;
          }
          const next = {
            ...prev,
            readerAddress: resolved.readerAddress,
            contractAddress: resolved.contractAddress,
            attestationRegistryAddress: resolved.attestationRegistryAddress,
            tokenAddress: resolved.tokenAddress,
          };
          if (
            sameAddress(prev.readerAddress, next.readerAddress) &&
            sameAddress(prev.contractAddress, next.contractAddress) &&
            sameAddress(prev.attestationRegistryAddress, next.attestationRegistryAddress) &&
            sameAddress(prev.tokenAddress, next.tokenAddress)
          ) {
            return prev;
          }
          persistConfig(next);
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setModuleResolutionError(message);
        setState((prev) => {
          if (prev.rpcUrl.trim() !== rpcUrl || prev.readerAddress.trim() !== readerAddress) {
            return prev;
          }
          if (!prev.contractAddress && !prev.attestationRegistryAddress && !prev.tokenAddress) {
            return prev;
          }
          const next = {
            ...prev,
            contractAddress: "",
            attestationRegistryAddress: "",
            tokenAddress: "",
          };
          persistConfig(next);
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [state.rpcUrl, state.chainId, state.readerAddress]);

  const saveRootHistory = (list: string[]) => {
    try {
      localStorage.setItem(ROOT_HISTORY_KEY, JSON.stringify(list));
    } catch {}
  };

  const addRootToHistory = (hash: string) => {
    const normalized = (hash || "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return;
    setRootHistory((prev) => {
      const next = [
        normalized,
        ...prev.filter((v) => v.toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, 20);
      saveRootHistory(next);
      return next;
    });
  };

  const removeRootFromHistory = (hash: string) => {
    setRootHistory((prev) => {
      const next = prev.filter((v) => v.toLowerCase() !== (hash || "").toLowerCase());
      saveRootHistory(next);
      return next;
    });
  };

  const clearRootHistory = () => {
    setRootHistory([]);
    saveRootHistory([]);
  };

  const update = (partial: Partial<ConfigValues>) => {
    if (partial.readerAddress != null) setModuleResolutionError(null);
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (
        partial.readerAddress != null &&
        !sameAddress(partial.readerAddress, prev.readerAddress)
      ) {
        next.contractAddress = "";
        next.attestationRegistryAddress = "";
        next.tokenAddress = "";
      }
      try {
        persistConfig(next);
        if (partial.rootHash && /^0x[a-fA-F0-9]{64}$/.test(partial.rootHash.trim())) {
          // also record root history globally
          const normalized = partial.rootHash.trim();
          const currentRaw = localStorage.getItem(ROOT_HISTORY_KEY);
          let current: string[] = [];
          try {
            current = currentRaw ? (JSON.parse(currentRaw) as string[]) : [];
          } catch {
            current = [];
          }
          const nextList = [
            normalized,
            ...current.filter((v) => v.toLowerCase() !== normalized.toLowerCase()),
          ].slice(0, 20);
          try {
            localStorage.setItem(ROOT_HISTORY_KEY, JSON.stringify(nextList));
          } catch {}
          // reflect in state
          setRootHistory(nextList);
        }
      } catch {}
      return next;
    });
  };

  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setState(getEnvDefaults());
    setModuleResolutionError(null);
  };

  const value = useMemo<AppConfig>(
    () => ({
      ...state,
      update,
      reset,
      defaults,
      moduleResolutionError,
      rootHistory,
      addRootToHistory,
      removeRootFromHistory,
      clearRootHistory,
    }),
    [state, defaults, moduleResolutionError, rootHistory],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
