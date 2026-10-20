import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PublicHashForm } from "../../person";
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
export const SHIELDED_WALLET_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

/** Public person details used to prefill a re-unlock. Never contains the passphrase. */
export type ShieldedIdentityDraft = Omit<PublicHashForm, "hasPassphrase">;

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
  const scopeGenerationRef = useRef(0);
  const walletRequestRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [, setRevision] = useState(0);
  // Survives wallet signing and hidden-page locks, with an idle deadline
  // independent of the secret session.
  const identityDraftRef = useRef<{ scope: string; draft: ShieldedIdentityDraft } | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftExpiresAtRef = useRef(0);
  const generation = generationRef.current;
  const scopeGeneration = scopeGenerationRef.current;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearWalletRequest = useCallback(() => {
    if (walletRequestRef.current) clearTimeout(walletRequestRef.current.timer);
    walletRequestRef.current = null;
  }, []);

  const clearDraftTimer = useCallback(() => {
    if (draftTimerRef.current !== null) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
  }, []);

  const forgetIdentityDraft = useCallback(() => {
    clearDraftTimer();
    draftExpiresAtRef.current = 0;
    if (!identityDraftRef.current) return;
    identityDraftRef.current = null;
    if (mountedRef.current) setRevision((revision) => revision + 1);
  }, [clearDraftTimer]);

  const scheduleDraftExpiry = useCallback(() => {
    clearDraftTimer();
    if (!mountedRef.current || !identityDraftRef.current || busyRef.current) return;
    draftTimerRef.current = setTimeout(
      () => {
        draftTimerRef.current = null;
        if (!busyRef.current) forgetIdentityDraft();
      },
      Math.max(0, draftExpiresAtRef.current - Date.now()),
    );
  }, [clearDraftTimer, forgetIdentityDraft]);

  const touchDraft = useCallback(() => {
    if (!identityDraftRef.current) return;
    draftExpiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
    scheduleDraftExpiry();
  }, [scheduleDraftExpiry]);

  const clearSession = useCallback(() => {
    clearTimer();
    clearWalletRequest();
    expiresAtRef.current = 0;
    sessionRef.current = null;
    generationRef.current += 1;
    if (mountedRef.current) setRevision((revision) => revision + 1);
  }, [clearTimer, clearWalletRequest]);

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
        if (busyRef.current) return;
        forgetIdentityDraft();
        lock();
      },
      Math.max(0, expiresAtRef.current - Date.now()),
    );
  }, [clearTimer, forgetIdentityDraft, lock]);

  const touch = useCallback(() => {
    if (sessionRef.current) {
      expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      scheduleIdleLock();
    }
    touchDraft();
  }, [scheduleIdleLock, touchDraft]);

  const isWalletRequestPending = useCallback(() => walletRequestRef.current !== null, []);
  const beginWalletRequest = useCallback(() => {
    if (!mountedRef.current || scopeRef.current !== scope || generationRef.current !== generation)
      return () => {};
    clearWalletRequest();
    // Only an actual wallet signature or transaction gets this brief exception. A
    // request's object identity prevents a late release from ending a newer one.
    const request = {
      timer: setTimeout(() => {
        if (walletRequestRef.current === request) lock();
      }, SHIELDED_WALLET_REQUEST_TIMEOUT_MS),
    };
    walletRequestRef.current = request;
    touch();
    return () => {
      if (walletRequestRef.current !== request) return;
      clearWalletRequest();
      if (!mountedRef.current || scopeRef.current !== scope || generationRef.current !== generation)
        return;
      if (document.visibilityState === "hidden") lock();
      else touch();
    };
  }, [scope, generation, clearWalletRequest, lock, touch]);

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
      const independentKey = state.independentKey
        ? {
            ownerCommitment: state.independentKey.ownerCommitment,
            viewingKey: state.independentKey.viewingKey,
            keyFingerprint: state.independentKey.keyFingerprint,
            rootSource: state.independentKey.rootSource,
            recoveryVerified: state.independentKey.recoveryVerified,
            ...(state.independentKey.backupRequired === undefined
              ? {}
              : { backupRequired: state.independentKey.backupRequired }),
            ...(state.independentKey.signerAddress ? { signerAddress: state.independentKey.signerAddress } : {}),
            ...(state.independentKey.recoveryPath ? { recoveryPath: state.independentKey.recoveryPath } : {}),
          }
        : null;
      const credentials = state.credentials ? { handle: state.credentials.handle } : null;
      sessionRef.current = { scope, state: { credentials, identity, independentKey } };
      expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      scheduleIdleLock();
      touchDraft();
      setRevision((revision) => revision + 1);
    },
    [scope, generation, scheduleIdleLock, touchDraft],
  );
  const unlock = useCallback(
    (identity: ShieldedPublicIdentity) => {
      update({
        credentials: sessionRef.current?.state.credentials ?? null,
        identity,
        independentKey: sessionRef.current?.state.independentKey ?? null,
      });
    },
    [update],
  );
  const rememberIdentityDraft = useCallback(
    (draft: ShieldedIdentityDraft | null) => {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        scopeGenerationRef.current !== scopeGeneration
      )
        return;
      if (!draft) {
        forgetIdentityDraft();
        return;
      }
      identityDraftRef.current = {
        scope,
        draft: {
          fullName: draft.fullName,
          isBirthBC: draft.isBirthBC,
          birthYear: draft.birthYear,
          birthMonth: draft.birthMonth,
          birthDay: draft.birthDay,
          gender: draft.gender,
        },
      };
      touchDraft();
      setRevision((revision) => revision + 1);
    },
    [scope, scopeGeneration, forgetIdentityDraft, touchDraft],
  );

  useLayoutEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      scopeGenerationRef.current += 1;
      forgetIdentityDraft();
      lock();
    } else if (wasBusy !== busy) {
      // An operation can take longer than the idle window. Give its user a fresh
      // window when it finishes instead of locking halfway through proof/submit.
      if (!busy) {
        expiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
        draftExpiresAtRef.current = Date.now() + SHIELDED_IDENTITY_IDLE_TIMEOUT_MS;
      }
      scheduleIdleLock();
      scheduleDraftExpiry();
    }
  }, [scope, busy, forgetIdentityDraft, lock, scheduleIdleLock, scheduleDraftExpiry]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    window.addEventListener("keydown", touch, true);
    window.addEventListener("pagehide", lock);
    const visibility = () => {
      if (document.visibilityState === "hidden" && !walletRequestRef.current) lock();
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
      clearWalletRequest();
      clearDraftTimer();
      sessionRef.current = null;
      expiresAtRef.current = 0;
      identityDraftRef.current = null;
      draftExpiresAtRef.current = 0;
      terminateShieldedAssetWorker();
      terminateZkWorker();
    };
  }, [touch, lock, clearTimer, clearWalletRequest, clearDraftTimer, clearSession]);

  return {
    // Hide an old scope during render, before the layout effect releases it.
    identity: sessionRef.current?.scope === scope ? sessionRef.current.state.identity : null,
    credentials: sessionRef.current?.scope === scope ? sessionRef.current.state.credentials : null,
    independentKey: sessionRef.current?.scope === scope ? sessionRef.current.state.independentKey : null,
    identityDraft:
      identityDraftRef.current?.scope === scope ? identityDraftRef.current.draft : null,
    rememberIdentityDraft,
    unlock,
    update,
    lock,
    touch,
    beginWalletRequest,
    isWalletRequestPending,
  };
}
