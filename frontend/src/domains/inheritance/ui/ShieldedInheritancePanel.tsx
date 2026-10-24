import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, KeyRound, LockOpen, QrCode, ShieldCheck } from "lucide-react";
import {
  buildShieldedIndependentKeySigningMessage,
  normalizeShieldedIndependentKeyIdentity,
  normalizeShieldedIndependentKeyPassphrase,
} from "@deepfamily/protocol-core";
import {
  formatUnits,
  getBigInt,
  getAddress,
  parseUnits,
  toUtf8Bytes,
  type ContractTransactionResponse,
  type Provider,
  type Signer,
} from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useConfig } from "../../config";
import { normalizeShieldedStateReadMode } from "../../../shared/config/shieldedStateReadMode";
import { getWalletConnectionGeneration, subscribeWalletConnectionChange } from "../../wallet";
import { useTreeGraphData } from "../../tree/context";
import { getShieldedLocalRecipientLabels } from "../services/shieldedRecipientOptions";
import { useTransactionCenter } from "../../transactions";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { getShieldedPoolFactoryDeploymentBlock, getPrivateLetterArchiveAddress, getPrivateLetterArchiveDeploymentBlock } from "../../../shared/config/env";
import {
  getFriendlyErrorMessage,
  REASON_FRIENDLY_MAP,
  resolveErrorReason,
} from "../../../shared/lib/errors";
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
import { createIdentityAuthorizationContract } from "../services/shieldedIdentityAuthorizationChain";
import { waitForShieldedTransaction } from "../services/shieldedTransactionReceipt";
import {
  assertShieldedDepositBalance,
  ShieldedDepositBalanceError,
} from "../services/shieldedDepositBalance";
import { useShieldedPageIdentitySession } from "./ShieldedIdentitySessionContext";
import { type ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";
import { CopyIconButton } from "../../../shared/ui";
import {
  formatShieldedTimestamp,
  parseShieldedPeriodDays,
  SHIELDED_FUNDING_START_DELAY_SECONDS,
} from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount, getShieldedAvatarText } from "../model/shieldedDisplay";
import {
  FIELD_TEXTAREA,
  FIELD_INPUT,
  FieldBlock,
  PanelButton,
  WarningNotice,
  shortHex,
} from "./inheritanceControls";
import { PrivateLettersPanel, type PrivateLetterView } from "./PrivateLettersPanel";
import { ShieldedPublicStateSyncStatus } from "./ShieldedPublicStateSyncStatus";
import {
  subscribePublicStateSyncProgress,
  type PublicStateSyncProgress,
} from "../../../shared/workers/publicStateSyncProgress";
import { ShieldedTaskNavigation, type ShieldedTask } from "./ShieldedTaskNavigation";
import {
  ShieldedAssetOverview,
  type ShieldedOverviewWallet,
  type ShieldedWalletSheetState,
} from "./ShieldedAssetOverview";
import { ShieldedWalletActions, type ShieldedRecipientInputMethod } from "./ShieldedWalletActions";
import {
  ShieldedSpendReview,
  type ShieldedCompletedSpendStep,
  type ShieldedSpendReviewProps,
} from "./ShieldedSpendReview";
import { ShieldedFundComposer } from "./ShieldedFundComposer";
import { useBudgetLetterDelivery } from "./useBudgetLetterDelivery";
import {
  listShieldedFundingHeirs,
  shieldedFundingEntryLabelKey,
} from "../model/shieldedFundingOptions";
import {
  ShieldedClaimComposer,
  buildShieldedClaimSchedule,
  findShieldedClaimBudget,
} from "./ShieldedClaimComposer";
import {
  SHIELDED_ACTION_STAGES,
  SHIELDED_APPROVAL_STAGES,
  ShieldedProgressList,
  type ShieldedPeriodSegment,
  type ShieldedProgressStage,
} from "./ShieldedTaskReceipt";
import {
  ShieldedClaimReceipt,
  ShieldedFundReceipt,
  ShieldedShieldReceipt,
  ShieldedSpendReceipt,
} from "./ShieldedTaskReceipts";
import { ShieldedWalletSheet } from "./ShieldedWalletSheet";
import { ShieldedIndependentKeyManager } from "./ShieldedIndependentKeyManager";
import type { ShieldedRecoveryMaterialHandle } from "./ShieldedRecoveryMaterialView";
import { SHIELDED_WALLET_REQUEST_TIMEOUT_MS } from "./useShieldedIdentitySession";
type Action = ShieldedAssetActionRequest["action"];
type RecoveryFormat = "mnemonic" | "shieldedKey";
type OperationScope = "session" | "wallet";
type SpendReview = Pick<ShieldedSpendReviewProps,
  "preview" | "action" | "notes" | "candidateCommitments" | "generatedCommitments" | "recipientLabel"
>;
export interface ShieldedPanelNavigation {
  slot: ShieldedKeySlot;
  /** Pins an independent payment choice to the key the user actually selected. */
  keyFingerprint?: string;
  action: Action;
  letterView?: PrivateLetterView | null;
  /** The first scan or a user choice has settled the task; later pools keep it. */
  taskChosen?: boolean;
}

