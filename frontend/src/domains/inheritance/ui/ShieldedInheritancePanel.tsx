import {
  useEffect,
  useCallback,
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
  ZeroAddress,
  parseUnits,
  toUtf8Bytes,
  type Provider,
  type Signer,
} from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useConfig } from "../../config";
import { SUPPORTED_NETWORKS } from "../../../shared/config/networks";
import { normalizeShieldedUiError, ShieldedUiMessageError } from "../model/shieldedUiErrors";
import { ShieldedGasBalanceError } from "../model/shieldedGasBalanceError";
import { normalizeShieldedStateReadMode } from "../../../shared/config/shieldedStateReadMode";
import { getWalletConnectionGeneration, subscribeWalletConnectionChange } from "../../wallet";
import { useTreeGraphData } from "../../tree/context";
import { getShieldedLocalRecipientLabels } from "../services/shieldedRecipientOptions";
import { useTransactionCenter } from "../../transactions";
import { TransactionSuccessSummary } from "../../transactions/ui/shared/TransactionSuccessSummary";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { getShieldedPoolFactoryDeploymentBlock, getPrivateLetterArchiveAddress, getPrivateLetterArchiveDeploymentBlock } from "../../../shared/config/env";
import {
  normalizeFriendlyError,
  type ChainFriendlyError,
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
} from "../services/shieldedSubmissionTracking";
import { submitShieldedApproval, submitShieldedAuthorization } from "../services/shieldedWalletSubmission";
import { useShieldedSubmissionCoordinator, type ShieldedTrackedSubmission } from "./useShieldedSubmissionCoordinator";
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
  TaskHeader,
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
import { advanceReviewedSpendPlan, isReviewedSpendPlan } from "../model/shieldedSpendPlanReview";
import { parseShieldedAmount, parseShieldedFundingPeriods } from "../model/shieldedActionInputs";
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
  const stopSpendPlan = useRef(false);
  const [spendPlanStopped, setSpendPlanStopped] = useState(false);
  const [completedSpendSteps, setCompletedSpendSteps] = useState<ShieldedCompletedSpendStep[]>([]);
  const [completedMergeHashes, setCompletedMergeHashes] = useState<string[]>([]);
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
  const receiptTracking = useRef<ShieldedTrackedSubmission | null>(null);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setErrorState] = useState<ChainFriendlyError | null>(null);
  const setError = useCallback((message: string, cause?: unknown) => {
    setErrorState(message ? normalizeFriendlyError(cause ?? new Error(message), t, { message }) : null);
  }, [t]);
  const acceptPublicSyncProgress = useRef(false);
  const [publicSyncProgress, setPublicSyncProgress] = useState<Partial<Record<PublicStateSyncProgress["domain"], PublicStateSyncProgress>>>({});
  const [publicSyncPaused, setPublicSyncPaused] = useState(false);
  const [readModeRefreshing, setReadModeRefreshing] = useState(false);
  const readModeRefreshScope = useRef<string | null>(null);
  const [transactionHash, setTransactionHash] = useState(""),
    [transactionPending, setTransactionPending] = useState(false);
  const [transactionLabel, setTransactionLabel] = useState("");
  const [transactionKind, setTransactionKind] = useState<ShieldedTrackedSubmission["kind"] | null>(null);
  const [transactionStep, setTransactionStep] = useState<ShieldedTrackedSubmission["actionStep"]>();
  const [transactionResult, setTransactionResult] = useState<"done" | "failed" | "unknown" | "partial" | null>(
    null,
  );
  const [completedPayment, setCompletedPayment] = useState<{
    action: Action; amount: string; symbol: string; decimals: number; hash: string;
  } | null>(null);
  // Only the final payment can enter completion. Approval and consolidation cannot.
  const paymentCompletion = useRef<{
    id: string; requestKey: string; generation: number; action: Action;
    amount: string; symbol: string; decimals: number;
    walletGeneration: number; signer: Signer; account: string;
  } | null>(null);
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
  const [walletSection, setWalletSection] = useState<"balances" | "receiveCode" | "fundReceiveCredential" | "keys">("balances");
  const codePurpose = walletSection === "fundReceiveCredential" ? "fund" : "receive";
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
  const [ownCode, setOwnCode] = useState("");
  const [codeExpiry, setCodeExpiry] = useState(() => {
    const date = new Date(Date.now() + 90 * 86400_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [withdrawalRecipient, setWithdrawalRecipient] = useState(""),
    [candidates, setCandidates] = useState<string[]>([]);
  const [manualValueSelection, setManualValueSelection] = useState(false);
  const [claimHandle, setClaimHandle] = useState(""),
    [claimPeriods, setClaimPeriods] = useState<string[]>([]);
  const [claimSelectionReset, setClaimSelectionReset] = useState(false);
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
  const [allowanceErrorScope, setAllowanceErrorScope] = useState<typeof allowanceScope | null>(null);
  const allowanceKnown = modules.assetKind === "native" || allowanceSnapshot?.scope === allowanceScope;
  const allowanceFailed = !allowanceKnown && allowanceErrorScope === allowanceScope;
  const allowanceReady = useMemo(() => {
    if (modules.assetKind === "native") return true;
    if (!signer || allowanceSnapshot?.scope !== allowanceScope) return false;
    try {
      return allowanceSnapshot.amount >= parseUnits(amount || "0", modules.tokenDecimals ?? 0);
    } catch {
      return false;
    }
  }, [modules.assetKind, modules.tokenDecimals, signer, allowanceSnapshot, allowanceScope, amount]);
  const displayAssetSymbol = modules.tokenDecimals === null
    ? t("shielded.rawAssetUnit", { symbol: modules.assetSymbol }) : modules.assetSymbol;
  let withdrawalRecipientValid = false;
  try {
    const address = getAddress(withdrawalRecipient.trim());
    withdrawalRecipientValid = address !== ZeroAddress && address.toLowerCase() !== modules.poolAddress.toLowerCase();
  } catch { /* The field remains editable until a valid address is entered. */ }
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
  const feedbackScope = JSON.stringify([ownerContextKey, getShieldedAssetWorkerGeneration()]);
  const latestFeedbackScope = useRef(feedbackScope);
  latestFeedbackScope.current = feedbackScope;
  const submissionCoordinator = useShieldedSubmissionCoordinator({
    chainId: modules.chainId,
    poolAddress: modules.poolAddress,
    tracking: receiptTracking,
    isCurrent: () => mounted.current && contextRef.current === contextKey,
    onPending: (tracking) => {
      setTransactionKind(tracking.kind);
      setTransactionStep(tracking.actionStep);
      setTransactionHash(tracking.hash ?? "");
      setTransactionLabel(tracking.label);
      setTransactionPending(true);
      setTransactionResult(null);
    },
    onSettled: (tracking, status) => {
      setAllowanceRevision((revision) => revision + 1);
      setTransactionHash(tracking.hash ?? "");
      setTransactionPending(false);
      setTransactionKind(tracking.kind);
      setTransactionStep(tracking.actionStep);
      setTransactionResult(status === 1 ? tracking.actionStep === "merge" ? "partial" : "done" : "failed");
      setTransactionLabel(tracking.label);
      if (status === 1) {
        recordCompletedMerge(tracking, tracking.hash ?? "");
        if (tracking.actionStep !== "merge") completePayment(tracking.id, tracking.hash ?? "");
      }
      if (tracking.kind === "authorization" && status === 1 && tracking.feedbackScope === latestFeedbackScope.current) {
        setOwnCode("");
        receiveCodeScope.current = "";
      }
    },
    onRejected: () => setTransactionPending(false),
  });

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
  }, [showWorkspace, walletScreen, independentKeyInWorkspace, completedPayment]);
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
    verifiedRecipient.purpose === (action === "fund" ? "fund" : "receive") &&
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
  const selectedCandidates = manualValueSelection ? candidates : values.map((note) => note.commitment);
  // A submitted payment still belongs to this draft after recovery replaces its
  // notes, templates and claim handles. Preparation also checks that live state.
  const completionRequestKey = JSON.stringify([
    contextKey,
    session.credentials?.handle,
    session.identity?.handle,
    session.independentKey?.keyFingerprint,
    action,
    slot,
    selectedKeyFingerprint,
    amount,
    manualValueSelection,
    code,
    entry,
    rootVersion,
    periodDays,
    periods,
    policyHandle,
    personHash,
    withdrawalRecipient,
    recipientConfirmed,
    verifiedRecipient?.fingerprint,
    recipientInputMethod,
  ]);
  const currentCompletionRequestKey = useRef(completionRequestKey);
  currentCompletionRequestKey.current = completionRequestKey;
  const actionRequestKey = JSON.stringify([
    completionRequestKey,
    selectedCandidates,
    effectiveEntry,
    template?.handle,
    template?.ownerCommitment,
    claimHandle,
    claimPeriods,
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
    setProgress(null);
    setExecutingReview(null);
    paymentCompletion.current = null;
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
        setWalletScreen("workspace");
        setProgress(null);
        setExecutingReview(null);
        setCompletedSpendSteps([]);
        setCompletedMergeHashes([]);
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
    if (previousContext.current.ownerContextKey !== ownerContextKey && completedPayment)
      clearTransactionFeedback();
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
        setCompletedMergeHashes([]);
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
      actionStep: metadata.actionStep,
      hash: pendingRecord.transactionHash,
      nonce: metadata.nonce,
      signerAddress: metadata.signerAddress,
      fromBlock: metadata.fromBlock,
      ...(metadata.kind === "action"
        ? { pool: modules.pool, outputCommitments: metadata.outputCommitments }
        : {}),
    };
    setTransactionKind(metadata.kind);
    setTransactionStep(metadata.actionStep);
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
  // established it. A full lock or credentials replacement resets this local pin.
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
    const first = wallet?.claims.find((claim) => claim.slot === slot && claim.handle === claimHandle) ??
      wallet?.claims.find((claim) => claim.slot === slot && claim.status === "claimable") ??
      wallet?.claims.find((claim) => claim.slot === slot);
    setClaimHandle(first?.handle ?? "");
    setClaimPeriods((previous) => claimSelectionReset
      ? previous.filter((index) => first?.periodIndices.includes(index))
      : first?.periodIndices ?? []);
  }, [slot, selectedKeyFingerprint, wallet, claimHandle, claimSelectionReset]);
  useEffect(() => {
    cancelSpendReview();
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
        if (current()) { setAllowanceSnapshot(null); setAllowanceErrorScope(allowanceScope); }
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
        const unknownApproval = tracked.kind !== "action" && outcome.status === "replaced";
        latestTxCenter.current?.upsert({
          id: tracked.id,
          kind: "shielded",
          label: tracked.label,
          phase: successful ? "done" : unknownApproval ? "unknown" : "failed",
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
        setTransactionKind(tracked.kind);
        setTransactionStep(tracked.actionStep);
        setTransactionResult(successful ? tracked.actionStep === "merge" ? "partial" : "done" : unknownApproval ? "unknown" : "failed");
        setTransactionLabel(tracked.label);
        if (outcome.status === "confirmed") setTransactionHash(outcome.hash);
        if (successful && outcome.status === "confirmed") {
          recordCompletedMerge(tracked, outcome.hash);
          if (tracked.actionStep !== "merge") completePayment(tracked.id, outcome.hash);
        }
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
        if (successful && tracked.kind === "authorization" && tracked.feedbackScope === latestFeedbackScope.current) { setOwnCode(""); receiveCodeScope.current = ""; }
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
    resetError = true,
    failureMessage?: string,
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
    if (resetError) setError("");
    setStage(label);
    latestSession.current.touch();
    try {
      await task(current);
    } catch (cause) {
      if (current() && (resetError || !error)) {
        if (resolveErrorReason(cause) === "ERC20InsufficientAllowance") {
          // The allowance may also change outside this page while a proof is prepared.
          setAllowanceRevision((revision) => revision + 1);
        }
        if (failureMessage) {
          setErrorState(normalizeShieldedUiError(cause, t, { message: failureMessage }));
        } else if (cause instanceof ShieldedGasBalanceError) {
          const native = SUPPORTED_NETWORKS[Number(modules.chainId)]?.nativeCurrency;
          setError(t("shielded.gasBalanceInsufficient", {
            required: formatUnits(cause.required, native?.decimals ?? 18),
            symbol: native?.symbol ?? t("shielded.nativeCurrency"),
          }), cause);
        } else if (cause instanceof ShieldedDepositBalanceError) {
          setError(t("shielded.depositBalanceInsufficient", {
            balance: formatUnits(cause.balance, modules.tokenDecimals ?? 0),
            amount: formatUnits(cause.amount, modules.tokenDecimals ?? 0),
            symbol: displayAssetSymbol,
          }), cause);
        } else {
          setErrorState(normalizeShieldedUiError(cause, t));
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
    setLetterView(null);
    setWalletScreen("workspace");
    setPlanCount(0);
    setProgress(null);
    setExecutingReview(null);
    setCompletedSpendSteps([]);
    setCompletedMergeHashes([]);
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
    if (completedPayment) clearTransactionFeedback();
    setCompletedSpendSteps([]);
    setCompletedMergeHashes([]);
    setSlot(next);
    if (next === "independent") setSelectedKeyFingerprint(session.independentKey?.keyFingerprint ?? "");
    draftPolicy.current = null;
    setCandidates([]);
    setClaimHandle("");
    setClaimPeriods([]);
    setClaimSelectionReset(false);
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
    setError("");
    setWalletSection("balances");
    setOwnCode("");
    if (hasSession) setWalletScreen("workspace");
  }
  function openReceiveCode(next: ShieldedKeySlot, purpose: "receive" | "fund" = "receive") {
    if (busy || submissionPending) return;
    setError("");
    clearWalletSecretInputs();
    receiveCodeScope.current = "";
    setCodeSlot(next);
    setOwnCode("");
    setWalletSection(purpose === "fund" ? "fundReceiveCredential" : "receiveCode");
    if (hasSession) setWalletScreen("workspace");
  }
  function showIndependentKeyManager(flow: "restore" | "create" | "backup") {
    independentKeyOpenedFromWorkspace.current = showWorkspace;
    setTaskChosen(true);
    clearWalletSecretInputs();
    setWalletSection("keys");
    // In the workspace the key sheet takes focus itself; the entry card is focused here.
    focusDestination.current = showWorkspace ? null : "access";
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
      setOwnCode("");
      receiveCodeScope.current = "";
      pendingBackupDrill.current = null;
      showIndependentKeyManager(flow);
    }, "");
  }
  function chooseAction(next: Action) {
    setLetterView(null);
    clearSecretInputs();
    setTaskChosen(true);
    draftPolicy.current = null;
    changeCode("");
    setRecipientInputMethod("receiveCode");
    recipientForm.current?.clearSecretInputs();
    setStage("");
    setSpendPlanStopped(false);
    setCompletedSpendSteps([]);
    setCompletedMergeHashes([]);
    if (!submissionPending) {
      resetCompletedPaymentDraft();
      setTransactionHash("");
      setTransactionLabel("");
      setTransactionResult(null);
      setCompletedPayment(null);
      paymentCompletion.current = null;
    }
    if (next === "claim") {
      setClaimSelectionReset(false);
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
      if (!signer) throw new ShieldedUiMessageError(t("shielded.walletNotReady"));
      const credentialsHandle = latestSession.current.credentials?.handle;
      if (!credentialsHandle) throw new ShieldedUiMessageError(tr("independentKeyIdentityNeeded"));
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
          throw new ShieldedUiMessageError(tr("independentBackupRequired"));
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
                  () => reject(new ShieldedUiMessageError(tr("signatureExpired"))),
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
          setStage(tr(intent === "create" ? "creating" : "importing"));
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
      if (!credentialsHandle) throw new ShieldedUiMessageError(tr("independentKeyIdentityNeeded"));
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
      if (!credentialsHandle) throw new ShieldedUiMessageError(tr("independentKeyIdentityNeeded"));
      if (exportedFingerprint && (!externalSaved || !verificationStarted))
        throw new ShieldedUiMessageError(tr("saveExternalFirst"));
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
   * every verified factory pool to find the unlocked wallets' assets.
   */
  async function recover(allPools = false, automatic = false) {
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
      }, t("shielded.stages.recovering"), "session", !automatic,
        completedPayment ? t("shielded.confirmedRefreshFailed") : undefined);
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
    void recover(false, true);
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
      if (!Number.isFinite(new Date(codeExpiry).getTime()) || new Date(codeExpiry).getTime() <= Date.now()) throw new ShieldedUiMessageError(t("shielded.privateLetters.expiryFuture"));
      const result = await shieldedAssetWorkerCall(
        "receiveCode",
        { slot: receivingSlot, context, purpose: codePurpose, expiresAt: String(Math.floor(new Date(codeExpiry).getTime() / 1000)) },
        { timeoutMs: 1_200_000 },
      );
      if (current()) setOwnCode(result.code);
    }, t(codePurpose === "fund" ? "shielded.stages.fundReceiveCredential" : "shielded.stages.receiveCode"));
  }
  async function revokeReceiveCodes() {
    await run(async (current) => {
      if (!signer) throw new ShieldedUiMessageError(t("shielded.walletNotReady"));
      const chosen = signer;
      clearTransactionFeedback();
      const result = await shieldedAssetWorkerCall("authorizeIdentityCounter", { context }, { timeoutMs: 1_200_000 });
      if (!current()) return;
      if ((await chosen.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await chosen.getAddress()).toLowerCase() !== account.toLowerCase() || walletRef.current.signer !== chosen)
        throw new ShieldedUiMessageError(t("shielded.walletChanged"));
      if (!current()) return;
      const tracking = submissionCoordinator.capture({
        id: `shielded:authorization:${modules.chainId}:${Date.now()}`,
        label: t("shielded.privateLetters.revokeAll"), kind: "authorization", feedbackScope,
      }, chosen.provider!);
      try {
        const confirmed = await submitShieldedAuthorization({
          signer: chosen, chainId: modules.chainId, account,
          address: result.address, args: result.args,
          assertCurrent: () => {
            if (!current() || walletRef.current.signer !== chosen)
              throw new ShieldedUiMessageError(t("shielded.walletChanged"));
          },
          onSubmitting: tracking.onSubmitting,
          onBroadcast: (hash) => { tracking.onBroadcast(hash); if (current()) setStage(t("shielded.stages.confirming")); },
          onWalletRequest: () => {
            if (!current()) throw new ShieldedUiMessageError(t("shielded.walletChanged"));
            setStage(t("shielded.stages.submitting"));
            return latestSession.current.beginWalletRequest();
          },
        });
        tracking.onReceipt(confirmed.transactionHash, confirmed.receipt.status);
        if (confirmed.receipt.status !== 1)
          throw new ShieldedUiMessageError(t("shielded.transactionFailed", { hash: confirmed.transactionHash }));
        if (current()) { setOwnCode(""); receiveCodeScope.current = ""; }
      } catch (error) {
        tracking.onError(error);
        throw error;
      }
    }, t("shielded.privateLetters.revoking"), "wallet");
  }
  const receiveCodeReady = !!session.identity && (codeSlot === "identity" || independentKeyReady);
  // Each explicit open or wallet switch generates a receive code once; after a failure the
  // button retries.
  // A layout effect starts the job before paint, so the retry button never flashes first.
  useLayoutEffect(() => {
    if (walletSection !== "receiveCode" && walletSection !== "fundReceiveCredential") {
      receiveCodeScope.current = "";
      return;
    }
    if (ownCode || !receiveCodeReady || busy || submissionPending || activeOperation.current) return;
    const scope = JSON.stringify([
      contextKey,
      codeSlot,
      codePurpose,
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
    codePurpose,
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
        if (cancelled || !mounted.current || generation !== getShieldedAssetWorkerGeneration()) return;
        if (result.purpose !== (action === "fund" ? "fund" : "receive")) {
          setVerifiedRecipient(null);
          setCodeError(t(action === "fund" ? "shielded.fundReceiveCredentialRequired" : "shielded.receiveCodeRequired"));
          return;
        }
        setVerifiedRecipient(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled && mounted.current && generation === getShieldedAssetWorkerGeneration())
          setCodeError(cause instanceof Error ? cause.message : tr("failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [code, needsCode, action]);
  async function generateConvenientCode() {
    await run(async (current) => {
      const form = recipientForm.current;
      if (!form) return;
      const credentials = form.readAndClear();
      try {
        const pending = createShieldedReceiveCodeForRecipient({ ...credentials, context, purpose: action === "fund" ? "fund" : "receive", expiresAt: String(Math.floor(Date.now() / 1000) + 90 * 86400) });
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
    }, t(action === "fund" ? "shielded.stages.fundReceiveCredential" : "shielded.stages.receiveCode"));
  }
  function clearTransactionFeedback(dismissed = false) {
    resetCompletedPaymentDraft();
    setSpendPlanStopped(false);
    setTransactionHash("");
    setTransactionResult(null);
    setTransactionLabel("");
    setTransactionKind(null);
    setTransactionStep(undefined);
    setCompletedSpendSteps([]);
    setCompletedMergeHashes([]);
    setCompletedPayment(null);
    paymentCompletion.current = null;
    setTransactionFeedbackDismissed(dismissed);
  }
  function resetCompletedPaymentDraft() {
    if (!completedPayment) return;
    if (completedPayment.action === "claim") {
      setClaimSelectionReset(true);
      setClaimPeriods([]);
    } else {
      setAmounts((previous) => ({ ...previous, [completedPayment.action]: "" }));
      if (completedPayment.action === "fund") setPeriods("");
    }
  }
  function startNewPayment() {
    if (!completedPayment || busy || submissionPending || activeOperation.current) return;
    clearTransactionFeedback();
    setCompletedSpendSteps([]);
    setCompletedMergeHashes([]);
    setProgress(null);
    setExecutingReview(null);
    setStage("");
    setError("");
    focusDestination.current = "task";
  }
  function completePayment(id: string, hash: string) {
    const completed = paymentCompletion.current;
    if (!completed || completed.id !== id || !mounted.current ||
      completed.requestKey !== currentCompletionRequestKey.current ||
      completed.generation !== getShieldedAssetWorkerGeneration() ||
      completed.walletGeneration !== getWalletConnectionGeneration() ||
      completed.signer !== walletRef.current.signer || completed.account !== walletRef.current.account) return;
    paymentCompletion.current = null;
    setCompletedPayment({
      action: completed.action, amount: completed.amount, symbol: completed.symbol,
      decimals: completed.decimals, hash,
    });
    // Refreshing claimed budgets must not prepare another claim automatically.
    if (completed.action === "claim") setClaimSelectionReset(true);
  }
  function recordCompletedMerge(tracked: ShieldedTrackedSubmission, hash: string) {
    if (tracked.actionStep !== "merge" || !hash || tracked.feedbackScope !== latestFeedbackScope.current) return;
    setCompletedMergeHashes((hashes) => hashes.includes(hash) ? hashes : [...hashes, hash]);
  }
  async function approveDeposit(current: () => boolean, chosen: Signer, value: bigint, assertCurrent: () => void) {
    if (!modules.token) throw new ShieldedUiMessageError(t("shielded.walletNotReady"));
    assertCurrent();
    setProgress({ kind: "approval", stage: "submitting" });
    const tracking = submissionCoordinator.capture({
      id: `shielded:approval:${modules.chainId}:${account}:${Date.now()}`,
      label: `${modules.assetSymbol} · ${tr("approve")}`, kind: "approval",
    }, chosen.provider!);
    try {
      const confirmed = await submitShieldedApproval({
        signer: chosen, chainId: modules.chainId, account,
        token: modules.token, spender: modules.poolAddress, amount: value,
        assertCurrent,
        onSubmitting: tracking.onSubmitting,
        onBroadcast: (hash) => {
          tracking.onBroadcast(hash);
          if (current()) {
            setStage(t("shielded.stages.confirming"));
            setProgress({ kind: "approval", stage: "confirming" });
          }
        },
        onWalletRequest: () => { assertCurrent(); return latestSession.current.beginWalletRequest(); },
      });
      tracking.onReceipt(confirmed.transactionHash, confirmed.receipt.status);
      if (confirmed.receipt.status !== 1)
        throw new ShieldedUiMessageError(t("shielded.transactionFailed", { hash: confirmed.transactionHash }));
    } catch (error) {
      tracking.onError(error);
      throw error;
    }
    // The approval is confirmed independently of any subsequent deposit error.
    assertCurrent();
    clearTransactionFeedback();
    const allowance = await modules.token.allowance(account, modules.poolAddress);
    assertCurrent();
    if (getBigInt(allowance) < value) throw new ShieldedUiMessageError(tr("approveFirst"));
  }
  /**
   * Review the full plan once. A rebuilt remainder can continue only when it
   * exactly matches that approval, rebased onto the confirmed output notes.
   */
  async function prepare() {
    if (completedPayment || submissionPending || !slotReady || activeOperation.current) return;
    const chosen = signer,
      requested = actionRequestKey,
      generation = getShieldedAssetWorkerGeneration();
    await run(async (current) => {
      clearTransactionFeedback();
      setProgress({ kind: "action", stage: "preparing" });
      setCompletedSpendSteps([]);
      setCompletedMergeHashes([]);
      stopSpendPlan.current = false;
      setSpendPlanStopped(false);
      if (!chosen) throw new ShieldedUiMessageError(t("shielded.walletNotReady"));
      if (needsCode && !recipientReady) throw new ShieldedUiMessageError(action === "fund" ? t("shielded.fundReceiveCredentialRequired") : tr("confirmRecipient"));
      const assertCurrent = () => {
        if (requested !== currentRequestKey.current) throw new ShieldedUiMessageError(tr("reviewAgain"));
        if (!current() || generation !== getShieldedAssetWorkerGeneration())
          throw new ShieldedUiMessageError(t("shielded.unlockRequired"));
        if (walletRef.current.signer !== chosen || walletRef.current.account !== account)
          throw new ShieldedUiMessageError(t("shielded.walletChanged"));
      };
      const requiresAmount = action !== "claim" && !(action === "fund" && selectedPolicy);
      const parsedAmount = requiresAmount ? parseShieldedAmount(amount, modules.tokenDecimals ?? 0) : undefined;
      if (requiresAmount && parsedAmount === undefined)
        throw new ShieldedUiMessageError(tr("amountInvalid"));
      const amountValue = parsedAmount?.toString();
      if (action === "fund" && !parseShieldedFundingPeriods(periods.trim()))
        throw new ShieldedUiMessageError(tr("periodsInvalid"));
      if (action === "fund" && !selectedPolicy) parseShieldedPeriodDays(periodDays);
      if (action === "unshield" && !withdrawalRecipientValid) throw new ShieldedUiMessageError(t("shielded.invalidExitRecipient"));
      if (action === "claim" && !claimPeriods.length) throw new ShieldedUiMessageError(tr("reviewAgain"));
      if (action === "shield" && modules.assetKind === "erc20") {
        if (!modules.token) throw new ShieldedUiMessageError(t("shielded.walletNotReady"));
        if ((await chosen.getAddress()).toLowerCase() !== account.toLowerCase())
          throw new ShieldedUiMessageError(t("shielded.walletChanged"));
        await assertShieldedDepositBalance(modules.token, account, amountValue!);
        assertCurrent();
        const freshAllowance = getBigInt(await modules.token.allowance(account, modules.poolAddress));
        assertCurrent();
        setAllowanceSnapshot({ scope: allowanceScope, amount: freshAllowance });
        if (freshAllowance < BigInt(amountValue!)) {
          await approveDeposit(current, chosen, BigInt(amountValue!), assertCurrent);
          await assertShieldedDepositBalance(modules.token, account, amountValue!);
          assertCurrent();
        }
      }
      let stepCandidates =
        action === "fund"
          ? values.map((note) => note.commitment)
          : needsValues
            ? selectedCandidates
            : undefined;
      let stepPolicy =
        policyHandle ||
        (draftPolicy.current?.key === draftKey ? draftPolicy.current.handle : undefined);
      let reviewNotes = values.map(({ commitment, amount }) => ({ commitment, amount }));
      let generatedCommitments: string[] = [];
      let remaining = Number.POSITIVE_INFINITY;
      let sent = false;
      let reviewedRemainder: ShieldedAssetWorkerCallMap["preview"]["result"] | null = null;
      try {
        for (;;) {
          // A receipt may arrive after locking, navigation or a replacement session.
          // Reject it before it can mutate the shared Worker's next preview.
          assertCurrent();
          if (stopSpendPlan.current) return;
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
          if (stopSpendPlan.current) return;
          // Every consolidation must shorten the plan; anything else means history changed.
          if (planned.steps.length >= remaining) throw new ShieldedUiMessageError(tr("reviewAgain"));
          if (remaining === Number.POSITIVE_INFINITY && planned.steps.length > 1)
            setPlanCount(planned.steps.length);
          remaining = planned.steps.length;
          if (action === "fund" && !policyHandle && planned.policyHandle) {
            stepPolicy = planned.policyHandle;
            draftPolicy.current = { handle: planned.policyHandle, key: draftKey };
          }
          if (action === "privateTransfer" || action === "unshield") {
            const review: SpendReview = {
              preview: planned, action, notes: reviewNotes,
              candidateCommitments: [...(stepCandidates ?? [])], generatedCommitments,
              recipientLabel: action === "unshield" ? withdrawalRecipient : (recipientTargetName ?? recipientTargetHash ?? t("shielded.verifiedCodeRecipient")),
            };
            if (!isReviewedSpendPlan(reviewedRemainder, planned)) {
              if (!await reviewSpend(review)) {
                if (sent) setSpendPlanStopped(true);
                return;
              }
            } else setExecutingReview(review);
            assertCurrent();
            if (stopSpendPlan.current) return;
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
          if (stopSpendPlan.current) return;
          const txId = `shielded:${modules.chainId}:${Date.now()}:${planned.handle}`,
            label = `${modules.assetSymbol} · ${planned.steps.length > 1 ? t("shielded.spendReview.merge") : t(`shielded.actions.${action}`, { symbol: modules.assetSymbol })}`;
          const tracking = submissionCoordinator.capture({
            id: txId, label, kind: "action", pool: modules.pool,
            actionStep: planned.steps.length > 1 ? "merge" : "payment",
            feedbackScope,
            outputCommitments: result.data.outputCommitments.map((value) => getBigInt(value).toString()),
          }, chosen.provider!);
          if (planned.steps.length <= 1) paymentCompletion.current = {
            id: txId, requestKey: completionRequestKey, generation, action,
            amount: result.amount, symbol: displayAssetSymbol, decimals: modules.tokenDecimals ?? 0,
            walletGeneration: getWalletConnectionGeneration(), signer: chosen, account,
          };
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
              tracking.onBroadcast(hash);
            },
            onWalletRequest: () => {
              assertCurrent();
              return latestSession.current.beginWalletRequest();
            },
            onSubmitting: (metadata: import("../services/shieldedWalletSubmission").ShieldedSubmissionAnchor) => {
              assertCurrent();
              tracking.onSubmitting(metadata);
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
            tracking.onError(cause);
            throw cause;
          }
          sent = true;
          tracking.onReceipt(submitted.transactionHash, submitted.receipt.status);
          if (current()) {
            setTransactionHash(submitted.transactionHash);
            setTransactionLabel(label);
            setTransactionPending(false);
            setTransactionResult(submitted.receipt.status !== 1 ? "failed" : planned.steps.length > 1 ? "partial" : "done");
          }
          if (submitted.receipt.status !== 1)
            throw new ShieldedUiMessageError(t("shielded.transactionFailed", { hash: submitted.transactionHash }));
          if (planned.steps.length <= 1) {
            if (current()) completePayment(txId, submitted.transactionHash);
            if (current()) setSpendPlanStopped(false);
            break;
          }
          if (current()) {
            const first = planned.steps[0];
            setCompletedSpendSteps((steps) => [...steps, {
              merge: true, inputCount: first.inputs.length,
              inputTotal: planned.inputAmounts.reduce((sum, value) => sum + BigInt(value), 0n).toString(),
              principal: first.outputAmounts[0], change: first.outputAmounts[1], hash: submitted.transactionHash,
            }]);
          }
          // The consolidated outputs replace its inputs among the next step's candidates.
          const outputs = result.data.outputCommitments.map((value) => getBigInt(value).toString());
          reviewedRemainder = advanceReviewedSpendPlan(planned, outputs, reviewNotes,
            action === "unshield" ? getAddress(withdrawalRecipient.trim()) : undefined);
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
          if (current() && (action === "privateTransfer" || action === "unshield")) {
            // Keep the approved remainder and stop control visible while its new
            // preview scans the confirmed outputs. A changed plan still needs review.
            setExecutingReview(reviewedRemainder ? {
              preview: reviewedRemainder, action, notes: reviewNotes,
              candidateCommitments: [...(stepCandidates ?? [])], generatedCommitments,
              recipientLabel: action === "unshield" ? withdrawalRecipient : (recipientTargetName ?? recipientTargetHash ?? t("shielded.verifiedCodeRecipient")),
            } : null);
          }
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
  const symbol = displayAssetSymbol;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t("common.copyFailed"));
    }
  };
  const parsePositive = (value: string) => parseShieldedAmount(value.trim(), decimals);
  const walletName = tr(slot === "identity" ? "identityCredentials" : "independentKey");
  const slotAvailable = wallet && slotReady ? valueTotals[slot] : undefined;
  const walletSheetOpen = showWorkspace && walletSection !== "balances";
  const completedPaymentSummary = completedPayment ? (
    <TransactionSuccessSummary
      t={t}
      title={t("transaction.success")}
      rows={[
        { label: tr("action"), value: t(`shielded.actions.${completedPayment.action}`, { symbol: completedPayment.symbol }) },
        { label: tr("amount"), value: `${formatShieldedAmount(completedPayment.amount, completedPayment.decimals)} ${completedPayment.symbol}` },
        { label: tr("transactionHash"), value: completedPayment.hash, mono: true },
      ]}
    />
  ) : null;
  const transactionStatus =
    !busy &&
    hasSession &&
    !transactionFeedbackDismissed &&
    (transactionHash || submissionPending || transactionResult) ? (
      <p
        role="status"
        className="break-all rounded-xl bg-surface-alt px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted"
      >
        {transactionLabel ? `${transactionLabel} · ` : ""}
        {transactionHash && !completedMergeHashes.includes(transactionHash) ? `${tr("transactionHash")}: ${transactionHash} · ` : ""}
        {transactionKind === "authorization" && transactionResult === "done"
          ? t("transaction.success")
          : transactionStep === "payment" && completedMergeHashes.length > 0 && (submissionPending || transactionResult === "unknown")
            ? t("shielded.walletKeys.paymentPending", { count: completedMergeHashes.length })
            : transactionResult === "partial"
              ? t(spendPlanStopped ? "shielded.spendReview.stopped" : "shielded.walletKeys.mergeCompleted")
              : t(submissionPending ? "transaction.pending" : transactionResult === "unknown" ? "transaction.unknown" : transactionResult === "failed" ? "transaction.failed" : "transaction.success")}
      </p>
    ) : null;
  const errorNotice = error ? (
    <div className="space-y-2">
      {submissionPending ? null : <p role="alert" className="break-words text-sm text-danger">{error.message}</p>}
      {error.details && (submissionPending || error.details !== error.message) ? (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">{t("transaction.errorDetails")}</summary>
          <p className="mt-2 break-words">{error.details}</p>
        </details>
      ) : null}
    </div>
  ) : null;
  // A confirmed spend plan shows its own progress inside the step being sent.
  const progressList =
    busy && progress && !spendReview && !executingReview ? (
      <div>
        <ShieldedProgressList
          stage={progress.stage}
          stages={progress.kind === "approval" ? SHIELDED_APPROVAL_STAGES : SHIELDED_ACTION_STAGES}
        />
      </div>
    ) : null;
  const taskFeedback = walletSheetOpen ? null : (
    <>
      {spendPlanStopped && !busy && !transactionStatus ? <p role="status" className="text-sm text-ink-muted">{t("shielded.spendReview.stopped")}</p> : null}
      {!busy && completedMergeHashes.length > 0 && transactionResult !== "done" && transactionResult !== "partial" && !submissionPending && transactionResult !== "unknown" ? (
        <p role="status" className="text-sm text-ink-muted">
          {t("shielded.walletKeys.partialCompletion", { count: completedMergeHashes.length })}
        </p>
      ) : null}
      {!busy && !executingReview && !spendReview && completedMergeHashes.length > 0 ? (
        <dl className="space-y-2 text-xs text-ink-muted">
          {completedMergeHashes.map((hash, index) => <div key={hash}>
            <dt>{`${t("transaction.success")} · ${index + 1}`}</dt>
            <dd className="break-all font-mono">{hash}</dd>
          </div>)}
        </dl>
      ) : null}
      {busy && planCount > 1 && action === "fund" ? (
        <p role="status" className="text-[13px] font-medium text-ink/80">
          {t("shielded.walletKeys.planTransactions", { count: planCount })}
        </p>
      ) : null}
      {progressList ??
        (stage && !executingReview && !readModeRefreshing ? (
          <p role="status" className="text-sm text-ink-muted">
            {stage}
          </p>
        ) : null)}
      {errorNotice}
      {transactionStatus}
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
      onCreate={(source) => void createIndependentKey(source)}
      onExport={() => void exportRecoveryMaterial()}
      onBeginVerification={() => void beginBackupVerification()}
      onImport={() => void importRecoveryMaterial()}
      onRestoreSignature={() => void requestSignature("restore")}
      discoveryReport={discoveryWarning}
      onCopyFingerprint={() => void copy(keyFingerprint)}
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
    : walletSection === "receiveCode" || walletSection === "fundReceiveCredential"
      ? { kind: walletSection, slot: codeSlot }
      : walletSection === "keys"
        ? { kind: "keys", flow: accessFlow }
        : null;
  const receiveCodeContent = (
    <div role="group" aria-label={tr(codePurpose === "fund" ? "fundReceiveCredentialLabel" : "receiveKeyLabel")} className="space-y-4">
      {!session.identity ? (
        <WarningNotice>{tr("independentKeyRestoredIdentityHint")}</WarningNotice>
      ) : codeSlot === "independent" && !independentKeyReady ? (
        <p className="text-xs text-warning">{tr("walletLocked")}</p>
      ) : null}
      {codePurpose === "receive" ? (
        <p className="text-xs text-ink-muted">{t("shielded.privateLetters.receivePrivacy")}</p>
      ) : null}
      <FieldBlock label={t("shielded.privateLetters.expiresAt")}>
        <input type="datetime-local" aria-label={t("shielded.privateLetters.expiresAt")} className={FIELD_INPUT} value={codeExpiry} disabled={busy || submissionPending} onChange={(event) => { setCodeExpiry(event.target.value); setOwnCode(""); receiveCodeScope.current = ""; }} />
      </FieldBlock>
      {ownCode ? (
        <FieldBlock
          label={t(codePurpose === "fund" ? "shielded.fundReceiveCredentialLabel" : "shielded.receiveCodeLabel", { symbol })}
          hint={t(codePurpose === "fund" ? "shielded.fundReceiveCredentialShareHint" : "shielded.receiveCodeShareHint", { symbol })}
        >
          <div className="relative">
            <textarea
              aria-label={t(codePurpose === "fund" ? "shielded.fundReceiveCredentialLabel" : "shielded.receiveCodeLabel", { symbol })}
              className={`${FIELD_TEXTAREA} min-h-28 resize-none pr-10`}
              readOnly
              value={ownCode}
              rows={5}
            />
            <div className="absolute right-1.5 top-1.5">
              <CopyIconButton label={t(codePurpose === "fund" ? "shielded.copyFundReceiveCredential" : "shielded.copyReceiveCode")} onClick={() => void copy(ownCode)} />
            </div>
          </div>
        </FieldBlock>
      ) : busy ? null : receiveCodeReady ? (
        <>
          <PanelButton
            size="compact"
            disabled={submissionPending}
            onClick={() => void createCode(codeSlot)}
          >
            {t(codePurpose === "fund" ? "shielded.generateFundReceiveCredential" : "shielded.generateReceiveCode")}
          </PanelButton>
        </>
      ) : null}
      {session.identity ? <div className="space-y-2 border-t border-line pt-3">
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">{t("transaction.errorDetails")}</summary>
          <div className="mt-2 space-y-2">
            <p>{t("shielded.privateLetters.revokeHint")}</p>
          </div>
        </details>
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
  if (completedPayment && completedPayment.action === action && !letterView) {
    composer = (
      <div className="space-y-5">
        <TaskHeader id={taskTitleId} title={t(`shielded.actions.${completedPayment.action}`, { symbol: completedPayment.symbol })} />
        {completedPaymentSummary}
        {walletSheetOpen ? null : errorNotice}
        <PanelButton
          variant="primary"
          size="large"
          className="w-full sm:w-auto"
          disabled={busy || submissionPending}
          onClick={startNewPayment}
        >
          {tr("startNewPayment")}
        </PanelButton>
      </div>
    );
    receipt = null;
  } else if (letterView) {
    composer = (
      <>
        <PrivateLettersPanel
          mode={letterView}
          titleId={taskTitleId}
          context={context}
          provider={modules.provider}
          signer={signer ?? null}
          disabled={busy || submissionPending}
          recoveryReady={!!session.identity || !!session.independentKey}
          sessionScope={JSON.stringify([session.credentials?.handle, session.identity?.handle, session.independentKey?.keyFingerprint])}
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
      rate = selectedPolicy ? BigInt(selectedPolicy.amountPerPeriod) : parseShieldedAmount(amount, decimals);
    } catch {
      // Incomplete inputs have no preview until they are valid.
    }
    try {
      days = selectedPolicy ? BigInt(selectedPolicy.periodDays) : parseShieldedPeriodDays(periodDays);
    } catch {
      // As above.
    }
    const fundingPeriods = parseShieldedFundingPeriods(periods.trim());
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
        busy={busy || submissionPending}
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
        existingSchedule={!!selectedPolicy}
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
            {!wallet ? error ? null : <p role="status" className="text-xs text-ink-muted">{t("shielded.publicStateSync.balanceLoading")}</p> : fundingBalance === 0n ? <WarningNotice>{t("shielded.automaticFundingUnavailable")}</WarningNotice> : null}
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
            aria-busy={busy || undefined}
            disabled={
              busy ||
              submissionPending ||
              !slotReady ||
              !session.identity ||
              !signer ||
              !rate || rate <= 0n ||
              !fundingPeriods ||
              !days ||
              !wallet ||
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
    const noFundedPeriods = slotBudgets.length > 0 && slotBudgets.every((note) =>
      BigInt(note.amount) === 0n ||
      (BigInt(note.amountPerPeriod ?? "0") > 0n && BigInt(note.amount) < BigInt(note.amountPerPeriod!)),
    );
    const status = !wallet
      ? t(error ? "shielded.claimOverview.unavailable" : "shielded.claimOverview.checking", { symbol })
      : wallet.familyRecordsAvailable === false
        ? t("shielded.claimOverview.unavailable", { symbol })
        : noFundedPeriods
          ? t("shielded.claimOverview.exhausted", { symbol })
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
          paymentCompletion.current = null;
          setClaimHandle(handle);
          setClaimPeriods(claims.find((claim) => claim.handle === handle)?.periodIndices ?? []);
        }}
        claimPeriods={claimPeriods}
        onClaimPeriodsChange={(indices) => {
          paymentCompletion.current = null;
          setClaimPeriods(indices);
        }}
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
              aria-busy={busy || undefined}
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
        withdrawalRecipientError={action === "unshield" && withdrawalRecipient.trim() && !withdrawalRecipientValid ? t("shielded.invalidExitRecipient") : undefined}
        onWithdrawalRecipientChange={setWithdrawalRecipient}
        values={values}
        selectedCommitments={selectedCandidates}
        automaticSelection={!manualValueSelection}
        onAutomaticSelectionChange={(automatic) => { setManualValueSelection(!automatic); setCandidates([]); }}
        onSelectedCommitmentsChange={(commitments) => {
          paymentCompletion.current = null;
          setCandidates(commitments);
        }}
      />
    );
    const notices = (
      <>
        {action === "shield" && modules.assetKind === "erc20" && signer && !allowanceKnown ? (
          allowanceFailed ? <div className="space-y-2">
            <WarningNotice>{tr("allowanceFailed")}</WarningNotice>
            <PanelButton size="compact" disabled={busy} onClick={() => setAllowanceRevision((value) => value + 1)}>{t("common.retry")}</PanelButton>
          </div> : <p role="status" className="text-xs text-ink-muted">{tr("allowanceChecking")}</p>
        ) : null}
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
              aria-busy={busy || undefined}
              disabled={busy || !slotReady || submissionPending || !signer || !spendAmount || (modules.assetKind === "erc20" && !allowanceKnown)}
              onClick={() => void prepare()}
            >
              {modules.assetKind === "erc20" && allowanceKnown && !allowanceReady ? tr("approveAndDeposit") : submitLabel("shield")}
            </PanelButton>
          }
        />
      );
    } else {
      const candidateTotal = values
        .filter((note) => selectedCandidates.includes(note.commitment))
        .reduce((sum, note) => sum + BigInt(note.amount), 0n);
      const withdrawalSelectionAvailable =
        selectedCandidates.length > 0 &&
        selectedCandidates.every((commitment) =>
          values.some((note) => note.commitment === commitment && BigInt(note.amount) > 0n),
        );
      const review = spendReview ? (
        <ShieldedSpendReview
          {...spendReview}
          manualSelection={manualValueSelection}
          decimals={decimals}
          symbol={symbol}
          completedSteps={completedSpendSteps}
          onConfirm={() => settleSpendReview(spendReview, true)}
          onCancel={() => settleSpendReview(spendReview, false)}
        />
      ) : executingReview ? (
        <ShieldedSpendReview
          {...executingReview}
          manualSelection={manualValueSelection}
          decimals={decimals}
          symbol={symbol}
          completedSteps={completedSpendSteps}
          running
          onCancel={() => { stopSpendPlan.current = true; setSpendPlanStopped(true); }}
          stopRequested={spendPlanStopped}
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
            manualValueSelection && selectedCandidates.length
              ? t("shielded.valueSelectionSummary", {
                  symbol,
                  count: selectedCandidates.length,
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
              aria-busy={busy || undefined}
              disabled={
                busy ||
                !spendAmount ||
                !slotReady ||
                submissionPending ||
                (needsCode && !recipientReady) ||
                !signer ||
                (recipientNeedsConfirmation && !recipientConfirmed) ||
                (action === "privateTransfer" && selectedCandidates.length === 0) ||
                (action === "unshield" && (!withdrawalSelectionAvailable || !withdrawalRecipientValid))
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
      animate={!progress}
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
            onReceiveBudget={(receivingSlot) => openReceiveCode(receivingSlot, "fund")}
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
              walletSheet?.kind === "receiveCode" || walletSheet?.kind === "fundReceiveCredential"
                ? tr(codePurpose === "fund"
                  ? codeSlot === "identity" ? "identityFundReceiveCredential" : "independentKeyFundReceiveCredential"
                  : codeSlot === "identity" ? "identityReceiveCode" : "independentKeyReceiveCode")
                : independentKeyTitle
            }
            icon={
              walletSheet?.kind === "receiveCode" || walletSheet?.kind === "fundReceiveCredential"
                ? QrCode
                : accessFlow === "backup"
                  ? ShieldCheck
                  : KeyRound
            }
            closeLabel={t("common.close")}
            onClose={closeWalletSheet}
          >
            {walletSheet?.kind === "receiveCode" || walletSheet?.kind === "fundReceiveCredential"
              ? receiveCodeContent
              : walletSheet?.kind === "keys"
                ? independentKeyManager
                : null}
            {walletSheetOpen ? <div className="mt-4 space-y-3">
              {stage ? <p role="status" className="text-sm text-ink-muted">{stage}</p> : null}
              {errorNotice}
              {walletSection !== "keys" && transactionKind === "authorization" ? transactionStatus : null}
            </div> : null}
          </ShieldedWalletSheet>
        </div>
      )}
    </div>
  );
}
