import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { useToast } from "../components/ToastProvider";
import { useTranslation } from "react-i18next";
import { getAddChainParams } from "../config/networks";
import { SUPPORTED_WALLETS } from "../config/wallets";

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

  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const [showNetworkSelection, setShowNetworkSelection] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!walletState.provider || !walletState.address) return;

    try {
      const balance = await walletState.provider.getBalance(walletState.address);
      setWalletState((prev) => ({
        ...prev,
        balance: ethers.formatEther(balance),
      }));
    } catch (error) {
      console.error("[WalletContext] Failed to fetch balance:", error);
    }
  }, [walletState.provider, walletState.address]);

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
        toast.show(t("wallet.noWallet", "Wallet not available"));
        return;
      }

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

      setWalletState((prev) => ({ ...prev, isConnecting: true }));

      try {
        // Use the selected provider directly to avoid interception
        const accounts = await selectedProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
          throw new Error("No accounts returned");
        }

        const provider = new ethers.BrowserProvider(selectedProvider as any);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();

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

        setWalletState(newState);

        // Refresh balance after connection
        try {
          const balance = await provider.getBalance(address);
          setWalletState((prev) => ({
            ...prev,
            balance: ethers.formatEther(balance),
          }));
        } catch (balanceError) {
          console.warn("Failed to fetch balance:", balanceError);
        }

        toast.show(t("wallet.connected", "Wallet connected successfully"));
      } catch (error: any) {
        console.error("[WalletContext] Failed to connect wallet:", error);
        setWalletState((prev) => ({ ...prev, isConnecting: false }));

        if (error.code === 4001) {
          toast.show(t("wallet.rejected", "Connection rejected by user"));
        } else if (error.code === -32002) {
          toast.show(t("wallet.pending", "Connection request already pending"));
        } else {
          toast.show(
            t(
              "wallet.connectionFailed",
              `Failed to connect wallet: ${error.message || "Unknown error"}`,
            ),
          );
        }
      }
    },
    [t, toast],
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
    let shouldNotify = false;

    setWalletState((prev) => {
      const wasConnected = !!(prev.address || prev.provider || prev.signer);
      if (!wasConnected) {
        return prev;
      }

      shouldNotify = true;
      return {
        address: null,
        provider: null,
        signer: null,
        isConnecting: false,
        chainId: null,
        balance: null,
        connectedWalletId: null,
        rawProvider: null,
      };
    });

    if (shouldNotify) {
      // Clear saved wallet type from localStorage
      try {
        localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
      } catch (e) {
        console.warn("[WalletContext] Failed to clear wallet type from localStorage:", e);
      }
      toast.show(t("wallet.disconnected", "Wallet disconnected"));
    }
  }, [t, toast]);

  const switchChain = useCallback(
    async (targetChainId: number) => {
      // Use the connected rawProvider instead of getBoundProvider
      const rawProvider = walletState.rawProvider;
      if (!rawProvider) {
        toast.show(t("wallet.notConnected", "Please connect your wallet"));
        return;
      }

      try {
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        });

        // Update chain ID in state
        setWalletState((prev) => ({
          ...prev,
          chainId: targetChainId,
        }));

        toast.show(t("wallet.chainSwitched", "Chain switched successfully"));
      } catch (error: any) {
        console.error("[WalletContext] Failed to switch chain:", error);
        if (error.code === 4902) {
          toast.show(t("wallet.chainNotAdded", "Chain not added to wallet"));
        } else if (error.code === 4001) {
          toast.show(t("wallet.rejected", "Request rejected by user"));
        } else {
          toast.show(t("wallet.chainSwitchFailed", "Failed to switch chain"));
        }
      }
    },
    [t, toast, walletState.rawProvider],
  );

  // Switch to chain, or add it first if not present in wallet
  const switchOrAddChain = useCallback(
    async (targetChainId: number): Promise<boolean> => {
      const rawProvider = walletState.rawProvider;
      if (!rawProvider) {
        toast.show(t("wallet.notConnected", "Please connect your wallet"));
        return false;
      }

      const chainIdHex = `0x${targetChainId.toString(16)}`;

      try {
        // First try to switch
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });

        setWalletState((prev) => ({ ...prev, chainId: targetChainId }));
        toast.show(t("wallet.chainSwitched", "Chain switched successfully"));
        return true;
      } catch (switchError: any) {
        // Error 4902: chain not added to wallet
        if (switchError.code === 4902) {
          const addChainParams = getAddChainParams(targetChainId);
          if (!addChainParams) {
            toast.show(t("wallet.chainNotSupported", "This network is not supported"));
            return false;
          }

          try {
            await rawProvider.request({
              method: "wallet_addEthereumChain",
              params: [addChainParams],
            });

            setWalletState((prev) => ({ ...prev, chainId: targetChainId }));
            toast.show(t("wallet.chainAdded", "Network added successfully"));
            return true;
          } catch (addError: any) {
            console.error("[WalletContext] Failed to add chain:", addError);
            if (addError.code === 4001) {
              toast.show(t("wallet.rejected", "Request rejected by user"));
            } else {
              toast.show(t("wallet.chainAddFailed", "Failed to add network"));
            }
            return false;
          }
        } else if (switchError.code === 4001) {
          toast.show(t("wallet.rejected", "Request rejected by user"));
          return false;
        } else {
          console.error("[WalletContext] Failed to switch chain:", switchError);
          toast.show(t("wallet.chainSwitchFailed", "Failed to switch chain"));
          return false;
        }
      }
    },
    [t, toast, walletState.rawProvider],
  );

  // Listen to account and chain changes - use rawProvider from state
  useEffect(() => {
    const rawProvider = walletState.rawProvider;
    if (!rawProvider) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else if (accounts[0] !== walletState.address) {
        // Account changed, refresh signer/address without prompting
        (async () => {
          try {
            const provider = new ethers.BrowserProvider(rawProvider as any);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            setWalletState((prev) => ({ ...prev, provider, signer, address }));
            refreshBalance();
          } catch (e) {
            console.warn("Failed to refresh after account change:", e);
          }
        })();
      }
    };

    const handleChainChanged = (chainId: string) => {
      setWalletState((prev) => ({
        ...prev,
        chainId: parseInt(chainId, 16),
      }));
      // Refresh balance on chain change
      if (walletState.address) {
        refreshBalance();
      }
    };

    const handleDisconnect = () => {
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
          error,
        );
        // Fallback to polling
        pollTimer = setInterval(async () => {
          try {
            const accounts: string[] = await rawProvider.request({ method: "eth_accounts" });
            if (!accounts || accounts.length === 0) {
              if (walletState.address) disconnect();
            } else if (accounts[0] !== walletState.address) {
              handleAccountsChanged(accounts);
            }
          } catch {}
          try {
            const chainIdHex: string = await rawProvider.request({ method: "eth_chainId" });
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
  }, [
    walletState.rawProvider,
    walletState.address,
    walletState.connectedWalletId,
    disconnect,
    refreshBalance,
  ]);

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

      try {
        // Use eth_accounts to check if already connected (doesn't prompt)
        const accounts = await targetWallet.provider.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          // Hydrate state without prompting user
          const provider = new ethers.BrowserProvider(targetWallet.provider as any);
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          const network = await provider.getNetwork();

          setWalletState((prev) => ({
            ...prev,
            address,
            provider,
            signer,
            isConnecting: false,
            chainId: Number(network.chainId),
            connectedWalletId: targetWallet.id,
            rawProvider: targetWallet.provider,
          }));

          try {
            const balance = await provider.getBalance(address);
            setWalletState((prev) => ({ ...prev, balance: ethers.formatEther(balance) }));
          } catch {}
        } else {
          // Clear saved wallet type if no accounts connected
          try {
            localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
          } catch {}
        }
        isAutoConnectDone.current = true;
      } catch (error) {
        console.warn("[WalletContext] Auto-connect failed:", error);
        isAutoConnectDone.current = true;
      }
    };

    // Add a small delay to ensure the page is fully loaded
    const timer = setTimeout(autoConnect, 100);
    return () => clearTimeout(timer);
  }, [getAvailableWallets]);

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
