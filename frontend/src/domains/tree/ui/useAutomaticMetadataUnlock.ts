import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useConfig } from "../../config";
import { useTreeGraphData, useTreeMutations } from "../context";
import { buildTreeStorageNamespace } from "../context/treeStorageScope";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import {
  isMetadataUnlockUsable,
  rebaseValidatedMetadataUnlock,
  type NodeData,
} from "../../../shared/model";
import {
  MetadataUnlockCancelledError,
  unlockPersonVersionNode,
} from "../../../shared/metadata/metadataArchiveService";
import { CryptoWorkerTerminatedError } from "../../../shared/workers/cryptoWorkerClient";
import {
  claimAutomaticMetadataUnlock,
  finishAutomaticMetadataUnlock,
  getAutomaticMetadataUnlockIssues,
  getMetadataUnlockPreference,
  getMetadataUnlockSessionRevision,
  hasAutomaticMetadataUnlockAttempt,
  isAutomaticMetadataUnlockPaused,
  subscribeMetadataUnlockSession,
} from "../../../shared/metadata/metadataUnlockSession";
import type { MetadataUnlockViewScope } from "./useMetadataUnlockScope";

/** Includes every public binding; an updated envelope/context is a distinct attempt. */
export function automaticMetadataUnlockKey(node: NodeData): string | null {
  if (
    !node.personHash ||
    !Number.isSafeInteger(node.versionIndex) ||
    node.versionIndex < 1 ||
    !node.versionCommitment ||
    !node.metadataPointer ||
    !node.metadataPayloadHash ||
    !Number.isSafeInteger(node.metadataPayloadLength) ||
    Number(node.metadataPayloadLength) < 1 ||
    !Number.isSafeInteger(node.metadataSegmentCount) ||
    Number(node.metadataSegmentCount) < 1
  )
    return null;
  return [
    node.id,
    node.personHash.toLowerCase(),
    node.versionIndex,
    node.versionCommitment,
    node.metadataPointer.toLowerCase(),
    node.metadataPayloadHash.toLowerCase(),
    node.metadataPayloadLength,
    node.metadataSegmentCount,
    node.fatherHash?.toLowerCase(),
    node.fatherVersionIndex,
    node.motherHash?.toLowerCase(),
    node.motherVersionIndex,
  ].join("|");
}

