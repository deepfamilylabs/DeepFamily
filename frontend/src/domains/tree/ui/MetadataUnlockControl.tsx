import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LockOpen,
  Minus,
  RotateCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  EmptyState,
  MODAL_CARD,
  MODAL_FIELD,
  MODAL_LABEL,
  ModalSectionHeading,
  OVERLAY_Z_INDEX,
  ResponsiveModalFrame,
  useResponsiveModalMode,
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
type DisplayStatus = VersionStatus | "locked";
type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger";

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

/** Grey while checking or waiting, orange while working, green done, amber partial, red failed. */
const STATUS_CHIP: Record<VersionStatus, { tone: ChipTone; icon: LucideIcon; spin?: boolean }> = {
  checking: { tone: "neutral", icon: LoaderCircle, spin: true },
  ready: { tone: "neutral", icon: CircleCheck },
  readingFailed: { tone: "danger", icon: CircleAlert },
  validationFailed: { tone: "danger", icon: CircleAlert },
  unlocking: { tone: "primary", icon: LoaderCircle, spin: true },
  failed: { tone: "danger", icon: CircleX },
  unlocked: { tone: "success", icon: LockOpen },
  persistenceFailed: { tone: "warning", icon: TriangleAlert },
};

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-hairline bg-surface-alt text-ink-muted",
  primary: "border-primary/30 bg-primary/10 text-orange-700 dark:text-orange-300",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
};

/**
 * Each row is one label, so the whole line toggles its checkbox. A status chip sits at the right
 * and drops under the name on a phone, where it would otherwise squeeze the name to a few letters.
 */
const ROW_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 pr-3.5 transition-colors";

const rowTone = (selected: boolean, disabled: boolean) =>
  `${selected ? "bg-primary/6 dark:bg-primary/10" : disabled ? "" : "hover:bg-surface-alt"} ${
    disabled ? "cursor-not-allowed" : "cursor-pointer"
  }`;

/** Filled actions go grey when not ready, as TransactionButton does, rather than fading. */
const PRIMARY_BUTTON =
  "inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm leading-tight font-semibold text-white ring-offset-surface transition-colors hover:bg-primary-hover focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted disabled:hover:bg-surface-muted sm:w-auto dark:text-orange-950";

const SECONDARY_BUTTON =
  "inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-hairline-strong bg-surface px-5 text-sm leading-tight font-semibold text-ink ring-offset-surface transition-colors hover:bg-surface-alt focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:outline-hidden sm:w-auto";

