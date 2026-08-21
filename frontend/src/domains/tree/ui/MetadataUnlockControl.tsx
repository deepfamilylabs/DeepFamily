import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole, Trash2, X } from "lucide-react";
import { normalizePassphrase } from "@deepfamily/protocol-core";
import { useConfig } from "../../config";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import {
  MetadataUnlockCoordinator,
  readPersonVersionEnvelope,
  type MetadataUnlockBatchProgress,
} from "../../../shared/metadata";
import { isMetadataUnlockUsable, type NodeData } from "../../../shared/model";
import { useTreeGraphData, useTreeMutations } from "../context";

type PreparationState = "idle" | "preparing" | "ready";
type PassphraseRisk = "empty" | "whitespace" | "other";

const UNICODE_WHITESPACE_ONLY = /^\p{White_Space}+$/u;

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

function classifyPassphrase(raw: string): PassphraseRisk {
  try {
    const normalized = normalizePassphrase(raw);
    if (normalized.length === 0) return "empty";
    return UNICODE_WHITESPACE_ONLY.test(normalized) ? "whitespace" : "other";
  } catch {
    // The production KDF path will report malformed Unicode precisely; an
    // input event must never crash the surrounding React tree.
    return "other";
  }
}

export function MetadataUnlockControl() {
  const { nodesData } = useTreeGraphData();
  const {
    cacheValidatedPersonVersion,
    persistValidatedPersonVersion,
    clearMetadataUnlockCache,
  } = useTreeMutations();
  const { rpcUrl, chainId, contractAddress } = useConfig();
  const coordinatorRef = useRef(new MetadataUnlockCoordinator());
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
  const [passphraseRisk, setPassphraseRisk] = useState<PassphraseRisk>("empty");

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

  useEffect(
    () => () => {
      preflightGenerationRef.current += 1;
      coordinatorRef.current.cancel();
    },
    [],
  );

  const resetAttempt = () => {
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
  };

  const close = () => {
    resetAttempt();
    setOpen(false);
  };

  const prepare = async () => {
    if (!provider || !chainId || !contractAddress) {
      setError("Configure a valid RPC endpoint, chain ID, and DeepFamily proxy first.");
      return;
    }
    if (candidates.length === 0) {
      setError("No loaded locked version currently has a complete Archive reference.");
      return;
    }

    const generation = ++preflightGenerationRef.current;
    setPreparation("preparing");
    setError("");
    setPreparedNodes([]);
    setPreflightFailures(0);
    const supported: NodeData[] = [];
    let failed = 0;
    for (const node of candidates) {
      if (generation !== preflightGenerationRef.current) return;
      try {
        await readPersonVersionEnvelope({
          node,
          chainId,
          deepFamilyProxy: contractAddress,
          getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
        });
        supported.push(node);
      } catch {
        failed += 1;
      }
    }
    if (generation !== preflightGenerationRef.current) return;
    setPreparedNodes(supported);
    setPreflightFailures(failed);
    setPreparation("ready");
    if (supported.length === 0) {
      setError("None of the loaded Archive references use a supported, valid envelope format.");
    }
  };

  const unlock = async () => {
    if (!provider || !chainId || !contractAddress || preparedNodes.length === 0) return;
    const rawPassphrase = passphraseRef.current?.value ?? "";
    const currentRisk = classifyPassphrase(rawPassphrase);
    setPassphraseRisk(currentRisk);
    if (!riskConfirmed) {
      setError("Confirm the permanent offline-guessing risk before unlocking.");
      return;
    }
    if (currentRisk !== "other" && !highRiskConfirmed) {
      setError(
        currentRisk === "empty"
          ? "Explicitly confirm that an empty passphrase provides no secrecy."
          : "Explicitly confirm the risk of a whitespace-only passphrase.",
      );
      return;
    }

    setError("");
    const run = coordinatorRef.current.run({
      nodes: preparedNodes,
      chainId,
      deepFamilyProxy: contractAddress,
      getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
      rawPassphrase,
      cacheValidatedPersonVersion,
      persistUnlocked: persistValidatedPersonVersion,
      onProgress: setProgress,
    });
    // The coordinator owns the active batch's only in-memory string. Clear the
    // DOM before any later wallet or UI interaction.
    if (passphraseRef.current) passphraseRef.current.value = "";
    setPassphraseRisk("empty");
    try {
      const report = await run;
      if (report.status === "completed" && report.failed > 0) {
        setError(`${report.failed} version(s) could not be unlocked with this passphrase.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Metadata unlock failed");
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
        Unlock versions
        {unlockedCount > 0 ? <span className="text-emerald-600">{unlockedCount}</span> : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                  <LockKeyhole className="h-5 w-5 text-orange-500" />
                  Unlock encrypted version metadata
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  One passphrase is tried sequentially against loaded locked versions. Validated
                  person data, label, and biography are saved as plaintext in this browser.
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {candidates.length} locked candidate(s); {unlockedCount} already unlocked locally.
              {preparation === "ready"
                ? ` ${preparedNodes.length} passed Archive/header preflight; ${preflightFailures} failed before KDF.`
                : " Archive bytes and format are checked before a passphrase is requested."}
            </div>

            {preparation === "idle" ? (
              <button
                type="button"
                onClick={prepare}
                className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700"
              >
                Preflight loaded versions
              </button>
            ) : null}

            {preparation === "preparing" ? (
              <div className="mt-4 flex items-center justify-center gap-2 py-4 text-sm text-slate-600 dark:text-slate-300">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Checking Archive bytes…
              </div>
            ) : null}

            {preparation === "ready" && preparedNodes.length > 0 ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Identity passphrase
                  <input
                    ref={passphraseRef}
                    type="password"
                    autoComplete="off"
                    disabled={running}
                    onChange={(event) => {
                      setPassphraseRisk(classifyPassphrase(event.currentTarget.value));
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
                    I understand the permanent on-chain ciphertext permits unlimited offline
                    passphrase guesses and that the unlocked plaintext is stored in IndexedDB.
                  </span>
                </label>
                {passphraseRisk !== "other" ? (
                  <label className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                    <input
                      type="checkbox"
                      checked={highRiskConfirmed}
                      disabled={running}
                      onChange={(event) => setHighRiskConfirmed(event.currentTarget.checked)}
                    />
                    <span>
                      {passphraseRisk === "empty"
                        ? "I explicitly choose an empty passphrase and understand anyone can reproduce it and decrypt this metadata."
                        : "I explicitly confirm this whitespace-only passphrase is high risk and is not trimmed."}
                    </span>
                  </label>
                ) : null}

                {progress ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {progress.status}: {progress.processed}/{progress.total}; {progress.succeeded}
                    successful, {progress.failed} failed, {progress.skipped} cached.
                  </p>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={running ? () => coordinatorRef.current.cancel() : unlock}
                    className="flex-1 rounded-xl bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700"
                  >
                    {running ? "Cancel active Worker" : "Unlock sequentially"}
                  </button>
                  <button
                    type="button"
                    disabled={running}
                    onClick={resetAttempt}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}

            <button
              type="button"
              disabled={running || unlockedCount === 0}
              onClick={() => {
                clearMetadataUnlockCache();
                resetAttempt();
              }}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-rose-600 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" /> Clear local unlocked plaintext cache
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
