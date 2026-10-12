import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { useToast } from "../../../shared/ui";
import { useTranslation } from "react-i18next";
import { getAddChainParams } from "../../../shared/config";
import { normalizeFriendlyError, sanitizeErrorForLogging } from "../../../shared/lib/errors";
import { SUPPORTED_WALLETS } from "../config/wallets";
import { createWalletProvider } from "../services/walletProvider";
import {
  getWalletConnectionGeneration,
  invalidateWalletConnection,
} from "../services/walletConnectionGeneration";

// localStorage key for persisting wallet type
const WALLET_TYPE_STORAGE_KEY = "deepfamily_last_wallet_type";

interface WalletState {
  address: string | null;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  isConnecting: boolean;
  chainId: number | null;
  balance: string | null;
  // Track the connected wallet type and raw provider for event listeners
  connectedWalletId: string | null;
  rawProvider: any | null;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  provider: any;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  connectWithProvider: (provider: any, walletId?: string) => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
  switchOrAddChain: (chainId: number) => Promise<boolean>;
  refreshBalance: () => Promise<void>;
  getAvailableWallets: () => WalletOption[];
  showWalletSelection: boolean;
  setShowWalletSelection: (show: boolean) => void;
  showNetworkSelection: boolean;
  setShowNetworkSelection: (show: boolean) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const getWalletError = useCallback(
    (error: unknown, fallbackMessage: string, messageOverrides?: Record<string, string>) =>
      normalizeFriendlyError(error, t, {
        fallbackMessage,
        messageOverrides: {
          USER_REJECTED: t("wallet.rejected", "Request rejected by user"),
          WALLET_REQUEST_PENDING: t("wallet.pending", "Connection request already pending"),
          ...messageOverrides,
        },
      }),
    [t],
  );

