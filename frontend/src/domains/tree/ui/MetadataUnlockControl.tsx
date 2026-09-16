import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, LoaderCircle, LockKeyhole, Trash2, X } from "lucide-react";
import {
  MODAL_ACCENT_TILE,
  MODAL_FIELD,
  MODAL_PANEL,
  MODAL_TILE_BASE,
  ModalShell,
  OVERLAY_Z_INDEX,
} from "../../../shared/ui";
import { useConfig } from "../../config";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import {
  MetadataUnlockCoordinator,
  readPersonVersionEnvelope,
  type MetadataUnlockBatchProgress,
} from "../../../shared/metadata";
import { isMetadataUnlockUsable, makeNodeId, type NodeData } from "../../../shared/model";
import { useTreeGraphData, useTreeMutations } from "../context";
import { buildTreeStorageNamespace } from "../context/treeStorageScope";
import { useMetadataUnlockPreferences } from "./useMetadataUnlockPreferences";
import { useMetadataUnlockScope } from "./useMetadataUnlockScope";
import {
  automaticMetadataUnlockKey,
  useAutomaticMetadataUnlock,
} from "./useAutomaticMetadataUnlock";

type PreparationState = "idle" | "preparing" | "ready";
type VersionStatus =
  | "checking"
  | "ready"
  | "readingFailed"
  | "validationFailed"
  | "unlocking"
  | "failed"
  | "unlocked"
  | "persistenceFailed";

function hasArchiveAnchors(node: NodeData): boolean {
  return Boolean(
    node.personHash &&
    Number.isSafeInteger(node.versionIndex) &&
    node.versionIndex > 0 &&
    node.versionCommitment &&
    node.metadataPointer &&
    node.metadataPayloadHash &&
    Number.isSafeInteger(node.metadataPayloadLength) &&
    Number(node.metadataPayloadLength) > 0,
  );
}

const shortHash = (hash: string) =>
  hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;

export interface MetadataUnlockControlProps {
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  /** A detail entry selects just this version; global entries leave selection to the user. */
  target?: { personHash: string; versionIndex: number } | null;
  /** The person currently being inspected, independent of the manual unlock selection. */
  priorityNodeId?: string;
  /** The genealogy book also displays co-parent records outside the descendant graph. */
  includeSpouses?: boolean;
  showTrigger?: boolean;
}

