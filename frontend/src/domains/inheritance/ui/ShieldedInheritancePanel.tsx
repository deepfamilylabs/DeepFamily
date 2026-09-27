import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  deriveShieldedHeirKeyMaterial,
  wrapIdentityCommitmentAsPersonHash,
  INHERITANCE_PERIOD_SECONDS,
} from "@deepfamily/protocol-core";
import { formatUnits, parseUnits, type Signer } from "ethers";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import {
  assertVersionKnown,
  loadLineageSnapshot,
  loadRootRegistry,
} from "../services/inheritanceChain";
import { deriveIdentityFromForm } from "../services/inheritanceIdentity";
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

const ACTIONS: readonly Action[] = [
  "recover",
  "register",
  "shield",
  "createPolicy",
  "allocate",
  "topUp",
  "mergeBudget",
  "claim",
  "privateTransfer",
  "unshield",
];

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

type Note = ReturnType<typeof listUnspentRecoveredShieldedNotes>[number];

function selected<T extends { commitment: bigint }>(
  values: readonly T[],
  commitment: string,
): T | undefined {
  return values.find((value) => value.commitment.toString() === commitment) ?? values[0];
}

function shortCommitment(commitment: bigint): string {
  const hex = `0x${commitment.toString(16).padStart(64, "0")}`;
  return `${hex.slice(0, 11)}…${hex.slice(-8)}`;
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

/**
 * Select the earliest due periods with unused local nullifiers. The guard
 * keeps a decades-old identity from blocking the browser with an unbounded
 * walk; the user can enter exact indices when needed.
 */
function nextClaimPeriods(
  wallet: LocalShieldedWalletSnapshot,
  derivedSecretField: string,
  budget: Extract<Note["note"], { kind: "budget" }>,
  now: bigint,
): bigint[] {
  const elapsed = now - budget.eligibleFrom;
  if (elapsed < INHERITANCE_PERIOD_SECONDS) throw new Error("No whole period is due yet");
  const dueCount = elapsed / INHERITANCE_PERIOD_SECONDS;
  const fundedCount = budget.remaining / budget.amountPerPeriod;
  const target = Number(fundedCount < 12n ? fundedCount : 12n);
  if (target < 1) throw new Error("The selected budget cannot pay a whole period");
  const policyCommitment = computeShieldedPolicyCommitment(budget);
  const result: bigint[] = [];
  const scanLimit = dueCount < 100_000n ? dueCount : 100_000n;
  for (let index = 0n; index < scanLimit && result.length < target; index += 1n) {
    const nullifier = computeShieldedPeriodNullifier({
      derivedSecretField,
      policyCommitment,
      periodIndex: index,
    });
    if (!wallet.spentNullifiers.has(nullifier)) result.push(index);
  }
  if (!result.length)
    throw new Error("No unclaimed due period was found; enter exact period indices");
  return result;
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
  showAmount = false,
}: {
  label: string;
  notes: readonly Note[];
  selectedValue: string;
  onChange: (value: string) => void;
  decimals: number;
  showAmount?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <FieldBlock label={label}>
      <select
        className={INPUT_CLASS}
        value={selected(notes, selectedValue)?.commitment.toString() ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {notes.length === 0 ? <option value="">{t("shielded.noRecoveredNote")}</option> : null}
        {notes.map((item) => (
          <option key={item.commitment.toString()} value={item.commitment.toString()}>
            {shortCommitment(item.commitment)}
            {showAmount && item.note.kind === "value"
              ? ` · ${formatUnits(item.note.amount, decimals)} DEEP`
              : ""}
            {showAmount && item.note.kind === "budget"
              ? ` · ${formatUnits(item.note.remaining, decimals)} DEEP`
              : ""}
          </option>
        ))}
      </select>
    </FieldBlock>
  );
}

export function ShieldedInheritancePanel({
  modules,
  signer,
  account,
  publicActivityAddresses,
}: {
  modules: ShieldedPageModules;
  signer: Signer;
  account: string;
  publicActivityAddresses: Set<string>;
}) {
  const { t } = useTranslation();
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const walletCache = useRef<LocalShieldedWalletSnapshot | null>(null);
  const registryCache = useRef<KeyRegistrySnapshot | null>(null);
  const running = useRef(false);
  const [action, setAction] = useState<Action>("recover");
  const [busy, setBusy] = useState(false);
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
  const [rootVersion, setRootVersion] = useState("1");
  const [heirPersonHash, setHeirPersonHash] = useState("");
  const [periods, setPeriods] = useState("1");
  const [claimIndices, setClaimIndices] = useState("");
  const [transferPersonHash, setTransferPersonHash] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [useSecondValue, setUseSecondValue] = useState(false);
  const [exitAmount, setExitAmount] = useState("");
  const [exitRecipient, setExitRecipient] = useState(account);
  const [valueSelection, setValueSelection] = useState("");
  const [secondValueSelection, setSecondValueSelection] = useState("");
  const [budgetSelection, setBudgetSelection] = useState("");
  const [secondBudgetSelection, setSecondBudgetSelection] = useState("");
  const [policySelection, setPolicySelection] = useState("");
  const [topUpSelection, setTopUpSelection] = useState("");

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
      walletCache.current = snapshot;
      setWalletSnapshot(snapshot);
      setUnspentNotes(listUnspentRecoveredShieldedNotes(snapshot, identity.derivedSecretField));
      return snapshot;
    } catch (cause) {
      walletCache.current = null;
      setWalletSnapshot(null);
      setUnspentNotes([]);
      throw cause;
    }
  }

  async function refreshRegistry() {
    const previous = registryCache.current;
    try {
      const snapshot = await loadKeyRegistrySnapshot(modules.registry, {
        fromBlock: getShieldedKeyRegistryDeploymentBlock(Number(modules.chainId)),
        previous: previous && !previous.invalidated ? previous : undefined,
      });
      registryCache.current = snapshot;
      setRegistrySnapshot(snapshot);
      return snapshot;
    } catch (cause) {
      registryCache.current = null;
      setRegistrySnapshot(null);
      throw cause;
    }
  }

  const onStage = (next: ShieldedPoolFlowStage) => setStage(t(`shielded.stages.${next}`));

  async function submitSelected() {
    if (running.current) return;
    running.current = true;
    let hash = "";
    setBusy(true);
    setError("");
    setTransactionHash("");
    setStage(t("shielded.stages.deriving"));
    try {
      const isPrivate = action !== "recover" && action !== "register" && action !== "shield";
      if (isPrivate && !privateWalletChecked) {
        throw new Error(t("shielded.privateWalletRequired"));
      }
      if (isPrivate && publicActivityAddresses.has(account.toLowerCase())) {
        throw new Error(t("shielded.walletReused"));
      }
      const identity = await deriveIdentityFromForm(identityForm.current);
      if (
        (await signer.provider?.getNetwork())?.chainId !== modules.chainId ||
        (await signer.getAddress()).toLowerCase() !== account.toLowerCase()
      ) {
        throw new Error(t("shielded.walletChanged"));
      }
      let shouldRefreshWallet = action !== "register" && action !== "recover";
      if (action === "recover") {
        setStage(t("shielded.stages.recovering"));
        await Promise.all([refreshWallet(identity), refreshRegistry()]);
        shouldRefreshWallet = false;
      } else if (action === "register") {
        setStage(t("shielded.stages.recovering"));
        const existing = await refreshRegistry();
        if (existing.keys.has(identity.personHash.toLowerCase())) {
          throw new Error(t("shielded.alreadyRegistered"));
        }
        const result = await registerShieldedHeirKey({
          registry: modules.registry,
          signer,
          expectedChainId: modules.chainId,
          identity,
          onStage: (next) => setStage(t(`shielded.stages.${next}`)),
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
          setStage(t("shielded.stages.approving"));
          const token = modules.token.connect(signer) as typeof modules.token;
          const approval = await token.approve(modules.poolAddress, amount);
          const receipt = await approval.wait();
          checkReceipt(receipt?.status ?? null, approval.hash);
        }
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
        const value = selected(
          availableFromSnapshot(recovered, identity.derivedSecretField, "value"),
          valueSelection,
        );
        const budget = selected(
          availableFromSnapshot(recovered, identity.derivedSecretField, "budget"),
          budgetSelection,
        );
        if (action === "createPolicy") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const rootHash = rootPersonHash.trim() || identity.personHash;
          const versionIndex = Number(rootVersion);
          if (!Number.isSafeInteger(versionIndex) || versionIndex < 1) {
            throw new Error(t("shielded.invalidVersion"));
          }
          const roots = await loadRootRegistry(modules.lineageIndex, modules.deepFamily);
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
        } else if (action === "allocate") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const policy = selected(
            [...recovered.ownedNotes.values()].filter((note) => note.note.kind === "policy"),
            policySelection,
          );
          if (!policy || policy.note.kind !== "policy") throw new Error(t("shielded.noPolicyNote"));
          const policyNote = policy.note;
          const keyRegistry = await refreshRegistry();
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
                donorCommitment: value.commitment,
                keyRegistry,
                heirPersonHash: heirPersonHash.trim(),
                policy: {
                  note: policyNote,
                  commitment: policy.commitment,
                  ciphertext: policy.ciphertext,
                  shardId: policy.shardId,
                },
                lineageIndex: modules.lineageIndex,
                lineage: await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
                budgetPeriods: parsePositivePeriods(periods),
              }),
          });
          hash = result.transactionHash;
        } else if (action === "topUp") {
          if (!value) throw new Error(t("shielded.noValueNote"));
          const keyRegistry = await refreshRegistry();
          const template = selected(listRecoveredTopUpTemplates(recovered), topUpSelection);
          if (!template) throw new Error(t("shielded.noBudgetTemplate"));
          const prepared = await prepareShieldedTopUp({
            pool: modules.pool,
            wallet: recovered,
            donorDerivedSecretField: identity.derivedSecretField,
            donorCommitment: value.commitment,
            keyRegistry,
            heirPersonHash: wrapIdentityCommitmentAsPersonHash(
              template.note.heirIdentityCommitment,
            ),
            budget: template,
            topUpPeriods: parsePositivePeriods(periods),
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
          const first = selected(budgets, budgetSelection);
          const second = selected(budgets, secondBudgetSelection);
          if (!first || !second) throw new Error(t("shielded.needTwoBudgets"));
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
          if (!budget || budget.note.kind !== "budget") throw new Error(t("shielded.noBudgetNote"));
          const result = await submitClaimWithFreshLineage({
            pool: modules.pool,
            signer,
            expectedChainId: modules.chainId,
            lineageIndex: modules.lineageIndex,
            onStage,
            prepare: async () => {
              const latest = await modules.provider.getBlock("latest");
              if (!latest) throw new Error(t("shielded.unreachable"));
              const indices = claimIndices.trim()
                ? parsePeriodIndices(claimIndices)
                : nextClaimPeriods(
                    recovered,
                    identity.derivedSecretField,
                    budget.note as Extract<Note["note"], { kind: "budget" }>,
                    BigInt(latest.timestamp),
                  );
              return prepareShieldedClaim({
                chainId: modules.chainId,
                poolAddress: modules.poolAddress,
                identity,
                wallet: recovered,
                lineage: await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily),
                budgetCommitment: budget.commitment,
                asOf: latest.timestamp,
                periodIndices: indices,
              });
            },
          });
          hash = result.transactionHash;
        } else if (action === "privateTransfer") {
          const values = availableFromSnapshot(recovered, identity.derivedSecretField, "value");
          const first = selected(values, valueSelection);
          if (!first || first.note.kind !== "value") throw new Error(t("shielded.noValueNote"));
          const secondOptions = values.filter((item) => item.commitment !== first.commitment);
          const second = useSecondValue ? selected(secondOptions, secondValueSelection) : undefined;
          if (useSecondValue && (!second || second.note.kind !== "value"))
            throw new Error(t("shielded.needTwoValues"));
          const amount = parsePositiveTokenAmount(transferAmount, modules.tokenDecimals);
          const total = first.note.amount + (second?.note.kind === "value" ? second.note.amount : 0n);
          if (amount > total) throw new Error(t("shielded.amountExceedsNotes"));
          const keyRegistry = await refreshRegistry();
          const prepared = await prepareShieldedPrivateTransfer({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            inputs: second ? [
              { wallet: recovered, derivedSecretField: identity.derivedSecretField, commitment: first.commitment },
              { wallet: recovered, derivedSecretField: identity.derivedSecretField, commitment: second.commitment },
            ] : [
              { wallet: recovered, derivedSecretField: identity.derivedSecretField, commitment: first.commitment },
            ],
            destinations: [
              { kind: "registered", personHash: transferPersonHash.trim(), amount },
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
          if (!value) throw new Error(t("shielded.noValueNote"));
          const prepared = await prepareShieldedUnshield({
            chainId: modules.chainId,
            poolAddress: modules.poolAddress,
            input: {
              wallet: recovered,
              derivedSecretField: identity.derivedSecretField,
              commitment: value.commitment,
            },
            amount: parsePositiveTokenAmount(exitAmount, modules.tokenDecimals),
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
      setTransactionHash(hash);
      setStage(t("shielded.done"));
    } catch (cause) {
      const detail = cause instanceof InheritanceError
        ? t(`inheritance.errors.${cause.code}`)
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
      identityForm.current?.clearSecretInputs();
      running.current = false;
      setBusy(false);
    }
  }

  const isPrivate = action !== "recover" && action !== "register" && action !== "shield";
  const noteAmount = (note: Note): string =>
    note.note.kind === "value"
      ? formatUnits(note.note.amount, modules.tokenDecimals)
      : note.note.kind === "budget"
        ? formatUnits(note.note.remaining, modules.tokenDecimals)
        : "";

  return (
    <div className="space-y-6">
      <WarningNotice>{t("shielded.privacyNotice")}</WarningNotice>
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
      </PanelShell>
      <div role="tablist" aria-label={t("shielded.actionsTitle")} className="flex flex-wrap gap-2">
        {ACTIONS.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={item === action}
            key={item}
            disabled={busy}
            onClick={() => {
              setAction(item);
              setError("");
              setTransactionHash("");
              setStage("");
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              item === action
                ? "border-primary bg-primary/10 text-ink"
                : "border-hairline bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      <PanelShell title={labels[action]} description={t(`shielded.descriptions.${action}`)}>
        {walletSnapshot ? (
          <div className="rounded-xl bg-surface-alt p-3 text-xs text-ink-muted">
            {t("shielded.recoveredSummary", {
              values: available.values.length,
              budgets: available.budgets.length,
              policies: available.policies.length,
              templates: available.templates.length,
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t("shielded.recoverFirst")}</p>
        )}

        {action === "shield" ? (
          <FieldBlock label={t("shielded.fields.amount")} hint={t("shielded.publicDepositHint")}>
            <input
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
            <NoteSelect
              label={t("shielded.fields.valueNote")}
              notes={available.values}
              selectedValue={valueSelection}
              onChange={setValueSelection}
              decimals={modules.tokenDecimals}
              showAmount
            />
            <FieldBlock label={t("shielded.fields.rootPersonHash")}>
              <input
                className={INPUT_CLASS}
                value={rootPersonHash}
                onChange={(event) => setRootPersonHash(event.target.value)}
                placeholder={t("shielded.ownIdentityDefault")}
              />
            </FieldBlock>
            <FieldBlock label={t("shielded.fields.rootVersion")}>
              <input
                className={INPUT_CLASS}
                inputMode="numeric"
                value={rootVersion}
                onChange={(event) => setRootVersion(event.target.value)}
              />
            </FieldBlock>
            <FieldBlock label={t("shielded.fields.rate")}>
              <input
                className={INPUT_CLASS}
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="10"
              />
            </FieldBlock>
          </>
        ) : null}

        {action === "allocate" || action === "topUp" ? (
          <>
            <NoteSelect
              label={t("shielded.fields.valueNote")}
              notes={available.values}
              selectedValue={valueSelection}
              onChange={setValueSelection}
              decimals={modules.tokenDecimals}
              showAmount
            />
            {action === "allocate" ? (
              <>
                <NoteSelect
                  label={t("shielded.fields.policyNote")}
                  notes={available.policies}
                  selectedValue={policySelection}
                  onChange={setPolicySelection}
                  decimals={modules.tokenDecimals}
                />
                <FieldBlock label={t("shielded.fields.heirPersonHash")}>
                  <input
                    className={INPUT_CLASS}
                    value={heirPersonHash}
                    onChange={(event) => setHeirPersonHash(event.target.value)}
                    placeholder="0x…"
                  />
                </FieldBlock>
              </>
            ) : (
              <FieldBlock label={t("shielded.fields.budgetTemplate")}>
                <select
                  className={INPUT_CLASS}
                  value={selected(available.templates, topUpSelection)?.commitment.toString() ?? ""}
                  onChange={(event) => setTopUpSelection(event.target.value)}
                >
                  {available.templates.length === 0 ? (
                    <option value="">{t("shielded.noRecoveredTemplate")}</option>
                  ) : null}
                  {available.templates.map((template) => (
                    <option
                      key={template.commitment.toString()}
                      value={template.commitment.toString()}
                    >
                      {shortCommitment(template.commitment)}
                    </option>
                  ))}
                </select>
              </FieldBlock>
            )}
            <FieldBlock label={t("shielded.fields.periods")}>
              <input
                className={INPUT_CLASS}
                inputMode="numeric"
                value={periods}
                onChange={(event) => setPeriods(event.target.value)}
              />
            </FieldBlock>
          </>
        ) : null}

        {action === "claim" || action === "mergeBudget" ? (
          <>
            <NoteSelect
              label={t("shielded.fields.budgetNote")}
              notes={available.budgets}
              selectedValue={budgetSelection}
              onChange={setBudgetSelection}
              decimals={modules.tokenDecimals}
              showAmount
            />
            {action === "mergeBudget" ? (
              <NoteSelect
                label={t("shielded.fields.secondBudgetNote")}
                notes={available.budgets}
                selectedValue={secondBudgetSelection}
                onChange={setSecondBudgetSelection}
                decimals={modules.tokenDecimals}
                showAmount
              />
            ) : (
              <>
                {selected(available.budgets, budgetSelection) ? (
                  <p className="text-sm text-ink-muted">
                    {t("shielded.selectedBudget", {
                      amount: noteAmount(selected(available.budgets, budgetSelection)!),
                    })}
                  </p>
                ) : null}
                <FieldBlock
                  label={t("shielded.fields.claimIndices")}
                  hint={t("shielded.claimIndicesHint")}
                >
                  <input
                    className={INPUT_CLASS}
                    value={claimIndices}
                    onChange={(event) => setClaimIndices(event.target.value)}
                    placeholder="0,1,2"
                  />
                </FieldBlock>
              </>
            )}
          </>
        ) : null}

        {action === "privateTransfer" ? (
          <>
            <NoteSelect
              label={t("shielded.fields.valueNote")}
              notes={available.values}
              selectedValue={valueSelection}
              onChange={setValueSelection}
              decimals={modules.tokenDecimals}
              showAmount
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
                  (note) => note.commitment !== selected(available.values, valueSelection)?.commitment,
                )}
                selectedValue={secondValueSelection}
                onChange={setSecondValueSelection}
                decimals={modules.tokenDecimals}
                showAmount
              />
            ) : null}
            <FieldBlock label={t("shielded.fields.recipientPersonHash")}>
              <input
                className={INPUT_CLASS}
                value={transferPersonHash}
                onChange={(event) => setTransferPersonHash(event.target.value)}
                placeholder="0x…"
              />
            </FieldBlock>
            <FieldBlock label={t("shielded.fields.transferAmount")}>
              <input
                className={INPUT_CLASS}
                inputMode="decimal"
                value={transferAmount}
                onChange={(event) => setTransferAmount(event.target.value)}
              />
            </FieldBlock>
          </>
        ) : null}

        {action === "unshield" ? (
          <>
            <NoteSelect
              label={t("shielded.fields.valueNote")}
              notes={available.values}
              selectedValue={valueSelection}
              onChange={setValueSelection}
              decimals={modules.tokenDecimals}
              showAmount
            />
            <FieldBlock label={t("shielded.fields.amount")}>
              <input
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
                className={INPUT_CLASS}
                value={exitRecipient}
                onChange={(event) => setExitRecipient(event.target.value)}
                placeholder="0x…"
              />
            </FieldBlock>
          </>
        ) : null}

        {isPrivate ? (
          <label className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={privateWalletChecked}
              onChange={(event) => setPrivateWalletChecked(event.target.checked)}
            />
            <span>{t("shielded.privateWalletCheck")}</span>
          </label>
        ) : null}
        <PanelButton
          variant="primary"
          busy={busy}
          disabled={busy}
          onClick={() => void submitSelected()}
        >
          {t("shielded.submit", { action: labels[action] })}
        </PanelButton>
        {busy ? (
          <p role="status" className="text-sm text-ink-muted">
            {stage}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {error}
            {transactionHash ? <span className="mt-2 block font-mono text-xs">{transactionHash}</span> : null}
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
      </PanelShell>
      {registrySnapshot ? (
        <p className="text-xs text-ink-muted">
          {t("shielded.registrySummary", { count: registrySnapshot.keys.size })}
        </p>
      ) : null}
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