  const showWalletError = useCallback(
    (error: unknown, fallbackMessage: string, messageOverrides?: Record<string, string>) => {
      const friendly = getWalletError(error, fallbackMessage, messageOverrides);
      if (friendly.reason === "USER_REJECTED" || friendly.reason === "WALLET_REQUEST_PENDING") {
        toast.warning(friendly.message);
      } else {
        toast.error(friendly.message);
      }
      return friendly;
    },
    [getWalletError, toast],
  );

  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    provider: null,
    signer: null,
    isConnecting: false,
    chainId: null,
    balance: null,
    connectedWalletId: null,
    rawProvider: null,
  });
  const walletStateRef = useRef(walletState);
  walletStateRef.current = walletState;
  const activeRawProviderRef = useRef<any | null>(null);
  const mountedRef = useRef(true);
  const connectionIsCurrent = useCallback(
    (rawProvider: any, generation: number) =>
      mountedRef.current &&
      activeRawProviderRef.current === rawProvider &&
      getWalletConnectionGeneration() === generation,
    [],
  );
  useEffect(() => {
    mountedRef.current = true;
    // Development effect replay can preserve a selected connection's React state.
    if (walletStateRef.current.rawProvider) {
      activeRawProviderRef.current = walletStateRef.current.rawProvider;
    }
    return () => {
      mountedRef.current = false;
      activeRawProviderRef.current = null;
      invalidateWalletConnection();
    };
  }, []);

  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const [showNetworkSelection, setShowNetworkSelection] = useState(false);

  const refreshConnection = useCallback(
    async (rawProvider: any, generation: number, nextChainId?: number) => {
      const current = () => connectionIsCurrent(rawProvider, generation);
      try {
        const provider = createWalletProvider(rawProvider);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const chainId = nextChainId ?? Number((await provider.getNetwork()).chainId);
        if (!current()) return;
        setWalletState((prev) =>
          current() && prev.rawProvider === rawProvider
            ? { ...prev, provider, signer, address, chainId, isConnecting: false, balance: null }
            : prev,
        );
        try {
          const balance = await provider.getBalance(address);
          if (!current()) return;
          setWalletState((prev) =>
            current() && prev.provider === provider
              ? { ...prev, balance: ethers.formatEther(balance) }
              : prev,
          );
        } catch (error) {
          if (current())
            console.warn("Failed to refresh wallet balance:", sanitizeErrorForLogging(error));
        }
      } catch (error) {
        if (current()) {
          console.warn("Failed to refresh wallet connection:", sanitizeErrorForLogging(error));
          setWalletState((prev) => (current() ? { ...prev, isConnecting: false } : prev));
        }
      }
    },
    [connectionIsCurrent],
  );

  const restoreRetiredConnection = useCallback(
    async (rawProvider: any | null) => {
      activeRawProviderRef.current = rawProvider;
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      if (rawProvider) await refreshConnection(rawProvider, generation);
      else
        setWalletState((prev) =>
          getWalletConnectionGeneration() === generation ? { ...prev, isConnecting: false } : prev,
        );
    },
    [refreshConnection],
  );

  const refreshBalance = useCallback(async () => {
    if (!walletState.provider || !walletState.address) return;
    const generation = getWalletConnectionGeneration();

    try {
      const balance = await walletState.provider.getBalance(walletState.address);
      if (!connectionIsCurrent(walletState.rawProvider, generation)) return;
      setWalletState((prev) =>
        connectionIsCurrent(walletState.rawProvider, generation) &&
        prev.provider === walletState.provider &&
        prev.address === walletState.address
          ? { ...prev, balance: ethers.formatEther(balance) }
          : prev,
      );
    } catch (error) {
      console.error("[WalletContext] Failed to fetch balance:", sanitizeErrorForLogging(error));
    }
  }, [walletState.provider, walletState.address, walletState.rawProvider, connectionIsCurrent]);

  const getAvailableWallets = useCallback((): WalletOption[] => {
    if (typeof window === "undefined") return [];

    const wallets: WalletOption[] = [];
    const eth: any = window.ethereum;

    if (!eth) {
      return [];
    }

    const addWallet = (provider: any) => {
      for (const config of SUPPORTED_WALLETS) {
        if (config.detect(provider) && !wallets.find((w) => w.id === config.id)) {
          wallets.push({
            id: config.id,
            name: config.name,
            icon: config.icon,
            provider: provider,
          });
        }
      }
    };

    // Strategy 1: Check providers array (EIP-1193 multi-provider)
    if (Array.isArray(eth.providers) && eth.providers.length > 0) {
      eth.providers.forEach((provider: any, index: number) => {
        addWallet(provider);
      });
    }

    // Strategy 2: Check window.ethereum itself
    addWallet(eth);

    // Strategy 3: Check for Fluent's specific injection point
    const fluentProvider = (window as any).fluent;
    if (fluentProvider) {
      addWallet(fluentProvider);
    }

    return wallets;
  }, []);

  const connectWithProvider = useCallback(
    async (selectedProvider: any, walletId?: string) => {
      // Use the selected provider directly instead of getBoundProvider
      if (!selectedProvider) {
        toast.warning(t("wallet.noWallet", "Wallet not available"));
        return;
      }
      const previousRawProvider = walletStateRef.current.rawProvider;
      activeRawProviderRef.current = selectedProvider;
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      const current = () => connectionIsCurrent(selectedProvider, generation);

      // Determine wallet ID if not provided
      let detectedWalletId = walletId;
      if (!detectedWalletId) {
        if (selectedProvider.isFluent || selectedProvider.isFluentWallet) {
          detectedWalletId = "fluent";
        } else if (selectedProvider.isMetaMask) {
          detectedWalletId = "metamask";
        } else {
          detectedWalletId = "unknown";
        }
      }

      setWalletState((prev) =>
        current()
          ? { ...prev, signer: null, provider: null, balance: null, isConnecting: true }
          : prev,
      );

      try {
        // Use the selected provider directly to avoid interception
        const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
        if (!current()) return;
        if (!accounts || accounts.length === 0) {
          throw new Error("No accounts returned");
        }

        const provider = createWalletProvider(selectedProvider);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();
        if (!current()) return;

        // Save wallet type to localStorage for auto-reconnect
        try {
          localStorage.setItem(WALLET_TYPE_STORAGE_KEY, detectedWalletId);
        } catch (e) {
          console.warn("[WalletContext] Failed to save wallet type to localStorage:", e);
        }

        const newState: WalletState = {
          address,
          provider,
          signer,
          isConnecting: false,
          chainId: Number(network.chainId),
          balance: null,
          connectedWalletId: detectedWalletId,
          rawProvider: selectedProvider,
        };

        setWalletState((prev) => (current() ? newState : prev));

        // Refresh balance after connection
        try {
          const balance = await provider.getBalance(address);
          if (!current()) return;
          setWalletState((prev) =>
            current() && prev.provider === provider
              ? { ...prev, balance: ethers.formatEther(balance) }
              : prev,
          );
        } catch (balanceError) {
          console.warn("Failed to fetch balance:", balanceError);
        }

        if (current()) toast.success(t("wallet.connected", "Wallet connected successfully"));
      } catch (error: any) {
        if (!current()) return;
        console.error("[WalletContext] Failed to connect wallet:", sanitizeErrorForLogging(error));
        showWalletError(error, t("wallet.connectionFailed", "Failed to connect wallet"), {
          USER_REJECTED: t("wallet.rejected", "Connection rejected by user"),
        });
        await restoreRetiredConnection(previousRawProvider);
      }
    },
    [showWalletError, t, toast, connectionIsCurrent, restoreRetiredConnection],
  );

  const connect = useCallback(async () => {
    const wallets = getAvailableWallets();

    if (wallets.length === 0) {
      setShowWalletSelection(true);
      return;
    }

    if (wallets.length === 1) {
      await connectWithProvider(wallets[0].provider, wallets[0].id);
    } else {
      setShowWalletSelection(true);
    }
  }, [getAvailableWallets, connectWithProvider]);

  const disconnect = useCallback(() => {
    invalidateWalletConnection();
    activeRawProviderRef.current = null;
    const previous = walletStateRef.current;
    const shouldNotify = !!(previous.address || previous.provider || previous.signer);

    setWalletState({
      address: null,
      provider: null,
      signer: null,
      isConnecting: false,
      chainId: null,
      balance: null,
      connectedWalletId: null,
      rawProvider: null,
    });

    // An outstanding auto-connect must also remain disconnected after a reload.
    try {
      localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
    } catch (e) {
      console.warn("[WalletContext] Failed to clear wallet type from localStorage:", e);
    }
    if (shouldNotify) toast.info(t("wallet.disconnected", "Wallet disconnected"));
  }, [t, toast]);

  const switchChain = useCallback(
    async (targetChainId: number) => {
      // Use the connected rawProvider instead of getBoundProvider
      const rawProvider = walletState.rawProvider;
      if (!rawProvider) {
        toast.warning(t("wallet.notConnected", "Please connect your wallet"));
        return;
      }
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      const current = () => connectionIsCurrent(rawProvider, generation);
      setWalletState((prev) =>
        current() ? { ...prev, signer: null, provider: null, balance: null } : prev,
      );

      try {
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        });
        if (!current()) return;

        await refreshConnection(rawProvider, generation, targetChainId);
        if (!current()) return;
        toast.success(t("wallet.chainSwitched", "Chain switched successfully"));
      } catch (error: any) {
        if (!current()) return;
        console.error("[WalletContext] Failed to switch chain:", sanitizeErrorForLogging(error));
        if (error.code === 4902) {
          toast.warning(t("wallet.chainNotAdded", "Chain not added to wallet"));
        } else {
          showWalletError(error, t("wallet.chainSwitchFailed", "Failed to switch chain"));
        }
        await restoreRetiredConnection(rawProvider);
      }
    },
    [
      showWalletError,
      t,
      toast,
      walletState.rawProvider,
      connectionIsCurrent,
      refreshConnection,
      restoreRetiredConnection,
    ],
  );

  // Switch to chain, or add it first if not present in wallet
  const switchOrAddChain = useCallback(
    async (targetChainId: number): Promise<boolean> => {
      const rawProvider = walletState.rawProvider;
      if (!rawProvider) {
        toast.warning(t("wallet.notConnected", "Please connect your wallet"));
        return false;
      }
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      const current = () => connectionIsCurrent(rawProvider, generation);
      setWalletState((prev) =>
        current() ? { ...prev, signer: null, provider: null, balance: null } : prev,
      );

      const chainIdHex = `0x${targetChainId.toString(16)}`;

      try {
        // First try to switch
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
        if (!current()) return true;

        await refreshConnection(rawProvider, generation, targetChainId);
        if (!current()) return true;
        toast.success(t("wallet.chainSwitched", "Chain switched successfully"));
        return true;
      } catch (switchError: any) {
        if (!current()) return false;
        // Error 4902: chain not added to wallet
        if (switchError.code === 4902) {
          const addChainParams = getAddChainParams(targetChainId);
          if (!addChainParams) {
            toast.warning(t("wallet.chainNotSupported", "This network is not supported"));
            await restoreRetiredConnection(rawProvider);
            return false;
          }

          try {
            await rawProvider.request({
              method: "wallet_addEthereumChain",
              params: [addChainParams],
            });
            if (!current()) return true;

            await refreshConnection(rawProvider, generation, targetChainId);
            if (!current()) return true;
            toast.success(t("wallet.chainAdded", "Network added successfully"));
            return true;
          } catch (addError: any) {
            if (!current()) return false;
            console.error(
              "[WalletContext] Failed to add chain:",
              sanitizeErrorForLogging(addError),
            );
            showWalletError(addError, t("wallet.chainAddFailed", "Failed to add network"));
            await restoreRetiredConnection(rawProvider);
            return false;
          }
        } else {
          console.error(
            "[WalletContext] Failed to switch chain:",
            sanitizeErrorForLogging(switchError),
          );
          showWalletError(switchError, t("wallet.chainSwitchFailed", "Failed to switch chain"));
          await restoreRetiredConnection(rawProvider);
          return false;
        }
      }
    },
    [
      showWalletError,
      t,
      toast,
      walletState.rawProvider,
      connectionIsCurrent,
      refreshConnection,
      restoreRetiredConnection,
    ],
  );

  // Listen to account and chain changes - use rawProvider from state
  useEffect(() => {
    const rawProvider = walletState.rawProvider;
    if (!rawProvider) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (activeRawProviderRef.current !== rawProvider) return;
      // Invalidate before any await, including same-address notifications.
      invalidateWalletConnection();
      if (accounts.length === 0) {
        disconnect();
        return;
      }
      const generation = getWalletConnectionGeneration();
      setWalletState((prev) =>
        connectionIsCurrent(rawProvider, generation)
          ? {
              ...prev,
              address: accounts[0],
              signer: null,
              provider: null,
              balance: null,
              isConnecting: false,
            }
          : prev,
      );
      void refreshConnection(rawProvider, generation);
    };

    const handleChainChanged = (chainId: string) => {
      if (activeRawProviderRef.current !== rawProvider) return;
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      const nextChainId = parseInt(chainId, 16);
      // Retire the cached signer immediately; only this event may install its refresh.
      setWalletState((prev) =>
        connectionIsCurrent(rawProvider, generation)
          ? {
              ...prev,
              chainId: nextChainId,
              signer: null,
              provider: null,
              balance: null,
              isConnecting: false,
            }
          : prev,
      );
      void refreshConnection(rawProvider, generation, nextChainId);
    };

    const handleDisconnect = () => {
      if (activeRawProviderRef.current !== rawProvider) return;
      invalidateWalletConnection();
      disconnect();
    };

    let cleanupAccountsChanged = () => {};
    let cleanupChainChanged = () => {};
    let cleanupDisconnect = () => {};

    let pollTimer: any = null;

    const trySubscribe = () => {
      try {
        if (typeof rawProvider.on === "function") {
          rawProvider.on("accountsChanged", handleAccountsChanged);
          cleanupAccountsChanged = () => {
            try {
              rawProvider.removeListener?.("accountsChanged", handleAccountsChanged);
            } catch {}
          };
        }
        if (typeof rawProvider.on === "function") {
          rawProvider.on("chainChanged", handleChainChanged);
          cleanupChainChanged = () => {
            try {
              rawProvider.removeListener?.("chainChanged", handleChainChanged);
            } catch {}
          };
        }
        if (typeof rawProvider.on === "function") {
          rawProvider.on("disconnect", handleDisconnect);
          cleanupDisconnect = () => {
            try {
              rawProvider.removeListener?.("disconnect", handleDisconnect);
            } catch {}
          };
        }
      } catch (error) {
        console.warn(
          "[WalletContext] Failed to add wallet listener, falling back to polling:",
          sanitizeErrorForLogging(error),
        );
        // Fallback to polling
        pollTimer = setInterval(async () => {
          const generation = getWalletConnectionGeneration();
          const current = () => connectionIsCurrent(rawProvider, generation);
          if (!current()) return;
          try {
            const accounts: string[] = await rawProvider.request({ method: "eth_accounts" });
            if (!current()) return;
            if (!accounts || accounts.length === 0) {
              if (walletStateRef.current.address) disconnect();
              return;
            } else if (accounts[0] !== walletStateRef.current.address) {
              handleAccountsChanged(accounts);
              return;
            }
          } catch {}
          if (!current()) return;
          try {
            const chainIdHex: string = await rawProvider.request({ method: "eth_chainId" });
            if (!current()) return;
            if (parseInt(chainIdHex, 16) !== walletStateRef.current.chainId)
              handleChainChanged(chainIdHex);
          } catch {}
        }, 1500);
      }
    };

    trySubscribe();

    return () => {
      cleanupAccountsChanged();
      cleanupChainChanged();
      cleanupDisconnect();
      if (pollTimer) {
        try {
          clearInterval(pollTimer);
        } catch {}
      }
    };
  }, [walletState.rawProvider, disconnect, connectionIsCurrent, refreshConnection]);

  // Auto-connect if previously connected - use saved wallet type from localStorage
  const isAutoConnectDone = useRef(false);
  useEffect(() => {
    if (isAutoConnectDone.current) return;

    const autoConnect = async () => {
      // Get saved wallet type from localStorage
      let savedWalletType: string | null = null;
      try {
        savedWalletType = localStorage.getItem(WALLET_TYPE_STORAGE_KEY);
      } catch (e) {
        console.warn("[WalletContext] Failed to read wallet type from localStorage:", e);
      }

      // Only auto-connect if user previously connected (has saved wallet type)
      // This respects the user's explicit disconnect action
      if (!savedWalletType) {
        isAutoConnectDone.current = true;
        return;
      }

      const wallets = getAvailableWallets();
      if (wallets.length === 0) {
        isAutoConnectDone.current = true;
        return;
      }

      // Find the wallet that matches the saved type
      const targetWallet = wallets.find((w) => w.id === savedWalletType);
      if (!targetWallet) {
        // Clear invalid saved type
        try {
          localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
        } catch {}
        isAutoConnectDone.current = true;
        return;
      }
      if (activeRawProviderRef.current) {
        isAutoConnectDone.current = true;
        return;
      }
      activeRawProviderRef.current = targetWallet.provider;
      invalidateWalletConnection();
      const generation = getWalletConnectionGeneration();
      const current = () => connectionIsCurrent(targetWallet.provider, generation);

      try {
        // Use eth_accounts to check if already connected (doesn't prompt)
        const accounts = await targetWallet.provider.request({ method: "eth_accounts" });
        if (!current()) return;
        if (accounts && accounts.length > 0) {
          // Hydrate state without prompting user
          const provider = createWalletProvider(targetWallet.provider);
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const network = await provider.getNetwork();
          if (!current()) return;

          setWalletState((prev) =>
            current()
              ? {
                  ...prev,
                  address,
                  provider,
                  signer,
                  isConnecting: false,
                  chainId: Number(network.chainId),
                  connectedWalletId: targetWallet.id,
                  rawProvider: targetWallet.provider,
                }
              : prev,
          );

          try {
            const balance = await provider.getBalance(address);
            if (!current()) return;
            setWalletState((prev) =>
              current() && prev.provider === provider
                ? { ...prev, balance: ethers.formatEther(balance) }
                : prev,
            );
          } catch {}
        } else {
          activeRawProviderRef.current = null;
          // Clear saved wallet type if no accounts connected
          try {
            localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
          } catch {}
        }
        isAutoConnectDone.current = true;
      } catch (error) {
        if (!current()) return;
        activeRawProviderRef.current = null;
        console.warn("[WalletContext] Auto-connect failed:", sanitizeErrorForLogging(error));
        isAutoConnectDone.current = true;
      }
    };

    // Add a small delay to ensure the page is fully loaded
    const timer = setTimeout(autoConnect, 100);
    return () => clearTimeout(timer);
  }, [getAvailableWallets, connectionIsCurrent]);

  const contextValue: WalletContextValue = {
    ...walletState,
    connect,
    connectWithProvider,
    disconnect,
    switchChain,
    switchOrAddChain,
    refreshBalance,
    getAvailableWallets,
    showWalletSelection,
    setShowWalletSelection,
    showNetworkSelection,
    setShowNetworkSelection,
  };

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
}
