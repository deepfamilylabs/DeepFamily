import { describe, expect, it, vi } from "vitest";
import { publishPublicStateSyncProgress, subscribePublicStateSyncProgress } from "./publicStateSyncProgress";

describe("public synchronization progress boundary", () => {
  it("copies only public counters and isolates listeners from each other's mutations", () => {
    const mutate = subscribePublicStateSyncProgress((progress) => { progress.completed = 99; });
    const listener = vi.fn();
    const unsubscribe = subscribePublicStateSyncProgress(listener);
    try {
      publishPublicStateSyncProgress({ domain: "authorization", phase: "download", completed: 1, total: 3,
        rawPassphrase: "private-credential-sentinel", authorizationAlias: "target-sentinel" } as Parameters<typeof publishPublicStateSyncProgress>[0]);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ domain: "authorization", phase: "download", completed: 1, total: 3 });
      expect(JSON.stringify(listener.mock.calls)).not.toContain("sentinel");
    } finally { mutate(); unsubscribe(); }
  });
});
