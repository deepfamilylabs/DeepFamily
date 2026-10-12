import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShieldedIdentitySession } from "./useShieldedIdentitySession";

type IdentitySession = ReturnType<typeof useShieldedIdentitySession>;
type SessionContextValue = IdentitySession & {
  /** A secret operation is running; pool changes wait so no queued work spans two pools. */
  busy: boolean;
  setBusyFor: (owner: string, busy: boolean) => void;
};
const SessionContext = createContext<SessionContextValue | null>(null);

/** Identity keys belong to the page's protocol context; asset state stays in each pool panel. */
export function ShieldedIdentitySessionProvider({
  scope,
  enabled = true,
  children,
}: {
  scope: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const [busyOwners, setBusyOwners] = useState<ReadonlySet<string>>(() => new Set());
  const busy = busyOwners.size > 0;
  const session = useShieldedIdentitySession({ scope, busy });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const setBusyFor = useCallback((owner: string, busy: boolean) => {
    setBusyOwners((previous) => {
      if (previous.has(owner) === busy) return previous;
      const next = new Set(previous);
      if (busy) next.add(owner);
      else next.delete(owner);
      return next;
    });
  }, []);
  const {
    credentials,
    identity,
    funds,
    identityDraft,
    rememberIdentityDraft,
    unlock,
    update,
    lock,
    touch,
    beginWalletRequest,
    isWalletRequestPending,
  } = session;
  const guardedUnlock = useCallback<typeof unlock>(
    (material) => {
      if (enabledRef.current) unlock(material);
    },
    [unlock],
  );
  const guardedUpdate = useCallback<typeof update>(
    (state) => {
      if (enabledRef.current) update(state);
    },
    [update],
  );
  const guardedBeginWalletRequest = useCallback<typeof beginWalletRequest>(
    () => (enabledRef.current ? beginWalletRequest() : () => {}),
    [beginWalletRequest],
  );
  useLayoutEffect(() => {
    if (enabled) return;
    rememberIdentityDraft(null);
    lock();
  }, [enabled, lock, rememberIdentityDraft]);
  const value = useMemo(
    () => ({
      credentials: enabled ? credentials : null,
      identity: enabled ? identity : null,
      funds: enabled ? funds : null,
      identityDraft: enabled ? identityDraft : null,
      rememberIdentityDraft,
      unlock: guardedUnlock,
      update: guardedUpdate,
      lock,
      touch,
      beginWalletRequest: guardedBeginWalletRequest,
      isWalletRequestPending,
      busy,
      setBusyFor,
    }),
    [
      busy,
      enabled,
      credentials,
      identity,
      funds,
      identityDraft,
      rememberIdentityDraft,
      guardedUnlock,
      guardedUpdate,
      lock,
      touch,
      guardedBeginWalletRequest,
      isWalletRequestPending,
      setBusyFor,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Each mounted consumer owns its busy flag so a late old operation cannot release a new one. */
export function useShieldedPageIdentitySession(): IdentitySession & {
  busy: boolean;
  setBusy: (busy: boolean) => void;
} {
  const session = useContext(SessionContext);
  const owner = useId();
  const mounted = useRef(false);
  if (!session) throw new Error("Shielded identity session provider is missing");
  const {
    setBusyFor,
    credentials,
    identity,
    funds,
    identityDraft,
    rememberIdentityDraft,
    unlock,
    update,
    lock,
    touch,
    beginWalletRequest,
    isWalletRequestPending,
    busy,
  } = session;
  const setBusy = useCallback(
    (busy: boolean) => {
      if (mounted.current) setBusyFor(owner, busy);
    },
    [owner, setBusyFor],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setBusyFor(owner, false);
    };
  }, [owner, setBusyFor]);
  return useMemo(
    () => ({
      credentials,
      identity,
      funds,
      identityDraft,
      rememberIdentityDraft,
      unlock,
      update,
      lock,
      touch,
      beginWalletRequest,
      isWalletRequestPending,
      busy,
      setBusy,
    }),
    [
      credentials,
      identity,
      funds,
      identityDraft,
      rememberIdentityDraft,
      unlock,
      update,
      lock,
      touch,
      beginWalletRequest,
      isWalletRequestPending,
      busy,
      setBusy,
    ],
  );
}
