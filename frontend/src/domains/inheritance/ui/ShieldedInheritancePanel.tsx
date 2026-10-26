import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  getAddress,
  parseUnits,
  ZeroAddress,
  type ContractTransactionResponse,
  type Signer,
} from "ethers";
import { KeyRound, LockOpen, QrCode, ShieldCheck } from "lucide-react";
import { ReceiveChain } from "../../../shared/clients/receiveChain";
import {
  readLatestEncryptedWalletBackup,
  saveEncryptedWalletBackup,
} from "../../../shared/clients/walletBackupStore";
import type { ReceiveWorkerContext } from "../../../shared/workers/receiveWorkerClient";
import type {
  WalletLetterView,
  WalletNoteView,
  WalletQualificationView,
  WalletStateView,
} from "../../../shared/workers/walletWorkerTypes";
import { decodeBudgetRule } from "../../../shared/zk/budgetRule";
import { normalizeFriendlyError } from "../../../shared/lib/errors";
import { CopyIconButton } from "../../../shared/ui";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { parseShieldedPeriodDays } from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount, getShieldedAvatarText } from "../model/shieldedDisplay";
import { useShieldedWalletSession } from "./ShieldedWalletSessionContext";
import { ShieldedTaskNavigation, type ShieldedTask } from "./ShieldedTaskNavigation";
import { ShieldedAssetOverview, type ShieldedWalletSheetState } from "./ShieldedAssetOverview";
import { ShieldedWalletActions } from "./ShieldedWalletActions";
import { ShieldedSpendReview, type ShieldedSpendPlan } from "./ShieldedSpendReview";
import { ShieldedFundComposer } from "./ShieldedFundComposer";
import { ShieldedClaimComposer, buildShieldedClaimSchedule } from "./ShieldedClaimComposer";
import { ShieldedRuleComposer } from "./ShieldedRuleComposer";
import { PrivateLettersPanel } from "./PrivateLettersPanel";
import { QualificationManager, type QualificationOperation } from "./QualificationManager";
import {
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
import {
  CHOICE_INPUT,
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  PanelButton,
  TaskHeader,
  WarningNotice,
  choiceCardClass,
  shortHex,
} from "./inheritanceControls";

export interface ShieldedPanelNavigation {
  action: ShieldedTask;
  /** The first recovery or a user choice has settled the task; later pools keep it. */
  taskChosen?: boolean;
}

type TransactionStatus = {
  label: string;
  hash?: string;
  result?: "success" | "failed" | "unknown";
};
type LetterDelivery = {
  status: "sending" | "failed" | "sent";
  code: string;
  body: string;
  hash?: string;
};

const SECONDS_PER_DAY = 86_400;
const MAX_CODE_LIFETIME_DAYS = 3650;
const DEFAULT_CODE_LIFETIME_DAYS = 365;

function localDateTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function downloadBackup(bytes: Uint8Array, chainId: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `wallet-${chainId}-${Date.now()}.dfwallet`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** React keeps public handles and display amounts. Keys and note openings stay in the wallet Worker. */
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
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const formId = useId();
  const session = useShieldedWalletSession();
  const { context } = modules;
  const decimals = modules.tokenDecimals ?? 0;
  const symbol = modules.assetSymbol;
  const current = useRef({ context, signer, account, session });
  current.current = { context, signer, account, session };
  const operationSequence = useRef(0);
  const busyRef = useRef(false);
  const accessRegion = useRef<HTMLDivElement>(null);
  const taskRegion = useRef<HTMLElement>(null);
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const state = session.state;

  const [notes, setNotes] = useState<WalletNoteView[] | null>(null);
  const [letters, setLetters] = useState<WalletLetterView[] | null>(null);
  const [qualifications, setQualifications] = useState<WalletQualificationView[]>([]);
  const [selectedQualifications, setSelectedQualifications] = useState<number[]>([]);
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<ShieldedProgressStage | null>(null);
  const [transaction, setTransaction] = useState<TransactionStatus | null>(null);
  const [sheet, setSheet] = useState<ShieldedWalletSheetState | null>(null);
  const [action, setAction] = useState<ShieldedTask>(navigation?.action ?? "shield");
  const [taskChosen, setTaskChosen] = useState(navigation?.taskChosen ?? false);
  const taskChosenRef = useRef(taskChosen);
  taskChosenRef.current = taskChosen;
  useEffect(() => {
    onNavigationChange?.({ action, taskChosen });
  }, [action, taskChosen, onNavigationChange]);

  const [password, setPassword] = useState("");
  const [backupFile, setBackupFile] = useState<Uint8Array | null>(null);
  const [walletKind, setWalletKind] = useState<"ordinary" | "family">("ordinary");
  const [codeExpiry, setCodeExpiry] = useState(() =>
    localDateTime(Date.now() + DEFAULT_CODE_LIFETIME_DAYS * SECONDS_PER_DAY * 1000),
  );
  const [ownCode, setOwnCode] = useState("");
  const [amounts, setAmounts] = useState<Partial<Record<ShieldedTask, string>>>({});
  const amount = amounts[action] ?? "";
  const setAmount = (value: string) => setAmounts((previous) => ({ ...previous, [action]: value }));
  const [recipientCode, setRecipientCode] = useState("");
  const [withdrawalRecipient, setWithdrawalRecipient] = useState(account);
  const [noteHandle, setNoteHandle] = useState("");
  const [spendPlan, setSpendPlan] = useState<ShieldedSpendPlan | null>(null);
  const [spendRunning, setSpendRunning] = useState(false);
  const [rule, setRule] = useState("");
  const [periods, setPeriods] = useState("1");
  const [fundCode, setFundCode] = useState("");
  const [letterEnabled, setLetterEnabled] = useState(false);
  const [letterBody, setLetterBody] = useState("");
  const [delivery, setDelivery] = useState<LetterDelivery | null>(null);
  const [claimHandle, setClaimHandle] = useState("");
  const claimHandleRef = useRef(claimHandle);
  claimHandleRef.current = claimHandle;
  const [claimPeriods, setClaimPeriods] = useState<string[]>([]);
  const [ruleCredential, setRuleCredential] = useState("0");
  const [ruleRate, setRuleRate] = useState("");
  const [rulePeriodDays, setRulePeriodDays] = useState("30");
  const [createdRule, setCreatedRule] = useState("");
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  const setBusy = (value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
    current.current.session.setBusy(value);
  };
  const errorMessage = (failure: unknown) => {
    const friendly = normalizeFriendlyError(failure, t);
    return friendly.type === "UNKNOWN_ERROR"
      ? failure instanceof Error
        ? failure.message
        : t("shielded.unknownError")
      : friendly.message;
  };
  const run = async (operation: () => Promise<void>, label = "") => {
    const sequence = ++operationSequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    setStage(label);
    setProgress(null);
    try {
      await operation();
    } catch (failure) {
      if (operationSequence.current !== sequence) return;
      setError(errorMessage(failure));
    } finally {
      if (operationSequence.current === sequence) {
        setBusy(false);
        setStage("");
        setProgress(null);
      }
    }
  };
  const worker = () => current.current.session.worker();
  const scopeOf = (value: ReceiveWorkerContext) => ({
    chainId: String(value.deployment.chainId),
    registryAddress: value.deployment.registryAddress,
  });
  const saveBackup = async (result: { backup: Uint8Array; state: WalletStateView }) => {
    const { session: active, context: scope } = current.current;
    const epoch = active.epoch.current;
    await saveEncryptedWalletBackup(scopeOf(scope), result.backup);
    if (epoch !== current.current.session.epoch.current)
      throw new Error(t("shielded.walletChanged"));
    downloadBackup(result.backup, String(scope.deployment.chainId));
    current.current.session.setState(result.state);
  };
  const refreshQualifications = async () => {
    const result = await worker().call("walletReadQualifications", {}, current.current.context);
    setQualifications(result.qualifications);
    setSelectedQualifications(
      result.qualifications.filter((item) => item.selected).map((item) => item.index),
    );
    // A new rule defaults to a qualification that is still current.
    setRuleCredential((previous) =>
      result.qualifications.some((item) => item.current && String(item.index) === previous)
        ? previous
        : String(
            (result.qualifications.find((item) => item.current) ?? result.qualifications[0])
              ?.index ?? 0,
          ),
    );
  };
  const selectClaim = (handle: string, budgets: readonly WalletNoteView[]) => {
    const budget = budgets.find((item) => item.handle === handle);
    setClaimHandle(budget?.handle ?? "");
    setClaimPeriods(budget?.claimPeriod !== undefined ? [budget.claimPeriod] : []);
  };
  const recover = async () => {
    const epoch = current.current.session.epoch.current;
    setRecovering(true);
    try {
      const result = await worker().call("walletRecover", {}, current.current.context);
      if (epoch !== current.current.session.epoch.current) return;
      current.current.session.setState(result.state);
      setNow(BigInt(Math.floor(Date.now() / 1000)));
      setNotes(result.notes);
      setLetters(result.letters);
      const values = result.notes.filter(
        (note) => note.kind === "value" && BigInt(note.amount) > 0n,
      );
      const budgets = result.notes.filter((note) => note.kind === "budget");
      setNoteHandle((previous) =>
        values.some((note) => note.handle === previous) ? previous : "",
      );
      // A claimed budget is re-issued under a new handle; the next claimable one takes its place.
      selectClaim(
        (
          budgets.find((budget) => budget.handle === claimHandleRef.current) ??
          budgets.find((budget) => budget.claimPeriod !== undefined) ??
          budgets[0]
        )?.handle ?? "",
        budgets,
      );
      if (!taskChosenRef.current) {
        setTaskChosen(true);
        setAction(budgets.length ? "claim" : values.length ? "privateTransfer" : "shield");
      }
      await refreshQualifications();
    } finally {
      setRecovering(false);
    }
  };
  /** After a confirmed transaction, a failed refresh must not invite a second submission. */
  const refreshAfterTransaction = async () => {
    try {
      await recover();
    } catch (failure) {
      throw new Error(t("shielded.confirmedRefreshFailed", { detail: errorMessage(failure) }));
    }
  };

  // A panel opened on an unlocked wallet, such as after choosing another asset, reads this pool.
  // Leaving mid-operation cancels it: a pending proof or signature never reaches the chain.
  const mounted = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    mounted.current = true;
    if (current.current.session.state.unlocked && notesRef.current === null)
      void run(recover, t("shielded.stages.recovering"));
    return () => {
      mounted.current = false;
      ++operationSequence.current;
      const wasBusy = busyRef.current;
      busyRef.current = false;
      // Development replays effects on the same instance; only a real unmount cancels.
      setTimeout(() => {
        if (!mounted.current && wasBusy) current.current.session.lock();
      }, 0);
    };
  }, []);
  const wasUnlocked = useRef(state.unlocked);
  useEffect(() => {
    if (wasUnlocked.current && !state.unlocked) {
      ++operationSequence.current;
      busyRef.current = false;
      setBusyState(false);
      setNotes(null);
      setLetters(null);
      setQualifications([]);
      setSelectedQualifications([]);
      setPassword("");
      setOwnCode("");
      setSheet(null);
      setSpendPlan(null);
      setSpendRunning(false);
      setDelivery(null);
      setCreatedRule("");
      setRecovering(false);
      setStage("");
      setProgress(null);
      setTransaction(null);
      if (document.visibilityState === "visible")
        accessRegion.current?.focus({ preventScroll: true });
    }
    wasUnlocked.current = state.unlocked;
  }, [state.unlocked]);

  const parseAmount = (value: string): bigint => {
    let parsed = 0n;
    try {
      parsed =
        modules.tokenDecimals === null
          ? /^[1-9]\d*$/u.test(value.trim())
            ? BigInt(value.trim())
            : 0n
          : parseUnits(value.trim(), decimals);
    } catch {
      parsed = 0n;
    }
    if (parsed <= 0n) throw new Error(tr("amountInvalid"));
    return parsed;
  };
  const parsePositive = (value: string) => {
    try {
      return parseAmount(value);
    } catch {
      return undefined;
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t("common.copyFailed"));
    }
  };

  const createWallet = () =>
    run(async () => {
      if (password.length < 12) throw new Error(t("walletProtocol.passwordLength"));
      const rawPassphrase = password;
      setPassword("");
      const form = identityForm.current;
      if (walletKind === "family" && (!form || !form.passphrasesMatch()))
        throw new Error(t("walletProtocol.identityConfirmation"));
      const identity =
        walletKind === "family"
          ? {
              fields: form!.getRawIdentityFields(),
              rawPassphrase: form!.getSecretInputs().passphrase,
            }
          : undefined;
      form?.clearSecretInputs();
      const result = await worker().call(
        "walletCreate",
        { rawPassphrase, ...(identity ? { identity } : {}) },
        context,
      );
      await saveBackup(result);
      setNotes([]);
      setLetters([]);
      setQualifications([]);
      setSelectedQualifications([]);
      setNotice(t("walletProtocol.created"));
    }, tr("unlocking"));
  const restoreWallet = () =>
    run(async () => {
      if (!backupFile) throw new Error(t("walletProtocol.chooseBackup"));
      const rawPassphrase = password;
      setPassword("");
      const result = await worker().call(
        "walletRestore",
        { backup: backupFile, rawPassphrase },
        context,
      );
      current.current.session.setState(result.state);
      setBackupFile(null);
      await recover();
      setNotice(t("walletProtocol.restored"));
    }, tr("unlocking"));
  const loadLocalBackup = () =>
    run(async () => {
      const recovered = await readLatestEncryptedWalletBackup(scopeOf(context));
      if (!recovered) throw new Error(t("walletProtocol.noLocalBackup"));
      setBackupFile(recovered);
      setNotice(t("walletProtocol.localBackupLoaded"));
    });
  const backup = () =>
    run(async () => {
      if (password.length < 12) throw new Error(t("walletProtocol.passwordLength"));
      const rawPassphrase = password;
      setPassword("");
      const result = await worker().call("walletBackup", { rawPassphrase }, context);
      await saveBackup(result);
      setNotice(t("walletProtocol.backedUp"));
    });
  const generateCode = () =>
    run(
      async () => {
        if (password.length < 12) throw new Error(t("walletProtocol.passwordLength"));
        const expiresAt = Math.floor(new Date(codeExpiry).getTime() / 1000);
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds)
          throw new Error(t("shielded.privateLetters.expiryFuture"));
        if (expiresAt > nowSeconds + MAX_CODE_LIFETIME_DAYS * SECONDS_PER_DAY)
          throw new Error(t("walletProtocol.invalidExpiry"));
        const rawPassphrase = password;
        setPassword("");
        const result = await worker().call(
          "walletCreateCode",
          {
            expiresAt: String(expiresAt),
            rawPassphrase,
            credentialIndices: selectedQualifications,
          },
          context,
        );
        await saveBackup(result);
        setOwnCode(result.code);
      },
      t("shielded.stages.receiveCode", { symbol }),
    );
  const lock = () => {
    ++operationSequence.current;
    current.current.session.lock();
  };

  /** A chain client whose every signature first checks that nothing changed since preparation. */
  const openChain = () => {
    const expected = current.current;
    const epoch = expected.session.epoch.current;
    if (!expected.signer) throw new Error(t("shielded.walletNotReady", { symbol }));
    const assertCurrent = () => {
      const actual = current.current;
      if (
        !mounted.current ||
        actual.session.epoch.current !== epoch ||
        actual.signer !== expected.signer ||
        actual.account !== expected.account ||
        actual.context.deployment.poolAddress !== expected.context.deployment.poolAddress
      )
        throw new Error(t("shielded.walletChanged"));
    };
    const chain = new ReceiveChain(expected.context.deployment, expected.signer, {
      beforeTransaction: () => {
        assertCurrent();
        setProgress("submitting");
      },
    });
    return { expected, assertCurrent, chain };
  };
  const transact = async <P,>(
    label: string,
    prepare: (scope: ReceiveWorkerContext) => Promise<P>,
    send: (chain: ReceiveChain, prepared: P) => Promise<ContractTransactionResponse>,
  ): Promise<string> => {
    const { expected, assertCurrent, chain } = openChain();
    setTransaction(null);
    setProgress("proving");
    const prepared = await prepare(expected.context);
    assertCurrent();
    setProgress("checkingGas");
    const sent = await send(chain, prepared);
    setTransaction({ label, hash: sent.hash });
    setProgress("confirming");
    let receipt;
    try {
      receipt = await sent.wait();
    } catch (failure) {
      setTransaction({ label, hash: sent.hash, result: "unknown" });
      throw failure;
    }
    assertCurrent();
    if (!receipt || receipt.status !== 1) {
      setTransaction({ label, hash: sent.hash, result: "failed" });
      throw new Error(t("shielded.transactionFailed", { hash: sent.hash }));
    }
    setTransaction({ label, hash: sent.hash, result: "success" });
    return sent.hash;
  };
  const sendLetterTransaction = (code: string, body: string) =>
    transact(
      t("shielded.privateLetters.send"),
      (scope) =>
        worker().call(
          "prepareLetter",
          {
            code,
            body,
            asOf: String(Math.floor(Date.now() / 1000)),
            messageId: BigInt(crypto.getRandomValues(new BigUint64Array(1))[0]) || 1n,
          },
          scope,
        ),
      (chain, message) => chain.sendLetter(message),
    );

  const values = (notes ?? []).filter((note) => note.kind === "value" && BigInt(note.amount) > 0n);
  const budgets = (notes ?? []).filter((note) => note.kind === "budget");
  const valueBalances = values.map((note) => ({ commitment: note.handle, amount: note.amount }));
  const available = values.reduce((sum, note) => sum + BigInt(note.amount), 0n);
  const budgetTotal = budgets.reduce((sum, note) => sum + BigInt(note.amount), 0n);
  const selectedValue = values.find((note) => note.handle === noteHandle);
  const claimablePeriods = budgets.filter((budget) => budget.claimPeriod !== undefined).length;
  const hiddenTasks: ShieldedTask[] = qualifications.length ? [] : ["rule"];
  const walletName = t(
    state.identity ? "walletProtocol.familyWallet" : "walletProtocol.ordinaryWallet",
  );
  const lettersConfigured = !!context.deployment.lettersAddress;
  const submitLabel = (task: ShieldedTask) =>
    t("shielded.submit", { symbol, action: t(`shielded.actions.${task}`, { symbol }) });
  const decodedRule = useMemo(() => {
    try {
      const { policy } = decodeBudgetRule(rule);
      return { rate: policy.rate, periodDays: policy.periodDays };
    } catch {
      return undefined;
    }
  }, [rule]);
  // A task the recovered wallet cannot use falls back to funding, its neighbour in the rail.
  useEffect(() => {
    if (state.unlocked && notes && hiddenTasks.includes(action)) setAction("fund");
  });

  function navigateToAction(next: ShieldedTask) {
    setTaskChosen(true);
    if (next === action) return;
    setAction(next);
    setSpendPlan(null);
    setError("");
    setNotice("");
    setTransaction(null);
    requestAnimationFrame(() => taskRegion.current?.focus({ preventScroll: true }));
  }

  const submitShield = () =>
    run(async () => {
      const value = parseAmount(amount);
      await transact(
        t("shielded.actions.shield", { symbol }),
        (scope) => worker().call("walletPrepareShield", { amount: String(value) }, scope),
        (chain, prepared) => chain.sendShield(prepared),
      );
      setAmounts((previous) => ({ ...previous, shield: "" }));
      await refreshAfterTransaction();
    });
  const previewSpend = () => {
    setError("");
    try {
      if (action !== "privateTransfer" && action !== "unshield") return;
      const value = parseAmount(amount);
      if (!selectedValue) throw new Error(t("shielded.valueSelectionRequired", { symbol }));
      if (BigInt(selectedValue.amount) < value)
        throw new Error(t("shielded.amountExceedsNotes", { symbol }));
      let recipientLabel = shortHex(recipientCode.trim());
      if (action === "unshield") {
        let recipient = ZeroAddress;
        try {
          recipient = getAddress(withdrawalRecipient.trim());
        } catch {
          // Reported below as an invalid recipient.
        }
        if (recipient === ZeroAddress)
          throw new Error(t("shielded.invalidExitRecipient", { symbol }));
        recipientLabel = shortHex(recipient);
      }
      setSpendPlan({
        key: `${Date.now()}`,
        action,
        amount: value,
        inputIndex: values.indexOf(selectedValue) + 1,
        inputAmount: BigInt(selectedValue.amount),
        recipientLabel,
      });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const confirmSpend = () => {
    const plan = spendPlan;
    if (!plan) return;
    setSpendRunning(true);
    void run(async () => {
      try {
        if (plan.action === "privateTransfer") {
          await transact(
            t("shielded.actions.privateTransfer", { symbol }),
            (scope) =>
              worker().call(
                "walletPrepareTransfer",
                { amount: String(plan.amount), code: recipientCode.trim(), noteHandle },
                scope,
              ),
            (chain, prepared) => chain.sendTransfer(prepared, prepared.inputShardId),
          );
          setRecipientCode("");
        } else {
          await transact(
            t("shielded.actions.unshield", { symbol }),
            (scope) =>
              worker().call(
                "walletPrepareUnshield",
                {
                  amount: String(plan.amount),
                  recipient: getAddress(withdrawalRecipient.trim()),
                  noteHandle,
                },
                scope,
              ),
            (chain, prepared) => chain.sendUnshield(prepared),
          );
        }
        setAmounts((previous) => ({ ...previous, [plan.action]: "" }));
        setNoteHandle("");
        await refreshAfterTransaction();
      } finally {
        setSpendRunning(false);
        setSpendPlan(null);
      }
    });
  };
  const deliverLetter = async (code: string, body: string) => {
    setDelivery({ status: "sending", code, body });
    try {
      const hash = await sendLetterTransaction(code, body);
      setDelivery({ status: "sent", code, body, hash });
    } catch (failure) {
      setDelivery({ status: "failed", code, body });
      throw failure;
    }
  };
  const submitFund = () =>
    run(async () => {
      const code = fundCode.trim();
      const body = letterEnabled ? letterBody : "";
      if (letterEnabled && !body.trim()) throw new Error(t("shielded.privateLetters.bodyRequired"));
      await transact(
        t("shielded.actions.fund", { symbol }),
        (scope) =>
          worker().call(
            "walletPrepareDeposit",
            { code, rule: rule.trim(), budgetPeriods: periods.trim(), noteHandle },
            scope,
          ),
        (chain, prepared) => chain.sendDeposit(prepared, prepared.inputShardId),
      );
      setFundCode("");
      setLetterBody("");
      setLetterEnabled(false);
      setNoteHandle("");
      try {
        if (body) await deliverLetter(code, body);
      } finally {
        await refreshAfterTransaction();
      }
    });
  const retryLetter = () => {
    const pending = delivery;
    if (pending) void run(() => deliverLetter(pending.code, pending.body));
  };
  const submitClaim = () =>
    run(async () => {
      const budget = budgets.find((item) => item.handle === claimHandle);
      if (!budget || budget.claimPeriod === undefined || !claimPeriods.includes(budget.claimPeriod))
        throw new Error(t("shielded.claimSelectionRequired", { symbol }));
      await transact(
        t("shielded.actions.claim", { symbol }),
        (scope) =>
          worker().call(
            "walletPrepareClaim",
            { noteHandle: budget.handle, periodIndex: budget.claimPeriod },
            scope,
          ),
        (chain, prepared) => chain.sendClaim(prepared, prepared.inputShardId),
      );
      await refreshAfterTransaction();
    });
  const createRule = () =>
    run(async () => {
      const days = parseShieldedPeriodDays(rulePeriodDays);
      if (days === undefined) return;
      const result = await worker().call(
        "walletCreateRule",
        {
          credentialIndex: Number(ruleCredential),
          rate: String(parseAmount(ruleRate)),
          periodDays: String(days),
        },
        context,
      );
      setCreatedRule(result.rule);
    });
  const sendLetter = async (code: string, body: string) => {
    let sent = false;
    await run(async () => {
      await sendLetterTransaction(code, body);
      sent = true;
    });
    return sent;
  };
  const qualificationOperation = (): QualificationOperation => {
    const expected = current.current;
    const epoch = expected.session.epoch.current;
    const activeWorker = expected.session.worker();
    const assertCurrent = () => {
      const actual = current.current;
      if (
        !mounted.current ||
        actual.session.epoch.current !== epoch ||
        actual.signer !== expected.signer ||
        actual.account !== expected.account ||
        actual.context.rpcUrl !== expected.context.rpcUrl ||
        actual.context.deployment.registryAddress !== expected.context.deployment.registryAddress ||
        actual.context.deployment.poolAddress !== expected.context.deployment.poolAddress
      )
        throw new Error(t("shielded.walletChanged"));
    };
    return {
      worker: activeWorker,
      context: expected.context,
      account: expected.account,
      assertCurrent,
      chain: expected.signer
        ? new ReceiveChain(expected.context.deployment, expected.signer, {
            beforeTransaction: assertCurrent,
          })
        : null,
    };
  };

  const errorNotice = error ? (
    <p role="alert" className="break-words text-sm text-danger">
      {error}
    </p>
  ) : null;
  const transactionStatus = transaction ? (
    <p
      role="status"
      className="break-all rounded-xl bg-surface-alt px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted"
    >
      {`${transaction.label} · `}
      {transaction.hash ? `${tr("transactionHash")}: ${transaction.hash} · ` : ""}
      {t(
        !transaction.result
          ? "transaction.pending"
          : transaction.result === "unknown"
            ? "transaction.unknown"
            : transaction.result === "failed"
              ? "transaction.failed"
              : "transaction.success",
      )}
    </p>
  ) : null;
  // A confirmed spend plan shows its own progress inside the step being sent.
  const progressList =
    busy && progress && !spendRunning ? (
      <div role="status">
        <ShieldedProgressList stage={progress} />
      </div>
    ) : null;
  const taskFeedback = (
    <>
      {progressList ??
        (stage && !spendRunning ? (
          <p role="status" className="text-sm text-ink-muted">
            {stage}
          </p>
        ) : null)}
      {errorNotice}
      {transactionStatus}
      {notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}
      {action === "fund" && delivery ? (
        <div className="space-y-3 rounded-xl bg-surface-alt p-4">
          <p role={delivery.status === "failed" ? "alert" : "status"} className="text-sm text-ink">
            {t(`shielded.privateLetters.delivery.${delivery.status}`)}
          </p>
          {delivery.hash ? (
            <p className="break-all text-xs text-ink-muted">
              {t("shielded.privateLetters.sent")}: {delivery.hash}
            </p>
          ) : null}
          {delivery.status === "failed" ? (
            <PanelButton disabled={busy || !signer} onClick={retryLetter}>
              {t("shielded.privateLetters.retryLetter")}
            </PanelButton>
          ) : null}
          {delivery.status !== "sending" ? (
            <PanelButton disabled={busy} size="compact" onClick={() => setDelivery(null)}>
              {t(
                delivery.status === "sent"
                  ? "shielded.privateLetters.finish"
                  : "shielded.privateLetters.later",
              )}
            </PanelButton>
          ) : null}
        </div>
      ) : null}
      {busy ? (
        <PanelButton size="compact" onClick={lock}>
          {t("walletProtocol.cancel")}
        </PanelButton>
      ) : null}
    </>
  );

  const accessTitleId = `${formId}-access-title`;
  if (!state.unlocked) {
    return (
      <div className="mx-auto w-full max-w-[45rem] space-y-6">
        {head}
        <div
          ref={accessRegion}
          tabIndex={-1}
          className="rounded-[20px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <section
            aria-labelledby={accessTitleId}
            className="min-w-0 rounded-[20px] border border-hairline bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-28px_rgba(15,23,42,0.2)] dark:shadow-none sm:p-8"
          >
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
              >
                <KeyRound className="h-[22px] w-[22px]" />
              </span>
              <div className="min-w-0 space-y-1.5">
                <h2 id={accessTitleId} className="ui-heading text-xl text-ink">
                  {t("walletProtocol.wallet")}
                </h2>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {t("walletProtocol.backupDescription")}
                </p>
              </div>
            </div>
            <div className="mt-7 space-y-6">
              <div className="space-y-2">
                <FieldBlock label={t("walletProtocol.backupFile")}>
                  <input
                    key={backupFile ? "chosen" : "empty"}
                    aria-label={t("walletProtocol.backupFile")}
                    type="file"
                    accept=".dfwallet,application/octet-stream"
                    className="block w-full min-w-0 text-sm text-ink-muted file:mr-3 file:h-9 file:rounded-lg file:border file:border-hairline-strong file:bg-surface file:px-3 file:text-xs file:font-semibold file:text-ink"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void file
                          .arrayBuffer()
                          .then((bytes) => setBackupFile(new Uint8Array(bytes)));
                    }}
                  />
                </FieldBlock>
                <div className="flex flex-wrap gap-2">
                  <PanelButton
                    size="compact"
                    disabled={busy}
                    onClick={() => void loadLocalBackup()}
                  >
                    {t("walletProtocol.localBackup")}
                  </PanelButton>
                  {backupFile ? (
                    <PanelButton
                      size="compact"
                      disabled={busy}
                      onClick={() => {
                        setBackupFile(null);
                        setNotice("");
                      }}
                    >
                      {t("common.cancel")}
                    </PanelButton>
                  ) : null}
                </div>
              </div>
              {!backupFile ? (
                <>
                  <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={busy}>
                    <legend className="mb-2 text-[13px] font-medium text-ink/80">
                      {t("walletProtocol.walletKind")}
                    </legend>
                    {(["ordinary", "family"] as const).map((kind) => {
                      const selected = kind === walletKind;
                      return (
                        <label
                          key={kind}
                          className={`flex flex-col gap-1.5 px-3.5 py-3 ${choiceCardClass(selected, busy)}`}
                        >
                          <span className="flex items-center gap-3">
                            <input
                              type="radio"
                              name={`${formId}-wallet-kind`}
                              className={CHOICE_INPUT}
                              checked={selected}
                              onChange={() => setWalletKind(kind)}
                            />
                            <span className="flex-1 text-sm font-semibold text-ink">
                              {t(`walletProtocol.${kind}Wallet`)}
                            </span>
                          </span>
                          {selected ? (
                            <span className="pl-7 text-[13px] leading-relaxed text-ink-muted">
                              {t(`walletProtocol.${kind}WalletDescription`)}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </fieldset>
                  {walletKind === "family" ? (
                    <PersonHashCalculator
                      ref={identityForm}
                      computeHash={false}
                      requirePassphraseConfirmation
                      showTitle={false}
                      collapsible={false}
                      showPassphraseGuidance={false}
                      className="border-0 bg-transparent p-0 shadow-none"
                    />
                  ) : null}
                </>
              ) : null}
              <FieldBlock label={t("walletProtocol.backupPassword")}>
                <input
                  aria-label={t("walletProtocol.backupPassword")}
                  className={FIELD_INPUT}
                  type="password"
                  value={password}
                  autoComplete={backupFile ? "current-password" : "new-password"}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FieldBlock>
              <PanelButton
                variant="primary"
                size="hero"
                className="w-full"
                busy={busy}
                disabled={busy}
                onClick={() => void (backupFile ? restoreWallet() : createWallet())}
              >
                {busy ? null : <LockOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
                <span role="status">
                  {busy
                    ? stage || tr("unlocking")
                    : t(backupFile ? "walletProtocol.restore" : "walletProtocol.create")}
                </span>
              </PanelButton>
              {errorNotice}
              {notice ? (
                <p role="status" className="text-sm text-ink-muted">
                  {notice}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const taskTitleId = `${formId}-task-title`;
  const signerNotice = !signer ? (
    <WarningNotice>{t("shielded.walletNotReady", { symbol })}</WarningNotice>
  ) : null;
  const working = busy || recovering;
  let composer: ReactNode;
  let receipt: ReactNode = null;
  if (action === "writeLetter" || action === "letterInbox") {
    composer = (
      <>
        <PrivateLettersPanel
          mode={action === "writeLetter" ? "write" : "inbox"}
          titleId={taskTitleId}
          lettersConfigured={lettersConfigured}
          disabled={working}
          canSend={!!signer}
          letters={letters}
          onRefresh={() => void run(recover, t("shielded.stages.recovering"))}
          onSend={sendLetter}
        />
        <div className="mt-4 space-y-3">{taskFeedback}</div>
      </>
    );
  } else if (action === "qualifications") {
    composer = (
      <>
        <TaskHeader id={taskTitleId} title={t("qualificationManager.title")} />
        <div className="mt-6">
          <QualificationManager
            busy={working}
            openOperation={qualificationOperation}
            run={(operation) => run(operation)}
            save={saveBackup}
            changed={refreshQualifications}
          />
        </div>
        <div className="mt-4 space-y-3">{taskFeedback}</div>
      </>
    );
  } else if (action === "rule") {
    composer = (
      <>
        <ShieldedRuleComposer
          titleId={taskTitleId}
          symbol={symbol}
          busy={working}
          qualifications={qualifications}
          credentialIndex={ruleCredential}
          onCredentialChange={(value) => {
            setRuleCredential(value);
            setCreatedRule("");
          }}
          rate={ruleRate}
          onRateChange={(value) => {
            setRuleRate(value);
            setCreatedRule("");
          }}
          periodDays={rulePeriodDays}
          onPeriodDaysChange={(value) => {
            setRulePeriodDays(value);
            setCreatedRule("");
          }}
          ready={
            parsePositive(ruleRate) !== undefined &&
            parseShieldedPeriodDays(rulePeriodDays) !== undefined &&
            qualifications.some((item) => String(item.index) === ruleCredential)
          }
          onCreate={() => void createRule()}
          rule={createdRule}
          onCopy={(value) => void copy(value)}
        />
        <div className="mt-4 space-y-3">{taskFeedback}</div>
      </>
    );
  } else if (action === "fund") {
    const fundingPeriods = /^[1-9][0-9]{0,19}$/.test(periods.trim())
      ? BigInt(periods.trim())
      : undefined;
    const total =
      decodedRule && fundingPeriods !== undefined ? decodedRule.rate * fundingPeriods : undefined;
    const deficit =
      total !== undefined && selectedValue && BigInt(selectedValue.amount) < total
        ? total - BigInt(selectedValue.amount)
        : undefined;
    composer = (
      <ShieldedFundComposer
        titleId={taskTitleId}
        symbol={symbol}
        decimals={decimals}
        busy={working || !!delivery}
        rule={rule}
        onRuleChange={setRule}
        rate={decodedRule?.rate}
        periodDays={decodedRule?.periodDays}
        periods={periods}
        onPeriodsChange={setPeriods}
        code={fundCode}
        onCodeChange={setFundCode}
        values={valueBalances}
        selected={noteHandle}
        onSelectedChange={setNoteHandle}
        letterEnabled={letterEnabled}
        onLetterEnabledChange={setLetterEnabled}
        letterBody={letterBody}
        onLetterBodyChange={setLetterBody}
        lettersConfigured={lettersConfigured}
      />
    );
    receipt = (
      <ShieldedFundReceipt
        symbol={symbol}
        decimals={decimals}
        walletName={walletName}
        available={notes ? available : undefined}
        rate={decodedRule?.rate}
        periods={fundingPeriods}
        days={decodedRule?.periodDays}
        notices={
          <>
            {deficit !== undefined ? (
              <WarningNotice>
                {t("shielded.fundingBalanceInsufficient", {
                  symbol,
                  amount: formatShieldedAmount(deficit, decimals),
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
              working ||
              !signer ||
              !!delivery ||
              !decodedRule ||
              fundingPeriods === undefined ||
              !fundCode.trim() ||
              !selectedValue ||
              deficit !== undefined ||
              (letterEnabled && !letterBody.trim())
            }
            onClick={() => void submitFund()}
          >
            {submitLabel("fund")}
          </PanelButton>
        }
      />
    );
  } else if (action === "claim") {
    const selectedBudget =
      budgets.find((budget) => budget.handle === claimHandle) ??
      budgets.find((budget) => budget.claimPeriod !== undefined) ??
      budgets[0];
    const schedule = selectedBudget ? buildShieldedClaimSchedule(selectedBudget, now) : [];
    const chosen =
      selectedBudget?.claimPeriod !== undefined && claimPeriods.includes(selectedBudget.claimPeriod)
        ? [selectedBudget.claimPeriod]
        : [];
    const total = selectedBudget && chosen.length ? BigInt(selectedBudget.rate ?? "0") : 0n;
    const nextDue = schedule.find((row) => row.kind !== "gap" && row.dueAt > now);
    const status = !notes
      ? t("shielded.claimOverview.checking", { symbol })
      : !selectedBudget
        ? t("shielded.claimOverview.noFunds", { symbol })
        : selectedBudget.claimPeriod !== undefined
          ? chosen.length
            ? t("shielded.claimOverview.claimable", {
                symbol,
                amount: formatShieldedAmount(total, decimals),
                periods: chosen.length,
              })
            : t("shielded.claimSelectionRequired", { symbol })
          : BigInt(selectedBudget.amount) < BigInt(selectedBudget.rate ?? "1")
            ? t("shielded.claimOverview.exhausted", { symbol })
            : t("shielded.claimOverview.notDue", { symbol });
    const segments = schedule.flatMap((row): ShieldedPeriodSegment[] =>
      row.kind === "claimable"
        ? [claimPeriods.includes(row.index) ? "selected" : "claimable"]
        : row.kind === "upcoming"
          ? ["upcoming"]
          : [],
    );
    composer = (
      <ShieldedClaimComposer
        titleId={taskTitleId}
        symbol={symbol}
        decimals={decimals}
        busy={working}
        budgets={notes ? budgets : null}
        now={now}
        claimHandle={selectedBudget?.handle ?? ""}
        onClaimChange={(handle) => selectClaim(handle, budgets)}
        claimPeriods={claimPeriods}
        onClaimPeriodsChange={setClaimPeriods}
      />
    );
    receipt = (
      <ShieldedClaimReceipt
        symbol={symbol}
        decimals={decimals}
        walletName={walletName}
        available={notes ? available : undefined}
        total={total}
        status={status}
        nextDue={
          nextDue && nextDue.kind !== "gap"
            ? t("shielded.claimOverview.nextDue", {
                symbol,
                date: new Date(Number(nextDue.dueAt) * 1000).toLocaleString(),
              })
            : undefined
        }
        segments={segments}
        budgetName={
          selectedBudget
            ? t("shielded.budgetOption", {
                symbol,
                index: budgets.indexOf(selectedBudget) + 1,
                amount: formatShieldedAmount(selectedBudget.amount, decimals),
              })
            : undefined
        }
        periods={chosen.map((index) => String(BigInt(index) + 1n))}
        notices={
          <>
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
            disabled={working || !signer || !chosen.length}
            onClick={() => void submitClaim()}
          >
            {submitLabel("claim")}
          </PanelButton>
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
        busy={working || !!spendPlan}
        amount={amount}
        onAmountChange={setAmount}
        code={recipientCode}
        onCodeChange={setRecipientCode}
        withdrawalRecipient={withdrawalRecipient}
        onWithdrawalRecipientChange={setWithdrawalRecipient}
        values={valueBalances}
        selected={noteHandle}
        onSelectedChange={setNoteHandle}
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
          available={notes ? available : undefined}
          amount={spendAmount}
          notices={notices}
          action={
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={working || !signer}
              onClick={() => void submitShield()}
            >
              {submitLabel("shield")}
            </PanelButton>
          }
        />
      );
    } else {
      const review = spendPlan ? (
        <ShieldedSpendReview
          plan={spendPlan}
          decimals={decimals}
          symbol={symbol}
          running={spendRunning}
          stage={progress}
          onConfirm={confirmSpend}
          onCancel={() => setSpendPlan(null)}
        />
      ) : undefined;
      receipt = (
        <ShieldedSpendReceipt
          spendAction={action}
          symbol={symbol}
          decimals={decimals}
          walletName={walletName}
          available={notes ? available : undefined}
          amount={spendAmount}
          recipient={
            action === "unshield" ? (
              withdrawalRecipient.trim() ? (
                <code className="font-mono" title={withdrawalRecipient.trim()}>
                  {shortHex(withdrawalRecipient.trim())}
                </code>
              ) : undefined
            ) : recipientCode.trim() ? (
              <code className="font-mono" title={recipientCode.trim()}>
                {shortHex(recipientCode.trim())}
              </code>
            ) : undefined
          }
          selection={
            selectedValue
              ? t("shielded.valueSelectionSummary", {
                  symbol,
                  count: 1,
                  amount: formatShieldedAmount(selectedValue.amount, decimals),
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
                working ||
                !signer ||
                !selectedValue ||
                (action === "privateTransfer" && !recipientCode.trim()) ||
                (action === "unshield" && !withdrawalRecipient.trim())
              }
              onClick={previewSpend}
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

  const receiveCodeContent = (
    <div role="group" aria-label={t("shielded.receiveCodeLabel", { symbol })} className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-muted">
        {t("walletProtocol.receiveDescription")}
      </p>
      {qualifications.length ? (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-[13px] font-medium text-ink/80">
            {t("walletProtocol.codeQualifications")}
          </legend>
          <p className="text-xs leading-relaxed text-ink-muted">
            {t("walletProtocol.codeQualificationsDescription")}
          </p>
          <div className="flex flex-col gap-1.5">
            {qualifications.map((item) => {
              const checked = selectedQualifications.includes(item.index);
              const disabled =
                busy || !item.current || (!checked && selectedQualifications.length >= 2);
              return (
                <label
                  key={item.index}
                  className={`flex min-h-10 items-center gap-2 px-3 text-[13px] text-ink ${choiceCardClass(checked, disabled)}`}
                >
                  <input
                    type="checkbox"
                    className={`${CHOICE_INPUT} rounded`}
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => {
                      setOwnCode("");
                      setSelectedQualifications((previous) =>
                        event.target.checked
                          ? [...previous, item.index]
                          : previous.filter((index) => index !== item.index),
                      );
                    }}
                  />
                  {t("walletProtocol.qualification", { index: item.index + 1 })}
                  {!item.current ? ` · ${t("walletProtocol.qualificationWithdrawn")}` : ""}
                </label>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            {t("walletProtocol.qualificationPrivacy")}
          </p>
        </fieldset>
      ) : null}
      <FieldBlock label={t("shielded.privateLetters.expiresAt")}>
        <input
          type="datetime-local"
          aria-label={t("shielded.privateLetters.expiresAt")}
          className={FIELD_INPUT}
          value={codeExpiry}
          disabled={busy}
          onChange={(event) => {
            setCodeExpiry(event.target.value);
            setOwnCode("");
          }}
        />
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
      ) : (
        <>
          <FieldBlock label={t("walletProtocol.backupPassword")}>
            <input
              aria-label={t("walletProtocol.backupPassword")}
              className={FIELD_INPUT}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </FieldBlock>
          {error ? <p className="break-words text-xs text-danger">{error}</p> : null}
          <PanelButton size="compact" disabled={working} onClick={() => void generateCode()}>
            {t("shielded.generateReceiveCode")}
          </PanelButton>
        </>
      )}
    </div>
  );
  const keysContent = (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-muted">
        {t("walletProtocol.backupDescription")}
      </p>
      {state.backupChanged ? (
        <WarningNotice>{t("walletProtocol.backupChanged")}</WarningNotice>
      ) : null}
      <FieldBlock label={t("walletProtocol.backupPassword")}>
        <input
          aria-label={t("walletProtocol.backupPassword")}
          className={FIELD_INPUT}
          type="password"
          value={password}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FieldBlock>
      <PanelButton variant="primary" busy={busy} disabled={working} onClick={() => void backup()}>
        {t("walletProtocol.backup")}
      </PanelButton>
      {errorNotice}
      {notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
  const openSheet = (next: ShieldedWalletSheetState) => {
    setError("");
    setNotice("");
    setPassword("");
    setSheet(next);
  };

  return (
    <div className="min-w-0 space-y-6 break-normal">
      {head}
      <ShieldedAssetOverview
        person={
          state.identity
            ? {
                name: state.identity.fullName,
                avatar: getShieldedAvatarText(state.identity.fullName),
                hash: state.identity.personHash,
                hashLabel: t("shielded.identityHash", { symbol }),
                copyLabel: t("shielded.copyIdentityHash", { symbol }),
                onCopy: () => void copy(state.identity!.personHash),
              }
            : { name: walletName }
        }
        assetControls={
          assetControls ? (
            <fieldset disabled={busy} className="min-w-0">
              {assetControls}
            </fieldset>
          ) : undefined
        }
        symbol={symbol}
        busy={working}
        onRecover={() => void run(recover, t("shielded.stages.recovering"))}
        onLock={lock}
        wallet={{
          family: !!state.identity,
          title: walletName,
          available: notes ? formatShieldedAmount(available, decimals) : "—",
          budget: notes ? formatShieldedAmount(budgetTotal, decimals) : "—",
          balanceState: recovering ? (notes ? "updating" : "loading") : undefined,
        }}
        onReceiveCode={() => openSheet("receiveCode")}
        onOpenKeys={() => openSheet("keys")}
        openSheet={sheet}
        footer={
          state.backupChanged ? (
            <WarningNotice>{t("walletProtocol.backupChanged")}</WarningNotice>
          ) : undefined
        }
      />
      {modules.tokenDecimals === null ? (
        <p className="text-xs text-ink-muted">{tr("rawUnits")}</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <ShieldedTaskNavigation
          action={action}
          busy={working}
          symbol={symbol}
          claimablePeriods={claimablePeriods}
          hidden={hiddenTasks}
          onActionChange={navigateToAction}
        />
        <div className="flex min-w-0 flex-[999_1_40rem] flex-wrap items-start gap-6">
          {/* A transfer or withdrawal leaves its wider receipt room for the step plan. */}
          <section
            ref={taskRegion}
            tabIndex={-1}
            aria-labelledby={taskTitleId}
            className={`min-w-0 ${
              action === "privateTransfer" || action === "unshield"
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
        open={sheet !== null}
        title={
          sheet === "receiveCode" ? t("shielded.receiveCodeLabel", { symbol }) : tr("keySettings")
        }
        icon={sheet === "receiveCode" ? QrCode : ShieldCheck}
        closeLabel={t("common.close")}
        onClose={() => setSheet(null)}
      >
        {sheet === "receiveCode" ? receiveCodeContent : sheet === "keys" ? keysContent : null}
      </ShieldedWalletSheet>
    </div>
  );
}
