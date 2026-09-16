/** Only public attempt identifiers and a boolean preference live here; never passwords or keys. */
interface UnlockSession {
  remember: boolean;
  paused: boolean;
  revision: number;
  attempts: Set<string>;
  active: Map<string, AbortController>;
  issues: Map<string, "read" | "validation" | "persistence">;
  listeners: Set<() => void>;
}

const sessions = new Map<string, UnlockSession>();
const preferenceKey = (scope: string) => `${scope}::rememberMetadataUnlocks`;

function session(scope: string): UnlockSession {
  let value = sessions.get(scope);
  if (!value) {
    let remember = true;
    try {
      remember = localStorage.getItem(preferenceKey(scope)) !== "false";
    } catch {
      // Storage is optional; the preference still works for this page session.
    }
    value = {
      remember,
      paused: false,
      revision: 0,
      attempts: new Set(),
      active: new Map(),
      issues: new Map(),
      listeners: new Set(),
    };
    sessions.set(scope, value);
  }
  return value;
}

function notify(value: UnlockSession): void {
  value.revision += 1;
  for (const listener of value.listeners) listener();
}

export function subscribeMetadataUnlockSession(scope: string, listener: () => void): () => void {
  const value = session(scope);
  value.listeners.add(listener);
  return () => {
    value.listeners.delete(listener);
  };
}

export const getMetadataUnlockSessionRevision = (scope: string): number => session(scope).revision;
export const getMetadataUnlockPreference = (scope: string): boolean => session(scope).remember;

export function setMetadataUnlockPreference(scope: string, remember: boolean): void {
  const value = session(scope);
  value.remember = remember;
  try {
    localStorage.setItem(preferenceKey(scope), String(remember));
  } catch {
    // Never fall back to persisting plaintext or secrets in another store.
  }
  notify(value);
}

export const isAutomaticMetadataUnlockPaused = (scope: string): boolean => session(scope).paused;

/** A clear is also a session-wide stop, including after navigation/remount in this tab. */
export function pauseAutomaticMetadataUnlock(scope: string): void {
  const value = session(scope);
  value.paused = true;
  for (const controller of value.active.values()) controller.abort();
  notify(value);
}

export function hasAutomaticMetadataUnlockAttempt(scope: string, key: string): boolean {
  return session(scope).attempts.has(key);
}

/** Claim synchronously so two mounted surfaces cannot try the same envelope twice. */
export function claimAutomaticMetadataUnlock(scope: string, key: string): AbortController | null {
  const value = session(scope);
  if (value.paused || value.attempts.has(key)) return null;
  const controller = new AbortController();
  value.attempts.add(key);
  value.active.set(key, controller);
  return controller;
}

export function finishAutomaticMetadataUnlock(
  scope: string,
  key: string,
  controller: AbortController,
  options: { retry?: boolean; issue?: "read" | "validation" | "persistence" } = {},
): void {
  const value = session(scope);
  if (value.active.get(key) !== controller) return;
  value.active.delete(key);
  if (options.retry) value.attempts.delete(key);
  if (options.issue) value.issues.set(key, options.issue);
  else value.issues.delete(key);
  notify(value);
}

export function getAutomaticMetadataUnlockIssues(scope: string) {
  return Array.from(session(scope).issues, ([key, kind]) => ({ key, kind }));
}
