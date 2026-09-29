import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationSalt,
  computeShieldedRegistrationTag,
  deriveShieldedHeirKeyMaterial,
  splitShieldedViewPublicKey,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { formatUnits, getBigInt, parseUnits, type Signer } from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { useTreeGraphData } from "../../tree/context";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import {
  assertVersionKnown,
  findHeirLegitimacy,
  loadLineageSnapshot,
  loadRootRegistry,
  type LineageSnapshot,
} from "../services/inheritanceChain";
import { deriveIdentityFromForm } from "../services/inheritanceIdentity";
import {
  nextClaimPeriods,
  selectClaimBudget,
  selectCompatibleBudgetPair,
  selectValueNotes,
} from "../services/shieldedActionSelection";
import { getShieldedClaimOverview } from "../services/shieldedClaimOverview";
import { getFriendlyError, resolveErrorReason } from "../../../shared/lib/errors";
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
  prepareShieldedAllocate,
  prepareShieldedTopUp,
} from "../services/shieldedFundingPreparation";
import {
  submitAllocateWithFreshLineage,
  submitClaimWithFreshLineage,
} from "../services/shieldedFreshLineageSubmit";
import {
  loadKeyRegistrySnapshot,
  type KeyRegistrySnapshot,
} from "../services/shieldedKeyRegistryChain";
import { registerShieldedHeirKey } from "../services/shieldedKeyRegistrationFlow";
import {
  deriveShieldedRecipientMaterial,
  encodeShieldedReceiveCode,
  parseShieldedReceiveCode,
  resolveShieldedRecipientMaterial,
  type ShieldedRecipientMaterial,
} from "../services/shieldedReceiveCode";
import { prepareShieldedMergeBudget } from "../services/shieldedMergeBudgetPreparation";
import {
  prepareShieldedCreatePolicy,
  prepareShieldedShield,
} from "../services/shieldedNotePreparation";
import {
  submitCreatePolicy,
  submitMergeBudget,
  submitPrivateTransfer,
  submitShield,
  submitTopUp,
  submitUnshield,
  type ShieldedPoolFlowStage,
} from "../services/shieldedPoolFlows";
import {
  getShieldedKeyRegistryDeploymentBlock,
  getShieldedPoolDeploymentBlock,
} from "../../../shared/config/env";
import {
  prepareShieldedPrivateTransfer,
  prepareShieldedUnshield,
} from "../services/shieldedTransferExitPreparation";
import {
  listRecoveredTopUpTemplates,
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
  | "register"
  | "shield"
  | "createPolicy"
  | "allocate"
  | "topUp"
  | "mergeBudget"
  | "claim"
  | "privateTransfer"
  | "unshield";

type TaskGroup = "wallet" | "inheritance" | "receive";
type RecipientInputMethod = "receiveCode" | "credentials";
const TASK_GROUPS: readonly TaskGroup[] = ["wallet", "inheritance", "receive"];
const TASK_ACTIONS: Record<TaskGroup, readonly Action[]> = {
  wallet: ["shield", "privateTransfer", "unshield"],
  inheritance: ["shield", "createPolicy", "allocate", "topUp"],
  receive: ["register", "claim"],
};

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

type Note = ReturnType<typeof listUnspentRecoveredShieldedNotes>[number];

function selected<T extends { commitment: bigint }>(
  values: readonly T[],
  commitment: string,
): T | undefined {
  return commitment
    ? values.find((value) => value.commitment.toString() === commitment)
    : values[0];
}

function parsePositiveTokenAmount(value: string, decimals: number): bigint {
  const amount = parseUnits(value.trim(), decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  return amount;
}

function parsePositivePeriods(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value.trim())) throw new Error("Periods must be a positive integer");
  return BigInt(value.trim());
}

function checkReceipt(status: number | null, hash: string): void {
  if (status !== 1) {
    throw new Error(`Transaction ${hash} did not succeed. Inspect it before trying again.`);
  }
}

function parsePeriodIndices(value: string): bigint[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    parts.length < 1 ||
    parts.length > 12 ||
    parts.some((part) => !/^(0|[1-9][0-9]*)$/.test(part))
  ) {
    throw new Error("Enter 1–12 zero-based period indices separated by commas");
  }
  return parts.map(BigInt);
}

function NoteSelect({
  label,
  notes,
  selectedValue,
  onChange,
  decimals,
}: {
  label: string;
  notes: readonly Note[];
  selectedValue: string;
  onChange: (value: string) => void;
  decimals: number;
}) {
  const { t } = useTranslation();
  const noteLabel = (item: Note, index: number) => {
    const amount =
      item.note.kind === "value"
        ? item.note.amount
        : item.note.kind === "budget"
          ? item.note.remaining
          : item.note.amountPerPeriod;
    const key =
      item.note.kind === "value"
        ? "valueOption"
        : item.note.kind === "budget"
          ? "budgetOption"
          : "policyOption";
    return t(`shielded.${key}`, { index: index + 1, amount: formatUnits(amount, decimals) });
  };
  return (
    <FieldBlock label={label}>
      <select
        aria-label={label}
        className={INPUT_CLASS}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {notes[0]?.note.kind === "policy" ? `${noteLabel(notes[0], 0)} · ` : ""}
          {t(notes.length ? "shielded.automaticSelection" : "shielded.noRecoveredNote")}
        </option>
        {notes.map((item, index) => (
          <option key={item.commitment.toString()} value={item.commitment.toString()}>
            {noteLabel(item, index)}
          </option>
        ))}
      </select>
    </FieldBlock>
  );
}

function AdvancedOptions({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-xl border border-hairline p-4">
      <summary className="cursor-pointer text-sm font-medium text-ink-muted">
        {t("shielded.advancedOptions")}
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

function RecipientInput({
  method,
  onMethodChange,
  codeRef,
  credentialsFormRef,
  onCodeChange,
  busy,
}: {
  method: RecipientInputMethod;
  onMethodChange: (method: RecipientInputMethod) => void;
  codeRef: RefObject<HTMLTextAreaElement>;
  credentialsFormRef: RefObject<ShieldedRecipientCredentialsFormHandle>;
  onCodeChange?: (value: string) => void;
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
          <FieldBlock
            label={t("shielded.receiveCodeInputLabel")}
            hint={t("shielded.receiveCodeInputHint")}
          >
            <textarea
              aria-label={t("shielded.receiveCodeInputLabel")}
              className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
              ref={codeRef}
              onChange={(event) => onCodeChange?.(event.target.value)}
              rows={3}
            />
          </FieldBlock>
        ) : (
          <div className="space-y-3">
            <WarningNotice>{t("shielded.recipientCredentialsWarning")}</WarningNotice>
            <ShieldedRecipientCredentialsForm ref={credentialsFormRef} />
          </div>
        )}
      </fieldset>
    </div>
  );
}

