export type PublicStateSyncProgress = {
  domain: "authorization" | "lineage";
  phase: "download" | "verify" | "catchup" | "complete";
  completed: number;
  total: number;
  resumed?: boolean;
};

const listeners = new Set<(progress: PublicStateSyncProgress) => void>();
const publicCounts = (progress: PublicStateSyncProgress): PublicStateSyncProgress => ({
  domain: progress.domain,
  phase: progress.phase,
  completed: progress.completed,
  total: progress.total,
  ...(progress.resumed === undefined ? {} : { resumed: progress.resumed }),
});
export function subscribePublicStateSyncProgress(
  listener: (progress: PublicStateSyncProgress) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function publishPublicStateSyncProgress(progress: PublicStateSyncProgress): void {
  if (!isPublicStateSyncProgress(progress)) return;
  for (const listener of listeners) listener(publicCounts(progress));
}
export function isPublicStateSyncProgress(value: unknown): value is PublicStateSyncProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as PublicStateSyncProgress;
  return (
    (item.domain === "authorization" || item.domain === "lineage") &&
    ["download", "verify", "catchup", "complete"].includes(item.phase) &&
    Number.isSafeInteger(item.completed) &&
    Number.isSafeInteger(item.total) &&
    item.completed >= 0 &&
    item.total >= item.completed &&
    (item.resumed === undefined || typeof item.resumed === "boolean")
  );
}
/** Only aggregate public counts cross this boundary, never a queried identity or alias. */
export function reportPublicStateSyncProgress(progress: PublicStateSyncProgress): void {
  if (!isPublicStateSyncProgress(progress))
    throw new Error("Invalid public synchronization progress");
  if (
    typeof window === "undefined" &&
    typeof self !== "undefined" &&
    typeof self.postMessage === "function"
  ) {
    self.postMessage({ type: "publicStateSyncProgress", progress: publicCounts(progress) });
  } else publishPublicStateSyncProgress(progress);
}
