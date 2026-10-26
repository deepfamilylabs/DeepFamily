import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReceiveWorkerClient } from "../../../shared/workers/receiveWorkerClient";
import type { WalletStateView } from "../../../shared/workers/walletWorkerTypes";

export const LOCKED_WALLET: WalletStateView = {
  unlocked: false,
  codeCount: "0",
  credentialCount: 0,
  backupChanged: false,
};

export interface ShieldedWalletSession {
  /** The Worker that holds the unlocked wallet; a lock replaces it. */
  worker(): ReceiveWorkerClient;
  state: WalletStateView;
  setState(state: WalletStateView): void;
  /** Bumped by every lock, so work started for an earlier wallet never reaches the chain. */
  epoch: { readonly current: number };
  lock(): void;
  /** An operation is running; the page keeps the asset fixed until it ends. */
  busy: boolean;
  setBusy(busy: boolean): void;
}

const SessionContext = createContext<ShieldedWalletSession | null>(null);

/**
 * The unlocked wallet outlives each asset pool's panel. The page remounts this
 * provider for another network, and a disconnected or switched wallet locks it.
 */
export function ShieldedWalletSessionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const client = useRef<ReceiveWorkerClient | null>(null);
  const epoch = useRef(0);
  const [state, setState] = useState(LOCKED_WALLET);
  const [busy, setBusy] = useState(false);
  const session = useMemo<ShieldedWalletSession>(
    () => ({
      worker: () => (client.current ??= new ReceiveWorkerClient()),
      state,
      setState,
      epoch,
      lock: () => {
        ++epoch.current;
        client.current?.close();
        client.current = null;
        setState(LOCKED_WALLET);
        setBusy(false);
      },
      busy,
      setBusy,
    }),
    [state, busy],
  );
  const lock = useRef(session.lock);
  lock.current = session.lock;
  useEffect(() => {
    if (!enabled) lock.current();
  }, [enabled]);
  useEffect(
    () => () => {
      ++epoch.current;
      client.current?.close();
      client.current = null;
    },
    [],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useShieldedWalletSession(): ShieldedWalletSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Shielded wallet session is unavailable");
  return session;
}
