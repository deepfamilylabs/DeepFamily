import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keccak256, type Provider, type Signer } from "ethers";
import { normalizeFriendlyError, type ChainFriendlyError } from "../../../shared/lib/errors";
import type { ShieldedAssetWorkerCallMap, ShieldedWorkerContext } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { shieldedAssetWorkerCall, subscribeShieldedAssetWorkerLock } from "../../../shared/workers/shieldedAssetWorkerClient";
import { getWalletConnectionGeneration, subscribeWalletConnectionChange } from "../../wallet";
import { checkPrivateLetter, PrivateLetterPreparationExpiredError, PrivateLetterTransactionFailedError, submitPrivateLetter, type ExpectedPrivateLetterRegistration, type ProvenPrivateLetter } from "../services/privateLetterChain";
import { FIELD_TEXTAREA, FieldBlock, PanelButton } from "./inheritanceControls";

export type PrivateLetterView = "write" | "inbox";
type LetterSubmission = ExpectedPrivateLetterRegistration & {
  transactionHash: string;
  state: "pending" | "confirmed" | "unknown" | "verificationFailed" | "failed";
};
type LetterStage = "preparing" | "checking" | "submitting" | "confirming" | "recovering";
const unresolved = (result: LetterSubmission | null) => !!result && ["pending", "unknown", "verificationFailed"].includes(result.state);
function expectedRegistration(letter: ProvenPrivateLetter): ExpectedPrivateLetterRegistration {
  return { messageId: letter.delivery.messageId, recipientBinding: letter.delivery.recipientBinding,
    deadline: letter.delivery.deadline, ciphertextHash: keccak256(letter.ciphertext) };
}