/** React keeps public handles and display amounts. Keys and note openings stay in the asset Worker. */
export function ShieldedInheritancePanel({
  modules,
  signer,
  account,
  head,
  assetControls,
  navigation,
  onNavigationChange,
}: {
  modules: ShieldedPageModules;
  signer: Signer | null;
  account: string;
  /** The page heading, placed inside whichever column the panel currently uses. */
  head?: ReactNode;
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
  const exportedMaterial = useRef<ShieldedRecoveryMaterialHandle>(null);
  const recoveryMaterial = useRef<HTMLTextAreaElement>(null);
  const accessRegion = useRef<HTMLDivElement>(null);
  const taskRegion = useRef<HTMLElement>(null);
  const focusDestination = useRef<"access" | "task" | null>(null);
  const mounted = useRef(false),
    signatureRequest = useRef(0);
  const activeOperation = useRef<{ scope: OperationScope } | null>(null);
  const letterOperationPending = useRef(false);
  const [spendReview, setSpendReview] = useState<SpendReview | null>(null);
  // A confirmed plan stays on screen while its first step is proven and sent.
  const [executingReview, setExecutingReview] = useState<SpendReview | null>(null);
  const [completedSpendSteps, setCompletedSpendSteps] = useState<ShieldedCompletedSpendStep[]>([]);
  const [progress, setProgress] = useState<{
    kind: "action" | "approval";
    stage: ShieldedProgressStage;
  } | null>(null);
  const pendingSpendReview = useRef<{
    review: SpendReview;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const activeSignatureRequest = useRef<number | null>(null);
  const walletRef = useRef({ signer, account });
  walletRef.current = { signer, account };
  const previousGasWallet = useRef({ signer, account });
  const receiptTracking = useRef<
    | (ShieldedSubmissionTracking & {
        id: string;
        label: string;
        kind: "action" | "approval";
      })
    | null
  >(null);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState("");
  const acceptPublicSyncProgress = useRef(false);
  const [publicSyncProgress, setPublicSyncProgress] = useState<Partial<Record<PublicStateSyncProgress["domain"], PublicStateSyncProgress>>>({});
  const [publicSyncPaused, setPublicSyncPaused] = useState(false);
  const [readModeRefreshing, setReadModeRefreshing] = useState(false);
  const readModeRefreshScope = useRef<string | null>(null);
  const [transactionHash, setTransactionHash] = useState(""),
    [transactionPending, setTransactionPending] = useState(false);
  const [transactionLabel, setTransactionLabel] = useState("");
  const [transactionResult, setTransactionResult] = useState<"done" | "failed" | "unknown" | null>(
    null,
  );
  // Public receipt tracking survives a lock; the exited session's feedback stays dismissed.
  const [transactionFeedbackDismissed, setTransactionFeedbackDismissed] = useState(
    !session.credentials,
  );
  const pendingRecord = txCenter?.records.find(
    (record) =>
      record.kind === "shielded" &&
      record.phase === "busy" &&
      record.shieldedSubmission?.chainId === String(modules.chainId) &&
      record.shieldedSubmission.poolAddress.toLowerCase() === modules.poolAddress.toLowerCase(),
  );
  const submissionPending = transactionPending || !!pendingRecord;
  // One current wallet controls balances and every asset operation.
  const [slot, setSlot] = useState<ShieldedKeySlot>(
    navigation?.slot ??
      (!session.identity && session.independentKey?.recoveryVerified && !session.independentKey.backupRequired
        ? "independent"
        : "identity"),
  );
  const [selectedKeyFingerprint, setSelectedKeyFingerprint] = useState(
    navigation?.keyFingerprint ??
      (navigation?.slot === "independent" ? "" : (session.independentKey?.keyFingerprint ?? "")),
  );
  // Only completed keys can update the overview's public pin; drafts stay in the sheet.
  const confirmedOverviewKey = useRef<{ credentialsHandle: string; fingerprint: string } | null>(null);
  const [codeSlot, setCodeSlot] = useState<ShieldedKeySlot>("identity");
  // "balances" means no wallet sheet is open; the overview always shows both wallets.
  const [walletSection, setWalletSection] = useState<"balances" | "receiveCode" | "keys">("balances");
  const [walletScreen, setWalletScreen] = useState<"workspace" | "manage" | "identity">(
    "workspace",
  );
  const [independentKeyFlow, setIndependentKeyFlow] = useState<"restore" | "create" | "backup">(() =>
    session.independentKey?.backupRequired ? "backup" : "restore",
  );
  const [expectedFingerprint, setExpectedFingerprint] = useState(""),
    [exportedFingerprint, setExportedFingerprint] = useState("");
  // Recovery evidence survives discarded drafts even when this wallet was never selected.
  const trustedRecoveryKey = useRef<{ credentialsHandle: string; fingerprint: string } | null>(null);
  const pendingBackupDrill = useRef<{ credentialsHandle: string; fingerprint: string } | null>(null);
  const previousCredentialsHandle = useRef(session.credentials?.handle);
  const [backupFormat, setBackupFormat] = useState<RecoveryFormat>("mnemonic");
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [recoveryScanned, setRecoveryScanned] = useState(false);
  const [showRecoveryCandidate, setShowRecoveryCandidate] = useState(false);
  const [externalSaved, setExternalSaved] = useState(false),
    [restorePath, setRestorePath] = useState<RecoveryFormat | "signature">("mnemonic");
  const [wallet, setWallet] = useState<ShieldedWalletSummary | null>(null);
  const [balancesRefreshing, setBalancesRefreshing] = useState(false);
  const [discovery, setDiscovery] = useState<
    ShieldedAssetWorkerCallMap["discover"]["result"] | null
  >(null);
  const [action, setAction] = useState<Action>(() =>
    !session.identity && session.independentKey?.recoveryVerified && !session.independentKey.backupRequired
      ? "privateTransfer"
      : (navigation?.action ?? "shield"),
  );
  const [letterView, setLetterView] = useState<PrivateLetterView | null>(navigation?.letterView ?? null);
  const [amounts, setAmounts] = useState<Partial<Record<Action, string>>>({});
  const amount = amounts[action] ?? "";
  const setAmount = (value: string) => setAmounts((previous) => ({ ...previous, [action]: value }));
  const [taskChosen, setTaskChosen] = useState(navigation?.taskChosen ?? !!navigation);
  const autoRecoveryScope = useRef("");
  const receiveCodeScope = useRef("");
  const autoRecoveryBlocked = useRef(false);
  const independentKeyOpenedFromWorkspace = useRef(false);
  const [recipientInputMethod, setRecipientInputMethod] =
    useState<ShieldedRecipientInputMethod>("receiveCode");
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const [codeError, setCodeError] = useState("");
  useEffect(() => {
    onNavigationChange?.({
      slot,
      keyFingerprint: selectedKeyFingerprint,
      action,
      letterView,
      taskChosen,
    });
  }, [slot, selectedKeyFingerprint, action, letterView, taskChosen, onNavigationChange]);
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
  const [letterBudget, setLetterBudget] = useState("");
  const [ownCode, setOwnCode] = useState("");
  const [codeDisclosure, setCodeDisclosure] = useState<"anonymous" | "fund">("anonymous");
  const [codeExpiry, setCodeExpiry] = useState(() => {
    const date = new Date(Date.now() + 90 * 86400_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [withdrawalRecipient, setWithdrawalRecipient] = useState(""),
    [candidates, setCandidates] = useState<string[]>([]);
  const [claimHandle, setClaimHandle] = useState(""),
    [claimPeriods, setClaimPeriods] = useState<string[]>([]);
  // Transactions in a multi-step plan, shown while one confirmation sends them all.
  const [planCount, setPlanCount] = useState(0);
  const [allowanceRevision, setAllowanceRevision] = useState(0);
  const walletGeneration = getWalletConnectionGeneration();
  const allowanceScope = useMemo(
    () => ({
      token: modules.token,
      assetKind: modules.assetKind,
      poolAddress: modules.poolAddress,
      chainId: modules.chainId,
      signer,
      account,
      walletGeneration,
      revision: allowanceRevision,
    }),
    [
      modules.token,
      modules.assetKind,
      modules.poolAddress,
      modules.chainId,
      signer,
      account,
      walletGeneration,
      allowanceRevision,
    ],
  );
  const [allowanceSnapshot, setAllowanceSnapshot] = useState<{
    scope: typeof allowanceScope;
    amount: bigint;
  } | null>(null);
  const allowanceReady = useMemo(() => {
    if (modules.assetKind === "native") return true;
    if (!signer || allowanceSnapshot?.scope !== allowanceScope) return false;
    try {
      return allowanceSnapshot.amount >= parseUnits(amount || "0", modules.tokenDecimals ?? 0);
    } catch {
      return false;
    }
  }, [modules.assetKind, modules.tokenDecimals, signer, allowanceSnapshot, allowanceScope, amount]);
  const context: ShieldedWorkerContext = {
    rpcUrl: config.rpcUrl,
    stateReadMode: normalizeShieldedStateReadMode(config.stateReadMode),
    chainId: String(modules.chainId),
    factoryAddress: String(modules.factory.target),
    factoryDeploymentBlock: getShieldedPoolFactoryDeploymentBlock(Number(modules.chainId)),
    familyAddress: String(modules.deepFamily.target),
    lineageIndexAddress: String(modules.lineageIndex.target),
    poolAddress: modules.poolAddress,
    poolDeploymentBlock: modules.poolDeploymentBlock,
    assetKind: modules.assetKind,
    lettersAddress: getPrivateLetterArchiveAddress(Number(modules.chainId)),
    lettersDeploymentBlock: getPrivateLetterArchiveDeploymentBlock(Number(modules.chainId)),
  };
  const contextKey = JSON.stringify(context),
    contextRef = useRef(contextKey);
  const protocolContextKey = JSON.stringify({ ...context, stateReadMode: undefined });
  const ownerContextKey = JSON.stringify([
    session.credentials?.handle,
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
  ]);
  const previousContext = useRef({ contextKey, protocolContextKey, ownerContextKey });
  contextRef.current = contextKey;
  const draftKey = JSON.stringify([
    contextKey,
    session.identity?.handle,
    slot,
    selectedKeyFingerprint,
    rootVersion,
    amount,
    periodDays,
  ]);
  const hasSession = !!session.credentials;
  const independentBackupPending = !!exportedFingerprint || !!session.independentKey?.backupRequired;
  const accessFlow = independentBackupPending
    ? "backup"
    : independentKeyFlow === "backup" && !session.independentKey
      ? "restore"
      : independentKeyFlow;
  const independentKeyReady = !!session.independentKey?.recoveryVerified && !session.independentKey.backupRequired;
  // The overview reflects completed key setup; pending backup steps stay inside the sheet.
  const independentKeyState = independentKeyReady ? "ready" : "setup";
  const independentKeySelectionMatches =
    !!selectedKeyFingerprint && selectedKeyFingerprint === session.independentKey?.keyFingerprint;
  if (confirmedOverviewKey.current?.credentialsHandle !== session.credentials?.handle)
    confirmedOverviewKey.current = null;
  if (session.credentials && independentKeyReady && independentKeySelectionMatches)
    confirmedOverviewKey.current = {
      credentialsHandle: session.credentials.handle,
      fingerprint: selectedKeyFingerprint,
    };
  // Keep the explicit owner even when its key becomes unavailable; never redirect a deposit or spend.
  const slotReady = slot === "identity" ? !!session.identity : independentKeyReady && independentKeySelectionMatches;
  const workspaceVisible = hasSession && walletScreen === "workspace";
  // Key management opened from a task stays in that task's container, including
  // the backup drill that temporarily removes the independent key root from the Worker.
  const independentKeyInWorkspace = walletScreen === "manage" && independentKeyOpenedFromWorkspace.current;
  const showWorkspace =
    workspaceVisible ||
    independentKeyInWorkspace ||
    (walletScreen === "workspace" && independentKeyOpenedFromWorkspace.current && independentBackupPending);
  const identityAccess = walletScreen !== "manage";
  const overviewHash =
    session.identity?.personHash ??
    session.independentKey?.keyFingerprint ??
    (exportedFingerprint || expectedFingerprint || "—");
  // Keep both wallet balances for comparison; the overview shows the current wallet.
  const valueTotals = { identity: 0n, independent: 0n };
  const budgetTotals = { identity: 0n, independent: 0n };
  for (const note of wallet?.notes ?? []) {
    if (!(note.slot === "identity" ? session.identity : independentKeyReady)) continue;
    if (note.slot === "independent" && note.ownerCommitment !== session.independentKey?.ownerCommitment) continue;
    if (note.kind === "value") valueTotals[note.slot] += BigInt(note.amount);
    else if (!note.pendingIdentity) budgetTotals[note.slot] += BigInt(note.amount);
  }
  useEffect(() => {
    const target =
      focusDestination.current === "access" && !showWorkspace
        ? accessRegion.current
        : focusDestination.current === "task" && showWorkspace
          ? taskRegion.current
          : null;
    if (target && document.visibilityState === "visible") {
      target.focus({ preventScroll: true });
      focusDestination.current = null;
    }
  }, [showWorkspace, walletScreen, independentKeyInWorkspace]);
  const values =
    wallet?.notes.filter(
      (note) =>
        note.kind === "value" &&
        (slot === "identity" ? !!session.identity : independentKeyReady && independentKeySelectionMatches) &&
        note.slot === slot &&
        (slot === "identity" || note.ownerCommitment === session.independentKey?.ownerCommitment) &&
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
  const effectiveEntry: ShieldedFundingEntry = template
    ? template.bindingKind === 1
      ? "public"
      : template.keyMode === 1
        ? "privateIndependent"
        : "privateConvenient"
    : entry;
  const needsCode =
    action === "privateTransfer" || (action === "fund" && effectiveEntry !== "public");
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
      (verifiedRecipient.personHash?.toLowerCase() === personHash.toLowerCase() &&
        verifiedRecipient.keyMode === (effectiveEntry === "privateIndependent" ? 1 : 0)));
  const recipientReady =
    recipientMatches &&
    recipientInputMethod === "receiveCode" &&
    (!recipientNeedsConfirmation || recipientConfirmed);
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
  const budgetLetter = useBudgetLetterDelivery({
    context,
    scope: JSON.stringify([ownerContextKey, account]),
    signer: signer ?? null,
    beginWalletRequest: () => latestSession.current.beginWalletRequest(),
  });
  const latestBudgetLetter = useRef(budgetLetter);
  latestBudgetLetter.current = budgetLetter;
  const actionRequestKey = JSON.stringify([
    contextKey,
    session.credentials?.handle,
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
    action,
    slot,
    selectedKeyFingerprint,
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
    budgetLetter.enabled,
    budgetLetter.body,
  ]);
  const currentRequestKey = useRef(actionRequestKey);
  currentRequestKey.current = actionRequestKey;
  function clearWalletSecretInputs() {
    exportedMaterial.current?.clear();
    if (recoveryMaterial.current) recoveryMaterial.current.value = "";
  }
  function clearSecretInputs() {
    identityForm.current?.clearSecretInputs();
    recipientForm.current?.clearSecretInputs();
    clearWalletSecretInputs();
  }
  const clearRef = useRef(clearSecretInputs);
  clearRef.current = clearSecretInputs;
  const lockRef = useRef(lock);
  lockRef.current = lock;
  function settleSpendReview(review: SpendReview, confirmed: boolean) {
    const pending = pendingSpendReview.current;
    if (pending?.review !== review) return;
    pendingSpendReview.current = null;
    if (mounted.current) {
      setSpendReview(null);
      if (confirmed) setExecutingReview(review);
    }
    if (!confirmed) void cancelShieldedAssetPreview().catch(() => undefined);
    pending.resolve(confirmed);
  }
  function cancelSpendReview() {
    const pending = pendingSpendReview.current;
    if (pending) settleSpendReview(pending.review, false);
  }
  function reviewSpend(review: SpendReview): Promise<boolean> {
    return new Promise((resolve) => {
      pendingSpendReview.current = { review, resolve };
      // Waiting for a person is idle time. Keep the form frozen while allowing
      // the normal session idle lock (or pool navigation) to cancel this review.
      latestSession.current.setBusy(false);
      setStage("");
      setSpendReview(review);
    });
  }
  function invalidateWalletOperation() {
    if (activeSignatureRequest.current !== null) {
      lockRef.current();
      return;
    }
    if (activeOperation.current?.scope !== "wallet") return;
    cancelSpendReview();
    activeOperation.current = null;
    acceptPublicSyncProgress.current = false;
    setBusy(false);
    setBalancesRefreshing(false);
    setStage("");
    setPlanCount(0);
    latestSession.current.setBusy(false);
    void cancelShieldedAssetPreview().catch(() => undefined);
  }
  useEffect(() => {
    mounted.current = true;
    // StrictMode and Fast Refresh re-run this effect on the same instance; an
    // operation it already started stays current and keeps the session busy.
    if (activeOperation.current) latestSession.current.setBusy(true);
    const clear = () => clearRef.current();
    const hidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (latestSession.current.isWalletRequestPending()) {
        clear();
        return;
      }
      lockRef.current();
    };
    const pagehide = () => lockRef.current();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    const unsubscribeLock = subscribeShieldedAssetWorkerLock(() => {
      cancelSpendReview();
      autoRecoveryBlocked.current = true;
      independentKeyOpenedFromWorkspace.current = false;
      signatureRequest.current++;
      activeSignatureRequest.current = null;
      activeOperation.current = null;
      letterOperationPending.current = false;
      readModeRefreshScope.current = null;
      acceptPublicSyncProgress.current = false;
      clear();
      if (mounted.current) {
        setBusy(false);
        setBalancesRefreshing(false);
        setStage("");
        setError("");
        setCodeError("");
        setReadModeRefreshing(false);
        clearTransactionFeedback(true);
        latestSession.current.setBusy(false);
        setWalletSection("balances");
        setOwnCode("");
        setLetterBudget("");
        setWalletScreen("workspace");
        setProgress(null);
        setExecutingReview(null);
        setCompletedSpendSteps([]);
      }
    });
    const unsubscribeWallet = subscribeWalletConnectionChange(() => {
      // Invalidate wallet work before asynchronous signer refresh reaches React.
      // Local key operations still have to publish the Worker's completed state.
      clear();
      setAllowanceSnapshot(null);
      invalidateWalletOperation();
    });
    return () => {
      // After a real unmount, mounted.current already rejects late results.
      mounted.current = false;
      letterOperationPending.current = false;
      readModeRefreshScope.current = null;
      cancelSpendReview();
      signatureRequest.current++;
      clear();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      unsubscribeLock();
      unsubscribeWallet();
      latestSession.current.setBusy(false);
      void cancelShieldedAssetPreview().catch(() => undefined);
    };
  }, []);
  useEffect(() => subscribePublicStateSyncProgress((event) => {
    if (!mounted.current || !acceptPublicSyncProgress.current) return;
    setPublicSyncProgress((previous) => ({
      ...previous,
      [event.domain]: { ...event, resumed: event.resumed || previous[event.domain]?.resumed },
    }));
    setPublicSyncPaused(false);
  }), []);
  useEffect(() => {
    const preserveView = previousContext.current.contextKey !== contextKey &&
      previousContext.current.protocolContextKey === protocolContextKey &&
      previousContext.current.ownerContextKey === ownerContextKey;
    if (previousContext.current.contextKey !== contextKey) {
      const protocolChanged = previousContext.current.protocolContextKey !== protocolContextKey;
      setPublicSyncProgress({});
      setPublicSyncPaused(false);
      if (protocolChanged) {
        lockRef.current();
        receiptTracking.current = null;
        setTransactionHash("");
        setTransactionLabel("");
        setTransactionPending(false);
        setTransactionResult(null);
      } else {
        // Read strategy changes invalidate prepared work, not the unlocked keys.
        if (preserveView && (session.identity || independentKeyReady)) {
          readModeRefreshScope.current = contextKey;
          setReadModeRefreshing(true);
        } else {
          readModeRefreshScope.current = null;
          setReadModeRefreshing(false);
        }
        cancelSpendReview();
        activeOperation.current = null;
        setBalancesRefreshing(false);
        acceptPublicSyncProgress.current = letterOperationPending.current;
        autoRecoveryBlocked.current = false;
        clearRef.current();
        if (!letterOperationPending.current) {
          setBusy(false);
          latestSession.current.setBusy(false);
        }
        setStage("");
        setError("");
        setCodeError("");
        setProgress(null);
        setExecutingReview(null);
        setCompletedSpendSteps([]);
        setPlanCount(0);
        void cancelShieldedAssetPreview().catch(() => undefined);
      }
    }
    previousContext.current = { contextKey, protocolContextKey, ownerContextKey };
    if (!preserveView) {
      setWallet(null);
      setDiscovery(null);
      setCandidates([]);
      readModeRefreshScope.current = null;
      setReadModeRefreshing(false);
    }
    setOwnCode("");
    draftPolicy.current = null;
  }, [
    session.credentials?.handle,
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
    contextKey,
    protocolContextKey,
    ownerContextKey,
  ]);
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
    setTransactionLabel(pendingRecord.label);
    setTransactionResult(null);
    setTransactionPending(true);
  }, [pendingRecord, modules.pool, modules.chainId]);
  useEffect(() => {
    const previous = previousGasWallet.current;
    previousGasWallet.current = { signer, account };
    if (previous.signer === signer && previous.account === account) return;
    clearSecretInputs();
    signatureRequest.current++;
    invalidateWalletOperation();
  }, [signer, account]);
  useEffect(() => {
    if (draftPolicy.current?.key !== draftKey) {
      draftPolicy.current = null;
    }
  }, [draftKey]);
  useEffect(() => {
    setOwnCode("");
  }, [codeSlot]);
  // Keep trusted recovery evidence across clearIndependentKey, scoped to the credentials that
  // established it. History confirmation is evidence too; a lock or replacement resets it.
  useEffect(() => {
    const handle = session.credentials?.handle;
    if (previousCredentialsHandle.current !== handle) {
      previousCredentialsHandle.current = handle;
      trustedRecoveryKey.current = null;
      pendingBackupDrill.current = null;
      setExpectedFingerprint("");
      setExportedFingerprint("");
      setExternalSaved(false);
      setVerificationStarted(false);
      setRecoveryScanned(false);
      setShowRecoveryCandidate(false);
      setIndependentKeyFlow("restore");
      clearSecretInputs();
    }
    if (handle && session.independentKey?.recoveryVerified && !session.independentKey.backupRequired) {
      trustedRecoveryKey.current = { credentialsHandle: handle, fingerprint: session.independentKey.keyFingerprint };
      pendingBackupDrill.current = null;
      setExpectedFingerprint(session.independentKey.keyFingerprint);
    }
  }, [
    session.credentials?.handle,
    session.independentKey?.keyFingerprint,
    session.independentKey?.recoveryVerified,
    session.independentKey?.backupRequired,
  ]);
  useEffect(() => {
    const first =
      wallet?.claims.find((claim) => claim.slot === slot && claim.status === "claimable") ??
      wallet?.claims.find((claim) => claim.slot === slot);
    setClaimHandle(first?.handle ?? "");
    setClaimPeriods(first?.periodIndices ?? []);
  }, [slot, selectedKeyFingerprint, wallet]);
  useEffect(() => {
    cancelSpendReview();
    setCompletedSpendSteps([]);
    void cancelShieldedAssetPreview().catch(() => undefined);
  }, [actionRequestKey]);
  useEffect(() => {
    const { signer, token, assetKind, account, poolAddress, walletGeneration } = allowanceScope;
    if (!signer || !token || assetKind !== "erc20") return;
    let cancelled = false;
    const current = () => !cancelled && walletGeneration === getWalletConnectionGeneration();
    void token.allowance(account, poolAddress)
      .then((value: bigint) => {
        if (current()) setAllowanceSnapshot({ scope: allowanceScope, amount: getBigInt(value) });
      })
      .catch(() => {
        if (current()) setAllowanceSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [allowanceScope]);

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
      const keyFingerprint = latestSession.current.independentKey?.keyFingerprint;
      try {
        if (activeOperation.current) return;
        const outcome = await readShieldedSubmissionOutcome(tracked);
        if (!current() || receiptTracking.current !== tracked || activeOperation.current) return;
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
        setTransactionLabel(tracked.label);
        if (outcome.status === "confirmed") setTransactionHash(outcome.hash);
        if (!transactionFeedbackDismissed && latestSession.current.credentials) {
          setError(
            successful || unknownApproval
              ? ""
              : outcome.status === "replaced"
                ? latestTranslations.current.tr("nonceConsumed")
                : latestTranslations.current.t("shielded.transactionFailed", { hash: outcome.hash }),
          );
        }
        // A recovered deposit may have consumed its approval, including when
        // a replacement's exact receipt cannot be identified. Re-read current state.
        setAllowanceRevision((revision) => revision + 1);
        // A public result must not clear a newer secret session's selection.
        if (
          generation === getShieldedAssetWorkerGeneration() &&
          identityHandle === latestSession.current.identity?.handle &&
          keyFingerprint === latestSession.current.independentKey?.keyFingerprint
        ) {
          autoRecoveryScope.current = "";
          setWallet(null);
          setCandidates([]);
        }
        const letters = latestBudgetLetter.current;
        if (!successful) letters.cancelDeposit(tracked.id);
        else if (letters.hasDeposit(tracked.id)) {
          await run(walletCurrent => latestBudgetLetter.current.confirmDeposit(tracked.id, walletCurrent),
            latestTranslations.current.t("shielded.privateLetters.sendingAfterFunding"), "wallet");
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
  }, [
    busy,
    submissionPending,
    contextKey,
    transactionHash,
    pendingRecord?.id,
    transactionFeedbackDismissed,
  ]);
  async function run(
    task: (current: () => boolean) => Promise<void>,
    label: string,
    operationScope: OperationScope = "session",
  ) {
    if (activeOperation.current) return;
    const operation = { scope: operationScope };
    activeOperation.current = operation;
    acceptPublicSyncProgress.current = true;
    setPublicSyncProgress({});
    setPublicSyncPaused(false);
    const scope = contextKey;
    const generation = getShieldedAssetWorkerGeneration();
    const walletGeneration = getWalletConnectionGeneration();
    const wallet = walletRef.current;
    const current = () =>
      mounted.current &&
      activeOperation.current === operation &&
      scope === contextRef.current &&
      generation === getShieldedAssetWorkerGeneration() &&
      (operationScope === "session" ||
        (walletGeneration === getWalletConnectionGeneration() &&
          wallet.signer === walletRef.current.signer &&
          wallet.account === walletRef.current.account));
    setBusy(true);
    latestSession.current.setBusy(true);
    setError("");
    setStage(label);
    latestSession.current.touch();
    try {
      await task(current);
    } catch (cause) {
      if (current()) {
        const reason = resolveErrorReason(cause);
        if (cause instanceof ShieldedDepositBalanceError) {
          setError(t("shielded.depositBalanceInsufficient", {
            balance: formatUnits(cause.balance, modules.tokenDecimals ?? 0),
            amount: formatUnits(cause.amount, modules.tokenDecimals ?? 0),
            symbol: modules.assetSymbol,
          }));
        } else if (reason === "ERC20InsufficientAllowance") {
          // The allowance may also change outside this page while a proof is prepared.
          setAllowanceRevision((revision) => revision + 1);
          setError(getFriendlyErrorMessage(cause, t, tr("failed")));
        } else if (
          (reason && Object.prototype.hasOwnProperty.call(REASON_FRIENDLY_MAP, reason)) ||
          (cause && typeof cause === "object" && "code" in cause && cause.code === "CALL_EXCEPTION")
        ) {
          setError(getFriendlyErrorMessage(cause, t, tr("failed")));
        } else {
          setError(cause instanceof Error ? cause.message : tr("failed"));
        }
      }
    } finally {
      if (activeOperation.current === operation) {
        activeOperation.current = null;
        acceptPublicSyncProgress.current = false;
        if (mounted.current) {
          setBusy(false);
          setBalancesRefreshing(false);
          setStage("");
          setProgress(null);
          setExecutingReview(null);
          latestSession.current.setBusy(false);
        }
      }
    }
  }
  async function unlock() {
    await run(async (current) => {
      const form = identityForm.current;
      if (!form) return;
      const identity = form.getRawIdentityFields();
      let rawPassphrase = form.getSecretInputs().passphrase;
      form.clearSecretInputs();
      try {
        normalizeShieldedIndependentKeyIdentity(identity);
        normalizeShieldedIndependentKeyPassphrase(rawPassphrase);
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
          // Receiving setup can reset after an unlock; the selected funds owner stays explicit.
          if (!(state.independentKey?.recoveryVerified && !state.independentKey.backupRequired)) {
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
    cancelSpendReview();
    autoRecoveryBlocked.current = true;
    independentKeyOpenedFromWorkspace.current = false;
    focusDestination.current = "access";
    signatureRequest.current++;
    activeSignatureRequest.current = null;
    activeOperation.current = null;
    letterOperationPending.current = false;
    readModeRefreshScope.current = null;
    acceptPublicSyncProgress.current = false;
    setBusy(false);
    setBalancesRefreshing(false);
    setStage("");
    setError("");
    setCodeError("");
    setReadModeRefreshing(false);
    clearTransactionFeedback(true);
    latestSession.current.setBusy(false);
    clearSecretInputs();
    latestSession.current.lock();
    setWalletSection("balances");
    setOwnCode("");
    setLetterBudget("");
    setLetterView(null);
    setWalletScreen("workspace");
    setPlanCount(0);
    setProgress(null);
    setExecutingReview(null);
    setCompletedSpendSteps([]);
    draftPolicy.current = null;
  }
  /** An explicit exit also forgets the public person details kept for re-unlock. */
  function exitSession() {
    latestSession.current.rememberIdentityDraft(null);
    setIdentityFormEpoch((epoch) => epoch + 1);
    lock();
  }
  /** Drops only the independent root inside the Worker; an unlocked identity stays. */
  async function clearIndependentKeyRoot() {
    const credentialsHandle = latestSession.current.credentials?.handle;
    const generation = getShieldedAssetWorkerGeneration();
    const state = await shieldedAssetWorkerCall("clearIndependentKey", {});
    if (
      !mounted.current ||
      generation !== getShieldedAssetWorkerGeneration() ||
      credentialsHandle !== latestSession.current.credentials?.handle
    )
      return;
    draftPolicy.current = null;
    latestSession.current.update(state);
  }
  function selectWallet(next: ShieldedKeySlot) {
    if (busy || submissionPending) return;
    budgetLetter.clear();
    setSlot(next);
    if (next === "independent") setSelectedKeyFingerprint(session.independentKey?.keyFingerprint ?? "");
    draftPolicy.current = null;
    setCandidates([]);
    setClaimHandle("");
    setClaimPeriods([]);
    if (next !== codeSlot) {
      receiveCodeScope.current = "";
      setCodeSlot(next);
      setOwnCode("");
    }
    setError("");
  }
  /** Closes the wallet sheet; its secrets are cleared and the workspace stays as it was. */
  function closeWalletSheet() {
    if (busy) return;
    clearWalletSecretInputs();
    setWalletSection("balances");
    setOwnCode("");
    if (hasSession) setWalletScreen("workspace");
  }
  function openReceiveCode(next: ShieldedKeySlot) {
    if (busy || submissionPending) return;
    clearWalletSecretInputs();
    receiveCodeScope.current = "";
    setCodeSlot(next);
    setOwnCode("");
    setWalletSection("receiveCode");
    if (hasSession) setWalletScreen("workspace");
  }
  function showIndependentKeyManager(flow: "restore" | "create" | "backup") {
    independentKeyOpenedFromWorkspace.current = showWorkspace;
    setTaskChosen(true);
    clearWalletSecretInputs();
    setWalletSection("keys");
    // In the workspace the key sheet takes focus itself; the entry card is focused here.
    focusDestination.current = showWorkspace ? null : "access";
    setRecoveryScanned(false);
    setShowRecoveryCandidate(false);
    setIndependentKeyFlow(flow);
    setWalletScreen("manage");
    setError("");
  }
  /** Setup entries honor their action; unfinished creation never hijacks unlocking. */
  function openIndependentKeyManager(flow: "restore" | "create" | "backup") {
    if (!latestSession.current.credentials || busy || submissionPending || activeOperation.current)
      return;
    const key = latestSession.current.independentKey;
    if (flow === "create" && key?.recoveryVerified) return;
    if (flow === "backup" || (!key?.backupRequired && !exportedFingerprint)) {
      showIndependentKeyManager(flow);
      return;
    }
    void run(async (current) => {
      const credentialsHandle = latestSession.current.credentials?.handle;
      if (!credentialsHandle) return;
      const pendingKey = latestSession.current.independentKey;
      let fingerprint: string | undefined;
      if (pendingKey) {
        if (!pendingKey.backupRequired || pendingKey.recoveryVerified) return;
        fingerprint = pendingKey.keyFingerprint;
        const state = await shieldedAssetWorkerCall("clearPendingIndependentKey", {
          expectedCredentialsHandle: credentialsHandle,
          expectedFingerprint: fingerprint,
        });
        if (!current() || latestSession.current.credentials?.handle !== credentialsHandle) return;
        const installed = latestSession.current.independentKey;
        if (
          installed &&
          (installed.keyFingerprint !== fingerprint || !installed.backupRequired || installed.recoveryVerified)
        )
          return;
        if (state.credentials?.handle !== credentialsHandle || state.independentKey) return;
        draftPolicy.current = null;
        latestSession.current.update(state);
      } else {
        const drill = pendingBackupDrill.current;
        // Only an unfinished new key's pin is a draft. An established wallet keeps
        // its trusted fingerprint when leaving a backup drill for another entry.
        if (
          drill?.credentialsHandle === credentialsHandle && drill.fingerprint === exportedFingerprint
        ) {
          fingerprint = drill.fingerprint;
        }
      }
      if (!current() || latestSession.current.credentials?.handle !== credentialsHandle) return;
      clearWalletSecretInputs();
      setExpectedFingerprint((previous) =>
        previous === fingerprint
          ? trustedRecoveryKey.current?.credentialsHandle === credentialsHandle
            ? trustedRecoveryKey.current.fingerprint
            : ""
          : previous,
      );
      setExportedFingerprint("");
      setExternalSaved(false);
      setVerificationStarted(false);
      setRecoveryScanned(false);
      setOwnCode("");
      receiveCodeScope.current = "";
      pendingBackupDrill.current = null;
      showIndependentKeyManager(flow);
    }, "");
  }
  function chooseAction(next: Action) {
    budgetLetter.clear();
    setLetterView(null);
    clearSecretInputs();
    setTaskChosen(true);
    draftPolicy.current = null;
    changeCode("");
    setRecipientInputMethod("receiveCode");
    recipientForm.current?.clearSecretInputs();
    setStage("");
    if (!submissionPending) {
      setTransactionHash("");
      setTransactionLabel("");
      setTransactionResult(null);
    }
    if (next === "claim") {
      const first =
        wallet?.claims.find((claim) => claim.slot === slot && claim.status === "claimable") ??
        wallet?.claims.find((claim) => claim.slot === slot);
      setClaimHandle(first?.handle ?? "");
      setClaimPeriods(first?.periodIndices ?? []);
    }
    setAction(next);
    if (walletSection !== "keys") setWalletScreen(!session.credentials ? "identity" : "workspace");
    setCandidates([]);
    setError("");
  }
  /** Return with the operation's fresh public state, without resetting task drafts. */
  function returnToTask(state: ShieldedAssetSessionState = latestSession.current) {
    clearWalletSecretInputs();
    const ready = !!state.independentKey?.recoveryVerified && !state.independentKey.backupRequired;
    // Closing the key sheet returns focus to the control that opened it.
    focusDestination.current = state.credentials ? null : "access";
    setWalletSection("balances");
    setWalletScreen(state.credentials ? "workspace" : "identity");
    autoRecoveryBlocked.current = false;
    if (!independentBackupPending || ready) independentKeyOpenedFromWorkspace.current = false;
  }
  function finishIndependentKeyRecovery(state: ShieldedAssetSessionState) {
    if (state.independentKey?.recoveryVerified && !state.independentKey.backupRequired) returnToTask(state);
  }
  function navigateToAction(next: ShieldedTask) {
    if (next === "writeLetter" || next === "letterInbox") {
      cancelSpendReview();
      chooseAction(action);
      setWalletSection("balances");
      setLetterView(next === "writeLetter" ? "write" : "inbox");
    } else if (next !== action || letterView) chooseAction(next);
  }
  async function requestSignature(intent: "create" | "restore") {
    await run(async (current) => {
      if (!signer) throw new Error(t("shielded.walletNotReady"));
      const credentialsHandle = latestSession.current.credentials?.handle;
      if (!credentialsHandle) throw new Error(tr("independentKeyIdentityNeeded"));
      const chosen = signer;
      const generation = getShieldedAssetWorkerGeneration();
      const walletGeneration = getWalletConnectionGeneration();
      const requestId = ++signatureRequest.current;
      activeSignatureRequest.current = requestId;
      try {
        const address = getAddress(await chosen.getAddress());
        const valid = () =>
          current() &&
          document.visibilityState === "visible" &&
          requestId === signatureRequest.current &&
          generation === getShieldedAssetWorkerGeneration() &&
          walletGeneration === getWalletConnectionGeneration() &&
          credentialsHandle === latestSession.current.credentials?.handle &&
          walletRef.current.signer === chosen &&
          walletRef.current.account.toLowerCase() === address.toLowerCase();
        if (!valid()) return;
        if (intent === "restore" && independentBackupPending)
          throw new Error(tr("independentBackupRequired"));
        const expected = expectedFingerprint || undefined;
        const openedFromWorkspace = independentKeyOpenedFromWorkspace.current;
        clearSecretInputs();
        await clearIndependentKeyRoot();
        if (!valid()) return;
        setWalletScreen("manage");
        let signature = "";
        try {
          const deadline = Date.now() + SHIELDED_WALLET_REQUEST_TIMEOUT_MS;
          const endWalletRequest = latestSession.current.beginWalletRequest();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            signature = await Promise.race([
              chosen.signMessage(toUtf8Bytes(buildShieldedIndependentKeySigningMessage(address))),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error(tr("signatureExpired"))),
                  SHIELDED_WALLET_REQUEST_TIMEOUT_MS,
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
            // Restore the normal visibility lock before any Worker derivation.
            endWalletRequest();
          }
          if (Date.now() >= deadline || !valid()) return;
          const pending =
            intent === "create"
              ? shieldedAssetWorkerCall("createIndependentKey", {
                  intent: "create",
                  rootSource: "walletSignature",
                  expectedCredentialsHandle: credentialsHandle,
                  signerAddress: address,
                  signature,
                  context,
                })
              : shieldedAssetWorkerCall("restoreSignature", {
                  expectedCredentialsHandle: credentialsHandle,
                  signerAddress: address,
                  signature,
                  expectedFingerprint: expected,
                  context,
                });
          signature = "";
          const state = await pending;
          if (valid()) {
            independentKeyOpenedFromWorkspace.current = openedFromWorkspace;
            latestSession.current.update(state);
            setRecoveryScanned(false);
            setShowRecoveryCandidate(
              !!state.independentKey && !state.independentKey.recoveryVerified && !state.independentKey.backupRequired,
            );
            if (intent === "create" || expected)
              setExpectedFingerprint(state.independentKey?.keyFingerprint ?? expected ?? "");
            if (intent === "create") {
              setExportedFingerprint("");
              setExternalSaved(false);
              setVerificationStarted(false);
            }
            const needsBackup = intent === "create" || state.independentKey?.backupRequired;
            setIndependentKeyFlow(needsBackup ? "backup" : "restore");
            setWalletScreen("manage");
            if (intent === "restore" && !needsBackup) finishIndependentKeyRecovery(state);
          }
        } finally {
          signature = "";
        }
      } finally {
        if (activeSignatureRequest.current === requestId) activeSignatureRequest.current = null;
      }
    }, tr("signing"), "wallet");
  }
  async function createIndependentKey(source: "random" | "walletSignature") {
    if (source === "walletSignature") return requestSignature("create");
    await run(async (current) => {
      const credentialsHandle = latestSession.current.credentials?.handle;
      if (!credentialsHandle) throw new Error(tr("independentKeyIdentityNeeded"));
      clearSecretInputs();
      if (latestSession.current.independentKey) await clearIndependentKeyRoot();
      if (!current() || credentialsHandle !== latestSession.current.credentials?.handle) return;
      const state = await shieldedAssetWorkerCall("createIndependentKey", {
        intent: "create",
        rootSource: "random",
        expectedCredentialsHandle: credentialsHandle,
        context,
      });
      if (current() && credentialsHandle === latestSession.current.credentials?.handle) {
        latestSession.current.update(state);
        setExpectedFingerprint(state.independentKey!.keyFingerprint);
        setExportedFingerprint("");
        setExternalSaved(false);
        setVerificationStarted(false);
        setIndependentKeyFlow("backup");
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
        exportedMaterial.current?.show(result.material);
        setExportedFingerprint(result.keyFingerprint);
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
      const credentialsHandle = latestSession.current.credentials?.handle;
      if (!credentialsHandle) throw new Error(tr("independentKeyIdentityNeeded"));
      if (exportedFingerprint && (!externalSaved || !verificationStarted))
        throw new Error(tr("saveExternalFirst"));
      let material = recoveryMaterial.current?.value ?? "";
      const fingerprint = exportedFingerprint || expectedFingerprint || undefined;
      clearSecretInputs();
      try {
        if (latestSession.current.independentKey) await clearIndependentKeyRoot();
        if (!current() || credentialsHandle !== latestSession.current.credentials?.handle) return;
        const pending = shieldedAssetWorkerCall("importRecoveryMaterial", {
          expectedCredentialsHandle: credentialsHandle,
          format,
          material,
          expectedFingerprint: fingerprint,
          context,
        });
        material = "";
        const state = await pending;
        if (current() && credentialsHandle === latestSession.current.credentials?.handle) {
          latestSession.current.update(state);
          setRecoveryScanned(false);
          setShowRecoveryCandidate(
            !!state.independentKey && !state.independentKey.recoveryVerified && !state.independentKey.backupRequired,
          );
          setIndependentKeyFlow(state.independentKey?.backupRequired ? "backup" : "restore");
          setWalletScreen("manage");
          if (fingerprint) setExpectedFingerprint(fingerprint);
          setExportedFingerprint("");
          setExternalSaved(false);
          setVerificationStarted(false);
          finishIndependentKeyRecovery(state);
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
      const key = latestSession.current.independentKey;
      const credentialsHandle = latestSession.current.credentials?.handle;
      pendingBackupDrill.current =
        credentialsHandle && key?.backupRequired && !key.recoveryVerified
          ? { credentialsHandle, fingerprint: key.keyFingerprint }
          : null;
      clearSecretInputs();
      await clearIndependentKeyRoot();
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
    const refreshingReadMode = readModeRefreshScope.current === contextKey;
    try {
      await run(async (current) => {
        setBalancesRefreshing(true);
        if (allPools) setDiscovery(null);
        const result = await shieldedAssetWorkerCall("recover", { context });
        let recoveredState = result.sessionState;
        if (current()) {
          setBalancesRefreshing(false);
          if (result.sessionState) latestSession.current.update(result.sessionState);
          setWallet(result);
          setRecoveryScanned(true);
          setCandidates((previous) => refreshingReadMode
            ? previous.filter((commitment) => result.notes.some((note) => note.kind === "value" && note.commitment === commitment))
            : []);
          if (!taskChosen && session.identity) {
            setTaskChosen(true);
            const next = result.notes.some(
              (note) =>
                note.kind === "budget" &&
                note.slot === slot &&
                BigInt(note.amountPerPeriod ?? "0") > 0n &&
                BigInt(note.amount) >= BigInt(note.amountPerPeriod ?? "0"),
            )
              ? "claim"
              : result.notes.some(
                    (note) => note.kind === "value" && note.slot === slot && BigInt(note.amount) > 0n,
                  )
                ? "privateTransfer"
                : "shield";
            setAction(next);
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
          finishIndependentKeyRecovery(recoveredState);
      }, t("shielded.stages.recovering"));
    } finally {
      if (mounted.current && contextRef.current === contextKey && readModeRefreshScope.current === contextKey) {
        readModeRefreshScope.current = null;
        setReadModeRefreshing(false);
      }
    }
  }
  useEffect(() => {
    if (!session.identity && !independentKeyReady) {
      autoRecoveryScope.current = "";
      return;
    }
    if (autoRecoveryBlocked.current || walletScreen !== "workspace" || busy || activeOperation.current || letterOperationPending.current)
      return;
    const scope = JSON.stringify([
      contextKey,
      session.identity?.handle,
      session.independentKey?.keyFingerprint,
    ]);
    if (autoRecoveryScope.current === scope) return;
    autoRecoveryScope.current = scope;
    void recover();
  }, [
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
    independentKeyReady,
    contextKey,
    walletScreen,
    busy,
  ]);
  async function createCode(receivingSlot: ShieldedKeySlot = codeSlot) {
    await run(async (current) => {
      if (!Number.isFinite(new Date(codeExpiry).getTime()) || new Date(codeExpiry).getTime() <= Date.now()) throw new Error(t("shielded.privateLetters.expiryFuture"));
      const result = await shieldedAssetWorkerCall(
        "receiveCode",
        { slot: receivingSlot, context, disclosure: codeDisclosure, expiresAt: String(Math.floor(new Date(codeExpiry).getTime() / 1000)) },
        { timeoutMs: 1_200_000 },
      );
      if (current()) setOwnCode(result.code);
    }, t("shielded.stages.receiveCode"));
  }
  async function revokeReceiveCodes() {
    await run(async (current) => {
      if (!signer) throw new Error(t("shielded.walletNotReady"));
      const chosen = signer;
      const result = await shieldedAssetWorkerCall("authorizeIdentityCounter", { context }, { timeoutMs: 1_200_000 });
      if (!current()) return;
      if ((await chosen.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await chosen.getAddress()).toLowerCase() !== account.toLowerCase() || walletRef.current.signer !== chosen)
        throw new Error(t("shielded.walletChanged"));
      if (!current()) return;
      const contract = createIdentityAuthorizationContract(result.address, chosen);
      const endWalletRequest = latestSession.current.beginWalletRequest();
      let transaction: ContractTransactionResponse;
      try {
        transaction = await contract.incrementCounter(...result.args, { chainId: modules.chainId });
      } finally { endWalletRequest(); }
      const confirmed = await waitForShieldedTransaction(transaction);
      if (confirmed.receipt.status !== 1) throw new Error(t("shielded.transactionFailed", { hash: confirmed.transactionHash }));
      if (current()) { setOwnCode(""); receiveCodeScope.current = ""; }
    }, t("shielded.privateLetters.revoking"), "wallet");
  }
  const receiveCodeReady = !!session.identity && (codeSlot === "identity" || independentKeyReady);
  // Each explicit open or wallet switch generates a receive code once; after a failure the
  // button retries.
  // A layout effect starts the job before paint, so the retry button never flashes first.
  useLayoutEffect(() => {
    if (walletSection !== "receiveCode") {
      receiveCodeScope.current = "";
      return;
    }
    if (ownCode || !receiveCodeReady || busy || submissionPending || activeOperation.current) return;
    const scope = JSON.stringify([
      contextKey,
      codeSlot,
      session.identity?.handle,
      session.independentKey?.keyFingerprint,
    ]);
    if (receiveCodeScope.current === scope) return;
    receiveCodeScope.current = scope;
    void createCode(codeSlot);
  }, [
    walletSection,
    ownCode,
    codeSlot,
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
    receiveCodeReady,
    contextKey,
    busy,
    submissionPending,
  ]);
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
        const pending = createShieldedReceiveCodeForRecipient({ ...credentials, context, disclosure: action === "fund" ? "fund" : "anonymous", expiresAt: String(Math.floor(Date.now() / 1000) + 90 * 86400) });
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
      setTransactionLabel(label);
      setTransactionPending(true);
      setTransactionResult(null);
    }
  }
  function clearFailedWalletRequest(cause: unknown, id: string) {
    const tracked = receiptTracking.current;
    if (tracked?.id !== id || tracked.hash) return;
    const error = cause && typeof cause === "object" ? cause : undefined;
    const code = error && "code" in error ? error.code : undefined;
    const info = error && "info" in error ? error.info : undefined;
    // ethers can send successfully, then fail while fetching the transaction.
    // Preserve tracking whenever the error carries evidence of a broadcast.
    if (
      (error && "receipt" in error && error.receipt) ||
      (info && typeof info === "object" && "sendTransactionHash" in info && info.sendTransactionHash)
    )
      return;
    const estimationFailed =
      code === "CALL_EXCEPTION" && error && "action" in error && error.action === "estimateGas";
    // An explicit rejection, insufficient funds, or failed estimation cannot
    // produce a transaction. Transport errors still need public reconciliation.
    if (
      code !== "ACTION_REJECTED" &&
      code !== 4001 &&
      code !== "INSUFFICIENT_FUNDS" &&
      !estimationFailed
    )
      return;
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
    // ERC-20 deposits consume allowance. Never reuse the pre-deposit snapshot
    // for the next amount, even if the original secret session has been locked.
    if (mounted.current) setAllowanceRevision((revision) => revision + 1);
    if (mounted.current && tracked?.id === record.id) {
      receiptTracking.current = null;
      setTransactionPending(false);
      setTransactionResult(status === 1 ? "done" : "failed");
      setTransactionLabel(record.label);
    }
  }
  function clearTransactionFeedback(dismissed = false) {
    setTransactionHash("");
    setTransactionResult(null);
    setTransactionLabel("");
    setTransactionFeedbackDismissed(dismissed);
  }
  async function approve() {
    if (submissionPending || !slotReady) return;
    await run(async (current) => {
      clearTransactionFeedback();
      setProgress({ kind: "approval", stage: "submitting" });
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
      await assertShieldedDepositBalance(modules.token, account, value);
      if (!current()) return;
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
      setTransactionLabel(label);
      setTransactionPending(true);
      setTransactionResult(null);
      const endWalletRequest = latestSession.current.beginWalletRequest();
      let tx: ContractTransactionResponse;
      try {
        tx = await (modules.token.connect(chosen) as typeof modules.token).approve(
          modules.poolAddress,
          value,
          { nonce, chainId: modules.chainId },
        );
      } catch (cause) {
        clearFailedWalletRequest(cause, txId);
        throw cause;
      } finally {
        endWalletRequest();
      }
      trackBroadcast(chosen.provider!, tx.hash, txId, label);
      if (current()) {
        setStage(t("shielded.stages.confirming"));
        setProgress({ kind: "approval", stage: "confirming" });
      }
      const { transactionHash, receipt } = await waitForShieldedTransaction(tx, (hash) => {
        trackBroadcast(chosen.provider!, hash, txId, label);
      });
      recordReceipt(transactionHash, receipt.status, { id: txId, label });
      if (receipt.status !== 1)
        throw new Error(t("shielded.transactionFailed", { hash: transactionHash }));
    }, t("shielded.stages.submitting"), "wallet");
  }
  /**
   * Spending plans pause for review before proving each actual transaction.
   * After a consolidation receipt, rebuild and review the remaining plan.
   */
  async function prepare() {
    if (submissionPending || !slotReady || budgetLetter.delivery) return;
    if (action === "shield" && !allowanceReady) return approve();
    const chosen = signer,
      requested = actionRequestKey,
      generation = getShieldedAssetWorkerGeneration();
    await run(async (current) => {
      clearTransactionFeedback();
      setCompletedSpendSteps([]);
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
      if (action === "shield" && modules.assetKind === "erc20") {
        if (!modules.token) throw new Error(t("shielded.walletNotReady"));
        if ((await chosen.getAddress()).toLowerCase() !== account.toLowerCase())
          throw new Error(t("shielded.walletChanged"));
        await assertShieldedDepositBalance(modules.token, account, amountValue!);
        assertCurrent();
      }
      const attachedDraft = action === "fund" && effectiveEntry !== "public"
        ? await budgetLetter.preflight(code, effectiveEntry === "privateIndependent" ? 1 : 0, current)
        : null;
      assertCurrent();
      let stepCandidates =
        action === "fund"
          ? values.map((note) => note.commitment)
          : needsValues
            ? candidates
            : undefined;
      let stepPolicy =
        policyHandle ||
        (draftPolicy.current?.key === draftKey ? draftPolicy.current.handle : undefined);
      let reviewNotes = values.map(({ commitment, amount }) => ({ commitment, amount }));
      let generatedCommitments: string[] = [];
      let remaining = Number.POSITIVE_INFINITY;
      let sent = false;
      try {
        for (;;) {
          // A receipt may arrive after locking, navigation or a replacement session.
          // Reject it before it can mutate the shared Worker's next preview.
          assertCurrent();
          setStage(tr("preparing"));
          setProgress({ kind: "action", stage: "preparing" });
          const planned = await shieldedAssetWorkerCall(
            "preview",
            {
              context,
              slot,
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
          if (action === "privateTransfer" || action === "unshield") {
            const confirmed = await reviewSpend({
              preview: planned,
              action,
              notes: reviewNotes,
              candidateCommitments: [...(stepCandidates ?? [])],
              generatedCommitments,
              recipientLabel: action === "unshield"
                ? withdrawalRecipient
                : verifiedRecipient!.fingerprint,
            });
            if (!confirmed) return;
            assertCurrent();
            latestSession.current.setBusy(true);
          }
          setStage(t("shielded.stages.proving"));
          setProgress({ kind: "action", stage: "proving" });
          const result = await shieldedAssetWorkerCall(
            "prove",
            { handle: planned.handle, context },
            { timeoutMs: 1_200_000 },
          );
          assertCurrent();
          const txId = `shielded:${modules.chainId}:${Date.now()}:${planned.handle}`,
            label = `${modules.assetSymbol} · ${t(`shielded.actions.${result.action}`, { symbol: modules.assetSymbol })}`;
          if (attachedDraft && result.action === "fund" && Number(result.data.budgetKind) === 0) {
            budgetLetter.stageDeposit(attachedDraft, String(result.data.outputCommitments[0]), txId);
          }
          const common = {
            pool: modules.pool,
            signer: chosen,
            expectedChainId: modules.chainId,
            data: result.data,
            preparedProof: result.proof,
            onStage: (next: "checkingGas" | "submitting" | "confirming") => {
              if (next !== "confirming") assertCurrent();
              if (current()) {
                setStage(t(`shielded.stages.${next}`));
                setProgress({ kind: "action", stage: next });
              }
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
                setTransactionLabel(label);
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
                    ...(modules.assetKind === "erc20"
                      ? { assetKind: "erc20" as const, token: modules.token! }
                      : { assetKind: "native" as const }),
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
            clearFailedWalletRequest(cause, txId);
            if (receiptTracking.current?.id !== txId) budgetLetter.cancelDeposit(txId);
            throw cause;
          }
          sent = true;
          recordReceipt(submitted.transactionHash, submitted.receipt.status, { id: txId, label });
          if (current()) {
            setTransactionHash(submitted.transactionHash);
            setTransactionLabel(label);
            setTransactionPending(false);
            setTransactionResult(submitted.receipt.status === 1 ? "done" : "failed");
          }
          if (submitted.receipt.status !== 1) {
            budgetLetter.cancelDeposit(txId);
            throw new Error(t("shielded.transactionFailed", { hash: submitted.transactionHash }));
          }
          if (attachedDraft && result.action === "fund" && Number(result.data.budgetKind) === 0 && current()) {
            setStage(t("shielded.privateLetters.sendingAfterFunding"));
            setProgress(null);
            await budgetLetter.confirmDeposit(txId, current);
          }
          if (planned.steps.length <= 1) break;
          // The confirmed step stays listed, with its hash, above the plan rebuilt for the rest.
          if (current()) {
            const [first] = planned.steps;
            setCompletedSpendSteps((steps) => [
              ...steps,
              {
                merge: true,
                inputCount: first.inputs.length,
                inputTotal: planned.inputAmounts
                  .reduce((sum, value) => sum + BigInt(value), 0n)
                  .toString(),
                principal: first.outputAmounts[0],
                change: first.outputAmounts[1],
                hash: submitted.transactionHash,
              },
            ]);
            setExecutingReview(null);
          }
          // The consolidated outputs replace its inputs among the next step's candidates.
          const outputs = result.data.outputCommitments.map((value) => getBigInt(value).toString());
          stepCandidates = [
            ...(stepCandidates ?? []).filter((commitment) => !planned.inputs.includes(commitment)),
            ...outputs.filter((_, index) => BigInt(planned.outputAmounts[index] ?? "0") > 0n),
          ];
          reviewNotes = [
            ...reviewNotes,
            ...outputs.flatMap((commitment, index) => {
              const amount = planned.outputAmounts[index];
              return BigInt(amount) > 0n ? [{ commitment, amount }] : [];
            }),
          ];
          generatedCommitments = [...generatedCommitments, ...outputs];
        }
      } finally {
        if (current()) setPlanCount(0);
        if (sent && current()) {
          autoRecoveryScope.current = "";
          setWallet(null);
          setCandidates([]);
        }
      }
    }, tr("preparing"), "wallet");
  }
  const decimals = modules.tokenDecimals ?? 0;
  const symbol = modules.assetSymbol;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t("common.copyFailed"));
    }
  };
  const parsePositive = (value: string) => {
    try {
      const parsed = parseUnits(value.trim(), decimals);
      return parsed > 0n ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const walletName = tr(slot === "identity" ? "identityCredentials" : "independentKey");
  const slotAvailable = wallet && slotReady ? valueTotals[slot] : undefined;
  const transactionStatus =
    hasSession &&
    !transactionFeedbackDismissed &&
    (transactionHash || submissionPending || transactionResult) ? (
      <p
        role="status"
        className="break-all rounded-xl bg-surface-alt px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted"
      >
        {transactionLabel ? `${transactionLabel} · ` : ""}
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
    ) : null;
  const errorNotice = error ? (
    <p role="alert" className="break-words text-sm text-danger">
      {error}
    </p>
  ) : null;
  // A confirmed spend plan shows its own progress inside the step being sent.
  const progressList =
    busy && progress && progress.stage !== "preparing" && !executingReview ? (
      <div role="status">
        <ShieldedProgressList
          stage={progress.stage}
          stages={progress.kind === "approval" ? SHIELDED_APPROVAL_STAGES : SHIELDED_ACTION_STAGES}
        />
      </div>
    ) : null;
  const taskFeedback = (
    <>
      {busy && planCount > 1 ? (
        <p role="status" className="text-[13px] font-medium text-ink/80">
          {t("shielded.walletKeys.planTransactions", { count: planCount })}
        </p>
      ) : null}
      {progressList ??
        (stage && !budgetLetter.delivery && !executingReview && !readModeRefreshing ? (
          <p role="status" className="text-sm text-ink-muted">
            {stage}
          </p>
        ) : null)}
      {errorNotice}
      {transactionStatus}
      {!letterView && action === "fund" && budgetLetter.delivery ? (
        <div className="space-y-3 rounded-xl bg-surface-alt p-4">
          <p role={budgetLetter.delivery.status === "failed" ? "alert" : "status"} className="text-sm text-ink">{t(`shielded.privateLetters.delivery.${budgetLetter.delivery.status}`)}</p>
          {budgetLetter.delivery.hash ? <p className="break-all text-xs text-ink-muted">{t("shielded.privateLetters.sent")}: {budgetLetter.delivery.hash}</p> : null}
          {budgetLetter.delivery.status === "failed" ? <>
            {budgetLetter.delivery.expired ? <p className="text-sm text-danger">{t("shielded.privateLetters.preparationExpired")}</p> : null}
            {budgetLetter.delivery.canUpdateCode ? <FieldBlock label={t("shielded.privateLetters.replacementCode")}>
              <textarea aria-label={t("shielded.privateLetters.replacementCode")} className={FIELD_TEXTAREA} rows={3} disabled={busy} value={budgetLetter.replacementCode} onChange={event => budgetLetter.setReplacementCode(event.target.value)} />
            </FieldBlock> : null}
            <PanelButton disabled={busy || submissionPending || !signer} onClick={() => void run(current => budgetLetter.retry(current), t("shielded.privateLetters.sendingAfterFunding"), "wallet")}>{t("shielded.privateLetters.retryLetter")}</PanelButton>
          </> : null}
          {budgetLetter.delivery.status !== "sending" && budgetLetter.delivery.status !== "awaitingDeposit" ? <PanelButton disabled={busy} size="compact" onClick={budgetLetter.clear}>{t(budgetLetter.delivery.status === "sent" ? "shielded.privateLetters.finish" : "shielded.privateLetters.later")}</PanelButton> : null}
        </div>
      ) : null}
    </>
  );
  const discoveryWarning = discovery && !discovery.complete ? (
    <WarningNotice>{tr("discoveryPartial")}</WarningNotice>
  ) : null;
  const independentKeyTitle = tr(
    accessFlow === "create"
      ? "createTitle"
      : accessFlow === "backup"
        ? "backupTitle"
        : "restoreTitle",
  );
  const keyFingerprint =
    session.independentKey?.keyFingerprint || exportedFingerprint || expectedFingerprint;
  const independentKeyManager = (
    <ShieldedIndependentKeyManager
      flow={accessFlow}
      independentKey={session.independentKey}
      fingerprint={keyFingerprint}
      identityReady={!!session.identity}
      busy={busy}
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
      showRecoveryCandidate={showRecoveryCandidate}
      onCreate={(source) => void createIndependentKey(source)}
      onExport={() => void exportRecoveryMaterial()}
      onBeginVerification={() => void beginBackupVerification()}
      onImport={() => void importRecoveryMaterial()}
      onRestoreSignature={() => void requestSignature("restore")}
      onRecover={() => void recover(true)}
      discoveryReport={discoveryWarning}
      onCopyFingerprint={() => void copy(keyFingerprint)}
      onShowRestore={() => {
        clearSecretInputs();
        setRecoveryScanned(false);
        setShowRecoveryCandidate(false);
        setIndependentKeyFlow("restore");
        setWalletScreen("manage");
        if (session.independentKey) void run(clearIndependentKeyRoot, "");
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
      showLock={!independentKeyInWorkspace}
      pinnedActions={showWorkspace}
    />
  );
  const walletSheet: ShieldedWalletSheetState | null = !showWorkspace
    ? null
    : walletSection === "receiveCode"
      ? { kind: "receiveCode", slot: codeSlot }
      : walletSection === "keys"
        ? { kind: "keys", flow: accessFlow }
        : null;
  const receiveCodeContent = (
    <div role="group" aria-label={tr("receiveKeyLabel")} className="space-y-4">
      {!session.identity ? (
        <WarningNotice>{tr("independentKeyRestoredIdentityHint")}</WarningNotice>
      ) : codeSlot === "independent" && !independentKeyReady ? (
        <p className="text-xs text-warning">{tr("walletLocked")}</p>
      ) : null}
      <FieldBlock label={t("shielded.privateLetters.disclosure")}>
        <select aria-label={t("shielded.privateLetters.disclosure")} className={FIELD_INPUT} disabled={busy || submissionPending} value={codeDisclosure} onChange={(event) => { setCodeDisclosure(event.target.value as "anonymous" | "fund"); setOwnCode(""); receiveCodeScope.current = ""; }}>
          <option value="anonymous">{t("shielded.privateLetters.anonymousCode")}</option>
          <option value="fund">{t("shielded.privateLetters.fundMaterial")}</option>
        </select>
      </FieldBlock>
      <p className="text-xs text-ink-muted">{t(`shielded.privateLetters.${codeDisclosure === "anonymous" ? "anonymousPrivacy" : "fundPrivacy"}`)}</p>
      <FieldBlock label={t("shielded.privateLetters.expiresAt")}>
        <input type="datetime-local" aria-label={t("shielded.privateLetters.expiresAt")} className={FIELD_INPUT} value={codeExpiry} disabled={busy || submissionPending} onChange={(event) => { setCodeExpiry(event.target.value); setOwnCode(""); receiveCodeScope.current = ""; }} />
      </FieldBlock>
      {ownCode ? (
        <FieldBlock
          label={t("shielded.receiveCodeLabel", { symbol })}
          hint={t("shielded.receiveCodeShareHint", { symbol })}
        >
          <div className="relative">
            <textarea
              aria-label={t("shielded.receiveCodeLabel", { symbol })}
              className={`${FIELD_TEXTAREA} min-h-28 resize-none pr-10`}
              readOnly
              value={ownCode}
              rows={5}
            />
            <div className="absolute right-1.5 top-1.5">
              <CopyIconButton label={t("common.copy")} onClick={() => void copy(ownCode)} />
            </div>
          </div>
        </FieldBlock>
      ) : busy ? (
        <p role="status" className="text-sm text-ink-muted">
          {stage}
        </p>
      ) : receiveCodeReady ? (
        <>
          {error ? <p className="break-words text-xs text-danger">{error}</p> : null}
          <PanelButton
            size="compact"
            disabled={submissionPending}
            onClick={() => void createCode(codeSlot)}
          >
            {t("shielded.generateReceiveCode")}
          </PanelButton>
        </>
      ) : null}
      {session.identity ? <div className="space-y-2 border-t border-line pt-3">
        <p className="text-xs text-ink-muted">{t("shielded.privateLetters.revokeHint")}</p>
        <PanelButton size="compact" disabled={busy || submissionPending || !signer} onClick={() => void revokeReceiveCodes()}>{t("shielded.privateLetters.revokeAll")}</PanelButton>
      </div> : null}
    </div>
  );
  const overviewWallets: ShieldedOverviewWallet[] = (
    [
      { slot: "identity", unlocked: !!session.identity },
      { slot: "independent", unlocked: independentKeyReady },
    ] as const
  ).map(({ slot: walletSlot, unlocked }) => ({
    slot: walletSlot,
    unlocked,
    balanceState: unlocked && balancesRefreshing ? wallet ? "updating" : "loading" : undefined,
    available: wallet && unlocked ? formatShieldedAmount(valueTotals[walletSlot], decimals) : "—",
    budget:
      wallet && unlocked && session.identity
        ? formatShieldedAmount(budgetTotals[walletSlot], decimals)
        : "—",
    current: slot === walletSlot,
    checked:
      slot === walletSlot && (walletSlot === "identity" || independentKeySelectionMatches || !unlocked),
    fingerprint:
      walletSlot === "independent" && slot === "independent"
        ? confirmedOverviewKey.current?.fingerprint
        : undefined,
  }));
  const claimablePeriods = claims
    .filter((claim) => claim.status === "claimable")
    .reduce((sum, claim) => sum + claim.periodIndices.length, 0);
  const taskTitleId = `${formId}-task-title`;
  const signerNotice = !signer ? (
    <WarningNotice>{t("shielded.walletNotReady", { symbol })}</WarningNotice>
  ) : null;
  const submitLabel = (task: Action) =>
    t("shielded.submit", { symbol, action: t(`shielded.actions.${task}`, { symbol }) });

  let composer: ReactNode;
  let receipt: ReactNode;
  if (letterView) {
    composer = (
      <>
        <PrivateLettersPanel
          mode={letterView}
          titleId={taskTitleId}
          context={context}
          signer={signer ?? null}
          disabled={busy || submissionPending}
          wallet={wallet}
          recoveryReady={!!session.identity || !!session.independentKey}
          sessionScope={JSON.stringify([session.credentials?.handle, session.identity?.handle, session.independentKey?.keyFingerprint])}
          budgetCommitment={letterBudget}
          onBudgetChange={setLetterBudget}
          onBusyChange={(value) => {
            letterOperationPending.current = value;
            acceptPublicSyncProgress.current = value;
            if (value) { setPublicSyncProgress({}); setPublicSyncPaused(false); }
            setBusy(value);
            latestSession.current.setBusy(value);
          }}
          beginWalletRequest={() => latestSession.current.beginWalletRequest()}
        />
        {taskFeedback}
      </>
    );
    receipt = null;
  } else if (action === "fund") {
    const fundingVersion = selectedPolicy?.rootVersionIndex ?? rootVersion;
    const heirs = listShieldedFundingHeirs(wallet, policyHandle, fundingVersion, localRecipientLabels);
    const heirIndex = heirs.findIndex(
      (heir) => heir.personHash.toLowerCase() === personHash.toLowerCase(),
    );
    const heirName = personHash
      ? (heirs[heirIndex]?.label ??
        (heirIndex >= 0
          ? t("shielded.recipientPicker.childFallback", { index: heirIndex + 1 })
          : shortHex(personHash)))
      : undefined;
    let rate: bigint | undefined;
    let days: bigint | undefined;
    try {
      rate = selectedPolicy ? BigInt(selectedPolicy.amountPerPeriod) : parseUnits(amount, decimals);
    } catch {
      // Incomplete inputs have no preview until they are valid.
    }
    try {
      days = selectedPolicy ? BigInt(selectedPolicy.periodDays) : parseShieldedPeriodDays(periodDays);
    } catch {
      // As above.
    }
    const fundingPeriods = /^[1-9][0-9]{0,19}$/.test(periods.trim())
      ? BigInt(periods.trim())
      : undefined;
    const fundingBalance = values.reduce((sum, note) => sum + BigInt(note.amount), 0n);
    const parentLabel = session.identity
      ? (localRecipientLabels.get(session.identity.personHash.toLowerCase()) ??
        shortHex(session.identity.personHash))
      : undefined;
    composer = (
      <ShieldedFundComposer
        titleId={taskTitleId}
        symbol={symbol}
        decimals={decimals}
        busy={busy || submissionPending || !!budgetLetter.delivery}
        wallet={wallet}
        identityReady={!!session.identity}
        heirs={heirs}
        entry={effectiveEntry}
        templateHandle={template?.handle}
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
          if (handle === policyHandle) return;
          const nextVersion = wallet?.policies.find(item => item.handle === handle)?.rootVersionIndex ?? rootVersion;
          const sameChildAvailable = listShieldedFundingHeirs(wallet, handle, nextVersion)
            .some(heir => heir.personHash.toLowerCase() === personHash.toLowerCase());
          setPolicyHandle(handle);
          if (!sameChildAvailable) {
            setPersonHash("");
            changeCode("");
            recipientForm.current?.clearSecretInputs();
          }
          setError("");
        }}
        rootVersion={rootVersion}
        onRootVersionChange={(value) => {
          if (value === rootVersion) return;
          const sameChildAvailable = listShieldedFundingHeirs(wallet, policyHandle, value)
            .some(heir => heir.personHash.toLowerCase() === personHash.toLowerCase());
          setRootVersion(value);
          if (!sameChildAvailable) {
            setPersonHash("");
            changeCode("");
            recipientForm.current?.clearSecretInputs();
          }
        }}
        personHash={personHash}
        onPersonHashChange={(value) => {
          if (value.toLowerCase() === personHash.toLowerCase()) return;
          budgetLetter.selectRecipient(value);
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
        codeError={needsCode ? codeError || undefined : undefined}
        recipientMatches={needsCode && recipientMatches}
        recipientMismatch={needsCode && !!verifiedRecipient && !recipientMatches}
        recipientInputMethod={recipientInputMethod}
        onRecipientInputMethodChange={(method) => {
          changeCode("");
          setRecipientInputMethod(method);
          recipientForm.current?.clearSecretInputs();
        }}
        recipientFormRef={recipientForm}
        onGenerateRecipientCode={() => void generateConvenientCode()}
        letterEnabled={budgetLetter.enabled}
        onLetterEnabledChange={(enabled) => {
          if (enabled && personHash) budgetLetter.selectRecipient(personHash);
          budgetLetter.setEnabled(enabled);
        }}
        letterBody={budgetLetter.body}
        onLetterBodyChange={budgetLetter.setBody}
        lettersConfigured={!!context.lettersAddress}
        parentLabel={parentLabel}
      />
    );
    receipt = (
      <ShieldedFundReceipt
        symbol={symbol}
        decimals={decimals}
        walletName={walletName}
        available={slotAvailable}
        rate={rate}
        periods={fundingPeriods}
        days={days}
        startsAt={
          selectedPolicy
            ? undefined
            : BigInt(Math.floor(Date.now() / 1000)) + SHIELDED_FUNDING_START_DELAY_SECONDS
        }
        heirName={heirName}
        versionLabel={
          fundingVersion
            ? t("shielded.fundingVersionOption", { symbol, version: fundingVersion })
            : undefined
        }
        entryLabel={t(shieldedFundingEntryLabelKey(effectiveEntry))}
        notices={
          <>
            {fundingDeficit !== undefined && fundingBalance > 0n ? (
              <WarningNotice>
                {t("shielded.fundingBalanceInsufficient", {
                  symbol,
                  amount: formatShieldedAmount(fundingDeficit, decimals),
                })}
              </WarningNotice>
            ) : null}
            {signerNotice}
            {taskFeedback}
          </>
        }
        action={
          <PanelButton
            variant="primary"
            size="large"
            className="w-full"
            busy={busy}
            disabled={
              busy ||
              submissionPending ||
              !slotReady ||
              !session.identity ||
              !signer ||
              !!budgetLetter.delivery ||
              (effectiveEntry !== "public" && budgetLetter.enabled && !budgetLetter.body.trim()) ||
              (wallet?.familyRecordsAvailable === false && !template) ||
              (needsCode && !recipientReady) ||
              fundingDeficit !== undefined ||
              !personHash ||
              (!selectedPolicy && !rootVersion)
            }
            onClick={() => void prepare()}
          >
            {submitLabel("fund")}
          </PanelButton>
        }
      />
    );
  } else if (action === "claim") {
    const displayClaim =
      selectedClaim ?? claims.find((claim) => claim.status === "claimable") ?? claims[0];
    const schedule = displayClaim
      ? buildShieldedClaimSchedule(displayClaim, findShieldedClaimBudget(wallet, displayClaim))
      : [];
    const chosen = displayClaim
      ? claimPeriods.filter((index) => displayClaim.periodIndices.includes(index))
      : [];
    const total = displayClaim ? BigInt(displayClaim.amountPerPeriod) * BigInt(chosen.length) : 0n;
    const slotBudgets =
      wallet?.notes.filter((note) => note.kind === "budget" && note.slot === slot) ?? [];
    const status = !wallet
      ? t("shielded.claimOverview.checking", { symbol })
      : slotBudgets.length === 0
        ? t("shielded.claimOverview.noFunds", { symbol })
        : claims.length === 0
          ? t("shielded.claimOverview.ineligible", { symbol })
          : displayClaim?.status === "claimable"
            ? chosen.length
              ? t("shielded.claimOverview.claimable", {
                  symbol,
                  amount: formatShieldedAmount(total, decimals),
                  periods: chosen.length,
                })
              : t("shielded.claimSelectionRequired", { symbol })
            : t(`shielded.claimOverview.${displayClaim?.status ?? "noFunds"}`, { symbol });
    const segments = schedule.flatMap((row): ShieldedPeriodSegment[] =>
      row.kind === "claimable"
        ? [claimPeriods.includes(row.index) ? "selected" : "claimable"]
        : row.kind === "upcoming"
          ? ["upcoming"]
          : [],
    );
    const locked = slot === "independent" && !slotReady;
    composer = (
      <ShieldedClaimComposer
        titleId={taskTitleId}
        symbol={symbol}
        decimals={decimals}
        busy={busy || submissionPending}
        wallet={wallet}
        slot={slot}
        identityReady={!!session.identity}
        independentKeyReady={independentKeyReady && independentKeySelectionMatches}
        claimHandle={claimHandle}
        onClaimChange={(handle) => {
          setClaimHandle(handle);
          setClaimPeriods(claims.find((claim) => claim.handle === handle)?.periodIndices ?? []);
        }}
        claimPeriods={claimPeriods}
        onClaimPeriodsChange={setClaimPeriods}
      />
    );
    receipt = (
      <ShieldedClaimReceipt
        symbol={symbol}
        decimals={decimals}
        walletName={walletName}
        available={slotAvailable}
        total={total}
        status={status}
        nextDue={
          displayClaim?.nextDueAt !== undefined
            ? t("shielded.claimOverview.nextDue", {
                symbol,
                date:
                  formatShieldedTimestamp(BigInt(displayClaim.nextDueAt)) ??
                  t("shielded.dateOutOfRange", { symbol }),
              })
            : undefined
        }
        segments={segments}
        budgetName={
          displayClaim
            ? t("shielded.budgetOption", {
                symbol,
                index: claims.indexOf(displayClaim) + 1,
                amount: formatShieldedAmount(
                  displayClaim.totalRemaining ?? displayClaim.amount,
                  decimals,
                ),
              })
            : undefined
        }
        periods={chosen.map((index) => String(BigInt(index) + 1n))}
        notices={
          <>
            {locked ? null : signerNotice}
            {taskFeedback}
          </>
        }
        action={
          // A locked independent key offers only its unlock action, on the wallet card above.
          locked ? undefined : (
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={
                busy ||
                submissionPending ||
                !slotReady ||
                !session.identity ||
                !signer ||
                !selectedClaim ||
                selectedClaim.status !== "claimable" ||
                !claimPeriods.length ||
                claimPeriods.some((index) => !selectedClaim.periodIndices.includes(index))
              }
              onClick={() => void prepare()}
            >
              {submitLabel("claim")}
            </PanelButton>
          )
        }
      />
    );
  } else {
    const spendAmount = parsePositive(amount);
    composer = (
      <ShieldedWalletActions
        titleId={taskTitleId}
        action={action}
        symbol={symbol}
        decimals={decimals}
        busy={busy}
        amount={amount}
        onAmountChange={setAmount}
        recipient={{
          method: recipientInputMethod,
          onMethodChange: (method) => {
            changeCode("");
            setRecipientInputMethod(method);
            recipientForm.current?.clearSecretInputs();
          },
          code,
          codeError: needsCode ? codeError || undefined : undefined,
          onCodeChange: changeCode,
          credentialsFormRef: recipientForm,
          onGenerateCode: () => void generateConvenientCode(),
          targetHash: recipientTargetHash ?? undefined,
          targetName: recipientTargetName,
          verified: !!verifiedRecipient,
          needsConfirmation: recipientNeedsConfirmation,
          confirmed: recipientConfirmed,
          onConfirmedChange: setRecipientConfirmed,
        }}
        withdrawalRecipient={withdrawalRecipient}
        onWithdrawalRecipientChange={setWithdrawalRecipient}
        values={values}
        selectedCommitments={candidates}
        onSelectedCommitmentsChange={setCandidates}
      />
    );
    const notices = (
      <>
        {signerNotice}
        {taskFeedback}
      </>
    );
    if (action === "shield") {
      receipt = (
        <ShieldedShieldReceipt
          symbol={symbol}
          decimals={decimals}
          walletName={walletName}
          available={slotAvailable}
          amount={spendAmount}
          notices={notices}
          action={
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={busy || !slotReady || submissionPending || !signer}
              onClick={() => void prepare()}
            >
              {modules.assetKind === "erc20" && !allowanceReady ? tr("approve") : submitLabel("shield")}
            </PanelButton>
          }
        />
      );
    } else {
      const candidateTotal = values
        .filter((note) => candidates.includes(note.commitment))
        .reduce((sum, note) => sum + BigInt(note.amount), 0n);
      const withdrawalSelectionAvailable =
        candidates.length > 0 &&
        candidates.every((commitment) =>
          values.some((note) => note.commitment === commitment && BigInt(note.amount) > 0n),
        );
      const review = spendReview ? (
        <ShieldedSpendReview
          {...spendReview}
          decimals={decimals}
          symbol={symbol}
          completedSteps={completedSpendSteps}
          onConfirm={() => settleSpendReview(spendReview, true)}
          onCancel={() => settleSpendReview(spendReview, false)}
        />
      ) : executingReview ? (
        <ShieldedSpendReview
          {...executingReview}
          decimals={decimals}
          symbol={symbol}
          completedSteps={completedSpendSteps}
          running
          stage={progress?.stage ?? null}
        />
      ) : undefined;
      receipt = (
        <ShieldedSpendReceipt
          spendAction={action}
          symbol={symbol}
          decimals={decimals}
          walletName={walletName}
          available={slotAvailable}
          amount={spendAmount}
          recipient={
            action === "unshield" ? (
              withdrawalRecipient.trim() ? (
                <code className="font-mono" title={withdrawalRecipient.trim()}>
                  {shortHex(withdrawalRecipient.trim())}
                </code>
              ) : undefined
            ) : recipientTargetHash ? (
              (recipientTargetName ?? (
                <code className="font-mono" title={recipientTargetHash}>
                  {shortHex(recipientTargetHash)}
                </code>
              ))
            ) : undefined
          }
          selection={
            candidates.length
              ? t("shielded.valueSelectionSummary", {
                  symbol,
                  count: candidates.length,
                  amount: formatShieldedAmount(candidateTotal, decimals),
                })
              : undefined
          }
          review={review}
          notices={notices}
          action={
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={
                busy ||
                !slotReady ||
                submissionPending ||
                (needsCode && !recipientReady) ||
                !signer ||
                (recipientNeedsConfirmation && !recipientConfirmed) ||
                (action === "privateTransfer" && candidates.length === 0) ||
                (action === "unshield" && !withdrawalSelectionAvailable)
              }
              onClick={() => void prepare()}
            >
              {t("shielded.spendReview.preview", {
                symbol,
                action: t(`shielded.actions.${action}`, { symbol }),
              })}
            </PanelButton>
          }
        />
      );
    }
  }

  const accessTitleId = `${formId}-access-title`;
  const accessCard = (
    <section
      aria-labelledby={accessTitleId}
      className="min-w-0 rounded-[20px] border border-hairline bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-28px_rgba(15,23,42,0.2)] dark:shadow-none sm:p-8"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
        >
          {identityAccess ? (
            <Fingerprint className="h-[22px] w-[22px]" />
          ) : (
            <KeyRound className="h-[22px] w-[22px]" />
          )}
        </span>
        <div className="min-w-0 space-y-1.5">
          <h2 id={accessTitleId} className="ui-heading text-xl text-ink">
            {identityAccess ? t("shielded.identityTitle", { symbol }) : independentKeyTitle}
          </h2>
          {identityAccess ? (
            <p className="text-sm leading-relaxed text-ink-muted">
              {t("shielded.identityDescription", { symbol })}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-7 space-y-6">
        {identityAccess ? (
          session.identity ? (
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
                independentKeyCredentials
                showTitle={false}
                collapsible={false}
                showPassphraseGuidance={false}
                className="border-0 bg-transparent p-0 shadow-none"
              />
              <PanelButton
                variant="primary"
                size="hero"
                className="w-full"
                busy={busy}
                disabled={busy}
                onClick={() => void unlock()}
              >
                {busy ? null : <LockOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
                <span role="status">
                  {busy ? tr("unlocking") : t("shielded.unlock", { symbol })}
                </span>
              </PanelButton>
            </>
          )
        ) : (
          independentKeyManager
        )}
        {identityAccess && independentKeyReady ? (
          <div className="space-y-3 border-t border-hairline/70 pt-5">
            <p className="text-sm leading-relaxed text-ink-muted">{tr("independentKeyIdentityNeeded")}</p>
            <PanelButton
              onClick={() => {
                chooseAction("privateTransfer");
                setWalletScreen("workspace");
              }}
            >
              {tr("useIndependentKey")}
            </PanelButton>
          </div>
        ) : null}
        {identityAccess && hasSession ? (
          <PanelButton onClick={exitSession}>{t("shielded.lock", { symbol })}</PanelButton>
        ) : null}
        {stage && (!identityAccess || hasSession) ? (
          <p role="status" className="text-sm text-ink-muted">
            {stage}
          </p>
        ) : null}
        {errorNotice}
        {transactionStatus}
      </div>
    </section>
  );

  const publicSyncItems = (["authorization", "lineage"] as const)
    .map((domain) => publicSyncProgress[domain])
    .filter((item): item is PublicStateSyncProgress => !!item);
  const publicSyncPauseDisabled = submissionPending || !!executingReview || session.isWalletRequestPending() ||
    progress?.stage === "checkingGas" || progress?.stage === "submitting" || progress?.stage === "confirming";
  const publicSyncStatus = publicSyncPaused || (busy && publicSyncItems.some((item) => item.phase !== "complete")) ? (
    <ShieldedPublicStateSyncStatus
      progress={publicSyncItems}
      paused={publicSyncPaused}
      pauseDisabled={publicSyncPauseDisabled}
      onPause={() => {
        if (publicSyncPauseDisabled || !busy || !publicSyncItems.some((item) => item.phase !== "complete")) return;
        lock();
        setPublicSyncPaused(true);
      }}
    />
  ) : null;

  return (
    <div className="min-w-0 space-y-6 break-normal">
      {!showWorkspace ? (
        <div className="mx-auto w-full max-w-[45rem] space-y-6">
          {head}
          {publicSyncStatus}
          <div
            ref={accessRegion}
            tabIndex={-1}
            className="rounded-[20px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {accessCard}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {head}
          <ShieldedAssetOverview
            syncStatus={publicSyncStatus}
            person={{
              name: session.identity?.identity.fullName ?? tr("independentKeyTitle"),
              avatar: session.identity
                ? getShieldedAvatarText(session.identity.identity.fullName)
                : undefined,
              hash: overviewHash,
              hashLabel: session.identity
                ? t("shielded.identityHash", { symbol })
                : tr("keyFingerprint"),
              copyLabel: session.identity
                ? t("shielded.copyIdentityHash", { symbol })
                : tr("copyKeyFingerprint"),
              onCopy: () => void copy(overviewHash),
            }}
            assetControls={
              assetControls ? (
                <fieldset disabled={busy} className="min-w-0">
                  {assetControls}
                </fieldset>
              ) : undefined
            }
            symbol={symbol}
            busy={busy || readModeRefreshing}
            onRecover={() => void recover(true)}
            onLock={exitSession}
            wallets={overviewWallets}
            selectionDisabled={busy || readModeRefreshing || submissionPending}
            onSelectWallet={selectWallet}
            independentKeyState={independentKeyState}
            onReceiveCode={openReceiveCode}
            onOpenIndependentKey={openIndependentKeyManager}
            openSheet={walletSheet}
            footer={walletSection === "keys" ? undefined : discoveryWarning}
          />
          {modules.tokenDecimals === null ? (
            <p className="text-xs text-ink-muted">{tr("rawUnits")}</p>
          ) : null}
          <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
            <ShieldedTaskNavigation
              action={letterView === "write" ? "writeLetter" : letterView === "inbox" ? "letterInbox" : action}
              busy={busy || readModeRefreshing}
              symbol={symbol}
              claimablePeriods={claimablePeriods}
              onActionChange={navigateToAction}
            />
            <div className="flex min-w-0 flex-[999_1_40rem] flex-wrap items-start gap-6">
              {/* A transfer or withdrawal leaves its wider receipt room for the step plan. */}
              <section
                ref={taskRegion}
                tabIndex={-1}
                aria-labelledby={taskTitleId}
                className={`min-w-0 ${
                  !letterView && (action === "privateTransfer" || action === "unshield")
                    ? "flex-[999_1_26.25rem]"
                    : "flex-[999_1_27.5rem]"
                } rounded-[20px] border border-hairline bg-surface p-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-7`}
              >
                {composer}
              </section>
              {receipt}
            </div>
          </div>
          <ShieldedWalletSheet
            open={walletSheet !== null}
            title={
              walletSheet?.kind === "receiveCode"
                ? tr(codeSlot === "identity" ? "identityReceiveCode" : "independentKeyReceiveCode")
                : independentKeyTitle
            }
            icon={
              walletSheet?.kind === "receiveCode"
                ? QrCode
                : accessFlow === "backup"
                  ? ShieldCheck
                  : KeyRound
            }
            closeLabel={t("common.close")}
            onClose={closeWalletSheet}
          >
            {walletSheet?.kind === "receiveCode"
              ? receiveCodeContent
              : walletSheet?.kind === "keys"
                ? independentKeyManager
                : null}
          </ShieldedWalletSheet>
        </div>
      )}
    </div>
  );
}