function InheritanceGuide({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  return (
    <details open={expanded} className="rounded-2xl border border-hairline bg-surface p-5">
      <summary className="cursor-pointer text-base font-medium text-ink">
        {t("shielded.guide.title")}
      </summary>
      <div className="mt-4 space-y-4 text-sm leading-relaxed">
        <p className="text-ink-muted">{t("shielded.guide.intro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "giverTitle", steps: ["stepDeposit", "stepSetAmount", "stepFund"] },
            { title: "receiverTitle", steps: ["stepReceive", "stepClaim", "stepWithdraw"] },
          ].map(({ title, steps }) => (
            <div key={title} className="rounded-xl bg-surface-alt p-4">
              <h3 className="font-semibold text-ink">{t(`shielded.guide.${title}`)}</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-ink-muted">
                {steps.map((step) => (
                  <li key={step}>{t(`shielded.guide.${step}`)}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-ink">
          <span className="font-semibold">{t("shielded.guide.exampleTitle")}</span>{" "}
          {t("shielded.guide.example")}
        </p>
        <p className="text-xs text-ink-muted">{t("shielded.guide.noDeathRequirement")}</p>
      </div>
    </details>
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
  const { nodesData } = useTreeGraphData();
  const localRecipientLabels = useMemo(
    () => getShieldedLocalRecipientLabels(nodesData),
    [nodesData],
  );
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const walletCache = useRef<LocalShieldedWalletSnapshot | null>(null);
  const registryCache = useRef<KeyRegistrySnapshot | null>(null);
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
  const [registrySnapshot, setRegistrySnapshot] = useState<KeyRegistrySnapshot | null>(null);
  const [privateWalletChecked, setPrivateWalletChecked] = useState(false);
  const [shieldAmount, setShieldAmount] = useState("");
  const [rate, setRate] = useState("");
  const [rootPersonHash, setRootPersonHash] = useState("");
  const [rootVersion, setRootVersion] = useState("");
  const [heirPersonHash, setHeirPersonHash] = useState("");
  const heirReceiveCodeRef = useRef<HTMLTextAreaElement>(null);
  const recipientCredentialsFormRef = useRef<ShieldedRecipientCredentialsFormHandle>(null);
  const [recipientInputMethod, setRecipientInputMethod] =
    useState<RecipientInputMethod>("receiveCode");
  const [periods, setPeriods] = useState("1");
  const [claimIndices, setClaimIndices] = useState("");
  const transferReceiveCodeRef = useRef<HTMLTextAreaElement>(null);
  const [transferReceiveTargetHash, setTransferReceiveTargetHash] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [useSecondValue, setUseSecondValue] = useState(false);
  const [exitAmount, setExitAmount] = useState("");
  const [exitRecipient, setExitRecipient] = useState("");
  const [valueSelection, setValueSelection] = useState("");
  const [secondValueSelection, setSecondValueSelection] = useState("");
  const [budgetSelection, setBudgetSelection] = useState("");
  const [secondBudgetSelection, setSecondBudgetSelection] = useState("");
  const [policySelection, setPolicySelection] = useState("");
  const [topUpSelection, setTopUpSelection] = useState("");
  const [lineageContext, setLineageContext] = useState<{
    wallet: LocalShieldedWalletSnapshot;
    snapshot: LineageSnapshot;
    asOf: bigint;
  } | null>(null);
  const [lineageError, setLineageError] = useState("");

  useLayoutEffect(() => {
    transactionEpoch.current += 1;
    setPrivateWalletChecked(false);
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
      registryCache.current = null;
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
    registryCache.current = null;
    setWalletSnapshot(null);
    setUnspentNotes([]);
    setRegistrySnapshot(null);
    setValueSelection("");
    setSecondValueSelection("");
    setBudgetSelection("");
    setSecondBudgetSelection("");
    setPolicySelection("");
    setTopUpSelection("");
    setPrivateWalletChecked(false);
    setClaimIndices("");
    setUseSecondValue(false);
    setRootPersonHash("");
    setRootVersion("");
    if (heirReceiveCodeRef.current) heirReceiveCodeRef.current.value = "";
    if (transferReceiveCodeRef.current) transferReceiveCodeRef.current.value = "";
    recipientCredentialsFormRef.current?.clearSecretInputs();
    setRecipientInputMethod("receiveCode");
    setTransferReceiveTargetHash(null);
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
        budgets: [] as Note[],
        policies: [] as Note[],
        templates: [] as ReturnType<typeof listRecoveredTopUpTemplates>,
      };
    }
    // Decrypted plaintext is read only from memory. The RPC never receives
    // a target leaf index or child identity query for this list.
    const values = unspentNotes.filter((note) => note.note.kind === "value");
    const budgets = unspentNotes.filter((note) => note.note.kind === "budget");
    const policies = [...walletSnapshot.ownedNotes.values()].filter(
      (note) => note.note.kind === "policy",
    );
    return {
      values,
      budgets,
      policies,
      templates: listRecoveredTopUpTemplates(walletSnapshot),
    };
  }, [walletSnapshot, unspentNotes]);

  const labels = useMemo<Record<Action, string>>(
    () => ({
      recover: t("shielded.actions.recover"),
      register: t("shielded.actions.register"),
      shield: t("shielded.actions.shield"),
      createPolicy: t("shielded.actions.createPolicy"),
      allocate: t("shielded.actions.allocate"),
      topUp: t("shielded.actions.topUp"),
      mergeBudget: t("shielded.actions.mergeBudget"),
      claim: t("shielded.actions.claim"),
      privateTransfer: t("shielded.actions.privateTransfer"),
      unshield: t("shielded.actions.unshield"),
    }),
    [t],
  );

  useEffect(() => {
    if (!identity || !walletSnapshot || taskGroup === "wallet") return;
    let cancelled = false;
    setLineageContext(null);
    setLineageError("");
    void Promise.all([
      loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
      modules.provider.getBlock("latest"),
    ])
      .then(([snapshot, block]) => {
        if (cancelled || activeIdentity.current !== identity) return;
        if (!block) throw new Error("Latest block unavailable");
        setLineageContext({ wallet: walletSnapshot, snapshot, asOf: BigInt(block.timestamp) });
      })
      .catch((cause: unknown) => {
        if (cancelled || activeIdentity.current !== identity) return;
        setLineageError(cause instanceof Error ? cause.message : "Family records unavailable");
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
  ]);

  const currentLineage = lineageContext?.wallet === walletSnapshot ? lineageContext : null;
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
  const claimOverview = useMemo(
    () =>
      currentLineage && walletSnapshot && identity
        ? getShieldedClaimOverview(
            eligibleClaimBudgets,
            walletSnapshot,
            identity.derivedSecretField,
            currentLineage.asOf,
          )
        : null,
    [currentLineage, walletSnapshot, identity, eligibleClaimBudgets],
  );
  const ownRegistration = useMemo(() => {
    if (!identity || !registrySnapshot) return null;
    const identityCommitment = BigInt(identity.identityCommitment);
    const derivedSecretField = BigInt(identity.derivedSecretField);
    const context = {
      identityCommitment,
      derivedSecretField,
      chainId: modules.chainId,
      registryAddress: registrySnapshot.registryAddress,
    };
    const registrationTag = computeShieldedRegistrationTag(context);
    const registrationSalt = computeShieldedRegistrationSalt(context);
    const key = registrySnapshot.keys.get(registrationTag);
    let registered = false;
    if (key) {
      const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(key.viewingKey);
      registered = key.leaf === computeShieldedRegistrationLeaf({
        identityCommitment,
        ownerCommitment: key.ownerCommitment,
        viewKeyHi,
        viewKeyLo,
        salt: registrationSalt,
      });
    }
    return {
      registered,
      receiveCode: encodeShieldedReceiveCode(identityCommitment, registrationSalt),
      waitingForSecondKey: Boolean(
        key && (registrySnapshot.shards.get(key.shardId)?.sizeBigInt ?? 0n) < 2n,
      ),
    };
  }, [identity, registrySnapshot, modules.chainId]);
  const updateTransferReceiveTarget = (value: string) => {
    try {
      setTransferReceiveTargetHash(parseShieldedReceiveCode(value).personHash);
    } catch {
      setTransferReceiveTargetHash(null);
    }
  };
  const changeRecipientInputMethod = (method: RecipientInputMethod) => {
    recipientCredentialsFormRef.current?.clearSecretInputs();
    if (heirReceiveCodeRef.current) heirReceiveCodeRef.current.value = "";
    if (transferReceiveCodeRef.current) transferReceiveCodeRef.current.value = "";
    setTransferReceiveTargetHash(null);
    setRecipientInputMethod(method);
  };
  const selectedPolicy = selected(available.policies, policySelection);
  const childOptions = useMemo<ShieldedRecipientOption[]>(() => {
    if (!currentLineage || selectedPolicy?.note.kind !== "policy") return [];
    const root = selectedPolicy.note;
    if (root.rootVersionIndex > BigInt(Number.MAX_SAFE_INTEGER)) return [];
    const candidates: ShieldedRecipientOption[] = [];
    for (const [personHash, versions] of currentLineage.snapshot.versions) {
      if (
        !versions.some(
          (version) =>
            version.fatherIdentityCommitment === root.rootIdentityCommitment ||
            version.motherIdentityCommitment === root.rootIdentityCommitment,
        )
      )
        continue;
      const childCommitment = versions[versions.length - 1]?.identityCommitment;
      if (childCommitment === undefined) continue;
      const eligible = findHeirLegitimacy({
        snapshot: currentLineage.snapshot,
        heir: { personHash, identityCommitment: childCommitment },
        root: { identityCommitment: root.rootIdentityCommitment },
        rootVersionIndex: Number(root.rootVersionIndex),
      }).some((source) => source.writtenAt <= currentLineage.asOf);
      candidates.push({
        personHash,
        label: localRecipientLabels.get(personHash.toLowerCase()),
        eligible,
      });
    }
    return candidates.sort((a, b) =>
      (a.label ?? a.personHash).localeCompare(b.label ?? b.personHash),
    );
  }, [currentLineage, selectedPolicy, localRecipientLabels]);

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

  async function refreshRegistry() {
    const currentIdentity = activeIdentity.current;
    const previous = registryCache.current;
    try {
      const snapshot = await loadKeyRegistrySnapshot(modules.registry, {
        fromBlock: getShieldedKeyRegistryDeploymentBlock(Number(modules.chainId)),
        previous: previous && !previous.invalidated ? previous : undefined,
      });
      if (currentIdentity && activeIdentity.current === currentIdentity) {
        registryCache.current = snapshot;
        setRegistrySnapshot(snapshot);
      }
      return snapshot;
    } catch (cause) {
      if (currentIdentity && activeIdentity.current === currentIdentity) {
        registryCache.current = null;
        setRegistrySnapshot(null);
      }
      throw cause;
    }
  }

  function chooseAction(next: Action, preferredGroup?: TaskGroup) {
    recipientCredentialsFormRef.current?.clearSecretInputs();
    if (heirReceiveCodeRef.current) heirReceiveCodeRef.current.value = "";
    if (transferReceiveCodeRef.current) transferReceiveCodeRef.current.value = "";
    setRecipientInputMethod("receiveCode");
    setTransferReceiveTargetHash(null);
    const group = TASK_GROUPS.find((candidate) => TASK_ACTIONS[candidate].includes(next));
    if (preferredGroup || group) setTaskGroup(preferredGroup ?? group!);
    setAction(next);
    setError("");
    setTransactionHash("");
    setStage("");
    setValueSelection("");
    setSecondValueSelection("");
    setBudgetSelection("");
    setSecondBudgetSelection("");
    setUseSecondValue(false);
    setClaimIndices("");
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
      const [recovery, registration] = await Promise.allSettled([
        refreshWallet(material),
        refreshRegistry(),
      ]);
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
      if (recovery.status === "rejected" || registration.status === "rejected") {
        const cause =
          recovery.status === "rejected"
            ? recovery.reason
            : registration.status === "rejected"
              ? registration.reason
              : undefined;
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

  async function submitSelected(requestedAction: Action = action) {
    if (running.current) return;
    const action = requestedAction;
    running.current = true;
    let hash = "";
    let createdPolicy: string | undefined;
    let policyCreated = false;
    setBusy(true);
    setError("");
    setTransactionHash("");
    setStage("");
    try {
      const identity = session.identity;
      if (!identity) throw new Error(t("shielded.unlockRequired"));
      if (!signer) throw new Error(t("shielded.walletNotReady"));
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
      let derivedRecipient: ShieldedRecipientMaterial | null = null;
      const resolveRecipient = () => {
        if (recipientInputMethod === "receiveCode") {
          const codeRef = action === "privateTransfer" ? transferReceiveCodeRef : heirReceiveCodeRef;
          const code = codeRef.current?.value ?? "";
          if (codeRef.current) codeRef.current.value = "";
          return resolveShieldedRecipientMaterial({ kind: "receiveCode", code });
        }
        if (!derivedRecipient) throw new Error(t("shielded.recipientCredentialsMissing"));
        return resolveShieldedRecipientMaterial({
          kind: "derivedRecipient",
          material: derivedRecipient,
        });
      };
      session.touch();
      const isPrivate = action !== "recover" && action !== "shield";
      if (isPrivate && !privateWalletChecked) {
        throw new Error(t("shielded.privateWalletRequired"));
      }
      if (isPrivate && publicActivityAddresses.has(account.toLowerCase())) {
        throw new Error(t("shielded.walletReused"));
      }
      if (
        recipientInputMethod === "credentials" &&
        (action === "allocate" || action === "topUp" || action === "privateTransfer")
      ) {
        const credentialsForm = recipientCredentialsFormRef.current;
        if (!credentialsForm) throw new Error(t("shielded.recipientCredentialsMissing"));
        const credentials = credentialsForm.readAndClear();
        setStage(t("shielded.stages.deriving"));
        const registryAddress =
          registryCache.current?.registryAddress ?? (await modules.registry.getAddress());
        derivedRecipient = await deriveShieldedRecipientMaterial({
          ...credentials,
          chainId: modules.chainId,
          registryAddress,
        });
        assertCurrentOperation();
      }
      if (
        (await signer.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await signer.getAddress()).toLowerCase() !== account.toLowerCase()
      ) {
        throw new Error(t("shielded.walletChanged"));
      }
      assertCurrentOperation();
      let shouldRefreshWallet = action !== "register" && action !== "recover";
      if (action === "recover") {
        setStage(t("shielded.stages.recovering"));
        await Promise.all([refreshWallet(identity), refreshRegistry()]);
        shouldRefreshWallet = false;
      } else if (action === "register") {
        setStage(t("shielded.stages.recovering"));
        const existing = await refreshRegistry();
        const registrationTag = computeShieldedRegistrationTag({
          derivedSecretField: identity.derivedSecretField,
          identityCommitment: identity.identityCommitment,
          chainId: modules.chainId,
          registryAddress: existing.registryAddress,
        });
        if (existing.keys.has(registrationTag)) {
          throw new Error(t("shielded.alreadyRegistered"));
        }
        const result = await registerShieldedHeirKey({
          registry: modules.registry,
          signer,
          expectedChainId: modules.chainId,
          identity,
          onStage: (next) => {
            if (next !== "confirming") assertCurrentOperation();
            setStage(t(`shielded.stages.${next}`));
          },
        });
        checkReceipt(result.receipt.status, result.transactionHash);
        hash = result.transactionHash;
        publicActivityAddresses.add(account.toLowerCase());
        await refreshRegistry();
      } else if (action === "shield") {
        const amount = parsePositiveTokenAmount(shieldAmount, modules.tokenDecimals);
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
          checkReceipt(receipt?.status ?? null, approval.hash);
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
        checkReceipt(result.receipt.status, result.transactionHash);
        hash = result.transactionHash;
        publicActivityAddresses.add(account.toLowerCase());
      } else {
        setStage(t("shielded.stages.recovering"));
        const recovered = await refreshWallet(identity);
        if (activeIdentity.current !== identity) throw new Error(t("shielded.unlockRequired"));
        const values = availableFromSnapshot(recovered, identity.derivedSecretField, "value");
        const value = selected(values, valueSelection);
        const fundingValue = (amount: bigint) => {
          const note = valueSelection ? value : selectValueNotes(values, amount)?.[0];
          if (!note || note.note.kind !== "value" || note.note.amount < amount) {
            throw new Error(t("shielded.automaticFundingUnavailable"));
          }
          return note;
        };
        if (action === "createPolicy") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const rootHash = rootPersonHash.trim() || identity.personHash;
          const roots = await loadRootRegistry(modules.lineageIndex, modules.deepFamily);
          const knownVersions = roots.versions.get(rootHash.toLowerCase()) ?? [];
          const versionIndex = rootVersion.trim()
            ? Number(rootVersion)
            : knownVersions.reduce((latest, version) => Math.max(latest, version.versionIndex), 0);
          if (!Number.isSafeInteger(versionIndex) || versionIndex < 1) {
            throw new Error(t("shielded.invalidVersion"));
          }
          assertVersionKnown(roots, rootHash, versionIndex);
          const version = roots.versions
            .get(rootHash.toLowerCase())
            ?.find((candidate) => candidate.versionIndex === versionIndex);
          if (!version) throw new Error(t("shielded.invalidVersion"));
          const prepared = await prepareShieldedCreatePolicy({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            derivedSecretField: identity.derivedSecretField,
            wallet: recovered,
            inputCommitment: value.commitment,
            rootIdentityCommitment: version.identityCommitment,
            rootVersionIndex: versionIndex,
            amountPerPeriod: parsePositiveTokenAmount(rate, modules.tokenDecimals),
          });
          const result = await submitCreatePolicy({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash);
          hash = result.transactionHash;
          createdPolicy = prepared.outputs?.[0]?.commitment?.toString();
          policyCreated = true;
        } else if (action === "allocate") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const policy = selected(
            [...recovered.ownedNotes.values()].filter((note) => note.note.kind === "policy"),
            policySelection,
          );
          if (!policy || policy.note.kind !== "policy") throw new Error(t("shielded.noPolicyNote"));
          const policyNote = policy.note;
          const budgetPeriods = parsePositivePeriods(periods);
          const donor = fundingValue(policyNote.amountPerPeriod * budgetPeriods);
          const keyRegistry = await refreshRegistry();
          const childError = validateShieldedRecipientSelection({
            value: heirPersonHash,
            options: childOptions,
            loading: !currentLineage && !lineageError,
          });
          if (childError) throw new Error(t(`shielded.recipientPicker.errors.${childError}`));
          const receive = resolveRecipient();
          if (receive.personHash.toLowerCase() !== heirPersonHash.trim().toLowerCase()) {
            throw new Error(t("shielded.recipientMismatch"));
          }
          const result = await submitAllocateWithFreshLineage({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            lineageIndex: modules.lineageIndex,
            onStage,
            prepare: async () =>
              prepareShieldedAllocate({
                pool: modules.pool,
                wallet: recovered,
                donorDerivedSecretField: identity.derivedSecretField,
                donorCommitment: donor.commitment,
                keyRegistry,
                heirPersonHash: heirPersonHash.trim(),
                heirIdentityCommitment: receive.identityCommitment,
                registrationSalt: receive.registrationSalt,
                policy: {
                  note: policyNote,
                  commitment: policy.commitment,
                  ciphertext: policy.ciphertext,
                  shardId: policy.shardId,
                },
                lineageIndex: modules.lineageIndex,
                lineage: await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
                budgetPeriods,
              }),
          });
          hash = result.transactionHash;
        } else if (action === "topUp") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const keyRegistry = await refreshRegistry();
          const template = selected(listRecoveredTopUpTemplates(recovered), topUpSelection);
          if (!template) throw new Error(t("shielded.noBudgetTemplate"));
          const topUpPeriods = parsePositivePeriods(periods);
          const donor = fundingValue(getBigInt(template.note.amountPerPeriod) * topUpPeriods);
          const receive = resolveRecipient();
          if (receive.identityCommitment !== getBigInt(template.note.heirIdentityCommitment)) {
            throw new Error(t("shielded.recipientMismatch"));
          }
          const prepared = await prepareShieldedTopUp({
            pool: modules.pool,
            wallet: recovered,
            donorDerivedSecretField: identity.derivedSecretField,
            donorCommitment: donor.commitment,
            keyRegistry,
            heirPersonHash: wrapIdentityCommitmentAsPersonHash(
              template.note.heirIdentityCommitment,
            ),
            heirIdentityCommitment: receive.identityCommitment,
            registrationSalt: receive.registrationSalt,
            budget: template,
            topUpPeriods,
          });
          const result = await submitTopUp({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash);
          hash = result.transactionHash;
        } else if (action === "mergeBudget") {
          const budgets = availableFromSnapshot(recovered, identity.derivedSecretField, "budget");
          const pair = selectCompatibleBudgetPair(budgets);
          const partner = (note: Note | undefined) =>
            note &&
            [...budgets]
              .sort((left, right) =>
                left.commitment < right.commitment
                  ? -1
                  : left.commitment > right.commitment
                    ? 1
                    : 0,
              )
              .find(
                (candidate) =>
                  candidate.commitment !== note.commitment &&
                  selectCompatibleBudgetPair([note, candidate]),
              );
          const explicitFirst = budgetSelection ? selected(budgets, budgetSelection) : undefined;
          const explicitSecond = secondBudgetSelection
            ? selected(budgets, secondBudgetSelection)
            : undefined;
          const first = budgetSelection
            ? explicitFirst
            : secondBudgetSelection
              ? partner(explicitSecond)
              : pair?.[0];
          const second = secondBudgetSelection
            ? explicitSecond
            : budgetSelection
              ? partner(explicitFirst)
              : pair?.[1];
          if (!first || !second || !selectCompatibleBudgetPair([first, second])) {
            throw new Error(t("shielded.noCompatibleBudgets"));
          }
          const prepared = await prepareShieldedMergeBudget({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            derivedSecretField: identity.derivedSecretField,
            wallet: recovered,
            inputCommitments: [first.commitment, second.commitment],
          });
          const result = await submitMergeBudget({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash);
          hash = result.transactionHash;
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
              const automatic =
                !budgetSelection && !claimIndices.trim()
                  ? selectClaimBudget(
                      eligibleBudgets,
                      recovered,
                      identity.derivedSecretField,
                      BigInt(latest.timestamp),
                    )
                  : undefined;
              const budget = automatic?.budget ?? selected(budgets, budgetSelection);
              if (
                !budget ||
                budget.note.kind !== "budget" ||
                (!budgetSelection && !claimIndices.trim() && !automatic)
              ) {
                throw new Error(t("shielded.noClaimableBudget"));
              }
              const indices = claimIndices.trim()
                ? parsePeriodIndices(claimIndices)
                : (automatic?.periodIndices ??
                  nextClaimPeriods(
                    recovered,
                    identity.derivedSecretField,
                    budget.note,
                    BigInt(latest.timestamp),
                  ));
              return prepareShieldedClaim({
                chainId: modules.chainId,
                poolAddress: modules.poolAddress,
                identity,
                wallet: recovered,
                lineage,
                budgetCommitment: budget.commitment,
                asOf: latest.timestamp,
                periodIndices: indices,
              });
            },
          });
          hash = result.transactionHash;
        } else if (action === "privateTransfer") {
          const amount = parsePositiveTokenAmount(transferAmount, modules.tokenDecimals);
          const automatic =
            !valueSelection && !useSecondValue ? selectValueNotes(values, amount, 2) : undefined;
          if (!valueSelection && !useSecondValue && !automatic && values.length) {
            throw new Error(t("shielded.automaticFundingUnavailable"));
          }
          const first = automatic?.[0] ?? selected(values, valueSelection);
          if (!first || first.note.kind !== "value") throw new Error(t("shielded.noValueNote"));
          const secondOptions = values.filter((item) => item.commitment !== first.commitment);
          const second =
            automatic?.[1] ??
            (useSecondValue ? selected(secondOptions, secondValueSelection) : undefined);
          if (useSecondValue && (!second || second.note.kind !== "value"))
            throw new Error(t("shielded.needTwoValues"));
          const total =
            first.note.amount + (second?.note.kind === "value" ? second.note.amount : 0n);
          if (amount > total) throw new Error(t("shielded.amountExceedsNotes"));
          const keyRegistry = await refreshRegistry();
          const receive = resolveRecipient();
          setTransferReceiveTargetHash(receive.personHash);
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
              {
                kind: "registered",
                identityCommitment: receive.identityCommitment,
                registrationSalt: receive.registrationSalt,
                amount,
              },
              { kind: "inputOwner", inputIndex: 0, amount: total - amount },
            ],
            keyRegistry,
          });
          const result = await submitPrivateTransfer({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            data: prepared.data,
            witness: prepared.witness,
            onStage,
          });
          checkReceipt(result.receipt.status, result.transactionHash);
          hash = result.transactionHash;
        } else if (action === "unshield") {
          const amount = parsePositiveTokenAmount(exitAmount, modules.tokenDecimals);
          const withdrawalNote = fundingValue(amount);
          const prepared = await prepareShieldedUnshield({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            input: {
              wallet: recovered,
              derivedSecretField: identity.derivedSecretField,
              commitment: withdrawalNote.commitment,
            },
            amount,
            recipient: exitRecipient.trim(),
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
          checkReceipt(result.receipt.status, result.transactionHash);
          hash = result.transactionHash;
        }
      }
      if (shouldRefreshWallet) {
        setStage(t("shielded.stages.recovering"));
        await refreshWallet(identity);
      }
      if (policyCreated) {
        setPolicySelection(createdPolicy ?? "");
        setTaskGroup("inheritance");
        setAction("allocate");
      } else if (action === "shield" && taskGroup === "inheritance") {
        setAction(available.policies.length ? "allocate" : "createPolicy");
      } else if (action === "register" && taskGroup === "receive") {
        setAction("claim");
      }
      setTransactionHash(hash);
      setStage(t("shielded.done"));
      setValueSelection("");
      setSecondValueSelection("");
      setBudgetSelection("");
      setSecondBudgetSelection("");
      setUseSecondValue(false);
      setClaimIndices("");
    } catch (cause) {
      const errorReason = resolveErrorReason(cause);
      const detail =
        cause instanceof InheritanceError
          ? t(`inheritance.errors.${cause.code}`)
          : errorReason === "LOCAL_NONCE_TOO_HIGH" || errorReason === "NONCE_TOO_HIGH"
            ? getFriendlyError(cause, t).message
            : cause instanceof Error
              ? cause.message
              : t("shielded.unknownError");
      if (hash) {
        setTransactionHash(hash);
        setError(t("shielded.confirmedRefreshFailed", { detail }));
      } else {
        setError(detail);
      }
    } finally {
      recipientCredentialsFormRef.current?.clearSecretInputs();
      running.current = false;
      setBusy(false);
    }
  }

  const isPrivate = action !== "recover" && action !== "shield";

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

  const privacy = (
    <details className="rounded-xl border border-warning/30 bg-warning/5 p-4">
      <summary className="cursor-pointer text-sm text-ink">{t("shielded.privacySummary")}</summary>
      <div className="mt-3">
        <WarningNotice>{t("shielded.privacyNotice")}</WarningNotice>
      </div>
    </details>
  );

  if (!identity) {
    return (
      <div className="space-y-6 break-normal">
        <InheritanceGuide expanded />
        <PanelShell
          title={t("shielded.identityTitle")}
          description={t("shielded.identityDescription")}
        >
          <PersonHashCalculator
            ref={identityForm}
            showTitle={false}
            collapsible={false}
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
        {privacy}
      </div>
    );
  }

  const registered = ownRegistration?.registered;
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
  const nextAction: Action | null =
    taskGroup === "receive"
      ? registered === false
        ? "register"
        : claimOverview?.claim
          ? "claim"
          : null
      : taskGroup === "inheritance"
        ? !hasSpendableValue
          ? "shield"
          : available.policies.length
            ? "allocate"
            : "createPolicy"
        : hasSpendableValue
          ? "privateTransfer"
          : "shield";
  const firstActionForGroup = (group: TaskGroup): Action =>
    group === "inheritance"
      ? !hasSpendableValue
        ? "shield"
        : available.policies.length
          ? "allocate"
          : "createPolicy"
      : group === "receive"
        ? registered === false
          ? "register"
          : "claim"
        : hasSpendableValue
          ? "privateTransfer"
          : "shield";
  const fundingRule = selected(available.policies, policySelection);
  const fundingTemplate = selected(available.templates, topUpSelection);
  const fundingRate =
    action === "allocate" && fundingRule?.note.kind === "policy"
      ? fundingRule.note.amountPerPeriod
      : action === "topUp" && fundingTemplate
        ? getBigInt(fundingTemplate.note.amountPerPeriod)
        : undefined;
  const fundingPeriods = /^[1-9][0-9]{0,19}$/.test(periods.trim())
    ? BigInt(periods.trim())
    : undefined;

  return (
    <div className="space-y-6 break-normal">
      <InheritanceGuide expanded={false} />
      <PanelShell title={t("shielded.balanceTitle")} description={t("shielded.sessionHint")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-ink">{identity.identity.fullName}</p>
            <p className="text-xs text-success">{t("shielded.unlocked")}</p>
          </div>
          <PanelButton disabled={busy} onClick={lockIdentity}>
            {t("shielded.lock")}
          </PanelButton>
        </div>
        <dl className="grid grid-cols-1 gap-4 rounded-2xl bg-surface-alt p-4 sm:grid-cols-2">
          {[
            { label: "balanceAmount", amount: totalValue },
            { label: "budgetAmount", amount: totalBudget },
          ].map(({ label, amount }) => (
            <div key={label}>
              <dt className="text-xs text-ink-muted">{t(`shielded.${label}`)}</dt>
              <dd className="mt-1 break-words text-xl font-semibold text-ink">
                {walletSnapshot ? formatUnits(amount, modules.tokenDecimals) : "—"}
                <span className="ml-1 inline-block whitespace-nowrap text-xs font-normal text-ink-muted">
                  DEEP
                </span>
              </dd>
              <dd className="mt-2 text-xs leading-relaxed text-ink-muted">
                {t(label === "balanceAmount" ? "shielded.balanceHint" : "shielded.budgetHint")}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {registered === undefined
              ? t("shielded.recoverFirst")
              : t(registered ? "shielded.registered" : "shielded.pendingRegistration")}
          </p>
          <PanelButton disabled={busy} onClick={() => void submitSelected("recover")}>
            {t("shielded.actions.recover")}
          </PanelButton>
        </div>
        {registered && ownRegistration ? (
          <FieldBlock
            label={t("shielded.receiveCodeLabel")}
            hint={t("shielded.receiveCodeShareHint")}
          >
            <textarea
              aria-label={t("shielded.receiveCodeLabel")}
              className={`${INPUT_CLASS} h-auto min-h-20 break-all py-2 font-mono text-xs`}
              readOnly
              value={ownRegistration.receiveCode}
              rows={3}
            />
          </FieldBlock>
        ) : null}
        {registered && ownRegistration?.waitingForSecondKey ? (
          <WarningNotice>{t("shielded.waitingForSecondKey")}</WarningNotice>
        ) : null}
        {nextAction && nextAction !== action ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-3">
            <p className="text-sm text-ink-muted">{t(`shielded.nextStep.${nextAction}`)}</p>
            <PanelButton disabled={busy} onClick={() => chooseAction(nextAction, taskGroup)}>
              {labels[nextAction]}
            </PanelButton>
          </div>
        ) : null}
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">{t("shielded.identityHashLabel")}</summary>
          <p className="mt-2 break-all font-mono">{identity.personHash}</p>
          <p className="mt-2">{t("shielded.transactionWalletLabel")}</p>
          <p className="break-all font-mono">{account}</p>
        </details>
      </PanelShell>
      <div role="tablist" aria-label={t("shielded.actionsTitle")} className="flex flex-wrap gap-2">
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
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              group === taskGroup
                ? "border-primary bg-primary/10 text-ink"
                : "border-hairline bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {t(`shielded.groups.${group}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {TASK_ACTIONS[taskGroup]
          .filter((item) => item !== "register" || registered !== true)
          .map((item) => (
            <PanelButton
              key={item}
              variant={item === action ? "primary" : "secondary"}
              aria-pressed={item === action}
              disabled={busy}
              onClick={() => chooseAction(item, taskGroup)}
            >
              {labels[item]}
            </PanelButton>
          ))}
      </div>
      <div id="shielded-task-panel" role="tabpanel" aria-labelledby={`shielded-tab-${taskGroup}`}>
        <PanelShell title={labels[action]} description={t(`shielded.descriptions.${action}`)}>
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

          {action === "createPolicy" ? (
            <>
              <FieldBlock label={t("shielded.fields.rate")} hint={t("shielded.rateHint")}>
                <input
                  aria-label={t("shielded.fields.rate")}
                  className={INPUT_CLASS}
                  inputMode="decimal"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  placeholder="10"
                />
              </FieldBlock>
              <AdvancedOptions>
                <NoteSelect
                  label={t("shielded.fields.valueNote")}
                  notes={available.values}
                  selectedValue={valueSelection}
                  onChange={setValueSelection}
                  decimals={modules.tokenDecimals}
                />
                <FieldBlock
                  label={t("shielded.fields.rootPersonHash")}
                  hint={t("shielded.rootIdentityHint")}
                >
                  <input
                    aria-label={t("shielded.fields.rootPersonHash")}
                    className={INPUT_CLASS}
                    value={rootPersonHash}
                    onChange={(event) => setRootPersonHash(event.target.value)}
                    placeholder={t("shielded.ownIdentityDefault")}
                  />
                </FieldBlock>
                <FieldBlock
                  label={t("shielded.fields.rootVersion")}
                  hint={t("shielded.rootVersionHint")}
                >
                  <input
                    aria-label={t("shielded.fields.rootVersion")}
                    className={INPUT_CLASS}
                    inputMode="numeric"
                    value={rootVersion}
                    onChange={(event) => setRootVersion(event.target.value)}
                    placeholder={t("shielded.latestVersion")}
                  />
                </FieldBlock>
              </AdvancedOptions>
            </>
          ) : null}

          {action === "allocate" || action === "topUp" ? (
            <>
              {action === "allocate" ? (
                <>
                  <NoteSelect
                    label={t("shielded.fields.policyNote")}
                    notes={available.policies}
                    selectedValue={policySelection}
                    onChange={setPolicySelection}
                    decimals={modules.tokenDecimals}
                  />
                  <ShieldedRecipientPicker
                    label={t("shielded.fields.heirPersonHash")}
                    value={heirPersonHash}
                    onChange={setHeirPersonHash}
                    options={childOptions}
                    loading={!currentLineage && !lineageError}
                  />
                </>
              ) : (
                <FieldBlock label={t("shielded.fields.budgetTemplate")}>
                  <select
                    aria-label={t("shielded.fields.budgetTemplate")}
                    className={INPUT_CLASS}
                    value={
                      selected(available.templates, topUpSelection)?.commitment.toString() ?? ""
                    }
                    onChange={(event) => setTopUpSelection(event.target.value)}
                  >
                    {available.templates.length === 0 ? (
                      <option value="">{t("shielded.noRecoveredTemplate")}</option>
                    ) : null}
                    {available.templates.map((template) => {
                      const hash = wrapIdentityCommitmentAsPersonHash(
                        template.note.heirIdentityCommitment,
                      );
                      const name = localRecipientLabels.get(hash.toLowerCase());
                      return (
                        <option
                          key={template.commitment.toString()}
                          value={template.commitment.toString()}
                        >
                          {t("shielded.fundingTargetOption", {
                            identity: name ? `${name} (${shortHex(hash)})` : shortHex(hash),
                            amount: formatUnits(
                              template.note.amountPerPeriod,
                              modules.tokenDecimals,
                            ),
                          })}
                        </option>
                      );
                    })}
                  </select>
                </FieldBlock>
              )}
              <RecipientInput
                method={recipientInputMethod}
                onMethodChange={changeRecipientInputMethod}
                codeRef={heirReceiveCodeRef}
                credentialsFormRef={recipientCredentialsFormRef}
                busy={busy}
              />
              <FieldBlock label={t("shielded.fields.periods")} hint={t("shielded.periodsHint")}>
                <input
                  aria-label={t("shielded.fields.periods")}
                  className={INPUT_CLASS}
                  inputMode="numeric"
                  value={periods}
                  onChange={(event) => setPeriods(event.target.value)}
                />
              </FieldBlock>
              {fundingRate !== undefined && fundingRate > 0n && fundingPeriods !== undefined ? (
                <p
                  role="status"
                  className="rounded-xl bg-primary/5 p-3 text-sm leading-relaxed text-ink"
                >
                  {t("shielded.fundingPreview", {
                    amount: formatUnits(fundingRate * fundingPeriods, modules.tokenDecimals),
                    periods: fundingPeriods.toString(),
                    rate: formatUnits(fundingRate, modules.tokenDecimals),
                  })}
                </p>
              ) : null}
              <AdvancedOptions>
                <NoteSelect
                  label={t("shielded.fields.valueNote")}
                  notes={available.values}
                  selectedValue={valueSelection}
                  onChange={setValueSelection}
                  decimals={modules.tokenDecimals}
                />
              </AdvancedOptions>
            </>
          ) : null}

          {action === "claim" || action === "mergeBudget" ? (
            <>
              {action === "claim" ? (
                <div
                  role="status"
                  className="space-y-1 rounded-xl bg-surface-alt p-3 text-sm text-ink"
                >
                  <p>
                    {lineageError
                      ? t("shielded.claimOverview.unavailable")
                      : !currentLineage
                        ? t("shielded.claimOverview.checking")
                        : available.budgets.length > 0 && eligibleClaimBudgets.length === 0
                          ? t("shielded.claimOverview.ineligible")
                          : claimOverview?.claim
                            ? t("shielded.claimOverview.claimable", {
                                amount: formatUnits(
                                  claimOverview.claim.amount,
                                  modules.tokenDecimals,
                                ),
                                periods: claimOverview.claim.periodIndices.length,
                              })
                            : t(`shielded.claimOverview.${claimOverview?.status ?? "noFunds"}`)}
                  </p>
                  {claimOverview?.nextDueAt !== undefined ? (
                    <p className="text-xs text-ink-muted">
                      {t("shielded.claimOverview.nextDue", {
                        date: new Date(Number(claimOverview.nextDueAt) * 1000).toLocaleString(),
                      })}
                    </p>
                  ) : null}
                  {lineageError ? (
                    <p className="break-words text-xs text-ink-muted">{lineageError}</p>
                  ) : null}
                </div>
              ) : null}
              <AdvancedOptions>
                <NoteSelect
                  label={t("shielded.fields.budgetNote")}
                  notes={available.budgets}
                  selectedValue={budgetSelection}
                  onChange={setBudgetSelection}
                  decimals={modules.tokenDecimals}
                />
                {action === "mergeBudget" ? (
                  <NoteSelect
                    label={t("shielded.fields.secondBudgetNote")}
                    notes={available.budgets.filter(
                      (item) => item.commitment.toString() !== budgetSelection,
                    )}
                    selectedValue={secondBudgetSelection}
                    onChange={setSecondBudgetSelection}
                    decimals={modules.tokenDecimals}
                  />
                ) : (
                  <>
                    <FieldBlock
                      label={t("shielded.fields.claimIndices")}
                      hint={t("shielded.claimIndicesHint")}
                    >
                      <input
                        aria-label={t("shielded.fields.claimIndices")}
                        className={INPUT_CLASS}
                        value={claimIndices}
                        onChange={(event) => setClaimIndices(event.target.value)}
                        placeholder="0,1,2"
                      />
                    </FieldBlock>
                  </>
                )}
              </AdvancedOptions>
            </>
          ) : null}

          {action === "privateTransfer" ? (
            <>
              <RecipientInput
                method={recipientInputMethod}
                onMethodChange={changeRecipientInputMethod}
                codeRef={transferReceiveCodeRef}
                credentialsFormRef={recipientCredentialsFormRef}
                onCodeChange={updateTransferReceiveTarget}
                busy={busy}
              />
              {transferReceiveTargetHash ? (
                <p className="break-all rounded-xl bg-surface-alt p-3 text-sm text-ink">
                  {t("shielded.recipientTarget", {
                    identity:
                      localRecipientLabels.get(transferReceiveTargetHash.toLowerCase()) ??
                      transferReceiveTargetHash,
                  })}
                  <span className="mt-1 block font-mono text-xs text-ink-muted">
                    {transferReceiveTargetHash}
                  </span>
                </p>
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
              <AdvancedOptions>
                <NoteSelect
                  label={t("shielded.fields.valueNote")}
                  notes={available.values}
                  selectedValue={valueSelection}
                  onChange={setValueSelection}
                  decimals={modules.tokenDecimals}
                />
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={useSecondValue}
                    onChange={(event) => setUseSecondValue(event.target.checked)}
                  />
                  <span>{t("shielded.fields.useSecondValueNote")}</span>
                </label>
                {useSecondValue ? (
                  <NoteSelect
                    label={t("shielded.fields.secondValueNote")}
                    notes={available.values.filter(
                      (note) =>
                        note.commitment !== selected(available.values, valueSelection)?.commitment,
                    )}
                    selectedValue={secondValueSelection}
                    onChange={setSecondValueSelection}
                    decimals={modules.tokenDecimals}
                  />
                ) : null}
              </AdvancedOptions>
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
              <AdvancedOptions>
                <NoteSelect
                  label={t("shielded.fields.valueNote")}
                  notes={available.values}
                  selectedValue={valueSelection}
                  onChange={setValueSelection}
                  decimals={modules.tokenDecimals}
                />
              </AdvancedOptions>
            </>
          ) : null}

          {isPrivate ? (
            <label className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-ink">
              <input
                aria-label={t("shielded.privateWalletCheck")}
                type="checkbox"
                className="mt-1"
                checked={privateWalletChecked}
                onChange={(event) => setPrivateWalletChecked(event.target.checked)}
              />
              <span>{t("shielded.privateWalletCheck")}</span>
            </label>
          ) : null}
          {!signer ? <WarningNotice>{t("shielded.walletNotReady")}</WarningNotice> : null}
          {isPrivate && publicActivityAddresses.has(account.toLowerCase()) ? (
            <WarningNotice>{t("shielded.switchWalletPrompt")}</WarningNotice>
          ) : null}
          <PanelButton
            variant="primary"
            busy={busy}
            disabled={
              busy || !signer || (isPrivate && publicActivityAddresses.has(account.toLowerCase()))
            }
            onClick={() => void submitSelected()}
          >
            {t("shielded.submit", { action: labels[action] })}
          </PanelButton>
          {feedback}
        </PanelShell>
      </div>
      <details className="rounded-xl border border-hairline p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-muted">
          {t("shielded.groups.tools")}
        </summary>
        <p className="mt-3 text-sm text-ink-muted">{t("shielded.groups.toolsHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["register", "mergeBudget"] as const).map((item) => (
            <PanelButton
              key={item}
              disabled={busy || (item === "register" && registered === true)}
              onClick={() => chooseAction(item)}
            >
              {labels[item]}
            </PanelButton>
          ))}
        </div>
      </details>
      {privacy}
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
