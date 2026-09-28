import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";

export const SHIELDED_IDENTITY_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface IdentitySession {
  scope: string;
  identity: IdentityMaterialV1Result;
}

/** Keeps the derived identity in this mounted page only; the original passphrase is never stored. */
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

  const lock = useCallback(() => {
    clearTimer();
    expiresAtRef.current = 0;
    sessionRef.current = null;
    generationRef.current += 1;
    if (mountedRef.current) setRevision((revision) => revision + 1);
  }, [clearTimer]);

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

  const unlock = useCallback(
    (identity: IdentityMaterialV1Result) => {
      // Ignore derivations that finish after locking, navigation, or a scope change.
      if (!mountedRef.current || scopeRef.current !== scope || generationRef.current !== generation)
        return;
      sessionRef.current = { scope, identity };
      expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      scheduleIdleLock();
      setRevision((revision) => revision + 1);
    },
    [scope, generation, scheduleIdleLock],
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
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("keydown", touch, true);
      window.removeEventListener("pagehide", lock);
      clearTimer();
      sessionRef.current = null;
      expiresAtRef.current = 0;
    };
  }, [touch, lock, clearTimer]);

  return {
    // Hide an old scope during render, before the layout effect releases it.
    identity: sessionRef.current?.scope === scope ? sessionRef.current.identity : null,
    unlock,
    lock,
    touch,
  };
}
