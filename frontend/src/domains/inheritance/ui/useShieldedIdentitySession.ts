import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  ShieldedAssetSessionState,
  ShieldedPublicIdentity,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import {
  subscribeShieldedAssetWorkerLock,
  terminateShieldedAssetWorker,
} from "../../../shared/workers/shieldedAssetWorkerClient";
import { terminateZkWorker } from "../../../shared/workers/zkWorkerClient";

export const SHIELDED_IDENTITY_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface IdentitySession {
  scope: string;
  state: ShieldedAssetSessionState;
}

/** Holds public handles only; locking terminates both secret-processing workers. */
export function useShieldedIdentitySession({
  scope,
  busy = false,
}: {
  scope: string;
  busy?: boolean;
}) {
  const sessionRef = useRef<IdentitySession | null>(null);
  const scopeRef = useRef(scope);
  const busyRef = useRef(busy);
  const mountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiresAtRef = useRef(0);
  const generationRef = useRef(0);
  const [, setRevision] = useState(0);
  const generation = generationRef.current;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearSession = useCallback(() => {
    clearTimer();
    expiresAtRef.current = 0;
    sessionRef.current = null;
    generationRef.current += 1;
    if (mountedRef.current) setRevision((revision) => revision + 1);
  }, [clearTimer]);

  const lock = useCallback(() => {
    terminateZkWorker();
    terminateShieldedAssetWorker();
    clearSession();
  }, [clearSession]);

  const scheduleIdleLock = useCallback(() => {
    clearTimer();
    if (!mountedRef.current || !sessionRef.current || busyRef.current) return;
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        if (!busyRef.current) lock();
      },
      Math.max(0, expiresAtRef.current - Date.now()),
    );
  }, [clearTimer, lock]);

  const touch = useCallback(() => {
    if (!sessionRef.current) return;
    expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
    scheduleIdleLock();
  }, [scheduleIdleLock]);

  const update = useCallback(
    (state: ShieldedAssetSessionState) => {
      // Ignore derivations that finish after locking, navigation, or a scope change.
      if (!mountedRef.current || scopeRef.current !== scope || generationRef.current !== generation)
        return;
      // Copy a whitelist of public fields. Secrets never enter the React session.
      const identity = state.identity
        ? {
            handle: state.identity.handle,
            identitySuiteId: state.identity.identitySuiteId,
            identityCommitment: state.identity.identityCommitment,
            personHash: state.identity.personHash,
            identity: { fullName: state.identity.identity.fullName },
          }
        : null;
      const funds = state.funds
        ? {
            ownerCommitment: state.funds.ownerCommitment,
            viewingKey: state.funds.viewingKey,
            fundsFingerprint: state.funds.fundsFingerprint,
            rootSource: state.funds.rootSource,
            recoveryVerified: state.funds.recoveryVerified,
            ...(state.funds.backupRequired === undefined
              ? {}
              : { backupRequired: state.funds.backupRequired }),
            ...(state.funds.signerAddress ? { signerAddress: state.funds.signerAddress } : {}),
            ...(state.funds.recoveryPath ? { recoveryPath: state.funds.recoveryPath } : {}),
          }
        : null;
      sessionRef.current = { scope, state: { identity, funds } };
      expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      scheduleIdleLock();
      setRevision((revision) => revision + 1);
    },
    [scope, generation, scheduleIdleLock],
  );
  const unlock = useCallback(
    (identity: ShieldedPublicIdentity) => {
      update({ identity, funds: sessionRef.current?.state.funds ?? null });
    },
    [update],
  );

  useLayoutEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      lock();
    } else if (wasBusy !== busy) {
      // An operation can take longer than the idle window. Give its user a fresh
      // window when it finishes instead of locking halfway through proof/submit.
      if (!busy) expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      scheduleIdleLock();
    }
  }, [scope, busy, lock, scheduleIdleLock]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    window.addEventListener("keydown", touch, true);
    window.addEventListener("pagehide", lock);
    const visibility = () => {
      if (document.visibilityState === "hidden") lock();
    };
    document.addEventListener("visibilitychange", visibility);
    const unsubscribe = subscribeShieldedAssetWorkerLock(clearSession);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("keydown", touch, true);
      window.removeEventListener("pagehide", lock);
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe();
      clearTimer();
      sessionRef.current = null;
      expiresAtRef.current = 0;
      terminateShieldedAssetWorker();
      terminateZkWorker();
    };
  }, [touch, lock, clearTimer, clearSession]);

  return {
    // Hide an old scope during render, before the layout effect releases it.
    identity: sessionRef.current?.scope === scope ? sessionRef.current.state.identity : null,
    funds: sessionRef.current?.scope === scope ? sessionRef.current.state.funds : null,
    unlock,
    update,
    lock,
    touch,
  };
}