export function MetadataUnlockControl({
  open: openProp,
  onOpenChange,
  target = null,
  priorityNodeId,
  includeSpouses = false,
  showTrigger = true,
}: MetadataUnlockControlProps = {}) {
  const { nodesData } = useTreeGraphData();
  const viewScope = useMetadataUnlockScope({ includeSpouses });
  const viewScopeRef = useRef(viewScope);
  viewScopeRef.current = viewScope;
  const {
    cacheValidatedPersonVersion,
    persistValidatedPersonVersion,
    clearMetadataUnlockCache,
    captureMetadataCacheRevision,
  } = useTreeMutations();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const titleId = useId();
  const descriptionId = useId();
  const coordinatorRef = useRef(new MetadataUnlockCoordinator());
  const nodesDataRef = useRef(nodesData);
  nodesDataRef.current = nodesData;
  const passphraseRef = useRef<HTMLInputElement>(null);
  const preflightGenerationRef = useRef(0);
  const attemptGenerationRef = useRef(0);
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preparation, setPreparation] = useState<PreparationState>("idle");
  const [preparedNodes, setPreparedNodes] = useState<NodeData[]>([]);
  const [versionStatuses, setVersionStatuses] = useState<Record<string, VersionStatus>>({});
  const [progress, setProgress] = useState<MetadataUnlockBatchProgress | null>(null);
  const [error, setError] = useState("");
  const [preflightRetry, setPreflightRetry] = useState(0);
  const unlockScopeKey = useMemo(
    () => buildTreeStorageNamespace({ chainId, contractAddress }),
    [chainId, contractAddress],
  );
  const { remember, setRemember } = useMetadataUnlockPreferences(unlockScopeKey);
  const targetKey = target ? makeNodeId(target.personHash, target.versionIndex) : "";
  const automaticSuspended = open && selectedIds.length > 0;
  const { paused: automaticPaused, issues: automaticIssues } = useAutomaticMetadataUnlock({
    suspended: automaticSuspended,
    priorityNodeId: priorityNodeId ?? (targetKey || undefined),
    viewScope,
  });
  const currentScopeKeyRef = useRef(unlockScopeKey);
  // Fence commits during render, before a scope-change effect can run.
  currentScopeKeyRef.current = unlockScopeKey;

  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return getReadonlyProvider(rpcUrl, chainId);
    } catch {
      return null;
    }
  }, [chainId, rpcUrl]);
  const archiveNodes = useMemo(
    () =>
      Array.from(viewScope.nodeIds, (id) => nodesData[id]).filter(
        (node): node is NodeData => Boolean(node) && hasArchiveAnchors(node),
      ),
    [nodesData, viewScope.nodeIds],
  );
  const automaticStatuses = useMemo(() => {
    const issuesByKey = new Map(automaticIssues.map((issue) => [issue.key, issue.kind]));
    const result: Record<string, VersionStatus> = {};
    for (const node of archiveNodes) {
      const key = automaticMetadataUnlockKey(node);
      const kind = key ? issuesByKey.get(key) : undefined;
      if (kind)
        result[node.id] =
          kind === "persistence"
            ? "persistenceFailed"
            : kind === "validation"
              ? "validationFailed"
              : "readingFailed";
    }
    return result;
  }, [archiveNodes, automaticIssues]);
  const candidates = archiveNodes.filter((node) => !isMetadataUnlockUsable(node));
  const unlockedCount = viewScope.unlockedCount;
  const running = progress?.status === "running" || progress?.status === "cancelling";
  const selectedSet = new Set(selectedIds);
  const groups = useMemo(() => {
    const grouped = new Map<string, NodeData[]>();
    for (const node of archiveNodes) {
      if (isMetadataUnlockUsable(node) && !versionStatuses[node.id] && !automaticStatuses[node.id])
        continue;
      const key = node.personHash.toLowerCase();
      const group = grouped.get(key) ?? [];
      group.push(node);
      grouped.set(key, group);
    }
    return Array.from(grouped.entries()).map(([personHash, nodes]) => ({
      personHash,
      nodes: nodes.sort((a, b) => a.versionIndex - b.versionIndex),
      name: nodes.find((node) => node.fullName?.trim())?.fullName || shortHash(personHash),
    }));
  }, [archiveNodes, versionStatuses, automaticStatuses]);
  // Plaintext updates do not restart a preflight or cancel the active batch.
  const selectionKey = JSON.stringify(
    selectedIds.map((id) => {
      const node = nodesData[id];
      return [
        id,
        node?.versionCommitment,
        node?.metadataPointer,
        node?.metadataPayloadHash,
        node?.metadataPayloadLength,
        node?.metadataSegmentCount,
        viewScope.nodeIds.has(id),
      ];
    }),
  );

  const clearAttemptState = useCallback(() => {
    preflightGenerationRef.current += 1;
    attemptGenerationRef.current += 1;
    coordinatorRef.current.cancel();
    if (passphraseRef.current) passphraseRef.current.value = "";
    setPreparation("idle");
    setPreparedNodes([]);
    setProgress(null);
    setError("");
  }, []);

  useEffect(
    () => () => {
      preflightGenerationRef.current += 1;
      attemptGenerationRef.current += 1;
      coordinatorRef.current.cancel();
    },
    [],
  );

  useEffect(() => {
    clearAttemptState();
    setVersionStatuses({});
    const initialNode = Object.values(nodesDataRef.current).find(
      (node) =>
        makeNodeId(node.personHash, node.versionIndex) === targetKey &&
        viewScopeRef.current.nodeIds.has(node.id) &&
        hasArchiveAnchors(node) &&
        !isMetadataUnlockUsable(node),
    );
    setSelectedIds(open && initialNode ? [initialNode.id] : []);
  }, [open, targetKey, unlockScopeKey, viewScope.rootId, clearAttemptState]);

  useEffect(() => {
    // A version returning to the view must not inherit a cancelled busy status.
    setVersionStatuses((previous) => {
      const entries = Object.entries(previous);
      const visible = entries.filter(([id]) => viewScope.nodeIds.has(id));
      return visible.length === entries.length ? previous : Object.fromEntries(visible);
    });
    if (!selectedIds.some((id) => !viewScope.nodeIds.has(id))) return;
    clearAttemptState();
    setSelectedIds((ids) => ids.filter((id) => viewScope.nodeIds.has(id)));
  }, [viewScope.key, viewScope.nodeIds, selectedIds, clearAttemptState]);

  useEffect(() => {
    if (!open) return;
    const generation = ++preflightGenerationRef.current;
    const runScopeKey = unlockScopeKey;
    const runRootId = viewScopeRef.current.rootId;
    const isCurrent = () =>
      generation === preflightGenerationRef.current &&
      runScopeKey === currentScopeKeyRef.current &&
      viewScopeRef.current.rootId === runRootId &&
      selected.every((node) => viewScopeRef.current.nodeIds.has(node.id));
    const selected = (JSON.parse(selectionKey) as [string][])
      .map(([id]) => nodesDataRef.current[id])
      .filter(
        (node): node is NodeData =>
          Boolean(node) &&
          viewScopeRef.current.nodeIds.has(node.id) &&
          !isMetadataUnlockUsable(node),
      );
    setPreparedNodes([]);
    setError("");
    if (!selected.length) {
      setPreparation("idle");
      return;
    }
    if (!provider || !chainId || !contractAddress) {
      setPreparation("idle");
      setError(
        tRef.current(
          "metadataUnlock.errors.config",
          "Configure a valid RPC endpoint, chain ID, and DeepFamily proxy first.",
        ),
      );
      return;
    }
    setPreparation("preparing");
    setVersionStatuses((previous) => ({
      ...previous,
      ...Object.fromEntries(
        selected.map((node) => [
          node.id,
          previous[node.id] === "failed" ? ("failed" as const) : ("checking" as const),
        ]),
      ),
    }));
    void (async () => {
      const supported: NodeData[] = [];
      for (const node of selected) {
        if (!isCurrent()) return;
        try {
          await readPersonVersionEnvelope({
            node,
            chainId,
            deepFamilyProxy: contractAddress,
            getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
          });
          if (!isCurrent()) return;
          supported.push(node);
          setVersionStatuses((previous) => ({
            ...previous,
            [node.id]: previous[node.id] === "failed" ? "failed" : "ready",
          }));
        } catch {
          if (!isCurrent()) return;
          setVersionStatuses((previous) => ({ ...previous, [node.id]: "readingFailed" }));
        }
      }
      if (!isCurrent()) return;
      setPreparedNodes(supported);
      setPreparation("ready");
    })();
    return () => {
      preflightGenerationRef.current += 1;
    };
  }, [
    open,
    selectionKey,
    unlockScopeKey,
    viewScope.rootId,
    chainId,
    contractAddress,
    provider,
    preflightRetry,
  ]);

  const close = () => {
    clearAttemptState();
    setOpen(false);
  };
  const updateSelection = (ids: string[], checked: boolean) => {
    if (running) return;
    // A new target always asks for its own passphrase, even if the previous attempt failed.
    clearAttemptState();
    setSelectedIds((previous) =>
      checked
        ? Array.from(new Set([...previous, ...ids]))
        : previous.filter((id) => !ids.includes(id)),
    );
  };

  const unlock = async () => {
    if (!provider || !chainId || !contractAddress || !preparedNodes.length) return;
    const runScopeKey = unlockScopeKey;
    const runRootId = viewScopeRef.current.rootId;
    const runNodeIds = preparedNodes.map((node) => node.id);
    const generation = ++attemptGenerationRef.current;
    const cacheRevision = captureMetadataCacheRevision();
    const isCurrentAttempt = () =>
      currentScopeKeyRef.current === runScopeKey && generation === attemptGenerationRef.current;
    const isCurrent = () =>
      isCurrentAttempt() &&
      captureMetadataCacheRevision() === cacheRevision &&
      viewScopeRef.current.rootId === runRootId &&
      runNodeIds.every((id) => viewScopeRef.current.nodeIds.has(id));
    const resetAfterCacheClear = () => {
      if (!isCurrentAttempt() || captureMetadataCacheRevision() === cacheRevision) return;
      // An external clear may silently fence tree mutations. Fence UI results too,
      // and leave the dialog ready for a fresh selection instead of stuck running.
      clearAttemptState();
      setVersionStatuses({});
      setSelectedIds([]);
    };
    const assertCurrent = () => {
      if (isCurrent()) return;
      resetAfterCacheClear();
      coordinatorRef.current.cancel();
      throw new Error("Metadata unlock scope changed");
    };
    const rawPassphrase = passphraseRef.current?.value ?? "";
    const pending = preparedNodes.filter(
      (node) =>
        viewScopeRef.current.nodeIds.has(node.id) &&
        !isMetadataUnlockUsable(nodesDataRef.current[node.id] ?? node) &&
        versionStatuses[node.id] !== "unlocked" &&
        versionStatuses[node.id] !== "persistenceFailed",
    );
    if (!pending.length) return;
    setError("");
    const persistence = remember ? ("device" as const) : ("session" as const);
    const succeededIds = new Set<string>();
    const run = coordinatorRef.current.run({
      nodes: pending,
      chainId,
      deepFamilyProxy: contractAddress,
      getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
      rawPassphrase,
      getCurrentNode: (nodeId) => {
        assertCurrent();
        return nodesDataRef.current[nodeId];
      },
      cacheValidatedPersonVersion: (node) => {
        assertCurrent();
        cacheValidatedPersonVersion(
          { ...node, metadataUnlockPersistence: persistence },
          cacheRevision,
        );
        assertCurrent();
        succeededIds.add(node.id);
        setVersionStatuses((previous) => ({ ...previous, [node.id]: "unlocked" }));
      },
      persistUnlocked: remember
        ? async (node) => {
            assertCurrent();
            await persistValidatedPersonVersion(
              { ...node, metadataUnlockPersistence: persistence },
              cacheRevision,
            );
            assertCurrent();
          }
        : undefined,
      onProgress: (nextProgress) => {
        if (!isCurrent()) {
          resetAfterCacheClear();
          return;
        }
        setProgress(nextProgress);
        if (nextProgress.currentNodeId && !succeededIds.has(nextProgress.currentNodeId)) {
          const id = nextProgress.currentNodeId;
          setVersionStatuses((previous) => ({ ...previous, [id]: "unlocking" }));
        }
      },
    });
    if (passphraseRef.current) passphraseRef.current.value = "";
    try {
      const report = await run;
      if (!isCurrent()) {
        resetAfterCacheClear();
        return;
      }
      setProgress(report);
      setVersionStatuses((previous) => {
        const next = { ...previous };
        for (const node of pending) {
          if (next[node.id] === "unlocking") next[node.id] = "ready";
        }
        for (const failure of report.failures) next[failure.nodeId] = "failed";
        for (const failure of report.persistenceFailures)
          next[failure.nodeId] = "persistenceFailed";
        return next;
      });
      // Successful versions stay visible with their result, but are no longer selected.
      setSelectedIds((previous) => previous.filter((id) => !succeededIds.has(id)));
    } catch (cause) {
      if (!isCurrent()) {
        resetAfterCacheClear();
        return;
      }
      setProgress(null);
      setError(
        cause instanceof Error
          ? cause.message
          : t("metadataUnlock.errors.failed", "Metadata unlock failed"),
      );
    }
  };

  const otherPersonVersions = target
    ? candidates.filter(
        (node) =>
          node.personHash.toLowerCase() === target.personHash.toLowerCase() &&
          node.versionIndex !== target.versionIndex,
      )
    : [];
  const hasReadFailures = selectedIds.some((id) => versionStatuses[id] === "readingFailed");
  const canUnlock =
    preparation === "ready" &&
    preparedNodes.some(
      (node) =>
        !isMetadataUnlockUsable(nodesData[node.id] ?? node) &&
        versionStatuses[node.id] !== "unlocked" &&
        versionStatuses[node.id] !== "persistenceFailed",
    );
  const statusLabel = (node: NodeData) => {
    const reported = versionStatuses[node.id] ?? automaticStatuses[node.id];
    const status =
      isMetadataUnlockUsable(node) && reported !== "persistenceFailed"
        ? "unlocked"
        : (reported ?? "locked");
    const fallbacks: Record<string, string> = {
      locked: "Locked",
      checking: "Checking…",
      ready: "Checked; awaiting unlock",
      readingFailed: "Read or data check failed",
      validationFailed: "Encrypted data verification failed",
      unlocking: "Unlocking…",
      failed: "Decryption or verification failed",
      unlocked: "Unlocked",
      persistenceFailed: "Unlocked; could not remember on this device",
    };
    return t(`metadataUnlock.versionStatus.${status}`, fallbacks[status]);
  };

  return (
    <>
      {showTrigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(var(--app-statusbar-h)+5.25rem)] right-6 z-30 inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface/95 px-3.5 py-2 text-[13px] font-semibold text-ink shadow-sm backdrop-blur-sm transition-colors hover:border-hairline-strong md:right-10"
        >
          <KeyRound className="h-4 w-4 text-ink-muted" />
          {t("metadataUnlock.openButton", "Unlock versions")}
          {unlockedCount > 0 ? <span className="text-emerald-600">{unlockedCount}</span> : null}
        </button>
      ) : null}
      <ModalShell
        isOpen={open}
        onClose={close}
        bare
        zIndex={OVERLAY_Z_INDEX.nestedModal}
        ariaLabelledBy={titleId}
        ariaDescribedBy={descriptionId}
      >
        <div className="h-full overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <section
              className={`w-full max-w-[600px] p-5 ${MODAL_PANEL}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id={titleId}
                    className="flex items-center gap-2.5 font-body text-base font-semibold text-ink"
                  >
                    <span className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE.primary}`}>
                      <LockKeyhole className="h-[19px] w-[19px]" aria-hidden />
                    </span>
                    {t("metadataUnlock.title", "Unlock encrypted version metadata")}
                  </h3>
                  <p id={descriptionId} className="mt-1 text-xs leading-5 text-ink-muted">
                    {t(
                      "metadataUnlock.description",
                      "Select versions that share an identity passphrase. After unlocking, select another person and enter their passphrase to continue.",
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("metadataUnlock.close", "Close")}
                  className="p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-4 text-xs leading-5 text-ink-muted">
                {t(
                  "metadataUnlock.summary",
                  "Current family view: {{candidates}} locked candidate(s); {{unlocked}} already unlocked locally.",
                  { candidates: candidates.length, unlocked: unlockedCount },
                )}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                {automaticPaused
                  ? t(
                      "metadataUnlock.automaticPaused",
                      "Automatic empty-passphrase unlock is paused after clearing cached plaintext for this session.",
                    )
                  : automaticSuspended
                    ? t(
                        "metadataUnlock.automaticSelectionPaused",
                        "Automatic attempts are paused while you unlock the selected versions. Clear the selection to resume them.",
                      )
                    : t(
                        "metadataUnlock.automaticHint",
                        "Only versions in the current family view are tried once with an empty passphrase in the background. You can unlock the remaining versions here.",
                      )}
              </p>
              {target && otherPersonVersions.length > 0 ? (
                <label className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    disabled={running}
                    checked={otherPersonVersions.every((node) => selectedSet.has(node.id))}
                    onChange={(event) =>
                      updateSelection(
                        otherPersonVersions.map((node) => node.id),
                        event.currentTarget.checked,
                      )
                    }
                  />
                  {t(
                    "metadataUnlock.includePersonVersions",
                    "Also unlock this person's other versions in this view",
                  )}
                </label>
              ) : null}
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-hairline p-2">
                {groups.map((group) => {
                  const selectable = group.nodes.filter(
                    (node) =>
                      !isMetadataUnlockUsable(node) &&
                      versionStatuses[node.id] !== "unlocked" &&
                      versionStatuses[node.id] !== "persistenceFailed",
                  );
                  return (
                    <fieldset
                      key={group.personHash}
                      className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
                    >
                      <legend className="sr-only">{group.name}</legend>
                      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <input
                          type="checkbox"
                          disabled={running || selectable.length === 0}
                          checked={
                            selectable.length > 0 &&
                            selectable.every((node) => selectedSet.has(node.id))
                          }
                          aria-label={t(
                            "metadataUnlock.selectPerson",
                            "Select all versions for {{person}} in this view",
                            { person: group.name },
                          )}
                          onChange={(event) =>
                            updateSelection(
                              selectable.map((node) => node.id),
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span className="truncate" title={group.personHash}>
                          {group.name}
                        </span>
                      </label>
                      <div className="mt-2 space-y-2 pl-5">
                        {group.nodes.map((node) => (
                          <label
                            key={node.id}
                            className="flex items-start gap-2 text-xs text-ink-muted"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSet.has(node.id)}
                              disabled={running || !selectable.includes(node)}
                              aria-label={t(
                                "metadataUnlock.selectVersion",
                                "Select {{person}}, version {{version}}",
                                { person: group.name, version: node.versionIndex },
                              )}
                              onChange={(event) =>
                                updateSelection([node.id], event.currentTarget.checked)
                              }
                            />
                            <span>
                              {t("metadataUnlock.version", "Version {{version}}", {
                                version: node.versionIndex,
                              })}
                            </span>
                            <span className="ml-auto text-right" role="status">
                              {statusLabel(node)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
                {!groups.length ? (
                  <p className="p-2 text-xs text-ink-muted">
                    {t(
                      "metadataUnlock.noLockedVersions",
                      "No versions in the current family view need unlocking.",
                    )}
                  </p>
                ) : null}
              </div>
              {!selectedIds.length && candidates.length > 0 ? (
                <p className="mt-3 text-xs text-ink-muted">
                  {t(
                    "metadataUnlock.selectHint",
                    "Select a person or individual versions to check them automatically.",
                  )}
                </p>
              ) : null}
              {preparation === "preparing" ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t("metadataUnlock.checking", "Checking encrypted data…")}
                </div>
              ) : null}
              {hasReadFailures && !running ? (
                <button
                  type="button"
                  onClick={() => setPreflightRetry((value) => value + 1)}
                  className="mt-3 text-xs font-semibold text-primary"
                >
                  {t("metadataUnlock.retryRead", "Retry reading selected versions")}
                </button>
              ) : null}
              <label className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={running}
                  onChange={(event) => setRemember(event.currentTarget.checked)}
                />
                <span>
                  {t("metadataUnlock.remember", "Remember unlocked results on this device")}
                  <span className="mt-1 block font-normal">
                    {remember
                      ? t(
                          "metadataUnlock.rememberDeviceHint",
                          "Future unlocks will save plaintext in this browser. Your passphrase is never saved.",
                        )
                      : t(
                          "metadataUnlock.rememberSessionHint",
                          "Future unlocks are shown for this session only.",
                        )}
                  </span>
                </span>
              </label>
              {preparation === "ready" && canUnlock ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold text-ink-muted">
                    {t("metadataUnlock.passphraseLabel", "Identity passphrase")}
                    <input
                      ref={passphraseRef}
                      type="password"
                      autoComplete="off"
                      disabled={running}
                      className={`mt-1 ${MODAL_FIELD}`}
                    />
                  </label>
                  {!running ? (
                    <button
                      type="button"
                      onClick={unlock}
                      className="w-full rounded-xl bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
                    >
                      {t("metadataUnlock.unlock", "Unlock selected versions")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {progress ? (
                <p className="mt-3 text-xs text-ink-muted" aria-live="polite">
                  {t(
                    "metadataUnlock.progress",
                    "{{status}}: {{processed}}/{{total}}; {{succeeded}} successful, {{failed}} failed, {{skipped}} cached.",
                    {
                      status: t(`metadataUnlock.status.${progress.status}`, progress.status),
                      processed: progress.processed,
                      total: progress.total,
                      succeeded: progress.succeeded,
                      failed: progress.failed,
                      skipped: progress.skipped,
                    },
                  )}
                </p>
              ) : null}
              {running ? (
                <button
                  type="button"
                  onClick={() => coordinatorRef.current.cancel()}
                  className="mt-3 w-full rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold"
                >
                  {t("metadataUnlock.cancel", "Cancel unlock")}
                </button>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-300">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={running || unlockedCount === 0}
                onClick={() => {
                  clearMetadataUnlockCache();
                  clearAttemptState();
                  setVersionStatuses({});
                  setSelectedIds([]);
                }}
                className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-rose-600 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
                {t("metadataUnlock.clearCache", "Clear local unlocked plaintext cache")}
              </button>
            </section>
          </div>
        </div>
      </ModalShell>
    </>
  );
}