/** Standalone letters to a receive code, and the unlocked keys' inbox. */
export function PrivateLettersPanel(props: {
  mode: PrivateLetterView;
  titleId?: string;
  context: ShieldedWorkerContext; signer: Signer | null; provider?: Provider; disabled: boolean; recoveryReady: boolean;
  sessionScope?: string;
  onBusyChange?: (busy: boolean) => void; beginWalletRequest?: () => () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.privateLetters.${key}`);
  const [code, setCode] = useState("");
  const [body, setBody] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setErrorState] = useState<ChainFriendlyError | null>(null);
  const setError = useCallback((message: string, cause?: unknown) => {
    setErrorState(message ? normalizeFriendlyError(cause ?? new Error(message), t, { message }) : null);
  }, [t]);
  const [submission, setSubmission] = useState<LetterSubmission | null>(null);
  const [previousSubmissions, setPreviousSubmissions] = useState<LetterSubmission[]>([]);
  const [stage, setStage] = useState<LetterStage>("preparing");
  const [inbox, setInbox] = useState<ShieldedAssetWorkerCallMap["recoverLetters"]["result"] | null>(null);
  const prepared = useRef<ProvenPrivateLetter | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const activeOperation = useRef<"send" | "check" | "recover" | null>(null);
  const inboxScope = useRef<string | null>(null);
  const currentSigner = useRef(props.signer);
  currentSigner.current = props.signer;
  const previousSigner = useRef(props.signer);
  const busyChange = useRef(props.onBusyChange);
  busyChange.current = props.onBusyChange;
  const invalidateSending = useCallback(() => {
    setCode(""); setBody(""); prepared.current = null;
    setSubmission(value => value?.state === "pending" ? { ...value, state: "unknown" } : value);
    setPreviousSubmissions(items => items.map(value => value.state === "pending" ? { ...value, state: "unknown" as const } : value));
    if (activeOperation.current !== "send" && activeOperation.current !== "check") return;
    epoch.current++; activeOperation.current = null; setWorking(false);
    busyChange.current?.(false);
  }, []);
  const contextKey = JSON.stringify([props.context, props.sessionScope]);
  const contentScope = JSON.stringify([{ ...props.context, stateReadMode: undefined }, props.sessionScope]);
  const previousContextKey = useRef(contextKey);
  const previousContentScope = useRef(contentScope);
  useEffect(() => {
    mounted.current = true;
    // StrictMode replays effects on the same instance. Its pending inbox read
    // stays current, and reacquires the parent's busy state after cleanup.
    if (activeOperation.current) busyChange.current?.(true);
    return () => {
      mounted.current = false;
      if (activeOperation.current) busyChange.current?.(false);
    };
  }, []);
  useEffect(() => subscribeShieldedAssetWorkerLock(() => {
    const wasWorking = activeOperation.current !== null;
    epoch.current++; activeOperation.current = null; setCode(""); setBody(""); setInbox(null); setError(""); setSubmission(null); setPreviousSubmissions([]); prepared.current = null; setWorking(false);
    if (wasWorking) busyChange.current?.(false);
  }), []);
  useEffect(() => subscribeWalletConnectionChange(invalidateSending), [invalidateSending]);
  useEffect(() => {
    if (previousSigner.current === props.signer) return;
    previousSigner.current = props.signer;
    invalidateSending();
  }, [props.signer, invalidateSending]);
  useEffect(() => {
    if (previousContextKey.current === contextKey) return;
    previousContextKey.current = contextKey;
    // A read strategy preference cannot change an in-flight transaction. Keep
    // its callbacks and message number current until its result is known.
    if (previousContentScope.current === contentScope && (activeOperation.current === "send" || activeOperation.current === "check")) return;
    const wasWorking = activeOperation.current !== null;
    epoch.current++;
    activeOperation.current = null;
    // The read strategy changes neither the recipient nor the unlocked keys.
    // Keep their displayed content until the new read finishes.
    if (previousContentScope.current !== contentScope) {
      setCode(""); setBody(""); setInbox(null); setError(""); setSubmission(null); setPreviousSubmissions([]);
      prepared.current = null;
    } else {
      setSubmission(value => value?.state === "pending" ? { ...value, state: "unknown" } : value);
    }
    previousContentScope.current = contentScope;
    setWorking(false);
    if (wasWorking) busyChange.current?.(false);
  }, [contextKey, contentScope]);
  const busy = props.disabled || working;
  const reader = props.provider ?? props.signer?.provider;
  async function send() {
    if (props.mode !== "write" || !props.signer || !props.context.lettersAddress || busy || unresolved(submission)) return;
    const version = epoch.current;
    const walletGeneration = getWalletConnectionGeneration();
    const current = () => mounted.current && version === epoch.current && currentSigner.current === props.signer && walletGeneration === getWalletConnectionGeneration();
    let letter: ProvenPrivateLetter | null = prepared.current;
    let broadcastHash = "";
    let walletRequested = false;
    activeOperation.current = "send";
    setWorking(true); setStage(letter ? "checking" : "preparing"); props.onBusyChange?.(true); setError("");
    try {
      letter ??= await shieldedAssetWorkerCall("prepareLetter", {
        context: props.context, code, body,
      }, { timeoutMs: 1_200_000 });
      if (!current()) return;
      prepared.current = letter;
      setStage("checking");
      const result = await submitPrivateLetter({
        address: props.context.lettersAddress, signer: props.signer, chainId: props.context.chainId,
        letter, onWalletRequest: () => {
          walletRequested = true;
          if (current()) setStage("submitting");
          return props.beginWalletRequest?.() ?? (() => undefined);
        }, isCurrent: current,
        onStage: next => { if (next === "submitting") walletRequested = true; if (current()) setStage(next); },
        onBroadcast: (transactionHash) => {
          broadcastHash = transactionHash;
          if (current() && letter) { setStage("confirming"); setSubmission({ ...expectedRegistration(letter), transactionHash, state: "pending" }); }
        },
      });
      if (!current()) return;
      setSubmission({ ...expectedRegistration(letter), transactionHash: result.transactionHash, state: "confirmed" });
      setBody(""); setCode(""); prepared.current = null;
    } catch (cause) {
      if (current()) {
        const publicError = normalizeFriendlyError(cause, t);
        if (cause instanceof PrivateLetterPreparationExpiredError) {
          prepared.current = null; setSubmission(null); setError(tr("preparationExpired"), cause);
        } else if (cause instanceof PrivateLetterTransactionFailedError && letter) {
          setSubmission({ ...expectedRegistration(letter), transactionHash: cause.transactionHash, state: "failed" });
          prepared.current = null;
        } else if (letter && (publicError.transactionHash || broadcastHash || (walletRequested && ["unknown", "network", "verification"].includes(publicError.category)))) {
          setSubmission({ ...expectedRegistration(letter), transactionHash: publicError.transactionHash ?? broadcastHash,
            state: publicError.transactionConfirmed ? "verificationFailed" : "unknown" });
        } else {
          // Only explicit sending reaches the wallet. A rejected or unsubmitted
          // request stays editable; its prepared material does not imply a broadcast.
          setError(publicError.category === "cancelled" ? publicError.message : tr("sendFailed"), cause);
        }
      }
    }
    finally { if (mounted.current && version === epoch.current) { activeOperation.current = null; setWorking(false); busyChange.current?.(false); } }
  }
  async function check(previous?: LetterSubmission) {
    const original = previous ?? submission;
    if (props.mode !== "write" || !reader || !props.context.lettersAddress || busy || !unresolved(original)) return;
    const version = epoch.current;
    const walletGeneration = getWalletConnectionGeneration();
    const current = () => mounted.current && version === epoch.current && walletGeneration === getWalletConnectionGeneration();
    const update = (value: LetterSubmission) => {
      if (previous) setPreviousSubmissions(items => items.map(item => item.messageId === value.messageId ? value : item));
      else setSubmission(value);
    };
    activeOperation.current = "check";
    setWorking(true); setStage("checking"); props.onBusyChange?.(true); setError("");
    try {
      const result = await checkPrivateLetter({ address: props.context.lettersAddress, provider: reader,
        chainId: props.context.chainId, expected: original!, transactionHash: original!.transactionHash || undefined });
      if (!current() || result.state === "pending") return;
      update({ ...original!, state: result.state, transactionHash: result.transactionHash });
      if (!previous) {
        prepared.current = null;
        if (result.state === "confirmed") { setBody(""); setCode(""); }
      }
    } catch (cause) {
      if (current()) {
        const publicError = normalizeFriendlyError(cause, t);
        // Read failures and proof expiry do not discard or replace the original
        // message/hash. Only a verified original receipt can settle it.
        if (publicError.transactionConfirmed) update({ ...original!, state: "verificationFailed" });
      }
    }
    finally { if (mounted.current && version === epoch.current) { activeOperation.current = null; setWorking(false); busyChange.current?.(false); } }
  }
  function startNewLetter() {
    if (busy) return;
    if (submission && unresolved(submission)) setPreviousSubmissions(items => [...items, submission]);
    setSubmission(null); prepared.current = null; setCode(""); setBody(""); setError("");
  }
  async function recover() {
    if (props.mode !== "inbox" || busy || !props.context.lettersAddress || !props.recoveryReady) return;
    const version = epoch.current;
    activeOperation.current = "recover";
    setWorking(true); setStage("recovering"); props.onBusyChange?.(true); setError("");
    try {
      const result = await shieldedAssetWorkerCall("recoverLetters", { context: props.context }, { timeoutMs: 1_200_000 });
      if (mounted.current && version === epoch.current) setInbox(result);
    } catch (cause) { if (mounted.current && version === epoch.current) setError(tr("recoverFailed"), cause); }
    finally { if (mounted.current && version === epoch.current) { activeOperation.current = null; setWorking(false); busyChange.current?.(false); } }
  }
  // Entering the inbox reads once for this key/context. Busy state changes and
  // the recovery result must not start another automatic read.
  useEffect(() => {
    if (props.mode !== "inbox") {
      inboxScope.current = null;
      return;
    }
    if (busy || !props.context.lettersAddress || !props.recoveryReady || inboxScope.current === contextKey) return;
    inboxScope.current = contextKey;
    void recover();
  });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <h2 id={props.titleId} className="mr-auto ui-heading text-xl text-ink">{tr(props.mode)}</h2>
      {props.mode === "inbox" ? <PanelButton size="compact" disabled={busy || !props.context.lettersAddress || !props.recoveryReady} onClick={() => void recover()}>{tr("refresh")}</PanelButton> : null}
    </div>
    {!props.context.lettersAddress ? <p className="text-sm text-ink-muted">{tr("notConfigured")}</p> : null}
    {props.mode === "inbox" && props.context.lettersAddress && !props.recoveryReady ? <p className="text-sm text-ink-muted">{tr("recoveryKeysRequired")}</p> : null}
    {props.mode === "write" ? <div className="space-y-4">
      {!props.signer ? <p className="text-sm text-ink-muted">{t("wallet.connectDescription")}</p> : null}
      <FieldBlock label={tr("recipientCode")}><textarea aria-label={tr("recipientCode")} className={FIELD_TEXTAREA} rows={3} disabled={busy || unresolved(submission)} value={code} onChange={event => { if (unresolved(submission)) return; setCode(event.target.value); prepared.current = null; setSubmission(null); }} /></FieldBlock>
      <FieldBlock label={tr("body")}><textarea aria-label={tr("body")} className={FIELD_TEXTAREA} rows={6} disabled={busy || unresolved(submission)} value={body} onChange={event => { if (unresolved(submission)) return; setBody(event.target.value); prepared.current = null; setSubmission(null); }} /></FieldBlock>
      <PanelButton aria-busy={working} disabled={busy || !props.context.lettersAddress || (unresolved(submission) ? !reader : !props.signer || !code.trim() || !body.trim())} onClick={() => void (unresolved(submission) ? check() : send())}>{tr(unresolved(submission) ? "checkOriginal" : "send")}</PanelButton>
      {unresolved(submission) ? <PanelButton size="compact" disabled={busy} onClick={startNewLetter}>{tr("newLetter")}</PanelButton> : null}
    </div> : null}
    {props.mode === "inbox" && inbox ? <div className="space-y-3">
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">{t("transaction.errorDetails")}</summary>
        <p className="mt-2">{tr("recoveryHint")}</p>
      </details>
      {inbox.unavailable > 0 ? <p role="alert" className="text-sm text-danger">{t("shielded.privateLetters.unavailable", { count: inbox.unavailable })}</p> : null}
      {inbox.letters.length === 0 && inbox.unavailable === 0 ? <p className="text-sm text-ink-muted">{tr("emptyInbox")}</p> : inbox.letters.map(letter => <article key={letter.messageId} className="space-y-2 rounded-xl bg-surface-alt p-4">
        <p className="text-xs text-ink-muted">{new Date(Number(letter.registeredAt) * 1000).toLocaleString()}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-ink">{letter.body}</p>
      </article>)}
    </div> : null}
    {working ? <p role="status" className="text-sm text-ink-muted">{stage === "submitting" || stage === "confirming" ? t(`shielded.stages.${stage}`) : tr("working")}</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null}
    {[...previousSubmissions, ...(submission ? [submission] : [])].map(result => <div key={result.messageId} className="space-y-2">
      <p role={result.state === "failed" || result.state === "verificationFailed" ? "alert" : "status"} className="break-all text-sm text-ink-muted">
        {working && result.state === "pending" ? null : result.state === "failed" ? t("transaction.failed") : tr(result.state === "confirmed" ? "sent" : result.state === "pending" ? "pending" : result.state === "verificationFailed" ? "confirmedDetailsUnavailable" : "confirmationPending")}
        {result.transactionHash ? <>{working && result.state === "pending" ? "" : " · "}{t("shielded.walletKeys.transactionHash")}: {result.transactionHash}</> : null}
      </p>
      {props.mode === "write" && result !== submission && unresolved(result) ? <PanelButton size="compact" disabled={busy || !reader || !props.context.lettersAddress} onClick={() => void check(result)}>{tr("checkOriginal")}</PanelButton> : null}
    </div>)}
  </div>;
}
