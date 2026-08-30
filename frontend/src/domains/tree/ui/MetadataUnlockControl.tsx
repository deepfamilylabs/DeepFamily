import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, LoaderCircle, LockKeyhole, Trash2, X } from "lucide-react";
import { ModalShell } from "../../../shared/ui";
import {
  classifyProtocolPassphraseRisk,
  type ProtocolPassphraseRisk,
} from "../../../shared/crypto/passphraseStrength";
import { useConfig } from "../../config";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import {
  MetadataUnlockCoordinator,
  readPersonVersionEnvelope,
  type MetadataUnlockBatchProgress,
} from "../../../shared/metadata";
import { isMetadataUnlockUsable, type NodeData } from "../../../shared/model";
import { useTreeGraphData, useTreeMutations } from "../context";
import { buildTreeStorageNamespace } from "../context/treeStorageScope";

type PreparationState = "idle" | "preparing" | "ready";

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

export function MetadataUnlockControl() {
  const { nodesData } = useTreeGraphData();
  const {
    cacheValidatedPersonVersion,
    persistValidatedPersonVersion,
    clearMetadataUnlockCache,
    captureMetadataCacheRevision,
  } = useTreeMutations();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const coordinatorRef = useRef(new MetadataUnlockCoordinator());
  const nodesDataRef = useRef(nodesData);
  nodesDataRef.current = nodesData;
  const passphraseRef = useRef<HTMLInputElement>(null);
  const preflightGenerationRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [preparation, setPreparation] = useState<PreparationState>("idle");
  const [preparedNodes, setPreparedNodes] = useState<NodeData[]>([]);
  const [preflightFailures, setPreflightFailures] = useState(0);
  const [progress, setProgress] = useState<MetadataUnlockBatchProgress | null>(null);
  const [error, setError] = useState("");
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [highRiskConfirmed, setHighRiskConfirmed] = useState(false);
  const [passphraseRisk, setPassphraseRisk] = useState<ProtocolPassphraseRisk>("empty");
  const unlockScopeKey = useMemo(
    () => buildTreeStorageNamespace({ chainId, contractAddress }),
    [chainId, contractAddress],
  );
  const currentScopeKeyRef = useRef(unlockScopeKey);
  const previousScopeKeyRef = useRef(unlockScopeKey);
  // Update during render, rather than waiting for an effect, so a Worker
  // completion racing a network render cannot commit against the old scope.
  currentScopeKeyRef.current = unlockScopeKey;

  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return getReadonlyProvider(rpcUrl, chainId);
    } catch {
      return null;
    }
  }, [chainId, rpcUrl]);

  const candidates = useMemo(
    () =>
      Object.values(nodesData).filter(
        (node) => hasArchiveAnchors(node) && !isMetadataUnlockUsable(node),
      ),
    [nodesData],
  );
  const unlockedCount = useMemo(
    () => Object.values(nodesData).filter(isMetadataUnlockUsable).length,
    [nodesData],
  );

  const clearAttemptState = useCallback(() => {
    preflightGenerationRef.current += 1;
    coordinatorRef.current.cancel();
    if (passphraseRef.current) passphraseRef.current.value = "";
    setPreparation("idle");
    setPreparedNodes([]);
    setPreflightFailures(0);
    setProgress(null);
    setError("");
    setRiskConfirmed(false);
    setHighRiskConfirmed(false);
    setPassphraseRisk("empty");
  }, []);

  useEffect(
    () => () => {
      preflightGenerationRef.current += 1;
      coordinatorRef.current.cancel();
    },
    [],
  );

  useEffect(() => {
    if (previousScopeKeyRef.current === unlockScopeKey) return;
    previousScopeKeyRef.current = unlockScopeKey;
    // A chain/proxy change invalidates both public preflight bytes and every
    // passphrase-derived result. cancel() aborts the batch and terminates an
    // Argon2 Worker that is already executing.
    clearAttemptState();
  }, [clearAttemptState, unlockScopeKey]);

  const resetAttempt = clearAttemptState;

  const close = () => {
    resetAttempt();
    setOpen(false);
  };

  const prepare = async () => {
    if (!provider || !chainId || !contractAddress) {
      setError(
        t(
          "metadataUnlock.errors.config",
          "Configure a valid RPC endpoint, chain ID, and DeepFamily proxy first.",
        ),
      );
      return;
    }
    if (candidates.length === 0) {
      setError(
        t(
          "metadataUnlock.errors.noCandidates",
          "No loaded locked version currently has a complete Archive reference.",
        ),
      );
      return;
    }

    const generation = ++preflightGenerationRef.current;
    const runScopeKey = unlockScopeKey;
    const isCurrent = () =>
      generation === preflightGenerationRef.current && runScopeKey === currentScopeKeyRef.current;
    setPreparation("preparing");
    setError("");
    setPreparedNodes([]);
    setPreflightFailures(0);
    const supported: NodeData[] = [];
    let failed = 0;
    for (const node of candidates) {
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
      } catch {
        if (!isCurrent()) return;
        failed += 1;
      }
    }
    if (!isCurrent()) return;
    setPreparedNodes(supported);
    setPreflightFailures(failed);
    setPreparation("ready");
    if (supported.length === 0) {
      setError("None of the loaded Archive references use a supported, valid envelope format.");
    }
  };

  const unlock = async () => {
    if (!provider || !chainId || !contractAddress || preparedNodes.length === 0) return;
    const runScopeKey = unlockScopeKey;
    const assertCurrentScope = () => {
      if (currentScopeKeyRef.current === runScopeKey) return;
      // This also terminates an in-flight Worker. Throwing after abort makes
      // the coordinator treat the stale completion as cancellation, not as a
      // failed unlock that may continue with another node.
      coordinatorRef.current.cancel();
      throw new Error("Metadata unlock scope changed");
    };
    const rawPassphrase = passphraseRef.current?.value ?? "";
    const currentRisk = classifyProtocolPassphraseRisk(rawPassphrase);
    setPassphraseRisk(currentRisk);
    if (!riskConfirmed) {
      setError("Confirm the permanent offline-guessing risk before unlocking.");
      return;
    }
    if (currentRisk !== "ordinary" && !highRiskConfirmed) {
      setError(
        currentRisk === "empty"
          ? "Explicitly confirm that an empty passphrase provides no secrecy."
          : "Explicitly confirm the risk of a whitespace-only passphrase.",
      );
      return;
    }

    setError("");
    // Bind every later Worker/cache completion to the clear fence that was
    // current when this user-initiated batch began.
    const cacheRevision = captureMetadataCacheRevision();
    const run = coordinatorRef.current.run({
      nodes: preparedNodes,
      chainId,
      deepFamilyProxy: contractAddress,
      getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
      rawPassphrase,
      getCurrentNode: (nodeId) => {
        assertCurrentScope();
        return nodesDataRef.current[nodeId];
      },
      cacheValidatedPersonVersion: (node) => {
        assertCurrentScope();
        cacheValidatedPersonVersion(node, cacheRevision);
        assertCurrentScope();
      },
      persistUnlocked: async (node) => {
        assertCurrentScope();
        await persistValidatedPersonVersion(node, cacheRevision);
        assertCurrentScope();
      },
      onProgress: (nextProgress) => {
        if (currentScopeKeyRef.current === runScopeKey) setProgress(nextProgress);
      },
    });
    // The coordinator owns the active batch's only in-memory string. Clear the
    // DOM before any later wallet or UI interaction.
    if (passphraseRef.current) passphraseRef.current.value = "";
    setPassphraseRisk("empty");
    try {
      const report = await run;
      if (currentScopeKeyRef.current !== runScopeKey) return;
      if (report.status === "completed" && report.failed > 0) {
        setError(
          t(
            "metadataUnlock.errors.partialFailure",
            "{{count}} version(s) could not be unlocked with this passphrase.",
            { count: report.failed },
          ),
        );
      }
    } catch (cause) {
      if (currentScopeKeyRef.current !== runScopeKey) return;
      setError(
        cause instanceof Error
          ? cause.message
          : t("metadataUnlock.errors.failed", "Metadata unlock failed"),
      );
    }
  };

  const running = progress?.status === "running" || progress?.status === "cancelling";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-lg hover:border-orange-300 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        <KeyRound className="h-4 w-4" />
        {t("metadataUnlock.openButton", "Unlock versions")}
        {unlockedCount > 0 ? <span className="text-emerald-600">{unlockedCount}</span> : null}
      </button>

      <ModalShell
        isOpen={open}
        onClose={close}
        bare
        ariaLabelledBy={titleId}
        ariaDescribedBy={descriptionId}
      >
        {/* Scrolls from the top once the panel outgrows the viewport: the shell
            locks body scroll, so this container owns the only scrollbar. */}
        <div className="h-full overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <section
              className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id={titleId}
                    className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"
                  >
                    <LockKeyhole className="h-5 w-5 text-orange-500" />
                    {t("metadataUnlock.title", "Unlock encrypted version metadata")}
                  </h3>
                  <p
                    id={descriptionId}
                    className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
                  >
                    {t(
                      "metadataUnlock.description",
                      "One passphrase is tried sequentially against loaded locked versions. Validated person data, label, and biography are saved as plaintext in this browser.",
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

              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t(
                  "metadataUnlock.summary",
                  "{{candidates}} locked candidate(s); {{unlocked}} already unlocked locally.",
                  { candidates: candidates.length, unlocked: unlockedCount },
                )}{" "}
                {preparation === "ready"
                  ? t(
                      "metadataUnlock.summaryReady",
                      "{{prepared}} passed Archive/header preflight; {{failed}} failed before KDF.",
                      { prepared: preparedNodes.length, failed: preflightFailures },
                    )
                  : t(
                      "metadataUnlock.summaryIdle",
                      "Archive bytes and format are checked before a passphrase is requested.",
                    )}
              </div>

              {preparation === "idle" ? (
                <button
                  type="button"
                  onClick={prepare}
                  className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700"
                >
                  {t("metadataUnlock.preflight", "Preflight loaded versions")}
                </button>
              ) : null}

              {preparation === "preparing" ? (
                <div className="mt-4 flex items-center justify-center gap-2 py-4 text-sm text-slate-600 dark:text-slate-300">
                  <LoaderCircle className="h-4 w-4 animate-spin" />{" "}
                  {t("metadataUnlock.checking", "Checking Archive bytes…")}
                </div>
              ) : null}

              {preparation === "ready" && preparedNodes.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("metadataUnlock.passphraseLabel", "Identity passphrase")}
                    <input
                      ref={passphraseRef}
                      type="password"
                      autoComplete="off"
                      disabled={running}
                      onChange={(event) => {
                        setPassphraseRisk(
                          classifyProtocolPassphraseRisk(event.currentTarget.value),
                        );
                        setHighRiskConfirmed(false);
                      }}
                      className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={riskConfirmed}
                      disabled={running}
                      onChange={(event) => setRiskConfirmed(event.currentTarget.checked)}
                    />
                    <span>
                      {t(
                        "metadataUnlock.riskConsent",
                        "I understand the permanent on-chain ciphertext permits unlimited offline passphrase guesses and that the unlocked plaintext is stored in IndexedDB.",
                      )}
                    </span>
                  </label>
                  {passphraseRisk !== "ordinary" ? (
                    <label className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                      <input
                        type="checkbox"
                        checked={highRiskConfirmed}
                        disabled={running}
                        onChange={(event) => setHighRiskConfirmed(event.currentTarget.checked)}
                      />
                      <span>
                        {passphraseRisk === "empty"
                          ? t(
                              "metadataUnlock.emptyPassphraseConsent",
                              "I explicitly choose an empty passphrase and understand anyone can reproduce it and decrypt this metadata.",
                            )
                          : t(
                              "metadataUnlock.whitespacePassphraseConsent",
                              "I explicitly confirm this whitespace-only passphrase is high risk and is not trimmed.",
                            )}
                      </span>
                    </label>
                  ) : null}

                  {progress ? (
                    <p className="text-xs text-slate-600 dark:text-slate-300">
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

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={running ? () => coordinatorRef.current.cancel() : unlock}
                      className="flex-1 rounded-xl bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700"
                    >
                      {running
                        ? t("metadataUnlock.cancel", "Cancel active Worker")
                        : t("metadataUnlock.unlock", "Unlock sequentially")}
                    </button>
                    <button
                      type="button"
                      disabled={running}
                      onClick={resetAttempt}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                    >
                      {t("metadataUnlock.reset", "Reset")}
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{error}</p>
              ) : null}

              <button
                type="button"
                disabled={running || unlockedCount === 0}
                onClick={() => {
                  clearMetadataUnlockCache();
                  resetAttempt();
                }}
                className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-rose-600 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />{" "}
                {t("metadataUnlock.clearCache", "Clear local unlocked plaintext cache")}
              </button>
            </section>
          </div>
        </div>
      </ModalShell>
    </>
  );
}
