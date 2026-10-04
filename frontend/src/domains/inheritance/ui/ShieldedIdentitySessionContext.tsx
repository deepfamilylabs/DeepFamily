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
  const session = useShieldedIdentitySession({ scope, busy: busyOwners.size > 0 });
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
  const { identity, unlock, lock, touch } = session;
  const guardedUnlock = useCallback<typeof unlock>(
    (material) => {
      if (enabledRef.current) unlock(material);
    },
    [unlock],
  );
  useLayoutEffect(() => {
    if (!enabled) lock();
  }, [enabled, lock]);
  const value = useMemo(
    () => ({ identity: enabled ? identity : null, unlock: guardedUnlock, lock, touch, setBusyFor }),
    [enabled, identity, guardedUnlock, lock, touch, setBusyFor],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Each mounted consumer owns its busy flag so a late old operation cannot release a new one. */
export function useShieldedPageIdentitySession(): IdentitySession & {
  setBusy: (busy: boolean) => void;
} {
  const session = useContext(SessionContext);
  const owner = useId();
  const mounted = useRef(false);
  if (!session) throw new Error("Shielded identity session provider is missing");
  const { setBusyFor, identity, unlock, lock, touch } = session;
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
    () => ({ identity, unlock, lock, touch, setBusy }),
    [identity, unlock, lock, touch, setBusy],
  );
}