/** ConsentCheckbox's box, plus the mixed state a person takes when only some versions are chosen. */
function SelectionBox({
  checked,
  indeterminate = false,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <span
      className={`relative col-start-1 row-start-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-hairline-strong bg-surface transition-colors checked:border-primary checked:bg-primary checked:bg-none indeterminate:border-primary indeterminate:bg-primary indeterminate:bg-none focus:ring-0 focus:ring-offset-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100 dark:text-orange-950"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute h-3 w-3 text-white opacity-0 transition-opacity peer-indeterminate:opacity-100 dark:text-orange-950"
      />
    </span>
  );
}

/**
 * MODAL_CHIP's pill, allowed to grow a line: the longest statuses outrun a phone row in English.
 * "Locked" is the resting state of every row, so it stays plain text instead of a chip.
 */
function StatusChip({ status, label }: { status: DisplayStatus; label: string }) {
  if (status === "locked")
    return (
      <span role="status" className="col-start-3 row-start-1 text-xs text-ink-muted">
        {label}
      </span>
    );
  const { tone, icon: Icon, spin } = STATUS_CHIP[status];
  return (
    <span
      role="status"
      className={`col-span-2 col-start-2 row-start-2 inline-flex min-h-7 items-center gap-1.5 justify-self-start rounded-full border px-2.5 py-1 text-xs font-semibold sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-self-end ${CHIP_TONE[tone]}`}
    >
      <Icon className={`h-[13px] w-[13px] shrink-0 ${spin ? "animate-spin" : ""}`} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

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
  const listHeadingId = useId();
  const localHeadingId = useId();
  const passphraseId = useId();
  const statusId = useId();
  const isDesktop = useResponsiveModalMode();
  const coordinatorRef = useRef(new MetadataUnlockCoordinator());
  const nodesDataRef = useRef(nodesData);
  nodesDataRef.current = nodesData;
  const passphraseRef = useRef<HTMLInputElement>(null);
  const preflightGenerationRef = useRef(0);
  const attemptGenerationRef = useRef(0);
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [entered, setEntered] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preparation, setPreparation] = useState<PreparationState>("idle");
  const [preparedNodes, setPreparedNodes] = useState<NodeData[]>([]);
  const [versionStatuses, setVersionStatuses] = useState<Record<string, VersionStatus>>({});
  const [progress, setProgress] = useState<MetadataUnlockBatchProgress | null>(null);
  const [error, setError] = useState("");
  const [preflightRetry, setPreflightRetry] = useState(0);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const unlockScopeKey = useMemo(
    () => buildTreeStorageNamespace({ chainId, contractAddress }),
    [chainId, contractAddress],
  );
  const { remember, setRemember } = useMetadataUnlockPreferences(unlockScopeKey);
  const targetKey = target ? makeNodeId(target.personHash, target.versionIndex) : "";
  const targetPersonKey = target?.personHash.toLowerCase() ?? "";
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
    const list = Array.from(grouped.entries()).map(([personHash, nodes]) => {
      const fullName = nodes.find((node) => node.fullName?.trim())?.fullName;
      return {
        personHash,
        nodes: nodes.sort((a, b) => a.versionIndex - b.versionIndex),
        fullName,
        name: fullName || shortHash(personHash),
      };
    });
    // Opened from a person's detail, that person leads the list.
    const viewed = list.filter((group) => group.personHash === targetPersonKey);
    return viewed.length
      ? [...viewed, ...list.filter((group) => group.personHash !== targetPersonKey)]
      : list;
  }, [archiveNodes, versionStatuses, automaticStatuses, targetPersonKey]);
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
    setShowPassphrase(false);
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
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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
    setShowPassphrase(false);
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

  const isSelectable = (node: NodeData) =>
    !isMetadataUnlockUsable(node) &&
    versionStatuses[node.id] !== "unlocked" &&
    versionStatuses[node.id] !== "persistenceFailed";
  const readFailureCount = selectedIds.filter(
    (id) => versionStatuses[id] === "readingFailed",
  ).length;
  const unlockableCount =
    preparation === "ready"
      ? preparedNodes.filter((node) => isSelectable(nodesData[node.id] ?? node)).length
      : 0;
  const canUnlock = unlockableCount > 0;
  // Once something was listed, the passphrase bar stays put: through a batch, its result and errors.
  const showComposer =
    candidates.length > 0 || selectedIds.length > 0 || progress !== null || Boolean(error);

  const displayStatus = (node: NodeData): DisplayStatus => {
    const reported = versionStatuses[node.id] ?? automaticStatuses[node.id];
    return isMetadataUnlockUsable(node) && reported !== "persistenceFailed"
      ? "unlocked"
      : (reported ?? "locked");
  };
  const statusLabel = (status: DisplayStatus) => {
    const fallbacks: Record<DisplayStatus, string> = {
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
  const versionLabel = (node: NodeData) =>
    t("metadataUnlock.version", "Version {{version}}", { version: node.versionIndex });
  const nameAfterUnlock = t("metadataUnlock.nameAfterUnlock", "Name shown after unlock");

  const renderGroup = (group: (typeof groups)[number]) => {
    const selectable = group.nodes.filter(isSelectable);
    const selectedCount = selectable.filter((node) => selectedSet.has(node.id)).length;
    const allSelected = selectable.length > 0 && selectedCount === selectable.length;
    const hashLabel = <span className="font-mono">{shortHash(group.personHash)}</span>;
    const heading = (
      <span className="flex min-w-0 items-center gap-2" title={group.personHash}>
        {group.fullName ? (
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{group.fullName}</span>
        ) : (
          <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-ink">
            {shortHash(group.personHash)}
          </span>
        )}
        {group.personHash === targetPersonKey ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold text-ink-muted">
            {t("metadataUnlock.viewing", "Viewing")}
          </span>
        ) : null}
      </span>
    );

    if (group.nodes.length === 1) {
      const [node] = group.nodes;
      const checked = selectedSet.has(node.id);
      const disabled = running || !selectable.includes(node);
      const status = displayStatus(node);
      return (
        <label
          key={group.personHash}
          className={`${ROW_GRID} ${rowTone(checked, disabled)} py-3 pl-3.5`}
        >
          <SelectionBox
            checked={checked}
            disabled={disabled}
            label={t("metadataUnlock.selectVersion", "Select {{person}}, version {{version}}", {
              person: group.name,
              version: node.versionIndex,
            })}
            onChange={(value) => updateSelection([node.id], value)}
          />
          <span className="col-start-2 row-start-1 flex min-w-0 flex-col">
            {heading}
            <span className="truncate text-xs text-ink-muted">
              {group.fullName ? (
                <>
                  {hashLabel} · {versionLabel(node)}
                </>
              ) : (
                `${versionLabel(node)} · ${nameAfterUnlock}`
              )}
            </span>
          </span>
          <StatusChip status={status} label={statusLabel(status)} />
        </label>
      );
    }

    const versionCount = t("metadataUnlock.versionCount", "{{count}} version(s)", {
      count: group.nodes.length,
    });
    return (
      <fieldset key={group.personHash} className="min-w-0">
        <legend className="sr-only">{group.name}</legend>
        <label
          className={`${ROW_GRID} ${rowTone(allSelected, running || selectable.length === 0)} py-3 pl-3.5`}
        >
          <SelectionBox
            checked={allSelected}
            indeterminate={selectedCount > 0 && !allSelected}
            disabled={running || selectable.length === 0}
            label={t(
              "metadataUnlock.selectPerson",
              "Select all versions for {{person}} in this view",
              {
                person: group.name,
              },
            )}
            onChange={(value) =>
              updateSelection(
                selectable.map((node) => node.id),
                value,
              )
            }
          />
          <span className="col-start-2 row-start-1 flex min-w-0 flex-col">
            {heading}
            <span className="truncate text-xs text-ink-muted">
              {group.fullName ? (
                <>
                  {hashLabel} · {versionCount}
                </>
              ) : (
                `${versionCount} · ${nameAfterUnlock}`
              )}
            </span>
          </span>
        </label>
        {group.nodes.map((node) => {
          const checked = selectedSet.has(node.id);
          const disabled = running || !selectable.includes(node);
          const status = displayStatus(node);
          return (
            <label
              key={node.id}
              className={`${ROW_GRID} ${rowTone(checked, disabled)} relative py-2.5 pl-11 before:absolute before:top-0 before:right-0 before:left-11 before:h-px before:bg-hairline`}
            >
              <SelectionBox
                checked={checked}
                disabled={disabled}
                label={t("metadataUnlock.selectVersion", "Select {{person}}, version {{version}}", {
                  person: group.name,
                  version: node.versionIndex,
                })}
                onChange={(value) => updateSelection([node.id], value)}
              />
              <span className="col-start-2 row-start-1 min-w-0 truncate text-[13px] leading-5 text-ink">
                {versionLabel(node)}
              </span>
              <StatusChip status={status} label={statusLabel(status)} />
            </label>
          );
        })}
      </fieldset>
    );
  };

  const statusLine = () => {
    if (error)
      return (
        <p role="alert" className="flex items-start gap-1.5 text-danger">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      );
    if (running) return null;
    if (readFailureCount > 0)
      return (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          {/* min-w-32, not min-w-0: a zero basis never wraps, so the button crushed the text. */}
          <p className="flex min-w-32 flex-1 items-start gap-1.5 text-ink">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
            <span>
              {t("metadataUnlock.readFailures", "{{count}} version(s) could not be read.", {
                count: readFailureCount,
              })}
            </span>
          </p>
          {/* A full 44px target on a phone, compact beside the text on wider screens. */}
          <button
            type="button"
            onClick={() => setPreflightRetry((value) => value + 1)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-orange-700 transition-colors hover:bg-primary/15 focus:ring-2 focus:ring-primary/30 focus:outline-hidden sm:h-8 sm:px-3 sm:text-[13px] dark:text-orange-300"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            {t("metadataUnlock.retryRead", "Retry reading selected versions")}
          </button>
        </div>
      );
    if (progress) {
      const counts = {
        succeeded: progress.succeeded,
        failed: progress.failed,
      };
      return (
        <p className="flex items-start gap-1.5 text-ink-muted">
          {progress.failed > 0 ? (
            <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          ) : (
            <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          )}
          <span>
            <span className="text-ink">
              {progress.status === "cancelled"
                ? t(
                    "metadataUnlock.result.cancelled",
                    "Cancelled: {{succeeded}} unlocked, {{failed}} failed.",
                    counts,
                  )
                : t(
                    "metadataUnlock.result.completed",
                    "Completed: {{succeeded}} unlocked, {{failed}} failed.",
                    counts,
                  )}
            </span>
            {progress.skipped > 0 ? (
              <span className="ms-1">
                {t("metadataUnlock.result.skipped", "{{count}} already unlocked.", {
                  count: progress.skipped,
                })}
              </span>
            ) : null}
            {progress.failed > 0 ? (
              <span className="ms-1">
                {t(
                  "metadataUnlock.result.retryHint",
                  "Failed versions stay selected, so you can try another passphrase.",
                )}
              </span>
            ) : null}
          </span>
        </p>
      );
    }
    if (preparation === "preparing")
      return (
        <p className="flex items-start gap-1.5 text-ink-muted">
          <LoaderCircle className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          <span>{t("metadataUnlock.checking", "Checking encrypted data…")}</span>
        </p>
      );
    if (!selectedIds.length)
      return (
        <p className="flex items-start gap-1.5 text-ink-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <span>
            {t(
              "metadataUnlock.selectHint",
              "Select a person or individual versions to check them automatically.",
            )}
          </span>
        </p>
      );
    return (
      <p className="flex items-start gap-1.5 text-ink-muted">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
        <span>
          {t(
            "metadataUnlock.passphraseNote",
            "Your passphrase is used only for local decryption and is never saved.",
          )}
        </span>
      </p>
    );
  };

  const automaticText = automaticPaused
    ? t(
        "metadataUnlock.automaticPaused",
        "Automatic empty-passphrase unlock is paused after clearing cached plaintext for this session.",
      )
    : automaticSuspended
      ? t(
          "metadataUnlock.automaticSelectionPaused",
          "Automatic attempts are paused while you unlock the selected versions. Clear the selection to resume them.",
        )
      : groups.length
        ? t(
            "metadataUnlock.automaticHint",
            "Only versions in the current family view are tried once with an empty passphrase in the background. You can unlock the remaining versions here.",
          )
        : t(
            "metadataUnlock.automaticHintEmpty",
            "Only versions in the current family view are tried once with an empty passphrase in the background.",
          );
  const title = t("metadataUnlock.title", "Unlock encrypted version metadata");
  const passphraseDisabled = running || !selectedIds.length;
  const progressPercent =
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

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
      <ResponsiveModalFrame
        isOpen={open}
        onClose={close}
        isDesktop={isDesktop}
        entered={entered}
        zIndex={OVERLAY_Z_INDEX.nestedModal}
        maxWidth="max-w-[600px]"
        ariaLabel={title}
        titleId={titleId}
        descriptionId={descriptionId}
        icon={<LockKeyhole className="h-[18px] w-[18px]" aria-hidden />}
        title={title}
        description={
          candidates.length > 0
            ? t(
                "metadataUnlock.scopeSummary",
                "Current family view · {{count}} version(s) to unlock",
                { count: candidates.length },
              )
            : t("metadataUnlock.scopeSummaryEmpty", "Current family view · nothing to unlock")
        }
        closeLabel={t("metadataUnlock.close", "Close")}
      >
        <div
          className={`min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain ${
            showComposer ? "" : "pb-[env(safe-area-inset-bottom)]"
          }`}
        >
          <div className="space-y-4 p-5">
            <section className="space-y-2.5" aria-labelledby={listHeadingId}>
              <ModalSectionHeading
                id={listHeadingId}
                aside={
                  selectedIds.length
                    ? t("metadataUnlock.selectedCount", "{{count}} selected", {
                        count: selectedIds.length,
                      })
                    : undefined
                }
              >
                {t("metadataUnlock.lockedSection", "Locked versions")}
              </ModalSectionHeading>
              <div className={`${MODAL_CARD} overflow-hidden`}>
                {/* Background empty-passphrase attempts decide what this list still holds. */}
                <div className="flex items-start gap-2 border-b border-hairline bg-surface-alt px-3.5 py-2.5 text-xs leading-[18px] text-ink-muted">
                  {automaticPaused || automaticSuspended ? (
                    <CirclePause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <span
                      className="flex h-[18px] w-3.5 shrink-0 items-center justify-center"
                      aria-hidden
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    </span>
                  )}
                  <p className="min-w-0 flex-1 text-pretty">{automaticText}</p>
                </div>
                {groups.length ? (
                  <div className="divide-y divide-hairline">{groups.map(renderGroup)}</div>
                ) : (
                  <EmptyState
                    icon={<LockOpen className="h-[22px] w-[22px]" aria-hidden />}
                    title={t(
                      "metadataUnlock.noLockedVersions",
                      "No versions in the current family view need unlocking",
                    )}
                  />
                )}
              </div>
            </section>

            <section className="space-y-2.5" aria-labelledby={localHeadingId}>
              <ModalSectionHeading id={localHeadingId}>
                {t("metadataUnlock.localSection", "On this device")}
              </ModalSectionHeading>
              <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
                <label
                  className={`flex items-start gap-3 px-3.5 py-3 ${
                    running ? "cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13px] leading-5 font-medium text-ink">
                      {t("metadataUnlock.remember", "Remember unlocked results on this device")}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {remember
                        ? t(
                            "metadataUnlock.rememberDeviceHint",
                            "Future unlocks will save plaintext in this browser.",
                          )
                        : t(
                            "metadataUnlock.rememberSessionHint",
                            "Future unlocks are shown for this session only.",
                          )}
                    </span>
                  </span>
                  <span className="relative mt-0.5 inline-flex shrink-0">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={remember}
                      disabled={running}
                      onChange={(event) => setRemember(event.currentTarget.checked)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className={`inline-flex h-5 w-9 items-center rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-50 ${
                        remember ? "bg-primary" : "bg-hairline-strong"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                          remember ? "translate-x-[18px]" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
                    {t(
                      "metadataUnlock.unlockedSummary",
                      "{{count}} version(s) in this view already unlocked locally",
                      { count: unlockedCount },
                    )}
                  </p>
                  {/* Calm at rest, red on hover: the same weight as the tree bar's cache wipe. */}
                  <button
                    type="button"
                    disabled={running || unlockedCount === 0}
                    onClick={() => {
                      clearMetadataUnlockCache();
                      clearAttemptState();
                      setVersionStatuses({});
                      setSelectedIds([]);
                    }}
                    className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 text-[13px] font-semibold whitespace-nowrap text-ink-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus:ring-3 focus:ring-danger/15 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-hairline-strong disabled:hover:bg-surface disabled:hover:text-ink-muted"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t("metadataUnlock.clearCache", "Clear plaintext cache")}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>

        {showComposer ? (
          // Pinned: select above, type here, press Enter. The field never moves or disappears.
          <div className="shrink-0 border-t border-hairline bg-surface px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
            {running && progress ? (
              <div className="mb-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2 text-[13px] leading-5 font-semibold text-ink">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                    {progress.status === "cancelling"
                      ? t("metadataUnlock.progressTitle.cancelling", "Cancelling")
                      : t("metadataUnlock.progressTitle.running", "Unlocking")}
                    <span className="font-medium text-ink-muted tabular-nums">
                      {progress.processed} / {progress.total}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted tabular-nums" aria-live="polite">
                    {t(
                      "metadataUnlock.progressCounts",
                      "{{succeeded}} unlocked · {{failed}} failed · {{skipped}} cached",
                      {
                        succeeded: progress.succeeded,
                        failed: progress.failed,
                        skipped: progress.skipped,
                      },
                    )}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={t("metadataUnlock.progressTitle.running", "Unlocking")}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.processed}
                  className="h-1 overflow-hidden rounded-full bg-surface-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className={running ? "sr-only" : "mb-1.5 flex items-center justify-between gap-3"}>
              <label htmlFor={passphraseId} className={`${MODAL_LABEL} shrink-0`}>
                {t("metadataUnlock.passphraseLabel", "Identity passphrase")}
              </label>
              <span className="min-w-0 truncate text-[11px] text-ink-subtle">
                {t(
                  "metadataUnlock.sharedPassphraseHint",
                  "Selected versions must share one passphrase",
                )}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <input
                  id={passphraseId}
                  ref={passphraseRef}
                  type={showPassphrase ? "text" : "password"}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={passphraseDisabled}
                  aria-describedby={statusId}
                  placeholder={
                    selectedIds.length
                      ? t("metadataUnlock.passphrasePlaceholder", "Enter identity passphrase")
                      : t("metadataUnlock.passphrasePlaceholderIdle", "Select versions above first")
                  }
                  onKeyDown={(event) => {
                    // Enter unlocks; an IME confirming a candidate must not.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (canUnlock && !running) void unlock();
                  }}
                  className={`${MODAL_FIELD} pr-11 disabled:cursor-not-allowed disabled:opacity-60`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((value) => !value)}
                  disabled={passphraseDisabled}
                  aria-label={
                    showPassphrase
                      ? t("metadataUnlock.passphraseVisibility.hide", "Hide identity passphrase")
                      : t("metadataUnlock.passphraseVisibility.show", "Show identity passphrase")
                  }
                  className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle transition-colors hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-primary/30 focus:outline-hidden disabled:pointer-events-none disabled:opacity-60"
                >
                  {showPassphrase ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
              {/* Keyed apart: reused in place, the focused Unlock button would become Cancel, and a
                  double click or a repeated Enter would stop the batch it just started. */}
              {running ? (
                <button
                  key="cancel"
                  type="button"
                  onClick={() => coordinatorRef.current.cancel()}
                  className={SECONDARY_BUTTON}
                >
                  {t("metadataUnlock.cancel", "Cancel unlock")}
                </button>
              ) : (
                <button
                  key="unlock"
                  type="button"
                  onClick={() => void unlock()}
                  disabled={!canUnlock}
                  className={PRIMARY_BUTTON}
                >
                  {canUnlock
                    ? t("metadataUnlock.unlockCount", "Unlock {{count}} selected version(s)", {
                        count: unlockableCount,
                      })
                    : t("metadataUnlock.unlock", "Unlock selected versions")}
                </button>
              )}
            </div>
            <div id={statusId} aria-live="polite" className="mt-2 text-xs empty:hidden">
              {statusLine()}
            </div>
          </div>
        ) : null}
      </ResponsiveModalFrame>
    </>
  );
}
