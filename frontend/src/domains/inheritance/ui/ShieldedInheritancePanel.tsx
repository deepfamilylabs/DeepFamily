import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedPolicyCommitment,
  getShieldedBudgetCommitments,
  deriveShieldedHeirKeyMaterial,
  DEFAULT_SHIELDED_PERIOD_DAYS,
  SECONDS_PER_DAY,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { formatUnits, getAddress, getBigInt, parseUnits, type Signer } from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useTreeGraphData } from "../../tree/context";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import { formatShieldedTimestamp, parseShieldedPeriodDays } from "../model/shieldedBudgetPeriod";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import {
  findHeirLegitimacy,
  loadLineageSnapshot,
  type LineageSnapshot,
} from "../services/inheritanceChain";
import { deriveIdentityFromForm } from "../services/inheritanceIdentity";
import {
  getShieldedFundingFamilyOptions,
  listShieldedFundingChildren,
  listShieldedFundingParentVersions,
} from "../services/shieldedFundingFamily";
import {
  nextClaimPeriods,
  getShieldedClaimBudgetKey,
  selectValueNotes,
  type ShieldedSelectableBudgetNote,
  type ShieldedSelectableValueNote,
} from "../services/shieldedActionSelection";
import {
  listShieldedClaimBudgetOptions,
  type ShieldedClaimOverview,
} from "../services/shieldedClaimOverview";
import { getFriendlyError, resolveErrorReason } from "../../../shared/lib/errors";
import { CopyIconButton, useToast } from "../../../shared/ui";
import {
  getShieldedLocalRecipientLabels,
  validateShieldedRecipientSelection,
  type ShieldedRecipientOption,
} from "../services/shieldedRecipientOptions";
import { useShieldedIdentitySession } from "./useShieldedIdentitySession";
import { ShieldedRecipientPicker } from "./ShieldedRecipientPicker";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";
import { prepareShieldedClaim } from "../services/shieldedClaimPreparation";
import {
  createShieldedPolicyDescriptor,
  prepareShieldedFund,
} from "../services/shieldedFundingPreparation";
import {
  submitFundWithFreshLineage,
  submitClaimWithFreshLineage,
} from "../services/shieldedFreshLineageSubmit";
import {
  createOwnShieldedReceiveCode,
  createShieldedReceiveCodeForRecipient,
  peekShieldedReceiveCodePersonHash,
  ShieldedReceiveCodeError,
  verifyShieldedReceiveCode,
} from "../services/shieldedReceiveCode";
import { prepareShieldedShield } from "../services/shieldedNotePreparation";
import {
  submitFund,
  submitPrivateTransfer,
  submitShield,
  submitUnshield,
  type ShieldedPoolFlowStage,
} from "../services/shieldedPoolFlows";
import { getShieldedPoolDeploymentBlock } from "../../../shared/config/env";
import {
  prepareShieldedPrivateTransfer,
  prepareShieldedValueConsolidation,
  prepareShieldedUnshield,
} from "../services/shieldedTransferExitPreparation";
import {
  listRecoveredFundingTemplates,
  listRecoveredShieldedPolicies,
  listUnspentRecoveredShieldedNotes,
  recoverLocalShieldedWallet,
  type LocalShieldedWalletSnapshot,
} from "../services/shieldedWalletRecovery";
import {
  FieldBlock,
  PanelButton,
  PanelShell,
  shortHex,
  SuccessNotice,
  WarningNotice,
} from "./inheritanceControls";

type Action =
  | "recover"
  | "receiveCode"
  | "shield"
  | "fund"
  | "claim"
  | "privateTransfer"
  | "unshield";

type TaskGroup = "wallet" | "inheritance" | "receive";
type RecipientInputMethod = "receiveCode" | "credentials";
type BudgetPrivacy = "private" | "public";
type ClaimSelection = NonNullable<ShieldedClaimOverview["claim"]> & { key: string };
const TASK_GROUPS: readonly TaskGroup[] = ["wallet", "inheritance", "receive"];
const PERIOD_DAY_PRESETS = [1, 7, 14, 21, 30, 90, 180, 365] as const;
const TASK_ACTIONS: Record<TaskGroup, readonly Action[]> = {
  wallet: ["shield", "privateTransfer", "unshield", "receiveCode"],
  inheritance: ["fund"],
  receive: ["claim"],
};

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

type Note = ReturnType<typeof listUnspentRecoveredShieldedNotes>[number];

function fundingPolicyKey(policy: ReturnType<typeof createShieldedPolicyDescriptor>): string {
  return computeShieldedPolicyCommitment({
    ...policy,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(policy.allocationKey),
  }).toString();
}

function parsePositiveTokenAmount(value: string, decimals: number): bigint {
  let amount: bigint;
  try {
    amount = parseUnits(value.trim(), decimals);
  } catch {
    throw new InheritanceError("amountInvalid");
  }
  if (amount <= 0n) throw new InheritanceError("amountInvalid");
  return amount;
}

function parsePositivePeriods(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value.trim())) throw new InheritanceError("periodsInvalid");
  return BigInt(value.trim());
}

function checkReceipt(status: number | null, hash: string, t: TFunction): void {
  if (status !== 1) {
    throw new Error(t("shielded.transactionFailed", { hash }));
  }
}

function claimSelectionIsAvailable(
  selection: ClaimSelection | undefined,
  budgets: readonly Note[],
  wallet: LocalShieldedWalletSnapshot,
  secret: string,
  now: bigint,
): boolean {
  if (!selection || selection.periodIndices.length < 1 || selection.periodIndices.length > 12)
    return false;
  const budget = budgets.find((item) => item.commitment === selection.budget.commitment);
  const secondCommitment = selection.secondBudget?.commitment;
  const second =
    secondCommitment !== undefined
      ? budgets.find((item) => item.commitment === secondCommitment)
      : undefined;
  if (
    budget?.note.kind !== "budget" ||
    getShieldedClaimBudgetKey(budget.note) !== selection.key ||
    (selection.secondBudget &&
      (second?.note.kind !== "budget" ||
        second.commitment === budget.commitment ||
        getShieldedClaimBudgetKey(second.note) !== selection.key))
  )
    return false;
  try {
    const availablePeriods = nextClaimPeriods(
      wallet,
      secret,
      {
        ...budget.note,
        remaining:
          budget.note.remaining + (second?.note.kind === "budget" ? second.note.remaining : 0n),
      },
      now,
    );
    return selection.periodIndices.every(
      (index, position) =>
        availablePeriods.includes(index) &&
        (position === 0 || index > selection.periodIndices[position - 1]),
    );
  } catch {
    return false;
  }
}

function ValueNotePicker({
  notes,
  selectedCommitments,
  onChange,
  maxInputs,
  decimals,
  busy,
}: {
  notes: readonly Note[];
  selectedCommitments: readonly string[];
  onChange: (commitments: string[]) => void;
  maxInputs: 1 | 2;
  decimals: number;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const radioGroupName = useId();
  const singleChoice = maxInputs === 1;
  const values = notes.filter(
    (item): item is ShieldedSelectableValueNote =>
      item.note.kind === "value" && item.note.amount > 0n,
  );
  const missing = selectedCommitments.filter(
    (commitment) => !values.some((item) => item.commitment.toString() === commitment),
  );
  const total = values.reduce(
    (amount, item) =>
      selectedCommitments.includes(item.commitment.toString()) ? amount + item.note.amount : amount,
    0n,
  );
  const toggle = (commitment: string, checked: boolean) => {
    if (singleChoice && checked) onChange([commitment]);
    else if (!checked) onChange(selectedCommitments.filter((value) => value !== commitment));
    else if (selectedCommitments.length < maxInputs && !selectedCommitments.includes(commitment))
      onChange([...selectedCommitments, commitment]);
  };
  return (
    <fieldset
      disabled={busy}
      role={singleChoice ? "radiogroup" : undefined}
      className="min-w-0 space-y-3"
    >
      <legend className="text-sm font-medium text-ink">{t("shielded.fields.valueNote")}</legend>
      <p className="text-xs text-ink-muted">
        {singleChoice
          ? t("shielded.singleValueSelectionHint")
          : t("shielded.valueSelectionHint", { count: maxInputs })}
      </p>
      {values.length === 0 && missing.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("shielded.noRecoveredNote")}</p>
      ) : null}
      {values.map((item, index) => {
        const commitment = item.commitment.toString();
        const checked = selectedCommitments.includes(commitment);
        return (
          <label key={commitment} className="flex items-center gap-3 text-sm text-ink">
            <input
              type={singleChoice ? "radio" : "checkbox"}
              name={singleChoice ? radioGroupName : undefined}
              value={commitment}
              className="shrink-0"
              checked={checked}
              disabled={!singleChoice && !checked && selectedCommitments.length >= maxInputs}
              onChange={(event) => toggle(commitment, event.target.checked)}
            />
            <span className="min-w-0 break-words">
              {t("shielded.valueOption", {
                index: index + 1,
                amount: formatUnits(item.note.amount, decimals),
              })}
            </span>
          </label>
        );
      })}
      {missing.map((commitment) =>
        singleChoice ? (
          <div key={commitment} className="flex items-center gap-3 text-sm text-danger">
            <input
              type="radio"
              name={radioGroupName}
              value={commitment}
              checked
              disabled
              aria-label={t("shielded.singleSelectedValueUnavailable")}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 break-words">
              {t("shielded.singleSelectedValueUnavailable")}
            </span>
            <button
              type="button"
              disabled={busy}
              className="shrink-0 text-primary hover:underline"
              onClick={() => onChange([])}
            >
              {t("shielded.clearValueSelection")}
            </button>
          </div>
        ) : (
          <label key={commitment} className="flex items-center gap-3 text-sm text-danger">
            <input type="checkbox" checked onChange={() => toggle(commitment, false)} />
            <span>{t("shielded.selectedValueUnavailable")}</span>
          </label>
        ),
      )}
      {selectedCommitments.length > 0 && missing.length === 0 ? (
        <p aria-live="polite" className="break-words text-xs text-ink-muted">
          {t(
            singleChoice
              ? "shielded.singleValueSelectionSummary"
              : "shielded.valueSelectionSummary",
            {
              count: selectedCommitments.length,
              amount: formatUnits(total, decimals),
            },
          )}
        </p>
      ) : null}
    </fieldset>
  );
}

