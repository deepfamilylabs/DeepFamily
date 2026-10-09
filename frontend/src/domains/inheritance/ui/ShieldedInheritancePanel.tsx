import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { buildShieldedAssetSigningMessage } from "@deepfamily/protocol-core";
import {
  formatUnits,
  getBigInt,
  getAddress,
  parseUnits,
  toUtf8Bytes,
  type Provider,
  type Signer,
} from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useConfig } from "../../config";
import { useTransactionCenter } from "../../transactions";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { getShieldedPoolFactoryDeploymentBlock } from "../../../shared/config/env";
import {
  cancelShieldedAssetPreview,
  getShieldedAssetWorkerGeneration,
  shieldedAssetWorkerCall,
  subscribeShieldedAssetWorkerLock,
} from "../../../shared/workers/shieldedAssetWorkerClient";
import type {
  ShieldedActionPreview,
  ShieldedAssetActionRequest,
  ShieldedAssetWorkerCallMap,
  ShieldedFundingEntry,
  ShieldedKeySlot,
  ShieldedWalletSummary,
  ShieldedWorkerContext,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import {
  createShieldedReceiveCodeForRecipient,
  verifyShieldedReceiveCode,
  type VerifiedShieldedRecipient,
} from "../services/shieldedReceiveCode";
import {
  submitShield,
  submitFund,
  submitClaim,
  submitPrivateTransfer,
  submitUnshield,
  type ShieldedGasReview,
} from "../services/shieldedPoolFlows";
import { useShieldedPageIdentitySession } from "./ShieldedIdentitySessionContext";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";
import { PanelButton, FieldBlock, PanelShell, shortHex } from "./inheritanceControls";
const INPUT =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";
type Action = ShieldedAssetActionRequest["action"];
type RecoveryFormat = "mnemonic" | "shieldedKey";

/** React keeps public handles and display amounts. Keys and note openings stay in the asset Worker. */
export function ShieldedInheritancePanel({
  modules,
  signer,
  account,
  publicActivityAddresses,
  assetControls,
}: {
  modules: ShieldedPageModules;
  signer: Signer | null;
  account: string;
  publicActivityAddresses: Set<string>;
  assetControls?: ReactNode;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const config = useConfig();
  const session = useShieldedPageIdentitySession();
  const latestSession = useRef(session);
  latestSession.current = session;
  const txCenter = useTransactionCenter();
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const recipientForm = useRef<ShieldedRecipientCredentialsFormHandle>(null);
  const exportedMaterial = useRef<HTMLTextAreaElement>(null);
  const recoveryMaterial = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false),
    running = useRef(false),
    job = useRef(0),
    signatureRequest = useRef(0);
  const waitingSignatureRequest = useRef<number | null>(null);
  const walletRef = useRef({ signer, account });
  walletRef.current = { signer, account };
  const previousGasWallet = useRef({ signer, account });
  const receiptTracking = useRef<{
    provider: Provider;
    chainId: bigint;
    hash?: string;
    id: string;
    label: string;
    nonce?: number;
    signerAddress?: string;
    fromBlock?: number;
    pool?: ShieldedPageModules["pool"];
    outputCommitments?: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState(""),
    [transactionPending, setTransactionPending] = useState(false);
  const pendingRecord = txCenter?.records.find(
    (record) =>
      record.kind === "shielded" &&
      record.phase === "busy" &&
      record.shieldedSubmission?.chainId === String(modules.chainId) &&
      record.shieldedSubmission.poolAddress.toLowerCase() === modules.poolAddress.toLowerCase(),
  );
  const submissionPending = transactionPending || !!pendingRecord;
  const [slot, setSlot] = useState<ShieldedKeySlot>("identity");
  const [rootSource, setRootSource] = useState<"random" | "walletSignature">("random");
  const [expectedFingerprint, setExpectedFingerprint] = useState(""),
    [exportedFingerprint, setExportedFingerprint] = useState("");
  const [backupFormat, setBackupFormat] = useState<RecoveryFormat>("mnemonic");
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [externalSaved, setExternalSaved] = useState(false),
    [restorePath, setRestorePath] = useState<RecoveryFormat | "signature">("mnemonic");
  const [wallet, setWallet] = useState<ShieldedWalletSummary | null>(null);
  const [discovery, setDiscovery] = useState<
    ShieldedAssetWorkerCallMap["discover"]["result"] | null
  >(null);
  const [action, setAction] = useState<Action>("shield"),
    [amount, setAmount] = useState("");
  const [entry, setEntry] = useState<ShieldedFundingEntry>("privateIndependent");
  const [rootVersion, setRootVersion] = useState(""),
    [periodDays, setPeriodDays] = useState("30"),
    [periods, setPeriods] = useState("1");
  const [policyHandle, setPolicyHandle] = useState(""),
    [personHash, setPersonHash] = useState(""),
    [code, setCode] = useState("");
  const draftPolicy = useRef<{ handle: string; key: string } | null>(null);
  const [draftPolicyHandle, setDraftPolicyHandle] = useState("");
  const [verifiedRecipient, setVerifiedRecipient] = useState<VerifiedShieldedRecipient | null>(
    null,
  );
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false),
    [ownCode, setOwnCode] = useState(""),
    [ownFingerprint, setOwnFingerprint] = useState("");
  const [withdrawalRecipient, setWithdrawalRecipient] = useState(account),
    [candidates, setCandidates] = useState<string[]>([]);
  const [claimHandle, setClaimHandle] = useState(""),
    [claimPeriods, setClaimPeriods] = useState<string[]>([]);
  const [preview, setPreview] = useState<ShieldedActionPreview | null>(null);
  const [gasReview, setGasReview] = useState<ShieldedGasReview | null>(null);
  const gasDecision = useRef<((approved: boolean) => void) | null>(null);
  const [allowanceReady, setAllowanceReady] = useState(modules.assetKind === "native");
  const context: ShieldedWorkerContext = {
    rpcUrl: config.rpcUrl,
    chainId: String(modules.chainId),
    factoryAddress: String(modules.factory.target),
    factoryDeploymentBlock: getShieldedPoolFactoryDeploymentBlock(Number(modules.chainId)),
    familyAddress: String(modules.deepFamily.target),
    lineageIndexAddress: String(modules.lineageIndex.target),
    poolAddress: modules.poolAddress,
    poolDeploymentBlock: modules.poolDeploymentBlock,
    assetKind: modules.assetKind,
  };
  const contextKey = JSON.stringify(context),
    contextRef = useRef(contextKey);
  const previousContextKey = useRef(contextKey);
  contextRef.current = contextKey;
  const draftKey = JSON.stringify([
    contextKey,
    session.identity?.handle,
    rootVersion,
    amount,
    periodDays,
  ]);
  const hasSession = !!(session.identity || session.funds);
  const recoveryInfoReady = !!(session.funds?.recoveryVerified || session.funds?.backupRequired);
  const independentBackupPending = !!exportedFingerprint || !!session.funds?.backupRequired;
  const slotReady = slot === "identity" ? !!session.identity : !!session.funds?.recoveryVerified;
  const showAmount = (value: string) => formatUnits(BigInt(value), modules.tokenDecimals ?? 0);
  const values =
    wallet?.notes.filter(
      (note) =>
        note.kind === "value" &&
        (note.slot === slot ||
          (slot === "asset" && note.ownerCommitment === session.funds?.ownerCommitment)) &&
        BigInt(note.amount) > 0n,
    ) ?? [];
  const claims = wallet?.claims.filter((claim) => claim.slot === slot) ?? [];
  const selectedClaim = claims.find((claim) => claim.handle === claimHandle);
  const selectedPolicy = wallet?.policies.find((policy) => policy.handle === policyHandle);
  const template = wallet?.templates.find(
    (item) =>
      item.policyHandle === policyHandle &&
      item.personHash.toLowerCase() === personHash.toLowerCase(),
  );
  const needsCode =
    action === "privateTransfer" || (action === "fund" && entry !== "public" && !template);
  const needsValues = ["fund", "privateTransfer", "unshield"].includes(action);
  function clearSecretInputs() {
    identityForm.current?.clearSecretInputs();
    recipientForm.current?.clearSecretInputs();
    if (exportedMaterial.current) exportedMaterial.current.value = "";
    if (recoveryMaterial.current) recoveryMaterial.current.value = "";
  }
  const clearRef = useRef(clearSecretInputs);
  clearRef.current = clearSecretInputs;
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    mounted.current = true;
    const clear = () => clearRef.current();
    const hidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (waitingSignatureRequest.current !== null) {
        // An external wallet may hide the page. Keep only its public request;
        // no secret session survives, and its result must return while visible.
        clear();
        latestSession.current.lock();
      } else lockRef.current();
    };
    const pagehide = () => lockRef.current();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    const unsubscribeLock = subscribeShieldedAssetWorkerLock(() => {
      clear();
      gasDecision.current?.(false);
    });
    return () => {
      mounted.current = false;
      job.current++;
      signatureRequest.current++;
      gasDecision.current?.(false);
      clear();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      unsubscribeLock();
      latestSession.current.setBusy(false);
      void cancelShieldedAssetPreview().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!pendingRecord || receiptTracking.current?.id === pendingRecord.id) return;
    const provider = modules.pool.runner?.provider;
    if (!provider) return;
    const metadata = pendingRecord.shieldedSubmission!;
    receiptTracking.current = {
      provider,
      chainId: modules.chainId,
      id: pendingRecord.id,
      label: pendingRecord.label,
      hash: pendingRecord.transactionHash,
      nonce: metadata.nonce,
      signerAddress: metadata.signerAddress,
      fromBlock: metadata.fromBlock,
      ...(metadata.kind === "action"
        ? { pool: modules.pool, outputCommitments: metadata.outputCommitments }
        : {}),
    };
    setTransactionHash(pendingRecord.transactionHash ?? "");
    setTransactionPending(true);
  }, [pendingRecord, modules.pool, modules.chainId]);
  useEffect(() => {
    const previous = previousGasWallet.current;
    previousGasWallet.current = { signer, account };
    if (previous.signer === signer && previous.account === account) return;
    clearSecretInputs();
    job.current++;
    signatureRequest.current++;
    waitingSignatureRequest.current = null;
    gasDecision.current?.(false);
    setGasReview(null);
    running.current = false;
    setBusy(false);
    setStage("");
    latestSession.current.setBusy(false);
    setPreview(null);
    void cancelShieldedAssetPreview().catch(() => undefined);
  }, [signer, account]);
  useEffect(() => {
    if (previousContextKey.current !== contextKey) {
      previousContextKey.current = contextKey;
      lockRef.current();
    }
    setWallet(null);
    setDiscovery(null);
    setCandidates([]);
    setPreview(null);
    setOwnCode("");
    setOwnFingerprint("");
    draftPolicy.current = null;
    setDraftPolicyHandle("");
  }, [session.identity?.handle, session.funds?.fundsFingerprint, contextKey]);
  useEffect(() => {
    if (draftPolicy.current?.key !== draftKey) {
      draftPolicy.current = null;
      setDraftPolicyHandle("");
    }
  }, [draftKey]);
  useEffect(() => {
    setPreview(null);
    void cancelShieldedAssetPreview().catch(() => undefined);
  }, [
    action,
    slot,
    amount,
    candidates,
    code,
    entry,
    rootVersion,
    periodDays,
    periods,
    policyHandle,
    personHash,
    claimHandle,
    claimPeriods,
    withdrawalRecipient,
    fingerprintConfirmed,
  ]);
  useEffect(() => {
    if (!signer || modules.assetKind !== "erc20") return;
    let cancelled = false;
    void modules
      .token!.allowance(account, modules.poolAddress)
      .then((value: bigint) => {
        if (!cancelled) {
          try {
            setAllowanceReady(
              BigInt(value) >= parseUnits(amount || "0", modules.tokenDecimals ?? 0),
            );
          } catch {
            setAllowanceReady(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setAllowanceReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modules, account, signer, amount]);
  async function run(task: (current: () => boolean) => Promise<void>, label: string) {
    if (running.current) return;
    running.current = true;
    const epoch = ++job.current,
      scope = contextKey;
    const current = () => mounted.current && epoch === job.current && scope === contextRef.current;
    setBusy(true);
    latestSession.current.setBusy(true);
    setError("");
    setStage(label);
    latestSession.current.touch();
    try {
      await task(current);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : tr("failed"));
    } finally {
      if (current()) {
        setBusy(false);
        setStage("");
        latestSession.current.setBusy(false);
      }
      if (epoch === job.current) running.current = false;
    }
  }
  async function unlock() {
    await run(async (current) => {
      const form = identityForm.current;
      if (!form) return;
      const identity = form.getPublicFormData();
      let rawPassphrase = form.getSecretInputs().passphrase;
      form.clearSecretInputs();
      try {
        const pending = shieldedAssetWorkerCall("unlockIdentity", { identity, rawPassphrase });
        rawPassphrase = "";
        const state = await pending;
        if (current()) latestSession.current.update(state);
      } finally {
        rawPassphrase = "";
      }
    }, tr("unlocking"));
  }
  function lock() {
    signatureRequest.current++;
    waitingSignatureRequest.current = null;
    job.current++;
    gasDecision.current?.(false);
    setGasReview(null);
    running.current = false;
    setBusy(false);
    setStage("");
    latestSession.current.setBusy(false);
    clearSecretInputs();
    latestSession.current.lock();
    setPreview(null);
    draftPolicy.current = null;
    setDraftPolicyHandle("");
  }
  async function requestSignature(intent: "create" | "restore") {
    await run(async (current) => {
      if (!signer) throw new Error(t("shielded.walletNotReady"));
      const chosen = signer,
        address = getAddress(await chosen.getAddress());
      if (
        !current() ||
        document.visibilityState !== "visible" ||
        walletRef.current.signer !== chosen ||
        walletRef.current.account.toLowerCase() !== address.toLowerCase()
      )
        return;
      const requestId = ++signatureRequest.current;
      if (intent === "restore" && independentBackupPending)
        throw new Error(tr("independentBackupRequired"));
      const expected = expectedFingerprint.trim() || undefined;
      latestSession.current.lock();
      clearSecretInputs();
      let signature = "";
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        waitingSignatureRequest.current = requestId;
        try {
          signature = await Promise.race([
            chosen.signMessage(toUtf8Bytes(buildShieldedAssetSigningMessage(address))),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(tr("signatureExpired"))), 120_000);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          if (waitingSignatureRequest.current === requestId) waitingSignatureRequest.current = null;
        }
        if (
          !current() ||
          document.visibilityState !== "visible" ||
          requestId !== signatureRequest.current ||
          walletRef.current.signer !== chosen ||
          walletRef.current.account.toLowerCase() !== address.toLowerCase()
        )
          return;
        const pending =
          intent === "create"
            ? shieldedAssetWorkerCall("createFunds", {
                intent: "create",
                rootSource: "walletSignature",
                signerAddress: address,
                signature,
                context,
              })
            : shieldedAssetWorkerCall("restoreSignature", {
                signerAddress: address,
                signature,
                expectedFingerprint: expected,
                context,
              });
        signature = "";
        const state = await pending;
        if (current() && requestId === signatureRequest.current) {
          latestSession.current.update(state);
          if (intent === "create" || expected)
            setExpectedFingerprint(state.funds?.fundsFingerprint ?? expected ?? "");
          if (intent === "create") {
            setExportedFingerprint("");
            setExternalSaved(false);
            setVerificationStarted(false);
          }
          setSlot("asset");
        }
      } finally {
        signature = "";
      }
    }, tr("signing"));
  }
  async function createFunds() {
    if (rootSource === "walletSignature") return requestSignature("create");
    await run(async (current) => {
      latestSession.current.lock();
      clearSecretInputs();
      const state = await shieldedAssetWorkerCall("createFunds", {
        intent: "create",
        rootSource: "random",
        context,
      });
      if (current()) {
        latestSession.current.update(state);
        setExpectedFingerprint(state.funds!.fundsFingerprint);
        setExportedFingerprint("");
        setExternalSaved(false);
        setVerificationStarted(false);
        setSlot("asset");
      }
    }, tr("creating"));
  }
  async function exportRecoveryMaterial() {
    await run(async (current) => {
      clearSecretInputs();
      const result = await shieldedAssetWorkerCall("exportRecoveryMaterial", {
        format: backupFormat,
        context,
      });
      try {
        if (!current()) return;
        if (exportedMaterial.current) exportedMaterial.current.value = result.material;
        setExportedFingerprint(result.fundsFingerprint);
        setExternalSaved(false);
        setVerificationStarted(false);
      } finally {
        result.material = "";
      }
    }, tr("exporting"));
  }
  async function importRecoveryMaterial() {
    if (restorePath === "signature") return;
    const format = restorePath;
    await run(async (current) => {
      if (exportedFingerprint && (!externalSaved || !verificationStarted))
        throw new Error(tr("saveExternalFirst"));
      let material = recoveryMaterial.current?.value ?? "";
      const fingerprint = exportedFingerprint || expectedFingerprint.trim() || undefined;
      latestSession.current.lock();
      clearSecretInputs();
      try {
        const pending = shieldedAssetWorkerCall("importRecoveryMaterial", {
          format,
          material,
          expectedFingerprint: fingerprint,
          context,
        });
        material = "";
        const state = await pending;
        if (current()) {
          latestSession.current.update(state);
          setSlot("asset");
          if (fingerprint) setExpectedFingerprint(fingerprint);
          setExportedFingerprint("");
          setExternalSaved(false);
          setVerificationStarted(false);
        }
      } finally {
        material = "";
      }
    }, tr("importing"));
  }
  function downloadRecoveryInfo() {
    if (!recoveryInfoReady || !session.funds) return;
    const fingerprint = session.funds.fundsFingerprint;
    const info = {
      format: "DeepFamily funds recovery information",
      version: 1,
      fundsFingerprint: fingerprint,
      chainId: context.chainId,
      factoryAddress: context.factoryAddress,
      factoryDeploymentBlock: context.factoryDeploymentBlock,
      lineageIndexAddress: context.lineageIndexAddress,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(info, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deepfamily-recovery-info-${fingerprint.slice(2, 14)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function recover(all = false) {
    await run(async (current) => {
      if (all) {
        const result = await shieldedAssetWorkerCall(
          "discover",
          { context },
          { timeoutMs: 1_200_000 },
        );
        if (current()) setDiscovery(result);
      } else {
        const result = await shieldedAssetWorkerCall("recover", { context });
        if (current()) {
          if (result.sessionState) latestSession.current.update(result.sessionState);
          setWallet(result);
          setCandidates([]);
          setClaimHandle("");
          setClaimPeriods([]);
        }
      }
    }, t("shielded.stages.recovering"));
  }
  async function createCode() {
    await run(async (current) => {
      const result = await shieldedAssetWorkerCall(
        "receiveCode",
        { slot },
        { timeoutMs: 1_200_000 },
      );
      if (current()) {
        setOwnCode(result.code);
        setOwnFingerprint(result.fingerprint);
      }
    }, t("shielded.stages.receiveCode"));
  }
  async function checkCode() {
    await run(async (current) => {
      const result = await verifyShieldedReceiveCode(code);
      if (current()) {
        setVerifiedRecipient(result);
        setFingerprintConfirmed(false);
      }
    }, tr("checkingCode"));
  }
  async function generateConvenientCode() {
    await run(async (current) => {
      const form = recipientForm.current;
      if (!form) return;
      const credentials = form.readAndClear();
      try {
        const pending = createShieldedReceiveCodeForRecipient(credentials);
        credentials.rawPassphrase = "";
        const result = await pending;
        if (current()) {
          setCode(result);
          setVerifiedRecipient(null);
          setFingerprintConfirmed(false);
        }
      } finally {
        credentials.rawPassphrase = "";
        form.clearSecretInputs();
      }
    }, t("shielded.stages.receiveCode"));
  }
  function trackBroadcast(provider: Provider, hash: string, id: string, label: string) {
    txCenter?.upsert({
      id,
      kind: "shielded",
      label,
      phase: "busy",
      transactionHash: hash,
      ...(txCenter.records.some((record) => record.id === id)
        ? {}
        : {
            shieldedSubmission: {
              chainId: String(modules.chainId),
              poolAddress: modules.poolAddress,
              kind: "action" as const,
            },
          }),
    });
    if (receiptTracking.current && receiptTracking.current.id !== id) return;
    receiptTracking.current = {
      ...(receiptTracking.current?.id === id ? receiptTracking.current : {}),
      provider,
      hash,
      chainId: modules.chainId,
      id,
      label,
    };
    if (mounted.current) {
      setTransactionHash(hash);
      setTransactionPending(true);
      setPreview(null);
    }
  }
  function rejectKnownWalletRequest(cause: unknown, id: string) {
    const tracked = receiptTracking.current;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (tracked?.id !== id || tracked.hash || (code !== "ACTION_REJECTED" && code !== 4001)) return;
    txCenter?.upsert({ id, kind: "shielded", label: tracked.label, phase: "failed" });
    receiptTracking.current = null;
    if (mounted.current) setTransactionPending(false);
  }
  function recordReceipt(
    hash: string,
    status: number | null,
    transaction?: { id: string; label: string },
  ) {
    const tracked = receiptTracking.current;
    const record = transaction ?? (tracked?.hash === hash ? tracked : undefined);
    if (!record || status === null) return;
    txCenter?.upsert({
      id: record.id,
      kind: "shielded",
      label: record.label,
      phase: status === 1 ? "done" : "failed",
      transactionHash: hash,
    });
    if (mounted.current && tracked?.hash === hash) setTransactionPending(false);
  }
  async function checkReceipt() {
    await run(async (current) => {
      const tracked = receiptTracking.current;
      if (!tracked) return;
      if ((await tracked.provider.getNetwork()).chainId !== tracked.chainId)
        throw new Error(t("shielded.walletChanged"));
      const toBlock = await tracked.provider.getBlockNumber();
      let hash = tracked.hash;
      if (!hash && tracked.pool && tracked.fromBlock !== undefined && tracked.outputCommitments) {
        // Replay public outputs without asking the RPC for a selected private note/nullifier.
        const logs = await tracked.pool.queryFilter(
          tracked.pool.filters.NoteAppended(),
          tracked.fromBlock,
          toBlock,
        );
        const matches = new Map<string, Set<string>>();
        for (const log of logs) {
          if (!("args" in log)) continue;
          const commitment = String(log.args.commitment);
          if (!tracked.outputCommitments.includes(commitment)) continue;
          const outputs = matches.get(log.transactionHash) ?? new Set<string>();
          outputs.add(commitment);
          matches.set(log.transactionHash, outputs);
        }
        hash = [...matches].find(([, outputs]) =>
          tracked.outputCommitments!.every((item) => outputs.has(item)),
        )?.[0];
        if (hash) {
          tracked.hash = hash;
          txCenter?.upsert({
            id: tracked.id,
            kind: "shielded",
            label: tracked.label,
            phase: "busy",
            transactionHash: hash,
          });
          if (mounted.current) setTransactionHash(hash);
        }
      }
      if (!hash) {
        if (
          tracked.signerAddress &&
          tracked.nonce !== undefined &&
          (await tracked.provider.getTransactionCount(tracked.signerAddress, toBlock)) >
            tracked.nonce
        ) {
          txCenter?.upsert({
            id: tracked.id,
            kind: "shielded",
            label: tracked.label,
            phase: "failed",
          });
          if (mounted.current) {
            setTransactionPending(false);
            setWallet(null);
            setCandidates([]);
            setPreview(null);
          }
          throw new Error(tr("nonceConsumed"));
        }
        throw new Error(tr("submissionUnknown"));
      }
      const receipt = await tracked.provider.getTransactionReceipt(hash);
      if (!receipt || receipt.status === null) throw new Error(tr("pendingTransaction"));
      recordReceipt(hash, receipt.status);
      if (current()) {
        setWallet(null);
        setCandidates([]);
        setPreview(null);
      }
      if (receipt.status !== 1) throw new Error(t("shielded.transactionFailed", { hash }));
    }, tr("checkingReceipt"));
  }
  async function approve() {
    if (submissionPending) return;
    await run(async (current) => {
      if (!signer || !modules.token) throw new Error(t("shielded.walletNotReady"));
      const chosen = signer,
        value = parseUnits(amount, modules.tokenDecimals ?? 0);
      if (value <= 0n || value >= 1n << 128n) throw new Error(tr("amountInvalid"));
      latestSession.current.lock();
      clearSecretInputs();
      if (
        (await chosen.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await chosen.getAddress()).toLowerCase() !== account.toLowerCase() ||
        walletRef.current.signer !== chosen
      )
        throw new Error(t("shielded.walletChanged"));
      const [nonce, fromBlock] = await Promise.all([
        chosen.provider!.getTransactionCount(account, "pending"),
        chosen.provider!.getBlockNumber(),
      ]);
      if (!current()) return;
      const txId = `shielded:approval:${modules.chainId}:${account}:${nonce}:${Date.now()}`;
      const label = `${modules.assetSymbol} · ${tr("approve")}`;
      receiptTracking.current = {
        provider: chosen.provider!,
        chainId: modules.chainId,
        nonce,
        fromBlock,
        signerAddress: account,
        id: txId,
        label,
      };
      txCenter?.upsert({
        id: txId,
        kind: "shielded",
        label,
        phase: "busy",
        shieldedSubmission: {
          chainId: String(modules.chainId),
          poolAddress: modules.poolAddress,
          kind: "approval",
          nonce,
          fromBlock,
          signerAddress: account,
        },
      });
      setTransactionHash("");
      setTransactionPending(true);
      const tx = await (modules.token.connect(chosen) as typeof modules.token)
        .approve(modules.poolAddress, value, { nonce, chainId: modules.chainId })
        .catch((cause: unknown) => {
          rejectKnownWalletRequest(cause, txId);
          throw cause;
        });
      trackBroadcast(chosen.provider!, tx.hash, txId, label);
      const receipt = await tx.wait();
      if (receipt) recordReceipt(tx.hash, receipt.status, { id: txId, label });
      if (current()) {
        if (
          walletRef.current.signer !== chosen ||
          (await chosen.provider!.getNetwork()).chainId !== modules.chainId
        )
          throw new Error(t("shielded.walletChanged"));
        const allowance: bigint = await modules.token.allowance(account, modules.poolAddress);
        setAllowanceReady(receipt?.status === 1 && allowance >= value);
      }
      if (receipt?.status !== 1)
        throw new Error(t("shielded.transactionFailed", { hash: tx.hash }));
    }, t("shielded.stages.submitting"));
  }
  async function prepare() {
    if (submissionPending) return;
    await run(async (current) => {
      if (needsCode && (!verifiedRecipient || !fingerprintConfirmed))
        throw new Error(tr("confirmFingerprint"));
      if (action === "shield" && !allowanceReady) throw new Error(tr("approveFirst"));
      const amountValue =
        action === "claim" || (action === "fund" && selectedPolicy)
          ? undefined
          : parseUnits(amount, modules.tokenDecimals ?? 0).toString();
      const result = await shieldedAssetWorkerCall(
        "preview",
        {
          context,
          slot,
          action,
          amount: amountValue,
          candidates: needsValues ? candidates : undefined,
          recipientCode: needsCode ? code : undefined,
          recipientFingerprint: needsCode ? verifiedRecipient?.fingerprint : undefined,
          publicRecipient: action === "unshield" ? withdrawalRecipient : personHash,
          fundingEntry: entry,
          rootVersionIndex: rootVersion ? Number(rootVersion) : undefined,
          periodDays,
          periods,
          policyHandle:
            policyHandle ||
            (draftPolicy.current?.key === draftKey ? draftPolicy.current.handle : undefined),
          claimHandle,
          periodIndices: claimPeriods,
        },
        { timeoutMs: 1_200_000 },
      );
      if (current()) {
        setPreview(result);
        if (action === "fund" && !policyHandle && result.policyHandle) {
          draftPolicy.current = { handle: result.policyHandle, key: draftKey };
          setDraftPolicyHandle(result.policyHandle);
        }
      }
    }, tr("preparing"));
  }
  async function confirm() {
    if (!preview || !signer || submissionPending) return;
    const confirmed = preview,
      chosen = signer,
      generation = getShieldedAssetWorkerGeneration();
    await run(async (current) => {
      const result = await shieldedAssetWorkerCall(
        "prove",
        { handle: confirmed.handle, context },
        { timeoutMs: 1_200_000 },
      );
      const assertCurrent = () => {
        if (!current() || generation !== getShieldedAssetWorkerGeneration())
          throw new Error(t("shielded.unlockRequired"));
        if (walletRef.current.signer !== chosen || walletRef.current.account !== account)
          throw new Error(t("shielded.walletChanged"));
      };
      assertCurrent();
      const txId = `shielded:${modules.chainId}:${Date.now()}:${confirmed.handle}`,
        label = `${modules.assetSymbol} · ${t(`shielded.actions.${result.action}`, { symbol: modules.assetSymbol })}`;
      const common = {
        pool: modules.pool,
        signer: chosen,
        expectedChainId: modules.chainId,
        data: result.data,
        preparedProof: result.proof,
        onStage: (next: string) => {
          if (next !== "confirming") assertCurrent();
          if (current()) setStage(t(`shielded.stages.${next}`));
        },
        onBroadcast: (hash: string) => {
          trackBroadcast(chosen.provider!, hash, txId, label);
        },
        onSubmitting: (metadata: { nonce: number; fromBlock: number; signerAddress: string }) => {
          assertCurrent();
          receiptTracking.current = {
            provider: chosen.provider!,
            chainId: modules.chainId,
            id: txId,
            label,
            ...metadata,
            pool: modules.pool,
            outputCommitments: result.data.outputCommitments.map((value) =>
              getBigInt(value).toString(),
            ),
          };
          txCenter?.upsert({
            id: txId,
            kind: "shielded",
            label,
            phase: "busy",
            shieldedSubmission: {
              chainId: String(modules.chainId),
              poolAddress: modules.poolAddress,
              kind: "action",
              ...metadata,
              outputCommitments: receiptTracking.current.outputCommitments,
            },
          });
          if (mounted.current) {
            setTransactionHash("");
            setTransactionPending(true);
            setPreview(null);
          }
        },
        onGasEstimate: async (review: ShieldedGasReview) => {
          assertCurrent();
          setGasReview(review);
          setStage(tr("reviewGas"));
          latestSession.current.setBusy(false);
          const approved = await new Promise<boolean>((resolve) => {
            gasDecision.current = resolve;
          });
          gasDecision.current = null;
          if (mounted.current) setGasReview(null);
          assertCurrent();
          latestSession.current.setBusy(true);
          if (!approved) throw new Error(tr("cancelled"));
        },
      };
      let sent;
      try {
        sent =
          result.action === "shield"
            ? await submitShield({ ...common, amount: result.amount, assetKind: modules.assetKind })
            : result.action === "fund"
              ? await submitFund(common)
              : result.action === "claim"
                ? await submitClaim(common)
                : result.action === "privateTransfer"
                  ? await submitPrivateTransfer(common)
                  : await submitUnshield({
                      ...common,
                      amount: result.amount,
                      recipient: result.recipient!,
                    });
      } catch (cause) {
        rejectKnownWalletRequest(cause, txId);
        if (current()) setPreview(null);
        throw cause;
      }
      recordReceipt(sent.transactionHash, sent.receipt.status, { id: txId, label });
      if (current()) {
        setTransactionHash(sent.transactionHash);
        setTransactionPending(false);
        setWallet(null);
        setCandidates([]);
        setPreview(null);
      }
      if (sent.receipt.status !== 1)
        throw new Error(t("shielded.transactionFailed", { hash: sent.transactionHash }));
      if (result.action === "shield") publicActivityAddresses.add(account.toLowerCase());
    }, t("shielded.stages.proving"));
  }
  const field = (label: string, value: string, change: (value: string) => void, type = "text") => (
    <FieldBlock label={tr(label)} htmlFor={`${formId}-${label}`}>
      <input
        id={`${formId}-${label}`}
        className={INPUT}
        type={type}
        value={value}
        disabled={busy}
        onChange={(event) => change(event.target.value)}
      />
    </FieldBlock>
  );
  const button = (label: string, click: () => void, disabled = false) => (
    <PanelButton disabled={busy || disabled} onClick={click}>
      {tr(label)}
    </PanelButton>
  );
  return (
    <div className="min-w-0 space-y-6">
      {assetControls}
      <PanelShell title={tr("keysTitle")}>
        <p className="text-sm text-ink-muted">{tr("identityNoBackup")}</p>
        {session.identity ? (
          <p className="break-all text-sm">
            {session.identity.identity.fullName} · {session.identity.personHash}
          </p>
        ) : (
          <>
            <PersonHashCalculator
              ref={identityForm}
              computeHash={false}
              showTitle={false}
              collapsible={false}
              showPassphraseGuidance={false}
            />
            {button("unlockIdentity", () => void unlock())}
          </>
        )}
        {hasSession || busy ? (
          <PanelButton disabled={false} onClick={lock}>
            {tr("lock")}
          </PanelButton>
        ) : null}
        <p className="text-xs text-ink-muted">{tr("slotRelock")}</p>
        <FieldBlock label={tr("slot")} htmlFor={`${formId}-slot`}>
          <select
            id={`${formId}-slot`}
            className={INPUT}
            value={slot}
            disabled={busy}
            onChange={(event) => {
              lock();
              setSlot(event.target.value as ShieldedKeySlot);
              setCandidates([]);
            }}
          >
            <option value="identity">{tr("identitySlot")}</option>
            <option value="asset">{tr("assetSlot")}</option>
          </select>
        </FieldBlock>
        {session.funds ? (
          <div className="space-y-2">
            <p className="break-all text-xs">
              {tr("fundsFingerprint")}: {session.funds.fundsFingerprint}
            </p>
            <p className="text-xs">
              {tr(
                session.funds.rootSource === "random"
                  ? "randomSource"
                  : session.funds.rootSource === "walletSignature"
                    ? "signatureSource"
                    : "importedSource",
              )}{" "}
              · {tr(session.funds.recoveryVerified ? "verified" : "needsVerification")}
            </p>
            {session.funds.signerAddress ? (
              <p className="break-all text-xs">
                {tr("sourceWallet")}: {session.funds.signerAddress}
              </p>
            ) : null}
            <p className="text-xs text-ink-muted">{tr("independentBackupGate")}</p>
            <FieldBlock label={tr("backupFormat")} htmlFor={`${formId}-backupFormat`}>
              <select
                id={`${formId}-backupFormat`}
                className={INPUT}
                value={backupFormat}
                disabled={busy}
                onChange={(event) => {
                  clearSecretInputs();
                  setBackupFormat(event.target.value as RecoveryFormat);
                  setExportedFingerprint("");
                  setExternalSaved(false);
                  setVerificationStarted(false);
                }}
              >
                <option value="mnemonic">{tr("mnemonicFormat")}</option>
                <option value="shieldedKey">{tr("shieldedKeyFormat")}</option>
              </select>
            </FieldBlock>
            {button("exportRecovery", () => void exportRecoveryMaterial(), !recoveryInfoReady)}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">{tr("newWalletExplanation")}</p>
            <FieldBlock label={tr("newSource")} htmlFor={`${formId}-newSource`}>
              <select
                id={`${formId}-newSource`}
                className={INPUT}
                value={rootSource}
                disabled={busy}
                onChange={(event) => setRootSource(event.target.value as typeof rootSource)}
              >
                <option value="random">{tr("randomSource")}</option>
                <option value="walletSignature">{tr("signatureSource")}</option>
              </select>
            </FieldBlock>
            {button("createNew", () => void createFunds())}
          </div>
        )}
        <div className="space-y-3 border-t border-hairline pt-4">
          <p className="text-xs text-ink-muted">{tr("recoveryFormatsExplanation")}</p>
          <p className="text-xs text-ink-muted">{tr("recoveryAuthority")}</p>
          <label className="block text-sm">
            {tr("exportedRecoveryMaterial")}
            <textarea
              ref={exportedMaterial}
              readOnly
              spellCheck={false}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-hairline p-3 font-mono text-xs"
              aria-label={tr("exportedRecoveryMaterial")}
            />
          </label>
          <p className="text-xs text-ink-muted">{tr("recoveryMaterialSecret")}</p>
          {exportedFingerprint ? (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={externalSaved}
                  disabled={verificationStarted}
                  onChange={(event) => setExternalSaved(event.target.checked)}
                />
                {tr("savedExternal")}
              </label>
              {button(
                "beginIndependentImport",
                () => {
                  lock();
                  setRestorePath(backupFormat);
                  setVerificationStarted(true);
                },
                !externalSaved || verificationStarted,
              )}
              {verificationStarted ? (
                <p role="status" className="text-xs">
                  {tr("reenterBackup")}
                </p>
              ) : null}
            </>
          ) : null}
          {button("downloadRecoveryInfo", downloadRecoveryInfo, !recoveryInfoReady)}
          <p className="text-xs text-ink-muted">{tr("recoveryInfoPublic")}</p>
          <FieldBlock label={tr("restorePath")} htmlFor={`${formId}-restorePath`}>
            <select
              id={`${formId}-restorePath`}
              className={INPUT}
              value={restorePath}
              disabled={busy}
              onChange={(event) => {
                clearSecretInputs();
                setRestorePath(event.target.value as typeof restorePath);
              }}
            >
              <option value="mnemonic">{tr("mnemonicRestore")}</option>
              <option value="shieldedKey">{tr("shieldedKeyRestore")}</option>
              <option value="signature" disabled={independentBackupPending}>
                {tr("signatureRestore")}
              </option>
            </select>
          </FieldBlock>
          {field("expectedFingerprint", expectedFingerprint, setExpectedFingerprint)}
          {restorePath !== "signature" ? (
            <>
              <label className="block text-sm">
                {tr(restorePath === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
                <textarea
                  key={restorePath}
                  ref={recoveryMaterial}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="none"
                  disabled={busy || (!!exportedFingerprint && !verificationStarted)}
                  className="mt-1 w-full rounded-lg border border-hairline p-3 font-mono text-xs"
                  aria-label={tr(restorePath === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
                />
              </label>
              <p className="text-xs text-ink-muted">
                {tr(restorePath === "mnemonic" ? "mnemonicHint" : "shieldedKeyHint")}
              </p>
              {button(
                "importRecovery",
                () => void importRecoveryMaterial(),
                !!exportedFingerprint && !verificationStarted,
              )}
            </>
          ) : (
            <>
              <pre className="whitespace-pre-wrap break-all text-xs">
                {buildShieldedAssetSigningMessage(account)}
              </pre>
              <p className="text-xs text-ink-muted">{tr("signatureWarning")}</p>
              {button(
                "restoreSignature",
                () => void requestSignature("restore"),
                !signer || independentBackupPending,
              )}
            </>
          )}
        </div>
      </PanelShell>
      <PanelShell title={tr("assetsTitle")}>
        {modules.tokenDecimals === null ? (
          <p className="text-xs text-ink-muted">{tr("rawUnits")}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {button("recover", () => void recover(), !hasSession)}
          {button("discoverAll", () => void recover(true), !hasSession)}
        </div>
        {!wallet ? (
          <p className="text-sm text-ink-muted">{tr("scanRequired")}</p>
        ) : (
          <>
            <p className="text-sm">
              {tr("valueBalance")}:{" "}
              {showAmount(values.reduce((sum, note) => sum + BigInt(note.amount), 0n).toString())}{" "}
              {modules.assetSymbol}
            </p>
            <p className="text-xs text-ink-muted">{tr("ownerGrouping")}</p>
            {wallet.notes
              .filter((note) => note.kind === "budget")
              .map((note) => (
                <p key={note.commitment} className="break-all text-xs">
                  {tr("budget")}: {showAmount(note.amount)} {modules.assetSymbol} ·{" "}
                  {tr(note.slot === "asset" ? "assetSlot" : "identitySlot")} ·{" "}
                  {note.pendingIdentity
                    ? tr("pendingIdentity")
                    : tr(
                        note.bindingKind === 1
                          ? "publicEntry"
                          : note.keyMode === 1
                            ? "independentEntry"
                            : "convenientEntry",
                      )}
                </p>
              ))}
          </>
        )}
        {discovery ? (
          <div className="space-y-2">
            <p role="status">{tr(discovery.complete ? "discoveryComplete" : "discoveryPartial")}</p>
            {discovery.pools.map((pool) => (
              <p key={pool.poolAddress} className="break-all text-xs">
                {pool.assetAddress}:{" "}
                {pool.status === "recovered"
                  ? `${tr("rawValue")}: ${pool.rawValueBalance}; ${tr("rawBudget")}: ${pool.rawBudgetBalance}`
                  : tr("poolUnknown")}
              </p>
            ))}
          </div>
        ) : null}
        {button("createCode", () => void createCode(), !slotReady || !session.identity)}
        {ownCode ? (
          <>
            <textarea
              readOnly
              className="w-full rounded-lg border border-hairline p-3 font-mono text-xs"
              value={ownCode}
              aria-label={tr("ownCode")}
            />
            <p className="break-all text-xs">
              {tr("receiveFingerprint")}: {ownFingerprint}
            </p>
          </>
        ) : null}
      </PanelShell>
      <PanelShell title={tr("actionsTitle")}>
        <p className="text-xs text-ink-muted">{tr("gasPrivacyHint")}</p>
        <FieldBlock label={tr("action")} htmlFor={`${formId}-action`}>
          <select
            id={`${formId}-action`}
            className={INPUT}
            value={action}
            disabled={busy}
            onChange={(event) => {
              setAction(event.target.value as Action);
              setCandidates([]);
            }}
          >
            {(["shield", "fund", "claim", "privateTransfer", "unshield"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`shielded.actions.${value}`, { symbol: modules.assetSymbol })}
              </option>
            ))}
          </select>
        </FieldBlock>
        {action === "fund" ? (
          <>
            <FieldBlock label={tr("fundingEntry")} htmlFor={`${formId}-fundingEntry`}>
              <select
                id={`${formId}-fundingEntry`}
                className={INPUT}
                value={entry}
                disabled={busy}
                onChange={(event) => {
                  setEntry(event.target.value as ShieldedFundingEntry);
                  setCode("");
                  setVerifiedRecipient(null);
                  setFingerprintConfirmed(false);
                }}
              >
                {(["public", "privateConvenient", "privateIndependent"] as const).map((value) => (
                  <option key={value} value={value}>
                    {tr(
                      value === "public"
                        ? "publicEntry"
                        : value === "privateConvenient"
                          ? "convenientEntry"
                          : "independentEntry",
                    )}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <p className="text-xs text-ink-muted">
              {tr(
                entry === "public"
                  ? "publicHint"
                  : entry === "privateConvenient"
                    ? "convenientHint"
                    : "independentHint",
              )}
            </p>
            <FieldBlock label={tr("policy")} htmlFor={`${formId}-policy`}>
              <select
                id={`${formId}-policy`}
                className={INPUT}
                value={policyHandle}
                disabled={busy}
                onChange={(event) => {
                  draftPolicy.current = null;
                  setDraftPolicyHandle("");
                  setPolicyHandle(event.target.value);
                }}
              >
                <option value="">{tr("newPolicy")}</option>
                {wallet?.policies.map((policy) => (
                  <option key={policy.handle} value={policy.handle}>
                    {shortHex(policy.handle)} · {showAmount(policy.amountPerPeriod)} /{" "}
                    {policy.periodDays}
                  </option>
                ))}
              </select>
            </FieldBlock>
            {!policyHandle && draftPolicyHandle ? (
              <div className="space-y-2">
                <p className="break-all text-xs">
                  {tr("draftPolicy")}: {draftPolicyHandle}
                </p>
                {button("discardDraft", () => {
                  draftPolicy.current = null;
                  setDraftPolicyHandle("");
                  setPreview(null);
                  void cancelShieldedAssetPreview().catch(() => undefined);
                })}
              </div>
            ) : null}
            {!selectedPolicy ? (
              <>
                <FieldBlock label={tr("familyVersion")} htmlFor={`${formId}-familyVersion`}>
                  <select
                    id={`${formId}-familyVersion`}
                    className={INPUT}
                    value={rootVersion}
                    disabled={busy}
                    onChange={(event) => setRootVersion(event.target.value)}
                  >
                    <option value="">{tr("select")}</option>
                    {wallet?.parentVersions.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </FieldBlock>
                {field("periodDays", periodDays, setPeriodDays)}
              </>
            ) : null}
            <FieldBlock label={tr("child")} htmlFor={`${formId}-child`}>
              <select
                id={`${formId}-child`}
                className={INPUT}
                value={personHash}
                disabled={busy}
                onChange={(event) => setPersonHash(event.target.value)}
              >
                <option value="">{tr("select")}</option>
                {Array.from(
                  new Set([
                    ...(wallet?.children
                      .filter(
                        (child) =>
                          child.eligible &&
                          String(child.rootVersionIndex) ===
                            (selectedPolicy?.rootVersionIndex ?? rootVersion),
                      )
                      .map((child) => child.personHash) ?? []),
                    ...(wallet?.templates
                      .filter((item) => item.policyHandle === policyHandle)
                      .map((item) => item.personHash) ?? []),
                  ]),
                ).map((hash) => (
                  <option key={hash} value={hash}>
                    {hash}
                  </option>
                ))}
              </select>
            </FieldBlock>
            {field("periods", periods, setPeriods)}
            {template ? (
              <p className="text-xs text-ink-muted">
                {tr("originalTemplate")}: {template.handle}
              </p>
            ) : null}
            {entry === "privateConvenient" && !template ? (
              <details className="space-y-3">
                <summary className="cursor-pointer text-sm">{tr("generateConvenient")}</summary>
                <p className="text-xs text-ink-muted">{tr("convenientHint")}</p>
                <ShieldedRecipientCredentialsForm ref={recipientForm} />
                {button("generate", () => void generateConvenientCode())}
              </details>
            ) : null}
          </>
        ) : null}
        {needsCode ? (
          <div className="space-y-3">
            <FieldBlock label={tr("receiveCode")} htmlFor={`${formId}-receiveCode`}>
              <textarea
                id={`${formId}-receiveCode`}
                className="w-full rounded-lg border border-hairline p-3 font-mono text-xs"
                value={code}
                disabled={busy}
                onChange={(event) => {
                  setCode(event.target.value);
                  setVerifiedRecipient(null);
                  setFingerprintConfirmed(false);
                }}
              />
            </FieldBlock>
            {button("verifyCode", () => void checkCode(), !code)}
            {verifiedRecipient ? (
              <>
                <p className="break-all text-xs">
                  {verifiedRecipient.personHash} ·{" "}
                  {tr(verifiedRecipient.keyMode === 1 ? "assetSlot" : "identitySlot")} ·{" "}
                  {verifiedRecipient.fingerprint}
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={fingerprintConfirmed}
                    onChange={(event) => setFingerprintConfirmed(event.target.checked)}
                  />
                  {tr("fingerprintChecked")}
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        {action !== "claim" && !(action === "fund" && selectedPolicy)
          ? field(action === "fund" ? "rate" : "amount", amount, setAmount)
          : null}
        {action === "shield" && modules.assetKind === "erc20" ? (
          <>
            <p className="text-xs text-ink-muted">{tr("approveBeforeUnlock")}</p>
            {button("approve", () => void approve(), submissionPending || !signer || !amount)}
          </>
        ) : null}
        {needsValues ? (
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-sm font-medium">{tr("candidateNotes")}</legend>
            <p className="text-xs text-ink-muted">{tr("candidateHint")}</p>
            {values.map((note) => (
              <label key={note.commitment} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={candidates.includes(note.commitment)}
                  onChange={(event) =>
                    setCandidates((previous) =>
                      event.target.checked
                        ? [...previous, note.commitment]
                        : previous.filter((item) => item !== note.commitment),
                    )
                  }
                />
                {showAmount(note.amount)} {modules.assetSymbol} · {shortHex(note.commitment)}
              </label>
            ))}
            {button(
              "selectAllCandidates",
              () => setCandidates(values.map((note) => note.commitment)),
              !values.length,
            )}
          </fieldset>
        ) : null}
        {action === "unshield"
          ? field("withdrawalRecipient", withdrawalRecipient, setWithdrawalRecipient)
          : null}
        {action === "claim" ? (
          <>
            <FieldBlock label={tr("claimBudget")} htmlFor={`${formId}-claimBudget`}>
              <select
                id={`${formId}-claimBudget`}
                className={INPUT}
                value={claimHandle}
                disabled={busy}
                onChange={(event) => {
                  setClaimHandle(event.target.value);
                  setClaimPeriods(
                    claims.find((claim) => claim.handle === event.target.value)?.periodIndices ??
                      [],
                  );
                }}
              >
                <option value="">{tr("select")}</option>
                {claims.map((claim) => (
                  <option key={claim.handle} value={claim.handle}>
                    {claim.status} · {showAmount(claim.amount)} {modules.assetSymbol}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <fieldset className="space-y-2" disabled={busy}>
              <legend className="text-sm">{tr("claimPeriods")}</legend>
              {selectedClaim?.periodIndices.map((index) => (
                <label key={index} className="mr-4 inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={claimPeriods.includes(index)}
                    onChange={(event) =>
                      setClaimPeriods((previous) =>
                        event.target.checked
                          ? [...previous, index].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
                          : previous.filter((value) => value !== index),
                      )
                    }
                  />
                  {Number(index) + 1}
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {button(
          "preview",
          () => void prepare(),
          submissionPending ||
            !slotReady ||
            !signer ||
            (action === "claim" && (!session.identity || !claimPeriods.length)),
        )}
        {preview ? (
          <div className="space-y-3 rounded-xl border border-hairline p-4">
            <p className="text-sm font-medium">
              {tr("reviewPlan")}: {showAmount(preview.amount)} {modules.assetSymbol}
            </p>
            {preview.recipient ? (
              <p className="break-all text-xs">
                {tr("destination")}: {preview.recipient}
              </p>
            ) : null}
            <ol className="list-inside list-decimal space-y-2 text-xs">
              {preview.steps.map((step, index) => (
                <li key={index}>
                  {t(`shielded.actions.${step.action}`, { symbol: modules.assetSymbol })} ·{" "}
                  {step.inputs.map((input) => shortHex(input)).join(", ")} →{" "}
                  {step.outputAmounts.map(showAmount).join(" + ")} {modules.assetSymbol}
                </li>
              ))}
            </ol>
            <p className="text-xs text-ink-muted">{tr("gasEachStep")}</p>
            {button("confirmStep", () => void confirm(), submissionPending)}
          </div>
        ) : null}
      </PanelShell>
      {gasReview ? (
        <PanelShell title={tr("reviewGas")}>
          <p className="text-sm">
            {tr("gasLimit")}: {gasReview.gasLimit.toString()}
          </p>
          <p className="text-sm">
            {tr("maximumGasFee")}: {formatUnits(gasReview.maximumGasFee, 18)} {tr("nativeGasUnit")}
          </p>
          <p className="text-xs text-ink-muted">{tr("gasQuoteHint")}</p>
          <div className="flex flex-wrap gap-3">
            <PanelButton onClick={() => gasDecision.current?.(true)}>
              {tr("confirmGas")}
            </PanelButton>
            <PanelButton onClick={lock}>{tr("cancel")}</PanelButton>
          </div>
        </PanelShell>
      ) : null}
      {stage ? (
        <p role="status" className="text-sm text-ink-muted">
          {stage}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {transactionHash || submissionPending ? (
        <div className="space-y-2">
          <p className="break-all text-xs">
            {transactionHash
              ? `${tr("transactionHash")}: ${transactionHash} · `
              : `${tr("submissionUnknown")} · `}
            {tr(submissionPending ? "pendingTransaction" : "receiptChecked")}
          </p>
          {submissionPending ? button("checkReceipt", () => void checkReceipt()) : null}
        </div>
      ) : null}
    </div>
  );
}