/** One public empty-password attempt per envelope in this tab, always below foreground work. */
export function useAutomaticMetadataUnlock({
  suspended = false,
  priorityNodeId,
  viewScope,
}: {
  suspended?: boolean;
  priorityNodeId?: string;
  viewScope: MetadataUnlockViewScope;
}) {
  const graph = useTreeGraphData();
  const mutations = useTreeMutations();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const scopeKey = useMemo(
    () => buildTreeStorageNamespace({ chainId, contractAddress }),
    [chainId, contractAddress],
  );
  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return getReadonlyProvider(rpcUrl, chainId);
    } catch {
      return null;
    }
  }, [rpcUrl, chainId]);
  const subscribe = useCallback(
    (listener: () => void) => subscribeMetadataUnlockSession(scopeKey, listener),
    [scopeKey],
  );
  const getRevision = useCallback(() => getMetadataUnlockSessionRevision(scopeKey), [scopeKey]);
  const sessionRevision = useSyncExternalStore(subscribe, getRevision, () => 0);
  const paused = isAutomaticMetadataUnlockPaused(scopeKey);
  const latest = useRef({ graph, mutations, scopeKey, suspended, priorityNodeId, viewScope });
  latest.current = { graph, mutations, scopeKey, suspended, priorityNodeId, viewScope };
  const wake = useRef<() => void>(() => {});
  const activeNode = useRef<{ id: string; controller: AbortController } | null>(null);

  useEffect(() => {
    if (
      !provider ||
      !chainId ||
      !contractAddress ||
      !viewScope.rootId ||
      suspended ||
      paused ||
      graph.idbHydrated === false
    )
      return;
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    const available = () =>
      !disposed &&
      latest.current.scopeKey === scopeKey &&
      latest.current.viewScope.rootId === viewScope.rootId &&
      !latest.current.suspended &&
      !isAutomaticMetadataUnlockPaused(scopeKey) &&
      document.visibilityState !== "hidden";

    const schedule = (delay = 250) => {
      if (!available() || running || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (!available()) return;
      const current = latest.current;
      let node: NodeData | undefined;
      let key: string | null = null;
      let bestRank = Infinity;
      for (const id of current.viewScope.nodeIds) {
        const candidate = current.graph.nodesData[id];
        if (!candidate) continue;
        const rank =
          candidate.id === current.priorityNodeId
            ? 0
            : candidate.id === current.viewScope.rootId
              ? 1
              : 2;
        if (rank >= bestRank) continue;
        if (isMetadataUnlockUsable(candidate)) continue;
        const candidateKey = automaticMetadataUnlockKey(candidate);
        if (candidateKey && !hasAutomaticMetadataUnlockAttempt(scopeKey, candidateKey)) {
          node = candidate;
          key = candidateKey;
          bestRank = rank;
          if (rank === 0) break;
        }
      }
      if (!node || !key) return;
      const controller = claimAutomaticMetadataUnlock(scopeKey, key);
      if (!controller) return;
      active = controller;
      activeNode.current = { id: node.id, controller };
      running = true;
      const revision = current.mutations.captureMetadataCacheRevision();
      let retry = false;
      let issue: "read" | "validation" | "persistence" | undefined;
      let readFailed = false;
      const isCurrent = () =>
        available() &&
        latest.current.viewScope.nodeIds.has(node.id) &&
        !controller.signal.aborted &&
        latest.current.mutations.captureMetadataCacheRevision() === revision;
      try {
        const unlocked = await unlockPersonVersionNode({
          node,
          chainId,
          deepFamilyProxy: contractAddress,
          rawPassphrase: "",
          signal: controller.signal,
          priority: "background",
          getCode: async (pointer, blockTag) => {
            try {
              return await provider.getCode(pointer, blockTag);
            } catch (error) {
              readFailed = true;
              throw error;
            }
          },
        });
        if (!isCurrent()) {
          retry = true;
          return;
        }
        const latestNode = latest.current.graph.nodesData[node.id];
        // A foreground unlock always wins a completion race.
        if (!latestNode || isMetadataUnlockUsable(latestNode)) return;
        // A chain refresh can replace an envelope while its Worker is running.
        // Drop the superseded result without reporting a validation failure;
        // the current envelope has its own attempt key and will run next.
        if (automaticMetadataUnlockKey(latestNode) !== key) return;
        const committed = rebaseValidatedMetadataUnlock(latestNode, {
          ...unlocked,
          metadataUnlockPersistence: getMetadataUnlockPreference(scopeKey) ? "device" : "session",
        });
        latest.current.mutations.cacheValidatedPersonVersion(committed, revision);
        if (committed.metadataUnlockPersistence === "device" && isCurrent()) {
          try {
            await latest.current.mutations.persistValidatedPersonVersion(committed, revision);
          } catch {
            issue = "persistence";
          }
        }
      } catch (error) {
        if (
          !isCurrent() ||
          controller.signal.aborted ||
          error instanceof CryptoWorkerTerminatedError ||
          error instanceof MetadataUnlockCancelledError
        ) {
          retry = true;
        } else {
          const code =
            error && typeof error === "object" && "code" in error ? error.code : undefined;
          // Authentication failure is an expected unsuccessful empty-password attempt.
          // It does not prove that a different password will decrypt this envelope.
          if (code !== "AES_GCM_AUTHENTICATION_FAILED") issue = readFailed ? "read" : "validation";
        }
      } finally {
        finishAutomaticMetadataUnlock(scopeKey, key, controller, { retry, issue });
        active = null;
        if (activeNode.current?.controller === controller) activeNode.current = null;
        running = false;
        schedule(retry ? 1000 : 250);
      }
    };

    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") active?.abort();
      else schedule();
    };
    wake.current = schedule;
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      active?.abort();
      wake.current = () => {};
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [
    provider,
    chainId,
    contractAddress,
    scopeKey,
    suspended,
    paused,
    graph.idbHydrated,
    viewScope.rootId,
  ]);

  // New public nodes/anchors and released cross-surface claims wake the idle queue.
  // Keeping them out of the effect above avoids cancelling a KDF on each graph update.
  useEffect(() => {
    const active = activeNode.current;
    if (active && !latest.current.viewScope.nodeIds.has(active.id)) active.controller.abort();
    wake.current();
  }, [graph.nodesData, priorityNodeId, sessionRevision, viewScope.key]);

  return { paused, issues: getAutomaticMetadataUnlockIssues(scopeKey) };
}