function RecipientInput({
  method,
  onMethodChange,
  code,
  codeHint,
  onCodeChange,
  credentialsFormRef,
  onGenerateCode,
  busy,
}: {
  method: RecipientInputMethod;
  onMethodChange: (method: RecipientInputMethod) => void;
  code: string;
  codeHint?: string;
  onCodeChange: (value: string) => void;
  credentialsFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  /** Generates the recipient's receive code; every payment then verifies that code. */
  onGenerateCode: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">
          {t("shielded.recipientMethodLabel")}
        </legend>
        <div className="flex flex-wrap gap-4">
          {(["receiveCode", "credentials"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="shielded-recipient-method"
                value={option}
                checked={method === option}
                disabled={busy}
                onChange={() => onMethodChange(option)}
              />
              {t(`shielded.recipientMethods.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        {method === "receiveCode" ? (
          <FieldBlock label={t("shielded.receiveCodeInputLabel")} hint={codeHint}>
            <textarea
              aria-label={t("shielded.receiveCodeInputLabel")}
              className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              spellCheck={false}
              rows={3}
            />
          </FieldBlock>
        ) : (
          <div className="space-y-3">
            <WarningNotice>{t("shielded.recipientCredentialsWarning")}</WarningNotice>
            <ShieldedRecipientCredentialsForm ref={credentialsFormRef} />
            <PanelButton busy={busy} disabled={busy} onClick={onGenerateCode}>
              {t("shielded.generateReceiveCode")}
            </PanelButton>
          </div>
        )}
      </fieldset>
    </div>
  );
}

export function ShieldedInheritancePanel({
  modules,
  signer,
  account,
  publicActivityAddresses,
}: {
  modules: ShieldedPageModules;
  signer: Signer | null;
  account: string;
  publicActivityAddresses: Set<string>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { nodesData } = useTreeGraphData();
  const localRecipientLabels = useMemo(
    () => getShieldedLocalRecipientLabels(nodesData),
    [nodesData],
  );
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const walletCache = useRef<LocalShieldedWalletSnapshot | null>(null);
  const running = useRef(false);
  const [action, setAction] = useState<Action>("shield");
  const [taskGroup, setTaskGroup] = useState<TaskGroup>("wallet");
  const [busy, setBusy] = useState(false);
  const scope = `${modules.chainId}:${modules.poolAddress}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const transactionWallet = useRef({ account, signer });
  transactionWallet.current = { account, signer };
  const transactionEpoch = useRef(0);
  const session = useShieldedIdentitySession({
    scope,
    busy,
  });
  const identity = session.identity;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const operationEpoch = useRef(0);
  const previousScope = useRef(scope);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [walletSnapshot, setWalletSnapshot] = useState<LocalShieldedWalletSnapshot | null>(null);
  const [unspentNotes, setUnspentNotes] = useState<Note[]>([]);
  const [ownReceiveCode, setOwnReceiveCode] = useState("");
  const [shieldAmount, setShieldAmount] = useState("");
  const [rate, setRate] = useState("");
  const [periodDaysChoice, setPeriodDaysChoice] = useState(DEFAULT_SHIELDED_PERIOD_DAYS.toString());
  const [periodDaysInput, setPeriodDaysInput] = useState(DEFAULT_SHIELDED_PERIOD_DAYS.toString());
  const [fundingFamilyVersionSelection, setFundingFamilyVersionSelection] = useState("");
  const [heirPersonHash, setHeirPersonHash] = useState("");
  // A receive code is shareable, so it may live in page state; the recipient's
  // passphrase stays in the uncontrolled credentials form until it is used.
  const [recipientCode, setRecipientCode] = useState("");
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const recipientCredentialsFormRef = useRef<ShieldedRecipientCredentialsFormHandle>(null);
  const [recipientInputMethod, setRecipientInputMethod] =
    useState<RecipientInputMethod>("receiveCode");
  const [periods, setPeriods] = useState("1");
  const [claimSelection, setClaimSelection] = useState<ClaimSelection | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [exitAmount, setExitAmount] = useState("");
  const [exitRecipient, setExitRecipient] = useState("");
  const [selectedValueCommitments, setSelectedValueCommitments] = useState<string[]>([]);
  const [budgetSelection, setBudgetSelection] = useState("");
  const [policySelection, setPolicySelection] = useState("");
  const [fundingMode, setFundingMode] = useState<BudgetPrivacy>("private");
  const [lineageContext, setLineageContext] = useState<{
    scope: string;
    identity: IdentityMaterialV1Result;
    wallet: LocalShieldedWalletSnapshot | null;
    snapshot: LineageSnapshot;
    asOf: bigint;
  } | null>(null);
  const [lineageError, setLineageError] = useState("");

  useLayoutEffect(() => {
    transactionEpoch.current += 1;
  }, [account, signer]);

  useEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      operationEpoch.current += 1;
    }
  }, [scope]);

  useEffect(() => {
    const invalidate = () => {
      operationEpoch.current += 1;
      activeIdentity.current = null;
      walletCache.current = null;
      recipientCredentialsFormRef.current?.clearSecretInputs();
    };
    window.addEventListener("pagehide", invalidate);
    return () => {
      window.removeEventListener("pagehide", invalidate);
      invalidate();
    };
  }, []);

  useEffect(() => {
    if (identity) return;
    walletCache.current = null;
    setWalletSnapshot(null);
    setUnspentNotes([]);
    setOwnReceiveCode("");
    setSelectedValueCommitments([]);
    setBudgetSelection("");
    setPolicySelection("");
    setPeriodDaysChoice(DEFAULT_SHIELDED_PERIOD_DAYS.toString());
    setPeriodDaysInput(DEFAULT_SHIELDED_PERIOD_DAYS.toString());
    setFundingMode("private");
    setHeirPersonHash("");
    setClaimSelection(null);
    setFundingFamilyVersionSelection("");
    setRecipientCode("");
    setRecipientConfirmed(false);
    recipientCredentialsFormRef.current?.clearSecretInputs();
    setRecipientInputMethod("receiveCode");
    setTransactionHash("");
    setStage("");
    setError("");
    setLineageContext(null);
    setLineageError("");
  }, [identity]);

  const available = useMemo(() => {
    if (!walletSnapshot || walletSnapshot.invalidated) {
      return {
        values: [] as Note[],
        budgets: [] as ShieldedSelectableBudgetNote[],
        policies: [] as ReturnType<typeof listRecoveredShieldedPolicies>,
        templates: [] as ReturnType<typeof listRecoveredFundingTemplates>,
      };
    }
    // Decrypted plaintext is read only from memory. The RPC never receives
    // a target leaf index or child identity query for this list.
    const values = unspentNotes.filter((note) => note.note.kind === "value");
    const budgets = unspentNotes.filter(
      (note): note is ShieldedSelectableBudgetNote => note.note.kind === "budget",
    );
    const parentIdentityCommitment = BigInt(identity?.identityCommitment ?? 0);
    const policies = listRecoveredShieldedPolicies(walletSnapshot).filter(
      (policy) => policy.rootIdentityCommitment === parentIdentityCommitment,
    );
    return {
      values,
      budgets,
      policies,
      templates: listRecoveredFundingTemplates(walletSnapshot).filter(
        (template) => template.note.rootIdentityCommitment === parentIdentityCommitment,
      ),
    };
  }, [walletSnapshot, unspentNotes, identity]);
  const withdrawalSelectionAvailable =
    selectedValueCommitments.length === 1 &&
    available.values.some(
      (item) =>
        item.commitment.toString() === selectedValueCommitments[0] &&
        item.note.kind === "value" &&
        item.note.amount > 0n,
    );

  const labels = useMemo<Record<Action, string>>(
    () => ({
      recover: t("shielded.actions.recover"),
      receiveCode: t("shielded.actions.receiveCode"),
      shield: t("shielded.actions.shield"),
      fund: t("shielded.actions.fund"),
      claim: t("shielded.actions.claim"),
      privateTransfer: t("shielded.actions.privateTransfer"),
      unshield: t("shielded.actions.unshield"),
    }),
    [t],
  );

  useEffect(() => {
    if (!identity || taskGroup === "wallet") return;
    let cancelled = false;
    setLineageContext(null);
    setLineageError("");
    void Promise.all([
      loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
      modules.provider.getBlock("latest"),
    ])
      .then(([snapshot, block]) => {
        if (cancelled || activeIdentity.current !== identity || currentScope.current !== scope)
          return;
        if (!block) throw new Error(t("shielded.familyRecordsUnavailable"));
        setLineageContext({
          scope,
          identity,
          wallet: walletSnapshot,
          snapshot,
          asOf: BigInt(block.timestamp),
        });
      })
      .catch((cause: unknown) => {
        if (cancelled || activeIdentity.current !== identity) return;
        setLineageError(
          cause instanceof Error ? cause.message : t("shielded.familyRecordsUnavailable"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    identity,
    walletSnapshot,
    taskGroup,
    modules.lineageIndex,
    modules.deepFamily,
    modules.provider,
    scope,
    t,
  ]);

  const currentLineage =
    lineageContext?.wallet === walletSnapshot &&
    lineageContext.identity === identity &&
    lineageContext.scope === scope
      ? lineageContext
      : null;
  const eligibleClaimBudgets = useMemo(() => {
    if (!currentLineage || !identity) return [] as Note[];
    return available.budgets.filter(
      (item) =>
        item.note.kind === "budget" &&
        item.note.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER) &&
        findHeirLegitimacy({
          snapshot: currentLineage.snapshot,
          heir: identity,
          root: { identityCommitment: item.note.rootIdentityCommitment },
          rootVersionIndex: Number(item.note.rootVersionIndex),
        }).some((source) => source.writtenAt <= currentLineage.asOf),
    );
  }, [available.budgets, currentLineage, identity]);
  const claimBudgetOptions = useMemo(
    () =>
      currentLineage && walletSnapshot && identity
        ? listShieldedClaimBudgetOptions(
            eligibleClaimBudgets,
            walletSnapshot,
            identity.derivedSecretField,
            currentLineage.asOf,
          )
        : [],
    [currentLineage, walletSnapshot, identity, eligibleClaimBudgets],
  );
  const claimBudgetOption = budgetSelection
    ? claimBudgetOptions.find((option) => option.key === budgetSelection)
    : (claimBudgetOptions.find((option) => option.overview.claim) ?? claimBudgetOptions[0]);
  const claimOverview = claimBudgetOption?.overview;
  const claimBatch = claimOverview?.claim;
  const chosenClaim = useMemo(
    () =>
      claimSelection ??
      (claimBatch && claimBudgetOption ? { ...claimBatch, key: claimBudgetOption.key } : undefined),
    [claimSelection, claimBatch, claimBudgetOption],
  );
  const emptyClaimStatus = eligibleClaimBudgets.some(
    (budget) => budget.note.kind === "budget" && budget.note.remaining === 0n,
  )
    ? "exhausted"
    : "noFunds";
  const claimSelectionAvailable = useMemo(
    () =>
      !!currentLineage &&
      !!walletSnapshot &&
      !!identity &&
      claimSelectionIsAvailable(
        chosenClaim,
        eligibleClaimBudgets,
        walletSnapshot,
        identity.derivedSecretField,
        currentLineage.asOf,
      ),
    [chosenClaim, eligibleClaimBudgets, walletSnapshot, identity, currentLineage],
  );
  function changeClaimPeriod(index: bigint, checked: boolean) {
    if (!chosenClaim || !claimBudgetOption) return;
    const indices = checked
      ? [...chosenClaim.periodIndices, index].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      : chosenClaim.periodIndices.filter((item) => item !== index);
    setBudgetSelection(claimBudgetOption.key);
    setClaimSelection({
      ...chosenClaim,
      periodIndices: indices,
      amount: chosenClaim.budget.note.amountPerPeriod * BigInt(indices.length),
    });
  }
  const recipientTargetHash = useMemo(
    () => peekShieldedReceiveCodePersonHash(recipientCode),
    [recipientCode],
  );
  const recipientTargetName = recipientTargetHash
    ? localRecipientLabels.get(recipientTargetHash.toLowerCase())
    : undefined;
  // A payer can recognize a named relative. Without a name, only an explicit
  // check with the recipient guards against a swapped code.
  const recipientNeedsConfirmation =
    action === "privateTransfer" &&
    recipientInputMethod === "receiveCode" &&
    recipientTargetHash !== null &&
    !recipientTargetName;
  const changeRecipientCode = (value: string) => {
    setRecipientCode(value);
    setRecipientConfirmed(false);
  };
  const changeRecipientInputMethod = (method: RecipientInputMethod) => {
    recipientCredentialsFormRef.current?.clearSecretInputs();
    setRecipientInputMethod(method);
  };
  const selectedPolicy = policySelection
    ? available.policies.find((policy) => fundingPolicyKey(policy) === policySelection)
    : undefined;
  const fundingParentVersions = useMemo(() => {
    if (action !== "fund" || !currentLineage || !identity) return [];
    return listShieldedFundingParentVersions({
      snapshot: currentLineage.snapshot,
      parentIdentityCommitment: identity.identityCommitment,
    });
  }, [action, currentLineage, identity]);
  const explicitFundingVersion = fundingFamilyVersionSelection
    ? Number(fundingFamilyVersionSelection)
    : undefined;
  const fundingRoot = useMemo(
    () =>
      selectedPolicy ??
      (identity &&
      explicitFundingVersion !== undefined &&
      fundingParentVersions.includes(explicitFundingVersion)
        ? {
            rootIdentityCommitment: BigInt(identity.identityCommitment),
            rootVersionIndex: BigInt(explicitFundingVersion),
          }
        : undefined),
    [selectedPolicy, identity, explicitFundingVersion, fundingParentVersions],
  );
  const fundingParent = useMemo(() => {
    if (action !== "fund" || !currentLineage || !identity || !heirPersonHash.trim())
      return undefined;
    return getShieldedFundingFamilyOptions({
      snapshot: currentLineage.snapshot,
      heirPersonHash: heirPersonHash.trim(),
      asOf: currentLineage.asOf,
    }).parents.find((parent) => parent.identityCommitment === BigInt(identity.identityCommitment));
  }, [action, currentLineage, heirPersonHash, identity]);
  const fundingFamilyVersion = fundingParent?.versions.find(
    (version) => BigInt(version.versionIndex) === fundingRoot?.rootVersionIndex,
  );
  const fundingFamilyHash = fundingRoot
    ? wrapIdentityCommitmentAsPersonHash(fundingRoot.rootIdentityCommitment)
    : undefined;
  const fundingFamilyRelation = fundingParent?.relation;
  const childOptions = useMemo<ShieldedRecipientOption[]>(() => {
    const candidates: ShieldedRecipientOption[] = [];
    if (action !== "fund" || !identity || !fundingRoot) return candidates;
    if (selectedPolicy) {
      const policyCommitment = computeShieldedPolicyCommitment({
        ...selectedPolicy,
        allocationKeyCommitment: computeShieldedAllocationKeyCommitment(
          selectedPolicy.allocationKey,
        ),
      });
      for (const template of available.templates) {
        if (getShieldedBudgetCommitments(template.note).policyCommitment !== policyCommitment)
          continue;
        const personHash = wrapIdentityCommitmentAsPersonHash(template.note.heirIdentityCommitment);
        if (!candidates.some((candidate) => candidate.personHash === personHash)) {
          candidates.push({
            personHash,
            label: localRecipientLabels.get(personHash.toLowerCase()),
            eligible: true,
          });
        }
      }
    }
    if (!currentLineage || fundingRoot.rootVersionIndex > BigInt(Number.MAX_SAFE_INTEGER))
      return candidates;
    for (const candidate of listShieldedFundingChildren({
      snapshot: currentLineage.snapshot,
      asOf: currentLineage.asOf,
      parentIdentityCommitment: identity.identityCommitment,
      rootVersionIndex: Number(fundingRoot.rootVersionIndex),
    })) {
      if (
        !selectedPolicy &&
        candidate.personHash.toLowerCase() === identity?.personHash.toLowerCase()
      )
        continue;
      if (!candidates.some((existing) => existing.personHash === candidate.personHash)) {
        candidates.push({
          ...candidate,
          label: localRecipientLabels.get(candidate.personHash.toLowerCase()),
          eligible: candidate.eligible,
        });
      }
    }
    return candidates;
  }, [
    action,
    currentLineage,
    selectedPolicy,
    identity,
    available.templates,
    localRecipientLabels,
    fundingRoot,
  ]);

  async function refreshWallet(identity: IdentityMaterialV1Result) {
    const previous = walletCache.current;
    const ownerCommitment = deriveShieldedHeirKeyMaterial(
      identity.derivedSecretField,
    ).ownerCommitment;
    const reusable =
      previous &&
      !previous.invalidated &&
      previous.walletOwnerCommitment === ownerCommitment &&
      previous.walletIdentityCommitment === BigInt(identity.identityCommitment)
        ? previous
        : undefined;
    try {
      const snapshot = await recoverLocalShieldedWallet(
        modules.pool,
        {
          derivedSecretField: identity.derivedSecretField,
          identityCommitment: identity.identityCommitment,
        },
        {
          fromBlock: getShieldedPoolDeploymentBlock(Number(modules.chainId)),
          previous: reusable,
        },
      );
      if (activeIdentity.current === identity) {
        walletCache.current = snapshot;
        setWalletSnapshot(snapshot);
        setUnspentNotes(listUnspentRecoveredShieldedNotes(snapshot, identity.derivedSecretField));
        setPolicySelection((selection) =>
          listRecoveredShieldedPolicies(snapshot).some(
            (policy) =>
              policy.rootIdentityCommitment === BigInt(identity.identityCommitment) &&
              fundingPolicyKey(policy) === selection,
          )
            ? selection
            : "",
        );
      }
      return snapshot;
    } catch (cause) {
      if (activeIdentity.current === identity) {
        walletCache.current = null;
        setWalletSnapshot(null);
        setUnspentNotes([]);
      }
      throw cause;
    }
  }

  function chooseAction(next: Action, preferredGroup?: TaskGroup) {
    recipientCredentialsFormRef.current?.clearSecretInputs();
    setRecipientCode("");
    setRecipientConfirmed(false);
    setRecipientInputMethod("receiveCode");
    const group = TASK_GROUPS.find((candidate) => TASK_ACTIONS[candidate].includes(next));
    if (preferredGroup || group) setTaskGroup(preferredGroup ?? group!);
    setAction(next);
    setError("");
    setTransactionHash("");
    setStage("");
    setSelectedValueCommitments([]);
    setBudgetSelection("");
    setClaimSelection(null);
  }

  async function copyIdentityHash() {
    if (!identity || activeIdentity.current !== identity) return;
    let copied = false;
    try {
      if (typeof navigator.clipboard?.writeText === "function") {
        await navigator.clipboard.writeText(identity.personHash);
        copied = true;
      }
    } catch {
      // Use the same clipboard fallback as the other identity views.
    }
    if (activeIdentity.current !== identity) return;
    if (!copied) {
      const focusedElement = document.activeElement;
      const textarea = document.createElement("textarea");
      textarea.value = identity.personHash;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      try {
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        textarea.remove();
        if (focusedElement instanceof HTMLElement && focusedElement.isConnected) {
          focusedElement.focus();
        }
      }
    }
    if (copied) toast.success(t("search.copied"));
    else toast.error(t("search.copyFailed"));
  }

  function lockIdentity() {
    operationEpoch.current += 1;
    activeIdentity.current = null;
    recipientCredentialsFormRef.current?.clearSecretInputs();
    session.lock();
    setError("");
    setStage("");
    setTransactionHash("");
  }

  async function unlockIdentity() {
    if (running.current) return;
    running.current = true;
    const epoch = operationEpoch.current;
    setBusy(true);
    setError("");
    setStage(t("shielded.stages.deriving"));
    try {
      const material = await deriveIdentityFromForm(identityForm.current);
      if (epoch !== operationEpoch.current || currentScope.current !== scope) return;
      activeIdentity.current = material;
      session.unlock(material);
      identityForm.current?.clearSecretInputs();
      setStage(t("shielded.stages.recovering"));
      const [recovery] = await Promise.allSettled([refreshWallet(material)]);
      if (activeIdentity.current !== material) return;
      if (recovery.status === "fulfilled") {
        const notes = listUnspentRecoveredShieldedNotes(
          recovery.value,
          material.derivedSecretField,
        );
        const hasBudgets = notes.some(
          (item) =>
            item.note.kind === "budget" &&
            item.note.amountPerPeriod > 0n &&
            item.note.remaining >= item.note.amountPerPeriod,
        );
        setTaskGroup(hasBudgets ? "receive" : "wallet");
        setAction(
          hasBudgets
            ? "claim"
            : notes.some((item) => item.note.kind === "value" && item.note.amount > 0n)
              ? "privateTransfer"
              : "shield",
        );
      }
      if (recovery.status === "rejected") {
        const cause = recovery.reason;
        setError(
          t("shielded.refreshFailed", {
            detail: cause instanceof Error ? cause.message : t("shielded.unknownError"),
          }),
        );
      }
      setStage("");
    } catch (cause) {
      if (epoch !== operationEpoch.current || currentScope.current !== scope) return;
      setError(
        cause instanceof InheritanceError
          ? t(`inheritance.errors.${cause.code}`)
          : cause instanceof Error
            ? cause.message
            : t("shielded.unknownError"),
      );
      setStage("");
    } finally {
      identityForm.current?.clearSecretInputs();
      running.current = false;
      setBusy(false);
    }
  }

  async function generateRecipientCode() {
    const form = recipientCredentialsFormRef.current;
    if (running.current || !form) return;
    running.current = true;
    const epoch = operationEpoch.current;
    setBusy(true);
    setError("");
    setTransactionHash("");
    setStage(t("shielded.stages.receiveCode"));
    try {
      const code = await createShieldedReceiveCodeForRecipient(form.readAndClear());
      if (epoch !== operationEpoch.current) return;
      setRecipientCode(code);
      setRecipientConfirmed(false);
      setRecipientInputMethod("receiveCode");
      setStage("");
    } catch (cause) {
      if (epoch !== operationEpoch.current) return;
      setError(
        cause instanceof InheritanceError
          ? t(`inheritance.errors.${cause.code}`)
          : cause instanceof Error
            ? cause.message
            : t("shielded.unknownError"),
      );
      setStage("");
    } finally {
      form.clearSecretInputs();
      running.current = false;
      setBusy(false);
    }
  }

  async function submitSelected(requestedAction: Action = action) {
    if (running.current) return;
    const action = requestedAction;
    const chosenValueCommitments = [...selectedValueCommitments];
    running.current = true;
    let hash = "";
    let preparatoryHash = "";
    let fundedPolicyCommitment: string | undefined;
    setBusy(true);
    setError("");
    setTransactionHash("");
    setStage("");
    try {
      const identity = session.identity;
      if (!identity) throw new Error(t("shielded.unlockRequired"));
      if (action === "receiveCode") {
        session.touch();
        setStage(t("shielded.stages.receiveCode"));
        const code = await createOwnShieldedReceiveCode(identity);
        if (activeIdentity.current !== identity) throw new Error(t("shielded.unlockRequired"));
        setOwnReceiveCode(code);
        setStage("");
        return;
      }
      if (!signer) throw new Error(t("shielded.walletNotReady"));
      if (
        (action === "privateTransfer" || action === "unshield") &&
        chosenValueCommitments.length === 0
      ) {
        throw new Error(t("shielded.valueSelectionRequired"));
      }
      if (action === "claim" && !claimSelectionAvailable) {
        throw new Error(
          t(
            chosenClaim?.periodIndices.length === 0
              ? "shielded.claimSelectionRequired"
              : "shielded.claimSelectionUnavailable",
          ),
        );
      }
      const walletEpoch = transactionEpoch.current;
      const assertCurrentOperation = () => {
        if (activeIdentity.current !== identity) throw new Error(t("shielded.unlockRequired"));
        if (
          walletEpoch !== transactionEpoch.current ||
          transactionWallet.current.account !== account ||
          transactionWallet.current.signer !== signer
        ) {
          throw new Error(t("shielded.walletChanged"));
        }
      };
      const onStage = (next: ShieldedPoolFlowStage) => {
        if (next !== "confirming") assertCurrentOperation();
        setStage(t(`shielded.stages.${next}`));
      };
      // Private delivery uses a verified receive code; public budgets use the selected family identity.
      const verifyRecipient = async () => {
        if (recipientInputMethod !== "receiveCode") {
          throw new Error(t("shielded.generateReceiveCodeFirst"));
        }
        const recipient = await verifyShieldedReceiveCode(recipientCode);
        assertCurrentOperation();
        return recipient;
      };
      session.touch();
      if (
        (await signer.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await signer.getAddress()).toLowerCase() !== account.toLowerCase()
      ) {
        throw new Error(t("shielded.walletChanged"));
      }
      assertCurrentOperation();
      let shouldRefreshWallet = action !== "recover";
      if (action === "recover") {
        setStage(t("shielded.stages.recovering"));
        await refreshWallet(identity);
        shouldRefreshWallet = false;
      } else if (action === "shield") {
        const amount = parsePositiveTokenAmount(shieldAmount, modules.tokenDecimals);
        const walletBalance = BigInt(await modules.token.balanceOf(account));
        assertCurrentOperation();
        if (walletBalance < amount) {
          throw new Error(
            t("shielded.depositBalanceInsufficient", {
              balance: formatUnits(walletBalance, modules.tokenDecimals),
              amount: formatUnits(amount, modules.tokenDecimals),
            }),
          );
        }
        const prepared = await prepareShieldedShield({
          chainId: modules.chainId,
          poolAddress: modules.poolAddress,
          derivedSecretField: identity.derivedSecretField,
          amount,
        });
        const allowance = BigInt(await modules.token.allowance(account, modules.poolAddress));
        if (allowance < amount) {
          assertCurrentOperation();
          setStage(t("shielded.stages.approving"));
          const token = modules.token.connect(signer) as typeof modules.token;
          const approval = await token.approve(modules.poolAddress, amount);
          const receipt = await approval.wait();
          checkReceipt(receipt?.status ?? null, approval.hash, t);
        }
        assertCurrentOperation();
        const result = await submitShield({
          pool: modules.pool,
          signer,
          expectedChainId: modules.chainId,
          amount,
          data: prepared.data,
          witness: prepared.witness,
          onStage,
        });
        checkReceipt(result.receipt.status, result.transactionHash, t);
        hash = result.transactionHash;
        publicActivityAddresses.add(account.toLowerCase());
      } else {
        setStage(t("shielded.stages.recovering"));
        let recovered = await refreshWallet(identity);
        if (activeIdentity.current !== identity) throw new Error(t("shielded.unlockRequired"));
        let values = availableFromSnapshot(recovered, identity.derivedSecretField, "value");
        const manualValues = (maxInputs: 1 | 2): ShieldedSelectableValueNote[] => {
          if (chosenValueCommitments.length === 0)
            throw new Error(t("shielded.valueSelectionRequired"));
          if (
            chosenValueCommitments.length > maxInputs ||
            new Set(chosenValueCommitments).size !== chosenValueCommitments.length
          ) {
            throw new Error(t("shielded.valueSelectionLimit", { count: maxInputs }));
          }
          return chosenValueCommitments.map((commitment) => {
            const note = values.find(
              (item): item is ShieldedSelectableValueNote =>
                item.commitment.toString() === commitment &&
                item.note.kind === "value" &&
                item.note.amount > 0n,
            );
            if (!note)
              throw new Error(
                t(
                  maxInputs === 1
                    ? "shielded.singleSelectedValueUnavailable"
                    : "shielded.selectedValueUnavailable",
                ),
              );
            return note;
          });
        };
        const automaticFundingValue = async (amount: bigint) => {
          const maxConsolidations = Math.max(0, values.length - 1);
          for (
            let count = 0;
            !selectValueNotes(values, amount) && count < maxConsolidations;
            count += 1
          ) {
            const prepared = await prepareShieldedValueConsolidation({
              chainId: modules.chainId,
              poolAddress: modules.poolAddress,
              wallet: recovered,
              derivedSecretField: identity.derivedSecretField,
              amount,
            });
            if (!prepared) break;
            assertCurrentOperation();
            const result = await submitPrivateTransfer({
              pool: modules.pool,
              signer,
              expectedChainId: modules.chainId,
              data: prepared.data,
              witness: prepared.witness,
              onStage,
            });
            checkReceipt(result.receipt.status, result.transactionHash, t);
            preparatoryHash = result.transactionHash;
            setStage(t("shielded.stages.recovering"));
            recovered = await refreshWallet(identity);
            assertCurrentOperation();
            values = availableFromSnapshot(recovered, identity.derivedSecretField, "value");
          }
          const note = selectValueNotes(values, amount)?.[0];
          if (!note || note.note.kind !== "value" || note.note.amount < amount) {
            throw new Error(t("shielded.automaticFundingUnavailable"));
          }
          return note;
        };
        if (action === "fund") {
          if (!policySelection && !fundingRoot) {
            throw new Error(t("shielded.fundingVersionRequired"));
          }
          const budgetPeriods = parsePositivePeriods(periods);
          const childError = validateShieldedRecipientSelection({
            value: heirPersonHash,
            options: childOptions,
            loading: !currentLineage && !lineageError && childOptions.length === 0,
          });
          if (childError) throw new Error(t(`shielded.recipientPicker.errors.${childError}`));
          const recipient = fundingMode === "private" ? await verifyRecipient() : undefined;
          if (
            recipient &&
            recipient.personHash.toLowerCase() !== heirPersonHash.trim().toLowerCase()
          ) {
            throw new Error(t("shielded.recipientMismatch"));
          }
          let policy = policySelection
            ? listRecoveredShieldedPolicies(recovered).find(
                (candidate) => fundingPolicyKey(candidate) === policySelection,
              )
            : undefined;
          if (policySelection && !policy) throw new Error(t("shielded.noFundingRule"));
          if (!policy) {
            if (!fundingRoot) {
              throw new Error(t("shielded.fundingFamilyUnavailable"));
            }
            // Use the record displayed for confirmation. Fresh-lineage preparation
            // verifies this exact rule instead of silently switching its parent/version.
            policy = createShieldedPolicyDescriptor({
              rootIdentityCommitment: fundingRoot.rootIdentityCommitment,
              rootVersionIndex: fundingRoot.rootVersionIndex,
              amountPerPeriod: parsePositiveTokenAmount(rate, modules.tokenDecimals),
              periodDays: parseShieldedPeriodDays(periodDaysInput),
            });
          }
          if (getBigInt(policy.rootIdentityCommitment) !== BigInt(identity.identityCommitment)) {
            throw new Error(t("shielded.noFundingRule"));
          }
          const policyCommitment = computeShieldedPolicyCommitment({
            ...policy,
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(policy.allocationKey),
          });
          const template = listRecoveredFundingTemplates(recovered).find(
            (candidate) =>
              getShieldedBudgetCommitments(candidate.note).policyCommitment === policyCommitment &&
              wrapIdentityCommitmentAsPersonHash(
                candidate.note.heirIdentityCommitment,
              ).toLowerCase() === heirPersonHash.trim().toLowerCase(),
          );
          if (
            template &&
            recipient &&
            template.note.binding !== "identity" &&
            getBigInt(template.note.heirOwnerCommitment) !== recipient.ownerCommitment
          ) {
            throw new Error(t("shielded.recipientMismatch"));
          }
          fundedPolicyCommitment = policyCommitment.toString();
          const donor = await automaticFundingValue(policy.amountPerPeriod * budgetPeriods);
          const common = {
            pool: modules.pool,
            wallet: recovered,
            donorDerivedSecretField: identity.derivedSecretField,
            donorCommitment: donor.commitment,
            recipient,
            budgetKind: fundingMode === "public" ? (1 as const) : (0 as const),
            publicRecipientPersonHash: heirPersonHash.trim(),
            lineageIndex: modules.lineageIndex,
            budgetPeriods,
          };
          if (template) {
            const prepared = await prepareShieldedFund({
              ...common,
              fundMode: 1,
              budget: template,
            });
            const result = await submitFund({
              pool: modules.pool,
              signer,
              expectedChainId: modules.chainId,
              data: prepared.data,
              witness: prepared.witness,
              onStage,
            });
            checkReceipt(result.receipt.status, result.transactionHash, t);
            hash = result.transactionHash;
          } else {
            const rule = policy;
            const result = await submitFundWithFreshLineage({
              pool: modules.pool,
              signer,
              expectedChainId: modules.chainId,
              lineageIndex: modules.lineageIndex,
              onStage,
              prepare: async () =>
                prepareShieldedFund({
                  ...common,
                  fundMode: 0,
                  policy: rule,
                  lineageIndex: modules.lineageIndex,
                  lineage: await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
                }),
            });
            hash = result.transactionHash;
          }
        } else if (action === "claim") {
          const budgets = availableFromSnapshot(recovered, identity.derivedSecretField, "budget");
          if (!budgets.length) throw new Error(t("shielded.noBudgetNote"));
          const result = await submitClaimWithFreshLineage({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            lineageIndex: modules.lineageIndex,
            onStage,
            prepare: async () => {
              const latest = await modules.provider.getBlock("latest");
              if (!latest) throw new Error(t("shielded.unreachable"));
              const lineage = await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily);
              const eligibleBudgets = budgets.filter(
                (item) =>
                  item.note.kind === "budget" &&
                  item.note.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER) &&
                  findHeirLegitimacy({
                    snapshot: lineage,
                    heir: identity,
                    root: { identityCommitment: item.note.rootIdentityCommitment },
                    rootVersionIndex: Number(item.note.rootVersionIndex),
                  }).some((source) => source.writtenAt <= BigInt(latest.timestamp)),
              );
              if (
                !chosenClaim ||
                !claimSelectionIsAvailable(
                  chosenClaim,
                  eligibleBudgets,
                  recovered,
                  identity.derivedSecretField,
                  BigInt(latest.timestamp),
                )
              )
                throw new Error(t("shielded.claimSelectionUnavailable"));
              return prepareShieldedClaim({
                chainId: modules.chainId,
                poolAddress: modules.poolAddress,
                identity,
                wallet: recovered,
                lineage,
                budgetCommitment: chosenClaim.budget.commitment,
                secondBudgetCommitment: chosenClaim.secondBudget?.commitment,
                asOf: latest.timestamp,
                periodIndices: chosenClaim.periodIndices,
              });
            },
          });
          hash = result.transactionHash;
        } else if (action === "privateTransfer") {
          const amount = parsePositiveTokenAmount(transferAmount, modules.tokenDecimals);
          const chosen = manualValues(2);
          const [first, second] = chosen;
          const total = first.note.amount + (second?.note.amount ?? 0n);
          if (amount > total) throw new Error(t("shielded.amountExceedsNotes"));
          const recipient = await verifyRecipient();
          const prepared = await prepareShieldedPrivateTransfer({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            inputs: second
              ? [
                  {
                    wallet: recovered,
                    derivedSecretField: identity.derivedSecretField,
                    commitment: first.commitment,
                  },
                  {
                    wallet: recovered,
                    derivedSecretField: identity.derivedSecretField,
                    commitment: second.commitment,
                  },
                ]
              : [
                  {
                    wallet: recovered,
                    derivedSecretField: identity.derivedSecretField,
                    commitment: first.commitment,
                  },
                ],
            destinations: [
              { kind: "recipient", recipient, amount },
              { kind: "inputOwner", inputIndex: 0, amount: total - amount },
            ],
          });
          const result = await submitPrivateTransfer({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash, t);
          hash = result.transactionHash;
        } else if (action === "unshield") {
          const amount = parsePositiveTokenAmount(exitAmount, modules.tokenDecimals);
          const recipient = getAddress(exitRecipient.trim());
          if (BigInt(recipient) === 0n) throw new Error(t("shielded.invalidExitRecipient"));
          const [withdrawalNote] = manualValues(1);
          if (amount > withdrawalNote.note.amount)
            throw new Error(t("shielded.amountExceedsNotes"));
          const prepared = await prepareShieldedUnshield({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            input: {
              wallet: recovered,
              derivedSecretField: identity.derivedSecretField,
              commitment: withdrawalNote.commitment,
            },
            amount,
            recipient,
          });
          const result = await submitUnshield({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            amount: prepared.amount,
            recipient: prepared.recipient,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash, t);
          hash = result.transactionHash;
        }
      }
      if (shouldRefreshWallet) {
        setStage(t("shielded.stages.recovering"));
        const refreshed = await refreshWallet(identity);
        if (fundedPolicyCommitment) {
          setPolicySelection(
            listRecoveredShieldedPolicies(refreshed).some(
              (policy) => fundingPolicyKey(policy) === fundedPolicyCommitment,
            )
              ? fundedPolicyCommitment
              : "",
          );
        }
      }
      setRecipientCode("");
      setRecipientConfirmed(false);
      setTransactionHash(hash);
      setStage(t("shielded.done"));
      if (action !== "recover") {
        setSelectedValueCommitments([]);
        setBudgetSelection("");
        setClaimSelection(null);
      }
    } catch (cause) {
      const errorReason = resolveErrorReason(cause);
      const detail =
        cause instanceof InheritanceError
          ? t(`inheritance.errors.${cause.code}`)
          : cause instanceof ShieldedReceiveCodeError
            ? t(`shielded.receiveCodeErrors.${cause.reason}`)
            : errorReason &&
                [
                  "ERC20InsufficientBalance",
                  "ERC20InsufficientAllowance",
                  "LOCAL_NONCE_TOO_LOW",
                  "NONCE_EXPIRED",
                  "LOCAL_NONCE_TOO_HIGH",
                  "NONCE_TOO_HIGH",
                ].includes(errorReason)
              ? getFriendlyError(cause, t).message
              : cause instanceof Error
                ? cause.message
                : t("shielded.unknownError");
      if (hash) {
        setTransactionHash(hash);
        setError(t("shielded.confirmedRefreshFailed", { detail }));
      } else if (preparatoryHash) {
        setTransactionHash(preparatoryHash);
        setError(t("shielded.preparedButNotCompleted", { detail }));
      } else {
        setError(detail);
      }
    } finally {
      recipientCredentialsFormRef.current?.clearSecretInputs();
      running.current = false;
      setBusy(false);
    }
  }

  const isPrivate = action !== "recover" && action !== "shield" && action !== "receiveCode";

  const feedback = (
    <>
      {busy ? (
        <p role="status" className="text-sm text-ink-muted">
          {stage}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
          {transactionHash ? (
            <span className="mt-2 block font-mono text-xs">{transactionHash}</span>
          ) : null}
        </p>
      ) : null}
      {!busy && !error && stage === t("shielded.done") ? (
        <SuccessNotice>
          <p>{t("shielded.done")}</p>
          {transactionHash ? (
            <p className="break-all font-mono text-xs">{transactionHash}</p>
          ) : null}
        </SuccessNotice>
      ) : null}
    </>
  );

  if (!identity) {
    return (
      <div className="space-y-6 break-normal">
        <PanelShell
          title={t("shielded.identityTitle")}
          description={t("shielded.identityDescription")}
        >
          <PersonHashCalculator
            ref={identityForm}
            showTitle={false}
            collapsible={false}
            computeHash={false}
            showPassphraseGuidance={false}
            className="border-0 bg-transparent p-0 shadow-none"
          />
          <PanelButton
            variant="primary"
            busy={busy}
            disabled={busy}
            onClick={() => void unlockIdentity()}
          >
            {t("shielded.unlock")}
          </PanelButton>
          {feedback}
        </PanelShell>
      </div>
    );
  }

  const totalValue = available.values.reduce(
    (sum, item) => sum + (item.note.kind === "value" ? item.note.amount : 0n),
    0n,
  );
  const totalBudget = available.budgets.reduce(
    (sum, item) => sum + (item.note.kind === "budget" ? item.note.remaining : 0n),
    0n,
  );
  const hasSpendableValue = available.values.some(
    (item) => item.note.kind === "value" && item.note.amount > 0n,
  );
  const firstActionForGroup = (group: TaskGroup): Action =>
    group === "inheritance"
      ? "fund"
      : group === "receive"
        ? "claim"
        : hasSpendableValue
          ? "privateTransfer"
          : "shield";
  let fundingRate = selectedPolicy?.amountPerPeriod;
  let fundingPeriodDays = selectedPolicy?.periodDays;
  if (fundingPeriodDays === undefined) {
    try {
      fundingPeriodDays = parseShieldedPeriodDays(periodDaysInput);
    } catch {
      // Show a preview only after a custom period has become a valid integer.
    }
  }
  if (fundingRate === undefined && action === "fund" && rate.trim()) {
    try {
      fundingRate = parsePositiveTokenAmount(rate, modules.tokenDecimals);
    } catch {
      // Incomplete input has no preview until it is a valid amount.
    }
  }
  const fundingPeriods = /^[1-9][0-9]{0,19}$/.test(periods.trim())
    ? BigInt(periods.trim())
    : undefined;
  const fundingAmount =
    fundingRate !== undefined && fundingPeriods !== undefined
      ? fundingRate * fundingPeriods
      : undefined;
  const fundingDeficit =
    fundingAmount !== undefined && fundingAmount > totalValue
      ? fundingAmount - totalValue
      : undefined;
  const fundingNeedsDeposit = totalValue === 0n || fundingDeficit !== undefined;

  return (
    <div className="space-y-4 break-normal">
      <section
        aria-label={t("shielded.balanceTitle")}
        className="space-y-2 rounded-xl border border-hairline bg-surface px-4 py-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
            <p className="break-words text-sm font-medium text-ink">{identity.identity.fullName}</p>
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {[
                { label: "balanceAmount", amount: totalValue },
                { label: "budgetAmount", amount: totalBudget },
              ].map(({ label, amount }) => (
                <div key={label} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-xs text-ink-muted">{t(`shielded.${label}`)}</dt>
                  <dd className="break-all text-sm font-semibold tabular-nums text-ink">
                    {walletSnapshot ? formatUnits(amount, modules.tokenDecimals) : "—"}
                    <span className="ml-1 whitespace-nowrap text-xs font-normal text-ink-muted">
                      DEEP
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex shrink-0 gap-2">
            <PanelButton
              size="compact"
              disabled={busy}
              onClick={() => void submitSelected("recover")}
            >
              {t("shielded.actions.recover")}
            </PanelButton>
            <PanelButton size="compact" disabled={busy} onClick={lockIdentity}>
              {t("shielded.lock")}
            </PanelButton>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2 text-xs">
          <span className="shrink-0 whitespace-nowrap py-1 text-ink-muted">
            {t("shielded.identityHash")}
          </span>
          <code className="min-w-0 break-all py-1 font-mono text-ink-muted">
            {identity.personHash}
          </code>
          <CopyIconButton
            size="xs"
            label={t("shielded.copyIdentityHash")}
            onClick={() => void copyIdentityHash()}
          />
        </div>
      </section>
      <div
        role="tablist"
        aria-label={t("shielded.actionsTitle")}
        className="flex flex-wrap gap-x-5 border-b border-hairline"
      >
        {TASK_GROUPS.map((group) => (
          <button
            type="button"
            role="tab"
            id={`shielded-tab-${group}`}
            aria-controls="shielded-task-panel"
            aria-selected={group === taskGroup}
            tabIndex={group === taskGroup ? 0 : -1}
            key={group}
            disabled={busy}
            onClick={() => {
              chooseAction(firstActionForGroup(group), group);
            }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = TASK_GROUPS.indexOf(group);
              const nextGroup =
                TASK_GROUPS[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? TASK_GROUPS.length - 1
                      : (index + (event.key === "ArrowLeft" ? -1 : 1) + TASK_GROUPS.length) %
                        TASK_GROUPS.length
                ];
              chooseAction(firstActionForGroup(nextGroup), nextGroup);
              document.getElementById(`shielded-tab-${nextGroup}`)?.focus();
            }}
            className={`-mb-px border-b-2 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
              group === taskGroup
                ? "border-primary text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`shielded.groups.${group}`)}
          </button>
        ))}
      </div>
      {TASK_ACTIONS[taskGroup].length > 1 ? (
        <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-surface-alt p-1">
          {TASK_ACTIONS[taskGroup].map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={item === action}
              disabled={busy}
              onClick={() => chooseAction(item, taskGroup)}
              className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                item === action ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"
              }`}
            >
              {labels[item]}
            </button>
          ))}
        </div>
      ) : null}
      <div id="shielded-task-panel" role="tabpanel" aria-labelledby={`shielded-tab-${taskGroup}`}>
        <PanelShell
          title={
            action === "shield" || action === "privateTransfer" || action === "unshield"
              ? t(`shielded.actionTitles.${action}`)
              : labels[action]
          }
          description={
            action === "fund" || action === "claim" || action === "receiveCode"
              ? t(`shielded.descriptions.${action}`)
              : undefined
          }
        >
          {action === "receiveCode" && ownReceiveCode ? (
            <FieldBlock
              label={t("shielded.receiveCodeLabel")}
              hint={t("shielded.receiveCodeShareHint")}
            >
              <textarea
                aria-label={t("shielded.receiveCodeLabel")}
                className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
                readOnly
                value={ownReceiveCode}
                rows={4}
              />
            </FieldBlock>
          ) : null}

          {action === "shield" ? (
            <FieldBlock label={t("shielded.fields.amount")} hint={t("shielded.publicDepositHint")}>
              <input
                aria-label={t("shielded.fields.amount")}
                className={INPUT_CLASS}
                inputMode="decimal"
                value={shieldAmount}
                onChange={(event) => setShieldAmount(event.target.value)}
                placeholder="100"
              />
            </FieldBlock>
          ) : null}

          {action === "fund" ? (
            <>
              <fieldset className="space-y-2" disabled={busy}>
                <legend className="text-sm font-medium text-ink">
                  {t("shielded.fundingModeLabel")}
                </legend>
                <div className="flex flex-wrap gap-4">
                  {(["private", "public"] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name="shielded-funding-mode"
                        checked={fundingMode === mode}
                        onChange={() => {
                          setFundingMode(mode);
                          setPolicySelection("");
                          setHeirPersonHash("");
                          setFundingFamilyVersionSelection("");
                          setRate("");
                          setSelectedValueCommitments([]);
                          changeRecipientCode("");
                          recipientCredentialsFormRef.current?.clearSecretInputs();
                          setRecipientInputMethod("receiveCode");
                          setError("");
                        }}
                      />
                      {t(`shielded.fundingModes.${mode}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {fundingMode === "public" ? (
                <WarningNotice>{t("shielded.publicFundingVisibility")}</WarningNotice>
              ) : null}

              {fundingNeedsDeposit ? (
                <div className="space-y-3">
                  <WarningNotice>
                    {totalValue === 0n
                      ? t("shielded.fundingNoBalance")
                      : t("shielded.fundingBalanceInsufficient", {
                          amount: formatUnits(fundingDeficit!, modules.tokenDecimals),
                        })}
                  </WarningNotice>
                  <PanelButton
                    disabled={busy}
                    onClick={() => {
                      chooseAction("shield", "wallet");
                      if (fundingDeficit !== undefined) {
                        setShieldAmount(formatUnits(fundingDeficit, modules.tokenDecimals));
                      }
                    }}
                  >
                    {t("shielded.fundingDepositAction")}
                  </PanelButton>
                </div>
              ) : null}
              {available.policies.length > 0 ? (
                <FieldBlock
                  label={t("shielded.fields.fundingRule")}
                  hint={t("shielded.fundingRuleHint")}
                >
                  <select
                    aria-label={t("shielded.fields.fundingRule")}
                    className={INPUT_CLASS}
                    value={policySelection}
                    onChange={(event) => {
                      setPolicySelection(event.target.value);
                      setHeirPersonHash("");
                      setFundingFamilyVersionSelection("");
                      changeRecipientCode("");
                      recipientCredentialsFormRef.current?.clearSecretInputs();
                      setError("");
                    }}
                  >
                    <option value="">{t("shielded.newFundingRule")}</option>
                    {available.policies.map((policy, index) => (
                      <option key={fundingPolicyKey(policy)} value={fundingPolicyKey(policy)}>
                        {t("shielded.policyOption", {
                          index: index + 1,
                          identity:
                            localRecipientLabels.get(
                              wrapIdentityCommitmentAsPersonHash(
                                policy.rootIdentityCommitment,
                              ).toLowerCase(),
                            ) ??
                            shortHex(
                              wrapIdentityCommitmentAsPersonHash(policy.rootIdentityCommitment),
                            ),
                          amount: formatUnits(policy.amountPerPeriod, modules.tokenDecimals),
                          days: policy.periodDays.toString(),
                        })}
                      </option>
                    ))}
                  </select>
                </FieldBlock>
              ) : null}
              <FieldBlock label={t("shielded.fields.familyVersion")}>
                {selectedPolicy ? (
                  <p className="text-sm text-ink" role="status">
                    {t("shielded.fundingVersionOption", {
                      version: selectedPolicy.rootVersionIndex.toString(),
                    })}
                  </p>
                ) : (
                  <select
                    aria-label={t("shielded.fields.familyVersion")}
                    className={INPUT_CLASS}
                    disabled={busy || !currentLineage || fundingParentVersions.length === 0}
                    value={fundingFamilyVersionSelection}
                    onChange={(event) => {
                      setFundingFamilyVersionSelection(event.target.value);
                      setHeirPersonHash("");
                      changeRecipientCode("");
                      recipientCredentialsFormRef.current?.clearSecretInputs();
                      setError("");
                    }}
                  >
                    <option value="">{t("shielded.fundingVersionPlaceholder")}</option>
                    {fundingFamilyVersionSelection &&
                    !fundingParentVersions.includes(Number(fundingFamilyVersionSelection)) ? (
                      <option value={fundingFamilyVersionSelection} disabled>
                        {t("shielded.fundingVersionOption", {
                          version: fundingFamilyVersionSelection,
                        })}
                      </option>
                    ) : null}
                    {fundingParentVersions.map((version) => (
                      <option key={version} value={version.toString()}>
                        {t("shielded.fundingVersionOption", { version })}
                      </option>
                    ))}
                  </select>
                )}
              </FieldBlock>
              <ShieldedRecipientPicker
                label={t("shielded.fields.heirPersonHash")}
                value={heirPersonHash}
                onChange={(value) => {
                  setHeirPersonHash(value);
                  changeRecipientCode("");
                  recipientCredentialsFormRef.current?.clearSecretInputs();
                  setError("");
                }}
                options={childOptions}
                loading={!currentLineage && !lineageError && childOptions.length === 0}
                disabled={!fundingRoot}
                placeholder={!fundingRoot ? t("shielded.fundingVersionRequired") : undefined}
              />
              {heirPersonHash.trim() &&
              !selectedPolicy &&
              currentLineage &&
              !fundingFamilyVersion?.eligible ? (
                <WarningNotice>{t("shielded.fundingFamilyUnavailable")}</WarningNotice>
              ) : null}
              {heirPersonHash.trim() && fundingRoot && fundingFamilyHash ? (
                <p role="status" className="text-xs text-ink-muted">
                  {t("shielded.fundingFamilySummary", {
                    parent:
                      localRecipientLabels.get(fundingFamilyHash.toLowerCase()) ??
                      shortHex(fundingFamilyHash),
                    relation: fundingFamilyRelation
                      ? t(`shielded.fundingParentRoles.${fundingFamilyRelation}`)
                      : "",
                    version: fundingRoot.rootVersionIndex.toString(),
                  })}
                </p>
              ) : null}
              {fundingMode === "private" ? (
                <RecipientInput
                  method={recipientInputMethod}
                  onMethodChange={changeRecipientInputMethod}
                  code={recipientCode}
                  codeHint={t("shielded.receiveCodeInputHint")}
                  onCodeChange={changeRecipientCode}
                  credentialsFormRef={recipientCredentialsFormRef}
                  onGenerateCode={() => void generateRecipientCode()}
                  busy={busy}
                />
              ) : null}
              {!selectedPolicy ? (
                <FieldBlock label={t("shielded.fields.rate")}>
                  <input
                    aria-label={t("shielded.fields.rate")}
                    className={INPUT_CLASS}
                    inputMode="decimal"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                    placeholder="10"
                  />
                </FieldBlock>
              ) : null}
              <FieldBlock label={t("shielded.fields.periodDays")}>
                {selectedPolicy ? (
                  <p className="text-sm text-ink" role="status">
                    {t("shielded.periodDaysSummary", {
                      days: selectedPolicy.periodDays.toString(),
                    })}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={t("shielded.fields.periodDays")}
                      className={`${INPUT_CLASS} min-w-0`}
                      disabled={busy}
                      value={periodDaysChoice}
                      onChange={(event) => {
                        const choice = event.target.value;
                        setPeriodDaysChoice(choice);
                        setPeriodDaysInput(choice === "custom" ? "" : choice);
                        setError("");
                      }}
                    >
                      {PERIOD_DAY_PRESETS.map((days) => (
                        <option key={days} value={days.toString()}>
                          {t("shielded.periodDaysSummary", { days })}
                        </option>
                      ))}
                      <option value="custom">{t("shielded.customPeriodDays")}</option>
                    </select>
                    {periodDaysChoice === "custom" ? (
                      <input
                        aria-label={t("shielded.fields.customPeriodDays")}
                        className={`${INPUT_CLASS} min-w-0`}
                        inputMode="numeric"
                        disabled={busy}
                        value={periodDaysInput}
                        onChange={(event) => {
                          setPeriodDaysInput(event.target.value);
                          setError("");
                        }}
                        placeholder="30"
                      />
                    ) : null}
                  </div>
                )}
              </FieldBlock>
              <FieldBlock label={t("shielded.fields.periods")}>
                <input
                  aria-label={t("shielded.fields.periods")}
                  className={INPUT_CLASS}
                  inputMode="numeric"
                  value={periods}
                  onChange={(event) => setPeriods(event.target.value)}
                />
              </FieldBlock>
              {fundingRate !== undefined &&
              fundingRate > 0n &&
              fundingPeriods !== undefined &&
              fundingPeriodDays !== undefined ? (
                <p
                  role="status"
                  className="rounded-xl bg-primary/5 p-3 text-sm leading-relaxed text-ink"
                >
                  {t("shielded.fundingPreview", {
                    amount: formatUnits(fundingRate * fundingPeriods, modules.tokenDecimals),
                    periods: fundingPeriods.toString(),
                    rate: formatUnits(fundingRate, modules.tokenDecimals),
                    days: fundingPeriodDays.toString(),
                  })}
                </p>
              ) : null}
            </>
          ) : null}

          {action === "claim" ? (
            <>
              {claimBudgetOptions.length > 1 ? (
                <FieldBlock label={t("shielded.fields.budgetNote")}>
                  <select
                    aria-label={t("shielded.fields.budgetNote")}
                    className={INPUT_CLASS}
                    disabled={busy}
                    value={budgetSelection || claimBudgetOption?.key || ""}
                    onChange={(event) => {
                      const key = event.target.value;
                      const option = claimBudgetOptions.find((item) => item.key === key);
                      setBudgetSelection(key);
                      setClaimSelection(
                        option?.overview.claim ? { ...option.overview.claim, key } : null,
                      );
                    }}
                  >
                    {budgetSelection && !claimBudgetOption ? (
                      <option value={budgetSelection} disabled>
                        {t("shielded.unavailableBudget")}
                      </option>
                    ) : null}
                    {claimBudgetOptions.map((option, index) => (
                      <option key={option.key} value={option.key}>
                        {t("shielded.budgetOption", {
                          index: index + 1,
                          amount: formatUnits(
                            option.overview.totalRemaining,
                            modules.tokenDecimals,
                          ),
                          days: option.notes[0].note.periodDays.toString(),
                        })}
                      </option>
                    ))}
                  </select>
                </FieldBlock>
              ) : null}
              <div
                role="status"
                className="space-y-1 break-words rounded-xl bg-surface-alt p-3 text-sm text-ink"
              >
                <p>
                  {available.budgets.length === 0
                    ? t("shielded.claimOverview.noFunds")
                    : lineageError
                      ? t("shielded.claimOverview.unavailable")
                      : !currentLineage
                        ? t("shielded.claimOverview.checking")
                        : eligibleClaimBudgets.length === 0
                          ? t("shielded.claimOverview.ineligible")
                          : claimOverview?.claim
                            ? t("shielded.claimOverview.claimable", {
                                amount: formatUnits(
                                  chosenClaim?.amount ?? claimOverview.claim.amount,
                                  modules.tokenDecimals,
                                ),
                                periods:
                                  chosenClaim?.periodIndices.length ??
                                  claimOverview.claim.periodIndices.length,
                              })
                            : t(
                                `shielded.claimOverview.${claimOverview?.status ?? emptyClaimStatus}`,
                              )}
                </p>
                {claimOverview?.nextDueAt !== undefined ? (
                  <p className="text-xs text-ink-muted">
                    {t("shielded.claimOverview.nextDue", {
                      date:
                        formatShieldedTimestamp(claimOverview.nextDueAt) ??
                        t("shielded.dateOutOfRange"),
                    })}
                  </p>
                ) : null}
                {lineageError ? (
                  <p className="break-words text-xs text-ink-muted">{lineageError}</p>
                ) : null}
              </div>
              {claimBatch ? (
                <fieldset disabled={busy} className="min-w-0 space-y-2">
                  <legend className="mb-2 text-sm font-medium text-ink">
                    {t("shielded.claimPeriodsLabel")}
                  </legend>
                  <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                    <span>{t("shielded.claimPeriodsHint")}</span>
                    <button
                      type="button"
                      className="shrink-0 text-primary hover:underline"
                      onClick={() => setClaimSelection(null)}
                    >
                      {t("shielded.selectAllClaimPeriods")}
                    </button>
                  </div>
                  {claimBatch.periodIndices.map((index) => {
                    const label = t("shielded.claimPeriodOption", {
                      period: (index + 1n).toString(),
                      amount: formatUnits(
                        claimBatch.budget.note.amountPerPeriod,
                        modules.tokenDecimals,
                      ),
                    });
                    const dueAt =
                      claimBatch.budget.note.eligibleFrom +
                      (index + 1n) * claimBatch.budget.note.periodDays * SECONDS_PER_DAY;
                    return (
                      <label
                        key={index.toString()}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          aria-label={label}
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={chosenClaim?.periodIndices.includes(index) ?? false}
                          onChange={(event) => changeClaimPeriod(index, event.target.checked)}
                        />
                        <span className="min-w-0 break-words text-sm text-ink">
                          <span>{label}</span>
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {t("shielded.claimPeriodDue", {
                              date:
                                formatShieldedTimestamp(dueAt, "date") ??
                                t("shielded.dateOutOfRange"),
                            })}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              {currentLineage &&
              ((claimSelection && !claimSelectionAvailable) ||
                (budgetSelection && !claimBudgetOption)) ? (
                claimSelection?.periodIndices.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t("shielded.claimSelectionRequired")}</p>
                ) : (
                  <WarningNotice>
                    {t("shielded.claimSelectionUnavailable")}
                    <button
                      type="button"
                      disabled={busy}
                      className="ml-2 text-primary hover:underline"
                      onClick={() => {
                        setBudgetSelection("");
                        setClaimSelection(null);
                      }}
                    >
                      {t("shielded.reselectClaim")}
                    </button>
                  </WarningNotice>
                )
              ) : null}
            </>
          ) : null}

          {action === "privateTransfer" ? (
            <>
              <RecipientInput
                method={recipientInputMethod}
                onMethodChange={changeRecipientInputMethod}
                code={recipientCode}
                onCodeChange={changeRecipientCode}
                credentialsFormRef={recipientCredentialsFormRef}
                onGenerateCode={() => void generateRecipientCode()}
                busy={busy}
              />
              {recipientInputMethod === "receiveCode" && recipientTargetHash ? (
                <div className="space-y-2 break-all rounded-xl bg-surface-alt p-3 text-sm text-ink">
                  <p>
                    {t("shielded.recipientTarget", {
                      identity: recipientTargetName ?? recipientTargetHash,
                    })}
                    {recipientTargetName ? (
                      <span className="mt-1 block font-mono text-xs text-ink-muted">
                        {recipientTargetHash}
                      </span>
                    ) : null}
                  </p>
                  {recipientNeedsConfirmation ? (
                    <>
                      <p className="text-xs text-warning">
                        {t("shielded.recipientTargetUnverified")}
                      </p>
                      <label className="flex items-start gap-3 break-normal">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={recipientConfirmed}
                          disabled={busy}
                          onChange={(event) => setRecipientConfirmed(event.target.checked)}
                        />
                        <span>{t("shielded.recipientConfirm")}</span>
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}
              <FieldBlock label={t("shielded.fields.transferAmount")}>
                <input
                  aria-label={t("shielded.fields.transferAmount")}
                  className={INPUT_CLASS}
                  inputMode="decimal"
                  value={transferAmount}
                  onChange={(event) => setTransferAmount(event.target.value)}
                />
              </FieldBlock>
              <ValueNotePicker
                notes={available.values}
                selectedCommitments={selectedValueCommitments}
                onChange={setSelectedValueCommitments}
                maxInputs={2}
                decimals={modules.tokenDecimals}
                busy={busy}
              />
            </>
          ) : null}

          {action === "unshield" ? (
            <>
              <FieldBlock label={t("shielded.fields.amount")}>
                <input
                  aria-label={t("shielded.fields.amount")}
                  className={INPUT_CLASS}
                  inputMode="decimal"
                  value={exitAmount}
                  onChange={(event) => setExitAmount(event.target.value)}
                />
              </FieldBlock>
              <FieldBlock
                label={t("shielded.fields.exitRecipient")}
                hint={t("shielded.publicExitHint")}
              >
                <input
                  aria-label={t("shielded.fields.exitRecipient")}
                  className={INPUT_CLASS}
                  value={exitRecipient}
                  onChange={(event) => setExitRecipient(event.target.value)}
                  placeholder="0x…"
                />
              </FieldBlock>
              <ValueNotePicker
                notes={available.values}
                selectedCommitments={selectedValueCommitments}
                onChange={setSelectedValueCommitments}
                maxInputs={1}
                decimals={modules.tokenDecimals}
                busy={busy}
              />
            </>
          ) : null}

          {isPrivate && publicActivityAddresses.has(account.toLowerCase()) ? (
            <WarningNotice>{t("shielded.switchWalletPrompt")}</WarningNotice>
          ) : null}
          {!signer && action !== "receiveCode" ? (
            <WarningNotice>{t("shielded.walletNotReady")}</WarningNotice>
          ) : null}
          <PanelButton
            variant="primary"
            busy={busy}
            disabled={
              busy ||
              (!signer && action !== "receiveCode") ||
              (recipientNeedsConfirmation && !recipientConfirmed) ||
              (action === "privateTransfer" && selectedValueCommitments.length === 0) ||
              (action === "unshield" && !withdrawalSelectionAvailable) ||
              (action === "fund" && (fundingNeedsDeposit || !fundingRoot)) ||
              (action === "claim" && !claimSelectionAvailable)
            }
            onClick={() => void submitSelected()}
          >
            {t("shielded.submit", { action: labels[action] })}
          </PanelButton>
          {feedback}
        </PanelShell>
      </div>
    </div>
  );
}

function availableFromSnapshot(
  snapshot: LocalShieldedWalletSnapshot,
  derivedSecretField: string,
  kind: "value" | "budget",
): Note[] {
  return listUnspentRecoveredShieldedNotes(snapshot, derivedSecretField).filter(
    (item) => item.note.kind === kind,
  );
}
