import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../context";
import {
  shouldShowDeduplicateToggle,
  shouldShowNodeModeToggle,
  shouldShowTrustedSourceFilterToggle,
} from "../../../../shared/config/env";
import { useTreeMutations, useVizOptions } from "../../../tree";
import { usePersonVersionOptions } from "../../../transactions/hooks/usePersonVersionOptions";
import { isHash32, reconcileRootVersionSelection, summarizeDataSourceHealth } from "../../model";
import type { ReaderHealth } from "../../model";
import type { RootHashPresence } from "../sections/RootHashField";
import { getLocalizedDefaultRoot } from "../../services";
import { useNetworkName } from "./useNetworkName";

type FormErrors = {
  root?: string;
  version?: string;
};

export type FamilyTreeConfigFormController = ReturnType<typeof useFamilyTreeConfigForm>;

export function useFamilyTreeConfigForm() {
  const { i18n } = useTranslation();
  const {
    readerAddress,
    contractAddress,
    moduleResolutionError,
    rootHash,
    rootVersionIndex,
    update,
    rootHistory,
    removeRootFromHistory,
    clearRootHistory,
    defaults,
  } = useConfig();
  const {
    traversal,
    setTraversal,
    childrenMode,
    setChildrenMode,
    strictIncludeUnversionedChildren,
    setStrictIncludeUnversionedChildren,
    deduplicateChildren,
    setDeduplicateChildren,
    trustedSourceFilterEnabled,
    setTrustedSourceFilterEnabled,
  } = useVizOptions();
  const { clearAllCaches } = useTreeMutations();
  const networkName = useNetworkName();

  const showNodeModeToggle = useMemo(() => shouldShowNodeModeToggle(), []);
  const showDeduplicateToggle = useMemo(() => shouldShowDeduplicateToggle(), []);
  const showTrustedSourceFilterToggle = useMemo(() => shouldShowTrustedSourceFilterToggle(), []);

  const [localRootHash, setLocalRootHash] = useState(rootHash);
  const [localVersion, setLocalVersion] = useState(rootVersionIndex);
  const [errors, setErrors] = useState<FormErrors>({});

  // The hash the version index was last decided for, so an arriving lookup only
  // preselects a version for a hash the user has not already answered. Seeded
  // with the saved root: its stored index is that answer.
  const decidedVersionHashRef = useRef<string | null>(rootHash || null);

  useEffect(() => {
    setLocalRootHash(rootHash);
    setLocalVersion(rootVersionIndex);
    decidedVersionHashRef.current = rootHash || null;
  }, [rootHash, rootVersionIndex]);

  // Reads through the saved connection, not the unsaved one being edited above:
  // a hash is looked up against the network the app is currently talking to.
  const rootVersionLookup = usePersonVersionOptions(isHash32(localRootHash) ? localRootHash : null);

  const rootHashIsValid = isHash32(localRootHash);
  const hadValidRootHashRef = useRef(rootHashIsValid);

  useEffect(() => {
    const hadValid = hadValidRootHashRef.current;
    hadValidRootHashRef.current = rootHashIsValid;
    // Only on the transition out of a valid hash. The index belonged to the
    // hash that was just erased, so it must not linger as a bare "Version 1"
    // over whatever is typed next.
    if (rootHashIsValid || !hadValid) return;
    decidedVersionHashRef.current = null;
    setLocalVersion(0);
  }, [rootHashIsValid]);

  useEffect(() => {
    const update = reconcileRootVersionSelection(rootVersionLookup, decidedVersionHashRef.current);
    if (!update) return;
    decidedVersionHashRef.current = update.decidedForHash;
    setLocalVersion(update.versionIndex);
  }, [rootVersionLookup]);

  const handleVersionChange = useCallback(
    (value: number) => {
      // Freeze the decision for this hash so a still-running lookup cannot
      // overwrite what was just chosen by hand.
      decidedVersionHashRef.current = rootVersionLookup.personHash ?? localRootHash;
      setLocalVersion(Math.max(1, value));
    },
    [localRootHash, rootVersionLookup.personHash],
  );

  /**
   * What the configured reader turned out to be on the chain in use — the same
   * judgment the status bar reports, so the two never disagree.
   *
   * Nothing here can change it: the entry contract is a property of a
   * deployment, not of a family, so it comes from the environment (and from the
   * per-chain address book a switch consults). The panel only needs to know when
   * it is broken, because then the root lookups below mean nothing.
   */
  const readerHealth: ReaderHealth = summarizeDataSourceHealth({
    readerAddress,
    contractAddress,
    moduleResolutionError,
    root: "idle",
  }).reader;

  /**
   * Whether the chain carries the hash in the field — the unsaved one, checked
   * as it is typed, the way the version list below has always been.
   *
   * Only ever about the hash the lookup actually ran for: a stale answer from
   * the previous hash would condemn whatever is being typed over it.
   */
  const rootPresence: RootHashPresence = !rootHashIsValid
    ? "idle"
    : // A dead reader fails every lookup here; that is the reader's fault, and
      // the version field below already points at it.
      readerHealth === "unreachable"
      ? "idle"
      : rootVersionLookup.personHash !== localRootHash || rootVersionLookup.status === "loading"
        ? "checking"
        : rootVersionLookup.status === "ready"
          ? rootVersionLookup.totalVersions > 0
            ? "present"
            : "absent"
          : "idle";

  const rootIsAbsent = rootPresence === "absent";

  const validateAll = useCallback(() => {
    const next: FormErrors = {};
    if (!isHash32(localRootHash)) next.root = "familyTree.validation.root";
    // 0 is the picker's "nothing chosen" state, which a cleared hash leaves
    // behind; the tree cannot be loaded from it. But a hash the chain does not
    // carry offers nothing to pick, and this demand would sit in the one slot
    // the field has — burying the note that says why the list is empty.
    if (!rootIsAbsent && (!Number.isFinite(localVersion) || (localVersion || 0) < 1))
      next.version = "familyTree.validation.version";
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [localRootHash, localVersion, rootIsAbsent]);

  useEffect(() => {
    validateAll();
  }, [validateAll]);

  const hasDiff = localRootHash !== rootHash || localVersion !== rootVersionIndex;

  const getLocalizedFormDefaultRoot = useCallback(() => {
    return getLocalizedDefaultRoot(i18n.language, {
      rootHash: defaults.rootHash,
      rootVersionIndex: defaults.rootVersionIndex,
    });
  }, [i18n.language, defaults.rootHash, defaults.rootVersionIndex]);

  const resetToDefaults = useCallback(() => {
    const localized = getLocalizedFormDefaultRoot();
    setLocalRootHash(localized.hash);
    setLocalVersion(localized.version);
    // The defaults name their own version; the lookup for that hash must not
    // replace it.
    decidedVersionHashRef.current = localized.hash || null;
  }, [defaults, getLocalizedFormDefaultRoot]);

  const applyConfigChanges = useCallback(() => {
    if (!validateAll()) return;
    // Only the root moves from here now. The reader and the addresses derived
    // from it belong to the connection, which this panel no longer edits, so
    // clearing them would cost a resolution round trip for nothing.
    update({
      rootHash: localRootHash,
      rootVersionIndex: localVersion,
    });
  }, [update, validateAll, localRootHash, localVersion]);

  return {
    showNodeModeToggle,
    showDeduplicateToggle,
    showTrustedSourceFilterToggle,

    actions: {
      reset: resetToDefaults,
      save: applyConfigChanges,
      hasDiff,
      clearAllCaches,
    },

    root: {
      value: localRootHash,
      onChange: setLocalRootHash,
      error: errors.root,
      presence: rootPresence,
      networkName,
    },

    version: {
      value: localVersion,
      onChange: handleVersionChange,
      lookup: rootVersionLookup,
      error: errors.version,
      // A reader that does not answer makes every version lookup fail, and the
      // picker must not read that as a fault of the hash above it.
      readerBlocked: readerHealth === "unreachable",
      // The chain answered: there is nothing to offer. Synthesising the saved
      // index below would contradict the note saying so.
      rootAbsent: rootIsAbsent,
    },

    history: {
      items: rootHistory,
      onSelect: setLocalRootHash,
      onRemove: removeRootFromHistory,
      onClearAll: clearRootHistory,
    },

    traversal: {
      value: traversal,
      onChange: setTraversal,
    },

    children: {
      mode: childrenMode,
      onModeChange: setChildrenMode,
      includeUnversioned: strictIncludeUnversionedChildren,
      onIncludeUnversionedChange: setStrictIncludeUnversionedChildren,
    },

    deduplicate: {
      value: deduplicateChildren,
      onChange: setDeduplicateChildren,
    },

    trustedSourceFilter: {
      value: trustedSourceFilterEnabled,
      onChange: setTrustedSourceFilterEnabled,
    },
  } as const;
}
