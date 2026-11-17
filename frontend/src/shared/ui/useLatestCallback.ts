import { useCallback, useLayoutEffect, useRef } from "react";

/** Event handlers read committed state without restarting subscriptions or jobs. */
export function useLatestCallback<TArgs extends unknown[], TResult>(
  callback: (...args: TArgs) => TResult,
) {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: TArgs) => latest.current(...args), []);
}
