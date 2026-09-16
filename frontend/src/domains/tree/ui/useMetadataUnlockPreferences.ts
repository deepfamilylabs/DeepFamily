import { useCallback, useSyncExternalStore } from "react";
import {
  getMetadataUnlockPreference,
  setMetadataUnlockPreference,
  subscribeMetadataUnlockSession,
} from "../../../shared/metadata/metadataUnlockSession";

export function useMetadataUnlockPreferences(scopeKey: string) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeMetadataUnlockSession(scopeKey, listener),
    [scopeKey],
  );
  const getSnapshot = useCallback(() => getMetadataUnlockPreference(scopeKey), [scopeKey]);
  const remember = useSyncExternalStore(subscribe, getSnapshot, () => true);
  const setRemember = useCallback(
    (value: boolean) => setMetadataUnlockPreference(scopeKey, value),
    [scopeKey],
  );
  return { remember, setRemember };
}
