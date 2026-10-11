import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { buildShieldedAssetSigningMessage } from "@deepfamily/protocol-core";
import {
  formatUnits,
  getBigInt,
  getAddress,
  parseUnits,
  toUtf8Bytes,
  ZeroAddress,
  type ContractTransactionResponse,
  type Provider,
  type Signer,
} from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useConfig } from "../../config";
import { useTreeGraphData } from "../../tree/context";
import { getShieldedLocalRecipientLabels } from "../services/shieldedRecipientOptions";
import { useTransactionCenter } from "../../transactions";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { getShieldedPoolFactoryDeploymentBlock } from "../../../shared/config/env";
import { SUPPORTED_NETWORKS } from "../../../shared/config/networks";
import {
  cancelShieldedAssetPreview,
  getShieldedAssetWorkerGeneration,
  shieldedAssetWorkerCall,
  subscribeShieldedAssetWorkerLock,
} from "../../../shared/workers/shieldedAssetWorkerClient";
import type {
  ShieldedAssetActionRequest,
  ShieldedAssetSessionState,
  ShieldedAssetWorkerCallMap,
  ShieldedFundingEntry,
  ShieldedKeySlot,
  ShieldedWalletSummary,
  ShieldedWorkerContext,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import {
  createShieldedReceiveCodeForRecipient,
  verifyShieldedReceiveCode,
  peekShieldedReceiveCodePersonHash,
  type VerifiedShieldedRecipient,
} from "../services/shieldedReceiveCode";
import {
  submitShield,
  submitFund,
  submitClaim,
  submitPrivateTransfer,
  submitUnshield,
} from "../services/shieldedPoolFlows";
import {
  readShieldedSubmissionOutcome,
  type ShieldedSubmissionTracking,
} from "../services/shieldedSubmissionTracking";
import { useShieldedPageIdentitySession } from "./ShieldedIdentitySessionContext";
import { type ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";
import { PanelButton, FieldBlock, PanelShell, WarningNotice } from "./inheritanceControls";
import { ShieldedTaskNavigation } from "./ShieldedTaskNavigation";
import { ShieldedAssetOverview } from "./ShieldedAssetOverview";
import { ShieldedWalletActions, type ShieldedRecipientInputMethod } from "./ShieldedWalletActions";
import { ShieldedBudgetActions } from "./ShieldedBudgetActions";
import { ShieldedFundsKeyManager } from "./ShieldedFundsKeyManager";
const INPUT =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";
type Action = ShieldedAssetActionRequest["action"] | "receiveCode";
type RecoveryFormat = "mnemonic" | "shieldedKey";
export interface ShieldedPanelNavigation {
  slot: ShieldedKeySlot;
  action: Action;
  walletAction: Action;
  receiveSlot?: ShieldedKeySlot;
  /** The first scan or a user choice has settled the task; later pools keep it. */
  taskChosen?: boolean;
}

/** React keeps public handles and display amounts. Keys and note openings stay in the asset Worker. */
export function ShieldedInheritancePanel({
  modules,
  signer,
  account,
  publicActivityAddresses,
  assetControls,
  navigation,
  onNavigationChange,
}: {
  modules: ShieldedPageModules;
  signer: Signer | null;
  account: string;
  publicActivityAddresses: Set<string>;
  assetControls?: ReactNode;
  navigation?: ShieldedPanelNavigation;
  onNavigationChange?: (navigation: ShieldedPanelNavigation) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const config = useConfig();
  const { nodesData } = useTreeGraphData();
  const localRecipientLabels = useMemo(
    () => getShieldedLocalRecipientLabels(nodesData),
    [nodesData],
  );
  const session = useShieldedPageIdentitySession();
  const latestSession = useRef(session);
  latestSession.current = session;
  const txCenter = useTransactionCenter();
  const latestTxCenter = useRef(txCenter);
  latestTxCenter.current = txCenter;
  const latestTranslations = useRef({ t, tr });
  latestTranslations.current = { t, tr };
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const [identityFormEpoch, setIdentityFormEpoch] = useState(0);
  const recipientForm = useRef<ShieldedRecipientCredentialsFormHandle>(null);
  const exportedMaterial = useRef<HTMLTextAreaElement>(null);
  const recoveryMaterial = useRef<HTMLTextAreaElement>(null);
  const accessRegion = useRef<HTMLDivElement>(null);
  const taskRegion = useRef<HTMLDivElement>(null);
  const focusDestination = useRef<"access" | "task" | null>(null);
  const mounted = useRef(false),
    running = useRef(false),
    job = useRef(0),
    signatureRequest = useRef(0);
  const waitingSignatureRequest = useRef<number | null>(null);
  const walletRef = useRef({ signer, account });
  walletRef.current = { signer, account };
  const previousGasWallet = useRef({ signer, account });
  const receiptTracking = useRef<(ShieldedSubmissionTracking & {
    id: string;
    label: string;
    kind: "action" | "approval";
  }) | null>(null);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState(""),
    [transactionPending, setTransactionPending] = useState(false);
  const [transactionResult, setTransactionResult] = useState<"done" | "failed" | "unknown" | null>(null);
  const pendingRecord = txCenter?.records.find(
    (record) =>
      record.kind === "shielded" &&
      record.phase === "busy" &&
      record.shieldedSubmission?.chainId === String(modules.chainId) &&
      record.shieldedSubmission.poolAddress.toLowerCase() === modules.poolAddress.toLowerCase(),
  );
  const submissionPending = transactionPending || !!pendingRecord;
  // Three independent choices: the funds that pay (or receive a deposit), the
  // receive-code type and the claim filter. Changing one never changes another.
  const [slot, setSlot] = useState<ShieldedKeySlot>(navigation?.slot ?? "identity");
  const [codeSlot, setCodeSlot] = useState<ShieldedKeySlot>("identity");
  const [walletScreen, setWalletScreen] = useState<"workspace" | "manage" | "identity">(
    "workspace",
  );
  const [fundsFlow, setFundsFlow] = useState<"restore" | "create" | "backup">(() =>
    session.funds?.backupRequired ? "backup" : "restore",
  );
  const [receiveSlot, setReceiveSlot] = useState<ShieldedKeySlot>(
    navigation?.receiveSlot ?? (navigation?.action === "claim" ? navigation.slot : "identity"),
  );
  const [rootSource, setRootSource] = useState<"random" | "walletSignature">("random");
  const [expectedFingerprint, setExpectedFingerprint] = useState(""),
    [exportedFingerprint, setExportedFingerprint] = useState("");
  const [backupFormat, setBackupFormat] = useState<RecoveryFormat>("mnemonic");
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [recoveryScanned, setRecoveryScanned] = useState(false);
  const [externalSaved, setExternalSaved] = useState(false),
    [restorePath, setRestorePath] = useState<RecoveryFormat | "signature">("mnemonic");
  const [wallet, setWallet] = useState<ShieldedWalletSummary | null>(null);
  const [discovery, setDiscovery] = useState<
    ShieldedAssetWorkerCallMap["discover"]["result"] | null
  >(null);
  const [action, setAction] = useState<Action>(() =>
    !session.identity && session.funds?.recoveryVerified && !session.funds.backupRequired
      ? "privateTransfer"
      : (navigation?.action ?? "shield"),
  );
  const [amounts, setAmounts] = useState<Partial<Record<Action, string>>>({});
  const amount = amounts[action] ?? "";
  const setAmount = (value: string) => setAmounts((previous) => ({ ...previous, [action]: value }));
  const [taskChosen, setTaskChosen] = useState(navigation?.taskChosen ?? !!navigation);
  const autoRecoveryScope = useRef("");
  const autoRecoveryBlocked = useRef(false);
  const fundsOpenedFromWorkspace = useRef(false);
  const [recipientInputMethod, setRecipientInputMethod] =
    useState<ShieldedRecipientInputMethod>("receiveCode");
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const [codeError, setCodeError] = useState("");
  const walletAction = useRef<Action>(navigation?.walletAction ?? "shield");
  useEffect(() => {
    onNavigationChange?.({
      slot,
      action,
      walletAction: walletAction.current,
      receiveSlot,
      taskChosen,
    });
  }, [slot, action, receiveSlot, taskChosen, onNavigationChange]);
  const [entry, setEntry] = useState<ShieldedFundingEntry>("privateIndependent");
  const [rootVersion, setRootVersion] = useState(""),
    [periodDays, setPeriodDays] = useState("30"),
    [periods, setPeriods] = useState("1");
  const [policyHandle, setPolicyHandle] = useState(""),
    [personHash, setPersonHash] = useState(""),
    [code, setCode] = useState("");
  const draftPolicy = useRef<{ handle: string; key: string } | null>(null);
  const [verifiedRecipient, setVerifiedRecipient] = useState<VerifiedShieldedRecipient | null>(
    null,
  );
  const [ownCode, setOwnCode] = useState("");
  const [withdrawalRecipient, setWithdrawalRecipient] = useState(""),
    [candidates, setCandidates] = useState<string[]>([]);
  const [claimHandle, setClaimHandle] = useState(""),
    [claimPeriods, setClaimPeriods] = useState<string[]>([]);
  // Transactions in a multi-step plan, shown while one confirmation sends them all.
  const [planCount, setPlanCount] = useState(0);
  const [allowanceReady, setAllowanceReady] = useState(modules.assetKind === "native");
  const [allowanceRevision, setAllowanceRevision] = useState(0);
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
  const independentBackupPending = !!exportedFingerprint || !!session.funds?.backupRequired;
  const accessFlow = independentBackupPending
    ? "backup"
    : fundsFlow === "backup" && !session.funds
      ? "restore"
      : fundsFlow;
  const fundsReady = !!session.funds?.recoveryVerified && !session.funds.backupRequired;
  // Identity funds pay until a verified independent root is loaded.
  const paymentSlot: ShieldedKeySlot = !session.identity ? "asset" : fundsReady ? slot : "identity";
  const actionSlot: ShieldedKeySlot =
    action === "claim" ? receiveSlot : action === "receiveCode" ? codeSlot : paymentSlot;
  const slotReady = actionSlot === "identity" ? !!session.identity : fundsReady;
  const workspaceVisible = (!!session.identity || fundsReady) && walletScreen === "workspace";
  // Key management opened from a task stays in that task's container, including
  // the backup drill that temporarily removes the funds root from the Worker.
  const fundsInWorkspace = walletScreen === "manage" && fundsOpenedFromWorkspace.current;
  const showWorkspace =
    workspaceVisible ||
    fundsInWorkspace ||
    (walletScreen === "workspace" && fundsOpenedFromWorkspace.current && independentBackupPending);
  const identityAccess = walletScreen !== "manage";
  const overviewHash =
    session.identity?.personHash ??
    session.funds?.fundsFingerprint ??
    (exportedFingerprint || expectedFingerprint || "—");
  // The overview totals every loaded slot; payments still use one owner at a time.
  const valueTotals = { identity: 0n, asset: 0n };
  let budgetTotal = 0n;
  for (const note of wallet?.notes ?? []) {
    if (!(note.slot === "identity" ? session.identity : fundsReady)) continue;
    if (note.kind === "value") valueTotals[note.slot] += BigInt(note.amount);
    else if (!note.pendingIdentity) budgetTotal += BigInt(note.amount);
  }
  useEffect(() => {
    const target =
      focusDestination.current === "access" && !showWorkspace
        ? accessRegion.current
        : focusDestination.current === "task" && showWorkspace
          ? taskRegion.current
          : null;
    if (target && document.visibilityState === "visible") {
      target.focus({ preventScroll: fundsInWorkspace });
      focusDestination.current = null;
    }
  }, [showWorkspace, walletScreen, fundsInWorkspace]);
  const showAmount = (value: string) => formatUnits(BigInt(value), modules.tokenDecimals ?? 0);
  const values =
    wallet?.notes.filter(
      (note) =>
        note.kind === "value" &&
        (note.slot === paymentSlot ||
          (paymentSlot === "asset" && note.ownerCommitment === session.funds?.ownerCommitment)) &&
        BigInt(note.amount) > 0n,
    ) ?? [];
  const claims = wallet?.claims.filter((claim) => claim.slot === receiveSlot) ?? [];
  const selectedClaim = claims.find((claim) => claim.handle === claimHandle);
  const selectedPolicy = wallet?.policies.find((policy) => policy.handle === policyHandle);
  const template = wallet?.templates.find(
    (item) =>
      item.policyHandle === policyHandle &&
      item.personHash.toLowerCase() === personHash.toLowerCase(),
  );
  const effectiveEntry: ShieldedFundingEntry = template
    ? template.bindingKind === 1
      ? "public"
      : template.keyMode === 1
        ? "privateIndependent"
        : "privateConvenient"
    : entry;
  const needsCode =
    action === "privateTransfer" || (action === "fund" && effectiveEntry !== "public" && !template);
  const needsValues = ["fund", "privateTransfer", "unshield"].includes(action);
  const recipientTargetHash = peekShieldedReceiveCodePersonHash(code);
  const recipientTargetName = recipientTargetHash
    ? localRecipientLabels.get(recipientTargetHash.toLowerCase())
    : undefined;
  const recipientNeedsConfirmation =
    action === "privateTransfer" &&
    recipientInputMethod === "receiveCode" &&
    !!recipientTargetHash &&
    !recipientTargetName;
  const recipientMatches =
    !!verifiedRecipient &&
    (action !== "fund" ||
      (verifiedRecipient.personHash.toLowerCase() === personHash.toLowerCase() &&
        verifiedRecipient.keyMode === (effectiveEntry === "privateIndependent" ? 1 : 0)));
  const recipientReady =
    recipientMatches &&
    recipientInputMethod === "receiveCode" &&
    (!recipientNeedsConfirmation || recipientConfirmed);
  const privateAccountWarning =
    ["fund", "claim", "privateTransfer", "unshield"].includes(action) &&
    publicActivityAddresses.has(account.toLowerCase());
  let fundingDeficit: string | undefined;
  if (action === "fund") {
    const balance = values.reduce((sum, note) => sum + BigInt(note.amount), 0n);
    try {
      const rate = selectedPolicy
        ? BigInt(selectedPolicy.amountPerPeriod)
        : parseUnits(amount, modules.tokenDecimals ?? 0);
      const required = rate * BigInt(periods);
      if (balance < required) fundingDeficit = (required - balance).toString();
      else if (balance === 0n) fundingDeficit = "0";
    } catch {
      if (balance === 0n) fundingDeficit = "0";
    }
  }
  const actionRequestKey = JSON.stringify([
    contextKey,
    session.identity?.handle,
    session.funds?.fundsFingerprint,
    action,
    actionSlot,
    amount,
    candidates,
    code,
    effectiveEntry,
    template?.handle,
    template?.ownerCommitment,
    rootVersion,
    periodDays,
    periods,
    policyHandle,
    personHash,
    claimHandle,
    claimPeriods,
    withdrawalRecipient,
    recipientConfirmed,
    verifiedRecipient?.fingerprint,
    recipientInputMethod,
  ]);
  const currentRequestKey = useRef(actionRequestKey);
  currentRequestKey.current = actionRequestKey;
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
    // StrictMode and Fast Refresh re-run this effect on the same instance; an
    // operation it already started stays current and keeps the session busy.
    if (running.current) latestSession.current.setBusy(true);
    const clear = () => clearRef.current();
    const hidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (latestSession.current.isWalletRequestPending()) {
        clear();
        return;
      }
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
      autoRecoveryBlocked.current = true;
      fundsOpenedFromWorkspace.current = false;
      clear();
      if (mounted.current) setWalletScreen("workspace");
    });
    return () => {
      // After a real unmount, mounted.current already rejects late results.
      mounted.current = false;
      signatureRequest.current++;
      clear();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      unsubscribeLock();
      latestSession.current.setBusy(false);
      void cancelShieldedAssetPreview().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (previousContextKey.current !== contextKey) {
      previousContextKey.current = contextKey;
      lockRef.current();
      receiptTracking.current = null;
      setTransactionHash("");
      setTransactionPending(false);
      setTransactionResult(null);
    }
    setWallet(null);
    setDiscovery(null);
    setCandidates([]);
    setOwnCode("");
    draftPolicy.current = null;
  }, [session.identity?.handle, session.funds?.fundsFingerprint, contextKey]);
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
      kind: metadata.kind,
      hash: pendingRecord.transactionHash,
      nonce: metadata.nonce,
      signerAddress: metadata.signerAddress,
      fromBlock: metadata.fromBlock,
      ...(metadata.kind === "action"
        ? { pool: modules.pool, outputCommitments: metadata.outputCommitments }
        : {}),
    };
    setTransactionHash(pendingRecord.transactionHash ?? "");
    setTransactionResult(null);
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
    running.current = false;
    setBusy(false);
    setStage("");
    setPlanCount(0);
    latestSession.current.setBusy(false);
    void cancelShieldedAssetPreview().catch(() => undefined);
  }, [signer, account]);
  useEffect(() => {
    if (draftPolicy.current?.key !== draftKey) {
      draftPolicy.current = null;
    }
  }, [draftKey]);
  useEffect(() => {
    setOwnCode("");
  }, [codeSlot]);
  // A fingerprint learned from creating a root, or from a fingerprint-checked import or
  // re-sign, checks later re-entry in this session; a lock forgets it for another key.
  useEffect(() => {
    if (!session.identity && !session.funds) setExpectedFingerprint("");
  }, [session.identity, session.funds]);
  useEffect(() => {
    const first =
      wallet?.claims.find((claim) => claim.slot === receiveSlot && claim.status === "claimable") ??
      wallet?.claims.find((claim) => claim.slot === receiveSlot);
    setClaimHandle(first?.handle ?? "");
    setClaimPeriods(first?.periodIndices ?? []);
  }, [receiveSlot, wallet]);
  useEffect(() => {
    void cancelShieldedAssetPreview().catch(() => undefined);
  }, [actionRequestKey]);
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
  }, [modules, account, signer, amount, allowanceRevision]);

  useEffect(() => {
    // Normal submissions await their own receipts, including every step in a
    // plan. Reconcile public state only after that operation finishes or stops.
    if (busy || !submissionPending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scope = contextKey;
    const current = () => !cancelled && mounted.current && contextRef.current === scope;
    const poll = async () => {
      const tracked = receiptTracking.current;
      if (!tracked) return;
      const generation = getShieldedAssetWorkerGeneration();
      const identityHandle = latestSession.current.identity?.handle;
      const fundsFingerprint = latestSession.current.funds?.fundsFingerprint;
      try {
        if (running.current) return;
        const outcome = await readShieldedSubmissionOutcome(tracked);
        if (!current() || receiptTracking.current !== tracked || running.current) return;
        if (outcome.status === "pending") {
          if (outcome.hash && outcome.hash !== tracked.hash) {
            tracked.hash = outcome.hash;
            latestTxCenter.current?.upsert({
              id: tracked.id,
              kind: "shielded",
              label: tracked.label,
              phase: "busy",
              transactionHash: outcome.hash,
            });
            setTransactionHash(outcome.hash);
          }
          return;
        }
        const successful = outcome.status === "confirmed" && outcome.receiptStatus === 1;
        // A consumed approval nonce does not establish which transaction mined.
        // Read back the allowance without reporting an unobserved receipt as failed.
        const unknownApproval = tracked.kind === "approval" && outcome.status === "replaced";
        latestTxCenter.current?.upsert({
          id: tracked.id,
          kind: "shielded",
          label: tracked.label,
          phase: successful ? "done" : "failed",
          error: unknownApproval
            ? {
                type: "transaction",
                message: latestTranslations.current.t("transaction.unknown"),
                details: "",
              }
            : null,
          ...(outcome.status === "confirmed" ? { transactionHash: outcome.hash } : {}),
        });
        receiptTracking.current = null;
        setTransactionPending(false);
        setTransactionResult(successful ? "done" : unknownApproval ? "unknown" : "failed");
        if (outcome.status === "confirmed") setTransactionHash(outcome.hash);
        setError(
          successful || unknownApproval
            ? ""
            : outcome.status === "replaced"
              ? latestTranslations.current.tr("nonceConsumed")
              : latestTranslations.current.t("shielded.transactionFailed", { hash: outcome.hash }),
        );
        if (tracked.kind === "approval") setAllowanceRevision((revision) => revision + 1);
        // A public result must not clear a newer secret session's selection.
        if (
          generation === getShieldedAssetWorkerGeneration() &&
          identityHandle === latestSession.current.identity?.handle &&
          fundsFingerprint === latestSession.current.funds?.fundsFingerprint
        ) {
          autoRecoveryScope.current = "";
          setWallet(null);
          setCandidates([]);
        }
      } catch {
        // A transient RPC failure leaves the submission blocked and retries.
      } finally {
        if (current() && receiptTracking.current === tracked)
          timer = setTimeout(() => void poll(), 5_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, submissionPending, contextKey, transactionHash, pendingRecord?.id]);
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
        if (current()) {
          latestSession.current.update(state);
          latestSession.current.rememberIdentityDraft({
            fullName: identity.fullName,
            isBirthBC: identity.isBirthBC,
            birthYear: identity.birthYear,
            birthMonth: identity.birthMonth,
            birthDay: identity.birthDay,
            gender: identity.gender,
          });
          autoRecoveryBlocked.current = false;
          focusDestination.current = "task";
          // Without a verified independent root, payments and receive codes use identity
          // funds. The claim filter is kept, so a missing original key is offered for restore.
          if (!(state.funds?.recoveryVerified && !state.funds.backupRequired)) {
            setSlot("identity");
            setCodeSlot("identity");
          }
          setWalletScreen("workspace");
        }
      } finally {
        rawPassphrase = "";
      }
    }, tr("unlocking"));
  }
  function lock() {
    autoRecoveryBlocked.current = true;
    fundsOpenedFromWorkspace.current = false;
    focusDestination.current = "access";
    signatureRequest.current++;
    waitingSignatureRequest.current = null;
    job.current++;
    running.current = false;
    setBusy(false);
    setStage("");
    latestSession.current.setBusy(false);
    clearSecretInputs();
    latestSession.current.lock();
    setWalletScreen("workspace");
    setPlanCount(0);
    draftPolicy.current = null;
  }
  /** An explicit exit also forgets the public person details kept for re-unlock. */
  function exitSession() {
    latestSession.current.rememberIdentityDraft(null);
    setIdentityFormEpoch((epoch) => epoch + 1);
    lock();
  }
  /** Drops only the independent root inside the Worker; an unlocked identity stays. */
  async function clearFundsRoot() {
    const state = await shieldedAssetWorkerCall("clearFunds", {});
    latestSession.current.update(state);
  }
  function selectBudgetKey(next: ShieldedKeySlot) {
    clearSecretInputs();
    setReceiveSlot(next);
    setError("");
  }
  /** Opens key management without changing the current task or any funds selection. */
  function openFundsManager(flow: "restore" | "create" | "backup") {
    fundsOpenedFromWorkspace.current = showWorkspace;
    setTaskChosen(true);
    clearSecretInputs();
    focusDestination.current = showWorkspace ? "task" : "access";
    setRecoveryScanned(false);
    if (flow === "create") setRootSource("random");
    setFundsFlow(flow);
    setWalletScreen("manage");
    setError("");
  }
  /** Task-specific receiving setup also selects its independent receiving key. */
  function openFundsKey(flow: "restore" | "create" | "backup") {
    if (action === "claim") setReceiveSlot("asset");
    else if (action === "receiveCode") setCodeSlot("asset");
    openFundsManager(flow);
  }
  function chooseAction(next: Action) {
    clearSecretInputs();
    setTaskChosen(true);
    draftPolicy.current = null;
    changeCode("");
    setRecipientInputMethod("receiveCode");
    recipientForm.current?.clearSecretInputs();
    setStage("");
    if (!submissionPending) {
      setTransactionHash("");
      setTransactionResult(null);
    }
    if (next !== "fund" && next !== "claim") walletAction.current = next;
    if (next === "claim") {
      const first =
        wallet?.claims.find(
          (claim) => claim.slot === receiveSlot && claim.status === "claimable",
        ) ?? wallet?.claims.find((claim) => claim.slot === receiveSlot);
      setClaimHandle(first?.handle ?? "");
      setClaimPeriods(first?.periodIndices ?? []);
    }
    setAction(next);
    setWalletScreen(
      !session.identity && ["fund", "claim", "receiveCode"].includes(next)
        ? "identity"
        : "workspace",
    );
    setCandidates([]);
    setError("");
  }
  /** Return with the operation's fresh public state, without resetting task drafts. */
  function returnToTask(state: ShieldedAssetSessionState = latestSession.current) {
    clearSecretInputs();
    const ready = !!state.funds?.recoveryVerified && !state.funds.backupRequired;
    const identityRequired = ["fund", "claim", "receiveCode"].includes(action);
    if (!state.identity && ready && !identityRequired && !fundsOpenedFromWorkspace.current)
      chooseAction("privateTransfer");
    focusDestination.current = state.identity || (ready && !identityRequired) ? "task" : "access";
    setWalletScreen(!state.identity && identityRequired ? "identity" : "workspace");
    autoRecoveryBlocked.current = false;
    if (!independentBackupPending || ready) fundsOpenedFromWorkspace.current = false;
  }
  function finishFundsRecovery(state: ShieldedAssetSessionState) {
    if (state.funds?.recoveryVerified && !state.funds.backupRequired) returnToTask(state);
  }
  function navigateToAction(next: Action) {
    if (walletScreen === "manage" && next === action) returnToTask();
    else chooseAction(next);
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
      const expected = expectedFingerprint || undefined;
      const openedFromWorkspace = fundsOpenedFromWorkspace.current;
      latestSession.current.lock();
      fundsOpenedFromWorkspace.current = openedFromWorkspace;
      clearSecretInputs();
      setWalletScreen("manage");
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
          fundsOpenedFromWorkspace.current = openedFromWorkspace;
          latestSession.current.update(state);
          setRecoveryScanned(false);
          if (intent === "create" || expected)
            setExpectedFingerprint(state.funds?.fundsFingerprint ?? expected ?? "");
          if (intent === "create") {
            setExportedFingerprint("");
            setExternalSaved(false);
            setVerificationStarted(false);
          }
          const needsBackup = intent === "create" || state.funds?.backupRequired;
          setFundsFlow(needsBackup ? "backup" : "restore");
          setWalletScreen("manage");
          if (intent === "restore" && !needsBackup) finishFundsRecovery(state);
        }
      } finally {
        signature = "";
      }
    }, tr("signing"));
  }
  async function createFunds() {
    if (rootSource === "walletSignature") return requestSignature("create");
    await run(async (current) => {
      clearSecretInputs();
      if (latestSession.current.funds) await clearFundsRoot();
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
        setFundsFlow("backup");
        setWalletScreen("manage");
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
      const fingerprint = exportedFingerprint || expectedFingerprint || undefined;
      clearSecretInputs();
      try {
        if (latestSession.current.funds) await clearFundsRoot();
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
          setRecoveryScanned(false);
          setFundsFlow(state.funds?.backupRequired ? "backup" : "restore");
          setWalletScreen("manage");
          if (fingerprint) setExpectedFingerprint(fingerprint);
          setExportedFingerprint("");
          setExternalSaved(false);
          setVerificationStarted(false);
          finishFundsRecovery(state);
        }
      } finally {
        material = "";
      }
    }, tr("importing"));
  }
  /**
   * The backup drill removes the new root from the Worker and clears the shown
   * material. Only the manually re-entered backup can reinstall it, decoded again
   * and matched against the original fingerprint. An unlocked identity stays.
   */
  async function beginBackupVerification() {
    await run(async (current) => {
      clearSecretInputs();
      await clearFundsRoot();
      if (!current()) return;
      setRestorePath(backupFormat);
      setVerificationStarted(true);
      setWalletScreen("manage");
    }, "");
  }
  /**
   * Automatic scans read only the selected pool. A user-requested scan then discovers
   * every verified factory pool, where history can also confirm a candidate root.
   */
  async function recover(allPools = false) {
    await run(async (current) => {
      const result = await shieldedAssetWorkerCall("recover", { context });
      let recoveredState = result.sessionState;
      if (current()) {
        if (result.sessionState) latestSession.current.update(result.sessionState);
        setWallet(result);
        setRecoveryScanned(true);
        setCandidates([]);
        if (!taskChosen && session.identity) {
          setTaskChosen(true);
          const next = result.notes.some(
            (note) =>
              note.kind === "budget" &&
              note.slot === "identity" &&
              BigInt(note.amountPerPeriod ?? "0") > 0n &&
              BigInt(note.amount) >= BigInt(note.amountPerPeriod ?? "0"),
          )
            ? "claim"
            : result.notes.some(
                  (note) =>
                    note.kind === "value" && note.slot === "identity" && BigInt(note.amount) > 0n,
                )
              ? "privateTransfer"
              : "shield";
          setAction(next);
          setSlot("identity");
          if (next === "claim") setReceiveSlot("identity");
          else walletAction.current = next;
        }
      }
      if (!allPools || !current()) return;
      const found = await shieldedAssetWorkerCall(
        "discover",
        { context },
        { timeoutMs: 1_200_000 },
      );
      if (!current()) return;
      if (found.sessionState) latestSession.current.update(found.sessionState);
      setDiscovery(found);
      recoveredState = found.sessionState ?? recoveredState;
      if (walletScreen === "manage" && accessFlow === "restore" && recoveredState)
        finishFundsRecovery(recoveredState);
    }, t("shielded.stages.recovering"));
  }
  useEffect(() => {
    if (!session.identity && !fundsReady) {
      autoRecoveryScope.current = "";
      return;
    }
    if (autoRecoveryBlocked.current || walletScreen !== "workspace" || busy || running.current)
      return;
    const scope = JSON.stringify([
      contextKey,
      session.identity?.handle,
      session.funds?.fundsFingerprint,
    ]);
    if (autoRecoveryScope.current === scope) return;
    autoRecoveryScope.current = scope;
    void recover();
  }, [
    session.identity?.handle,
    session.funds?.fundsFingerprint,
    fundsReady,
    contextKey,
    walletScreen,
    busy,
  ]);
  async function createCode(receivingSlot: ShieldedKeySlot = codeSlot) {
    await run(async (current) => {
      const result = await shieldedAssetWorkerCall(
        "receiveCode",
        { slot: receivingSlot },
        { timeoutMs: 1_200_000 },
      );
      if (current()) setOwnCode(result.code);
    }, t("shielded.stages.receiveCode"));
  }
  function changeCode(value: string) {
    setCode(value);
    setVerifiedRecipient(null);
    setRecipientConfirmed(false);
    setCodeError("");
  }
  useEffect(() => {
    if (!needsCode || !code.trim()) return;
    let cancelled = false;
    const generation = getShieldedAssetWorkerGeneration();
    void verifyShieldedReceiveCode(code)
      .then((result) => {
        if (!cancelled && mounted.current && generation === getShieldedAssetWorkerGeneration())
          setVerifiedRecipient(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled && mounted.current && generation === getShieldedAssetWorkerGeneration())
          setCodeError(cause instanceof Error ? cause.message : tr("failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [code, needsCode]);
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
          changeCode(result);
          setRecipientInputMethod("receiveCode");
        }
      } finally {
        credentials.rawPassphrase = "";
        form.clearSecretInputs();
      }
    }, t("shielded.stages.receiveCode"));
  }
  function trackBroadcast(provider: Provider, hash: string, id: string, label: string) {
    const center = latestTxCenter.current;
    center?.upsert({
      id,
      kind: "shielded",
      label,
      phase: "busy",
      transactionHash: hash,
      ...(receiptTracking.current?.id === id || center.records.some((record) => record.id === id)
        ? {}
        : {
            shieldedSubmission: {
              chainId: String(modules.chainId),
              poolAddress: modules.poolAddress,
              kind: "action" as const,
            },
          }),
    });
    if (!mounted.current || contextRef.current !== contextKey) return;
    if (receiptTracking.current && receiptTracking.current.id !== id) return;
    receiptTracking.current = {
      kind: "action",
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
      setTransactionResult(null);
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
    if (mounted.current && tracked?.id === record.id) {
      receiptTracking.current = null;
      setTransactionPending(false);
      setTransactionResult(status === 1 ? "done" : "failed");
      if (tracked.kind === "approval") setAllowanceRevision((revision) => revision + 1);
    }
  }
  async function approve() {
    if (submissionPending) return;
    await run(async (current) => {
      if (!signer || !modules.token) throw new Error(t("shielded.walletNotReady"));
      const chosen = signer,
        generation = getShieldedAssetWorkerGeneration(),
        value = parseUnits(amount, modules.tokenDecimals ?? 0);
      if (value <= 0n || value >= 1n << 128n) throw new Error(tr("amountInvalid"));
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
      if (generation !== getShieldedAssetWorkerGeneration())
        throw new Error(t("shielded.unlockRequired"));
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
        kind: "approval",
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
      setTransactionResult(null);
      const endWalletRequest = latestSession.current.beginWalletRequest();
      let tx: ContractTransactionResponse;
      try {
        tx = await (modules.token.connect(chosen) as typeof modules.token)
          .approve(modules.poolAddress, value, { nonce, chainId: modules.chainId });
      } catch (cause) {
        rejectKnownWalletRequest(cause, txId);
        throw cause;
      } finally {
        endWalletRequest();
      }
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
  /**
   * One confirmation sends the whole plan in order: any consolidation, then the payment.
   * Each step is proved, its gas checked and its receipt awaited before the next; the
   * wallet still signs every transaction.
   */
  async function prepare() {
    if (action === "receiveCode") return createCode();
    if (submissionPending) return;
    if (action === "shield" && !allowanceReady) return approve();
    const chosen = signer,
      requested = actionRequestKey,
      generation = getShieldedAssetWorkerGeneration();
    await run(async (current) => {
      if (!chosen) throw new Error(t("shielded.walletNotReady"));
      if (needsCode && !recipientReady) throw new Error(tr("confirmRecipient"));
      if (action === "shield" && !allowanceReady) throw new Error(tr("approveFirst"));
      const assertCurrent = () => {
        if (requested !== currentRequestKey.current) throw new Error(tr("reviewAgain"));
        if (!current() || generation !== getShieldedAssetWorkerGeneration())
          throw new Error(t("shielded.unlockRequired"));
        if (walletRef.current.signer !== chosen || walletRef.current.account !== account)
          throw new Error(t("shielded.walletChanged"));
      };
      const amountValue =
        action === "claim" || (action === "fund" && selectedPolicy)
          ? undefined
          : parseUnits(amount, modules.tokenDecimals ?? 0).toString();
      let stepCandidates =
        action === "fund"
          ? values.map((note) => note.commitment)
          : needsValues
            ? candidates
            : undefined;
      let stepPolicy =
        policyHandle ||
        (draftPolicy.current?.key === draftKey ? draftPolicy.current.handle : undefined);
      let remaining = Number.POSITIVE_INFINITY;
      let sent = false;
      try {
        for (;;) {
          // A receipt may arrive after locking, navigation or a replacement session.
          // Reject it before it can mutate the shared Worker's next preview.
          assertCurrent();
          setStage(tr("preparing"));
          const planned = await shieldedAssetWorkerCall(
            "preview",
            {
              context,
              slot: actionSlot,
              action,
              amount: amountValue,
              candidates: stepCandidates,
              recipientCode: needsCode ? code : undefined,
              publicRecipient: action === "unshield" ? withdrawalRecipient : personHash,
              fundingEntry: effectiveEntry,
              rootVersionIndex: rootVersion ? Number(rootVersion) : undefined,
              periodDays,
              periods,
              policyHandle: stepPolicy,
              claimHandle,
              periodIndices: claimPeriods,
            },
            { timeoutMs: 1_200_000 },
          );
          assertCurrent();
          // Every consolidation must shorten the plan; anything else means history changed.
          if (planned.steps.length >= remaining) throw new Error(tr("reviewAgain"));
          if (remaining === Number.POSITIVE_INFINITY && planned.steps.length > 1)
            setPlanCount(planned.steps.length);
          remaining = planned.steps.length;
          if (action === "fund" && !policyHandle && planned.policyHandle) {
            stepPolicy = planned.policyHandle;
            draftPolicy.current = { handle: planned.policyHandle, key: draftKey };
          }
          setStage(t("shielded.stages.proving"));
          const result = await shieldedAssetWorkerCall(
            "prove",
            { handle: planned.handle, context },
            { timeoutMs: 1_200_000 },
          );
          assertCurrent();
          const txId = `shielded:${modules.chainId}:${Date.now()}:${planned.handle}`,
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
            onWalletRequest: () => {
              assertCurrent();
              return latestSession.current.beginWalletRequest();
            },
            onSubmitting: (metadata: {
              nonce: number;
              fromBlock: number;
              signerAddress: string;
            }) => {
              assertCurrent();
              receiptTracking.current = {
                provider: chosen.provider!,
                chainId: modules.chainId,
                id: txId,
                label,
                kind: "action",
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
                setTransactionResult(null);
              }
            },
          };
          let submitted;
          try {
            submitted =
              result.action === "shield"
                ? await submitShield({
                    ...common,
                    amount: result.amount,
                    assetKind: modules.assetKind,
                  })
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
            throw cause;
          }
          sent = true;
          recordReceipt(submitted.transactionHash, submitted.receipt.status, { id: txId, label });
          if (current()) {
            setTransactionHash(submitted.transactionHash);
            setTransactionPending(false);
            setTransactionResult(submitted.receipt.status === 1 ? "done" : "failed");
          }
          if (submitted.receipt.status !== 1)
            throw new Error(t("shielded.transactionFailed", { hash: submitted.transactionHash }));
          if (result.action === "shield") publicActivityAddresses.add(account.toLowerCase());
          if (planned.steps.length <= 1) break;
          // The consolidated outputs replace its inputs among the next step's candidates.
          const outputs = result.data.outputCommitments.map((value) => getBigInt(value).toString());
          stepCandidates = [
            ...(stepCandidates ?? []).filter((commitment) => !planned.inputs.includes(commitment)),
            ...outputs.filter((_, index) => BigInt(planned.outputAmounts[index] ?? "0") > 0n),
          ];
        }
      } finally {
        if (current()) setPlanCount(0);
        if (sent && current()) {
          autoRecoveryScope.current = "";
          setWallet(null);
          setCandidates([]);
        }
      }
    }, tr("preparing"));
  }
  const feedback = (
    <>
      {busy && planCount > 1 ? (
        <p role="status" className="text-sm text-ink-muted">
          {t("shielded.walletKeys.planTransactions", { count: planCount })}
        </p>
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
      {transactionHash || submissionPending || transactionResult ? (
        <p role="status" className="break-all text-xs">
          {transactionHash ? `${tr("transactionHash")}: ${transactionHash} · ` : ""}
          {t(
            submissionPending
              ? "transaction.pending"
              : transactionResult === "unknown"
                ? "transaction.unknown"
                : transactionResult === "failed"
                  ? "transaction.failed"
                  : "transaction.success",
          )}
        </p>
      ) : null}
      {codeError && needsCode ? (
        <p role="alert" className="break-words text-sm text-danger">
          {codeError}
        </p>
      ) : null}
    </>
  );
  // With one loaded owner there is nothing to choose; deposits go into the chosen funds.
  const assetSource =
    session.identity && fundsReady ? (
      <FieldBlock label={tr("assetSource")} htmlFor={`${formId}-assetSource`}>
        <select
          id={`${formId}-assetSource`}
          className={INPUT}
          value={paymentSlot}
          disabled={busy}
          onChange={(event) => {
            setSlot(event.target.value as ShieldedKeySlot);
            setCandidates([]);
          }}
        >
          <option value="identity">{tr("identityFunds")}</option>
          <option value="asset">{tr("budgetFunds")}</option>
        </select>
      </FieldBlock>
    ) : null;
  const receiveSettings =
    action === "receiveCode" ? (
      <div className="space-y-4">
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium">{tr("receiveKeyLabel")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["identity", "asset"] as const).map((receivingSlot) => (
              <label key={receivingSlot} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${formId}-receiving-key`}
                  checked={codeSlot === receivingSlot}
                  onChange={() => {
                    clearSecretInputs();
                    setCodeSlot(receivingSlot);
                    setOwnCode("");
                  }}
                />
                {tr(receivingSlot === "identity" ? "identityReceive" : "independentReceive")}
              </label>
            ))}
          </div>
        </fieldset>
        {codeSlot !== "asset" ? null : session.funds && fundsReady ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-all text-xs text-ink-muted">
              {tr("fundsFingerprint")}: {session.funds.fundsFingerprint} · {tr("verified")}
            </p>
            <PanelButton size="compact" disabled={busy} onClick={() => openFundsKey("backup")}>
              {tr("showBackupFunds")}
            </PanelButton>
          </div>
        ) : (
          // Until a verified key is open, opening one takes the place of the receive-code action.
          <div className="space-y-3">
            {session.funds ? (
              <p className="break-all text-xs text-ink-muted">
                {tr("fundsFingerprint")}: {session.funds.fundsFingerprint} ·{" "}
                {tr("needsVerification")}
              </p>
            ) : null}
            {independentBackupPending ? (
              <p role="status" className="text-xs text-ink-muted">
                {tr("budgetKeyBackupPending")}
              </p>
            ) : null}
            {/* Restore comes first: a second new key cannot receive budgets bound to the original. */}
            <div className="flex flex-wrap gap-3">
              {independentBackupPending ? (
                <PanelButton
                  variant="primary"
                  disabled={busy}
                  onClick={() => openFundsKey("backup")}
                >
                  {tr("showBackupFunds")}
                </PanelButton>
              ) : (
                <PanelButton disabled={busy} onClick={() => openFundsKey("restore")}>
                  {tr("showRestoreFunds")}
                </PanelButton>
              )}
              {!session.funds && !independentBackupPending ? (
                <PanelButton disabled={busy} onClick={() => openFundsKey("create")}>
                  {tr("createNew")}
                </PanelButton>
              ) : null}
            </div>
          </div>
        )}
      </div>
    ) : null;
  const nativeSymbol = SUPPORTED_NETWORKS[config.chainId]?.nativeCurrency.symbol ?? "Native";
  // Other pools have no verified decimals here, so amounts stay raw integers.
  const discoveryReport = discovery ? (
    <div className="space-y-1 text-xs">
      <p role="status" className="text-ink">
        {tr(discovery.complete ? "discoveryComplete" : "discoveryPartial")}
      </p>
      {discovery.pools.map((pool) => (
        <p key={pool.poolAddress} className="break-all text-ink-muted">
          {pool.assetAddress.toLowerCase() === ZeroAddress
            ? nativeSymbol
            : pool.assetAddress.toLowerCase() === config.tokenAddress.toLowerCase()
              ? "DEEP"
              : pool.assetAddress}
          :{" "}
          {pool.status === "recovered"
            ? `${tr("rawValue")}: ${pool.rawValueBalance}; ${tr("rawBudget")}: ${pool.rawBudgetBalance}`
            : tr("poolUnknown")}
        </p>
      ))}
    </div>
  ) : null;
  const fundsTitle = tr(
    accessFlow === "create"
      ? "createTitle"
      : accessFlow === "backup"
        ? "backupTitle"
        : "restoreTitle",
  );
  const fundsManager = (
    <ShieldedFundsKeyManager
      flow={accessFlow}
      funds={session.funds}
      identityReady={!!session.identity}
      busy={busy}
      rootSource={rootSource}
      onRootSourceChange={setRootSource}
      backupFormat={backupFormat}
      onBackupFormatChange={(format) => {
        clearSecretInputs();
        setBackupFormat(format);
        setExportedFingerprint("");
        setExternalSaved(false);
        setVerificationStarted(false);
      }}
      exportedMaterialRef={exportedMaterial}
      recoveryMaterialRef={recoveryMaterial}
      exportedFingerprint={exportedFingerprint}
      externalSaved={externalSaved}
      onExternalSavedChange={setExternalSaved}
      verificationStarted={verificationStarted}
      restorePath={restorePath}
      onRestorePathChange={(path) => {
        clearSecretInputs();
        setRestorePath(path);
      }}
      account={account}
      canSign={!!signer}
      recoveryScanned={recoveryScanned}
      onCreate={() => void createFunds()}
      onExport={() => void exportRecoveryMaterial()}
      onBeginVerification={() => void beginBackupVerification()}
      onImport={() => void importRecoveryMaterial()}
      onRestoreSignature={() => void requestSignature("restore")}
      onRecover={() => void recover(true)}
      discoveryReport={discoveryReport}
      // Claims and recovery need the original key; only receive-code setup creates one.
      canCreate={action === "receiveCode"}
      onShowCreate={() => {
        clearSecretInputs();
        setRootSource("random");
        setFundsFlow("create");
      }}
      onShowRestore={() => {
        clearSecretInputs();
        setRecoveryScanned(false);
        setFundsFlow("restore");
        setWalletScreen("manage");
        if (session.funds) void run(clearFundsRoot, "");
      }}
      onUnlockIdentity={
        !showWorkspace && !session.identity
          ? () => {
              clearSecretInputs();
              focusDestination.current = "access";
              setWalletScreen("identity");
            }
          : undefined
      }
      onLock={exitSession}
      showLock={!fundsInWorkspace}
    />
  );
  return (
    <div className={`min-w-0 break-normal ${showWorkspace ? "space-y-4" : "space-y-6"}`}>
      {!showWorkspace ? (
        <div
          ref={accessRegion}
          tabIndex={-1}
          className="rounded-3xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <PanelShell
            title={
              identityAccess
                ? t("shielded.identityTitle", { symbol: modules.assetSymbol })
                : fundsTitle
            }
            description={
              identityAccess
                ? t("shielded.identityDescription", { symbol: modules.assetSymbol })
                : undefined
            }
          >
            {identityAccess ? (
              <>
                {session.identity ? (
                  <p className="break-all text-sm">
                    {session.identity.identity.fullName} · {session.identity.personHash}
                  </p>
                ) : (
                  <>
                    <PersonHashCalculator
                      key={`${identityFormEpoch}:${JSON.stringify(session.identityDraft)}`}
                      ref={identityForm}
                      initialValues={session.identityDraft ?? undefined}
                      computeHash={!busy}
                      showTitle={false}
                      collapsible={false}
                      showPassphraseGuidance={false}
                      className="border-0 bg-transparent p-0 shadow-none"
                    />
                    {/* Two ways in: identity credentials, or an independent funds key alone. */}
                    <div className="flex flex-wrap gap-3">
                      <PanelButton
                        variant="primary"
                        busy={busy}
                        disabled={busy}
                        onClick={() => void unlock()}
                      >
                        {t("shielded.unlock", { symbol: modules.assetSymbol })}
                      </PanelButton>
                      {!hasSession ? (
                        <PanelButton disabled={busy} onClick={() => openFundsKey("restore")}>
                          {tr("openIndependentFunds")}
                        </PanelButton>
                      ) : null}
                    </div>
                  </>
                )}
              </>
            ) : (
              fundsManager
            )}
            {identityAccess && fundsReady ? (
              <div className="space-y-3 border-t border-hairline pt-4">
                <p className="text-sm text-ink-muted">{tr("fundsIdentityNeeded")}</p>
                <PanelButton
                  onClick={() => {
                    chooseAction("privateTransfer");
                    setWalletScreen("workspace");
                  }}
                >
                  {tr("useIndependentFunds")}
                </PanelButton>
              </div>
            ) : null}
            {identityAccess && (hasSession || busy) ? (
              <PanelButton onClick={exitSession}>
                {t("shielded.lock", { symbol: modules.assetSymbol })}
              </PanelButton>
            ) : null}
            {feedback}
          </PanelShell>
        </div>
      ) : null}
      {showWorkspace ? (
        <>
          <ShieldedAssetOverview
            assetControls={
              assetControls ? (
                <fieldset disabled={busy} className="min-w-0">
                  {assetControls}
                </fieldset>
              ) : undefined
            }
            fullName={session.identity?.identity.fullName ?? tr("independentFundsTitle")}
            personHash={overviewHash}
            hashLabel={session.identity ? undefined : tr("fundsFingerprint")}
            copyHashLabel={session.identity ? undefined : tr("copyFundsFingerprint")}
            symbol={modules.assetSymbol}
            availableBalance={
              wallet ? showAmount((valueTotals.identity + valueTotals.asset).toString()) : "—"
            }
            availableDetail={
              wallet && session.identity && fundsReady
                ? `${tr("identityFunds")} ${showAmount(valueTotals.identity.toString())} · ${tr("budgetFunds")} ${showAmount(valueTotals.asset.toString())}`
                : undefined
            }
            budgetBalance={wallet && session.identity ? showAmount(budgetTotal.toString()) : "—"}
            busy={busy}
            onRecover={() => void recover(true)}
            onLock={exitSession}
            footer={fundsInWorkspace ? undefined : discoveryReport}
            onCopyIdentityHash={async () => {
              try {
                await navigator.clipboard.writeText(overviewHash);
              } catch {
                setError(t("common.copyFailed"));
              }
            }}
          />
          {modules.tokenDecimals === null ? (
            <p className="text-xs text-ink-muted">{tr("rawUnits")}</p>
          ) : null}
          <ShieldedTaskNavigation
            id={formId}
            action={action}
            walletAction={
              wallet?.notes.some(
                (note) =>
                  note.kind === "value" && note.slot === paymentSlot && BigInt(note.amount) > 0n,
              )
                ? "privateTransfer"
                : "shield"
            }
            busy={busy}
            symbol={modules.assetSymbol}
            onActionChange={navigateToAction}
            fundsAction={{
              label: tr(
                session.funds || independentBackupPending
                  ? "manageIndependentFunds"
                  : "openIndependentFunds",
              ),
              active: fundsInWorkspace,
              onClick: () =>
                openFundsManager(independentBackupPending || fundsReady ? "backup" : "restore"),
            }}
          />
          <div
            ref={taskRegion}
            id={`${formId}-task-panel`}
            role="tabpanel"
            tabIndex={-1}
            className="rounded-3xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={fundsInWorkspace ? fundsTitle : undefined}
            aria-labelledby={
              fundsInWorkspace
                ? undefined
                : `${formId}-tab-${action === "fund" ? "inheritance" : action === "claim" ? "receive" : "wallet"}`
            }
          >
            {fundsInWorkspace ? (
              <PanelShell title={fundsTitle}>
                {fundsManager}
                {feedback}
              </PanelShell>
            ) : action !== "fund" && action !== "claim" ? (
              <ShieldedWalletActions
                action={action}
                symbol={modules.assetSymbol}
                decimals={modules.tokenDecimals ?? 0}
                busy={busy}
                amount={amount}
                onAmountChange={setAmount}
                ownReceiveCode={ownCode}
                receivingSettings={receiveSettings}
                recipient={{
                  method: recipientInputMethod,
                  onMethodChange: (method) => {
                    changeCode("");
                    setRecipientInputMethod(method);
                    recipientForm.current?.clearSecretInputs();
                  },
                  code,
                  onCodeChange: changeCode,
                  credentialsFormRef: recipientForm,
                  onGenerateCode: () => void generateConvenientCode(),
                  targetHash: recipientTargetHash ?? undefined,
                  targetName: recipientTargetName,
                  needsConfirmation: recipientNeedsConfirmation,
                  confirmed: recipientConfirmed,
                  onConfirmedChange: setRecipientConfirmed,
                }}
                withdrawalRecipient={withdrawalRecipient}
                onWithdrawalRecipientChange={setWithdrawalRecipient}
                values={values}
                selectedCommitments={candidates}
                onSelectedCommitmentsChange={setCandidates}
                signerReady={!!signer}
                privateAccountWarning={privateAccountWarning}
                approvalRequired={modules.assetKind === "erc20" && !allowanceReady}
                submitDisabled={
                  !slotReady ||
                  (action === "receiveCode" && !session.identity) ||
                  (action !== "receiveCode" && submissionPending) ||
                  (needsCode && !recipientReady)
                }
                submitHidden={action === "receiveCode" && codeSlot === "asset" && !fundsReady}
                onSubmit={() => void prepare()}
                fundsSource={action !== "receiveCode" ? assetSource : null}
                feedback={feedback}
              />
            ) : (
              <PanelShell
                title={t(`shielded.actions.${action}`, { symbol: modules.assetSymbol })}
                description={t(`shielded.descriptions.${action}`, { symbol: modules.assetSymbol })}
              >
                {action === "fund" ? assetSource : null}
                <ShieldedBudgetActions
                  action={action}
                  symbol={modules.assetSymbol}
                  decimals={modules.tokenDecimals ?? 0}
                  busy={busy}
                  wallet={wallet}
                  entry={effectiveEntry}
                  fundingSlot={paymentSlot}
                  onEntryChange={(next) => {
                    // The child, version, rule and amounts stay; only receiving material differs.
                    if (template || next === entry) return;
                    setEntry(next);
                    changeCode("");
                    setRecipientInputMethod("receiveCode");
                    recipientForm.current?.clearSecretInputs();
                  }}
                  policyHandle={policyHandle}
                  onPolicyChange={(handle) => {
                    setPolicyHandle(handle);
                    setPersonHash("");
                    setRootVersion("");
                    changeCode("");
                    recipientForm.current?.clearSecretInputs();
                    setError("");
                  }}
                  rootVersion={rootVersion}
                  onRootVersionChange={(value) => {
                    setRootVersion(value);
                    setPersonHash("");
                    changeCode("");
                  }}
                  personHash={personHash}
                  onPersonHashChange={(value) => {
                    setPersonHash(value);
                    const original = wallet?.templates.find(
                      (item) =>
                        item.policyHandle === policyHandle &&
                        item.personHash.toLowerCase() === value.toLowerCase(),
                    );
                    if (original)
                      setEntry(
                        original.bindingKind === 1
                          ? "public"
                          : original.keyMode === 1
                            ? "privateIndependent"
                            : "privateConvenient",
                      );
                    changeCode("");
                    recipientForm.current?.clearSecretInputs();
                    setError("");
                  }}
                  amount={amount}
                  onAmountChange={setAmount}
                  periodDays={periodDays}
                  onPeriodDaysChange={setPeriodDays}
                  periods={periods}
                  onPeriodsChange={setPeriods}
                  code={code}
                  onCodeChange={changeCode}
                  recipientInputMethod={recipientInputMethod}
                  onRecipientInputMethodChange={(method) => {
                    changeCode("");
                    setRecipientInputMethod(method);
                    recipientForm.current?.clearSecretInputs();
                  }}
                  recipientFormRef={recipientForm}
                  onGenerateRecipientCode={() => void generateConvenientCode()}
                  claimHandle={claimHandle}
                  onClaimChange={(handle) => {
                    setClaimHandle(handle);
                    setClaimPeriods(
                      claims.find((claim) => claim.handle === handle)?.periodIndices ?? [],
                    );
                  }}
                  claimPeriods={claimPeriods}
                  onClaimPeriodsChange={setClaimPeriods}
                  receiveSlot={receiveSlot}
                  onReceiveSlotChange={selectBudgetKey}
                  independentKeyReady={
                    !!session.funds?.recoveryVerified && !session.funds.backupRequired
                  }
                  onRestoreIndependentKey={() =>
                    openFundsKey(exportedFingerprint ? "backup" : "restore")
                  }
                  parentPersonHash={session.identity?.personHash}
                  localRecipientLabels={localRecipientLabels}
                  fundingDeficit={fundingDeficit}
                />
                {privateAccountWarning ? (
                  <WarningNotice>
                    {t("shielded.switchWalletPrompt", { symbol: modules.assetSymbol })}
                  </WarningNotice>
                ) : null}
                {!signer ? <WarningNotice>{t("shielded.walletNotReady")}</WarningNotice> : null}
                {action !== "claim" || slotReady ? (
                  <PanelButton
                    variant="primary"
                    busy={busy}
                    disabled={
                      busy ||
                      submissionPending ||
                      !slotReady ||
                      !signer ||
                      (needsCode && !recipientReady) ||
                      (action === "fund" &&
                        (fundingDeficit !== undefined ||
                          !personHash ||
                          (!selectedPolicy && !rootVersion))) ||
                      (action === "claim" &&
                        (!selectedClaim ||
                          selectedClaim.status !== "claimable" ||
                          !claimPeriods.length ||
                          claimPeriods.some(
                            (index) => !selectedClaim.periodIndices.includes(index),
                          )))
                    }
                    onClick={() => void prepare()}
                  >
                    {t("shielded.submit", {
                      symbol: modules.assetSymbol,
                      action: t(`shielded.actions.${action}`, { symbol: modules.assetSymbol }),
                    })}
                  </PanelButton>
                ) : null}
                {feedback}
              </PanelShell>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
