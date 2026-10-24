import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Signer } from "ethers";
import type { ShieldedAssetWorkerCallMap, ShieldedWalletSummary, ShieldedWorkerContext } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { shieldedAssetWorkerCall, subscribeShieldedAssetWorkerLock } from "../../../shared/workers/shieldedAssetWorkerClient";
import { getWalletConnectionGeneration, subscribeWalletConnectionChange } from "../../wallet";
import { PrivateLetterPreparationExpiredError, submitPrivateLetter, type ProvenPrivateLetter } from "../services/privateLetterChain";
import { FIELD_INPUT, FIELD_TEXTAREA, FieldBlock, PanelButton, shortHex } from "./inheritanceControls";

export type PrivateLetterView = "write" | "inbox";

/** One composer handles standalone letters and references to authenticated private Fund budgets. */
export function PrivateLettersPanel(props: {
  mode: PrivateLetterView;
  titleId?: string;
  context: ShieldedWorkerContext; signer: Signer | null; disabled: boolean; wallet: ShieldedWalletSummary | null; recoveryReady: boolean;
  budgetCommitment: string; onBudgetChange: (value: string) => void;
  composeRequest?: number;
  sessionScope?: string;
  onBusyChange?: (busy: boolean) => void; beginWalletRequest?: () => () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.privateLetters.${key}`);
  const [code, setCode] = useState("");
  const [body, setBody] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [inbox, setInbox] = useState<ShieldedAssetWorkerCallMap["recoverLetters"]["result"] | null>(null);
  const prepared = useRef<ProvenPrivateLetter | null>(null);
  const epoch = useRef(0);
  const activeOperation = useRef<"send" | "recover" | null>(null);
  const inboxScope = useRef<string | null>(null);
  const currentSigner = useRef(props.signer);
  currentSigner.current = props.signer;
  const previousSigner = useRef(props.signer);
  const busyChange = useRef(props.onBusyChange);
  busyChange.current = props.onBusyChange;
  const invalidateSending = useCallback(() => {
    setCode(""); setBody(""); prepared.current = null;
    if (activeOperation.current !== "send") return;
    epoch.current++; activeOperation.current = null; setWorking(false);
    busyChange.current?.(false);
  }, []);
  const contextKey = JSON.stringify([props.context, props.sessionScope]);
  const contentScope = JSON.stringify([{ ...props.context, stateReadMode: undefined }, props.sessionScope]);
  const previousContentScope = useRef(contentScope);
  useEffect(() => subscribeShieldedAssetWorkerLock(() => {
    epoch.current++; activeOperation.current = null; setCode(""); setBody(""); setInbox(null); setError(""); setSent(""); prepared.current = null; setWorking(false);
  }), []);
  useEffect(() => subscribeWalletConnectionChange(invalidateSending), [invalidateSending]);
  useEffect(() => {
    if (previousSigner.current === props.signer) return;
    previousSigner.current = props.signer;
    invalidateSending();
  }, [props.signer, invalidateSending]);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => { prepared.current = null; }, [props.budgetCommitment, props.composeRequest]);
  useEffect(() => {
    epoch.current++;
    activeOperation.current = null;
    // The read strategy changes neither the recipient nor the unlocked keys.
    // Keep their displayed content until the new read finishes.
    if (previousContentScope.current !== contentScope) {
      setCode(""); setBody(""); setInbox(null); setError(""); setSent("");
    }
    previousContentScope.current = contentScope;
    prepared.current = null;
    setWorking(false);
  }, [contextKey, contentScope]);
  const budgets = props.wallet?.templates.filter(item => item.bindingKind === 0) ?? [];
  const busy = props.disabled || working;
  async function send() {
    if (props.mode !== "write" || !props.signer || !props.context.lettersAddress || busy) return;
    const version = epoch.current;
    const walletGeneration = getWalletConnectionGeneration();
    const current = () => version === epoch.current && currentSigner.current === props.signer && walletGeneration === getWalletConnectionGeneration();
    activeOperation.current = "send";
    setWorking(true); props.onBusyChange?.(true); setError("");
    try {
      const letter = prepared.current ?? await shieldedAssetWorkerCall("prepareLetter", {
        context: props.context, code, body, budgetCommitment: props.budgetCommitment || undefined,
      }, { timeoutMs: 1_200_000 });
      if (!current()) return;
      prepared.current = letter;
      const result = await submitPrivateLetter({ address: props.context.lettersAddress, signer: props.signer, chainId: props.context.chainId, letter, onWalletRequest: props.beginWalletRequest, isCurrent: current });
      if (!current()) return;
      setSent(result.transactionHash); setBody(""); setCode(""); prepared.current = null;
    } catch (cause) {
      if (current()) {
        if (cause instanceof PrivateLetterPreparationExpiredError) {
          prepared.current = null;
          setError(tr("preparationExpired"));
        } else setError(tr("sendFailed"));
      }
    }
    finally { if (version === epoch.current) { activeOperation.current = null; setWorking(false); props.onBusyChange?.(false); } }
  }
  async function recover() {
    if (props.mode !== "inbox" || busy || !props.context.lettersAddress || !props.recoveryReady) return;
    const version = epoch.current;
    activeOperation.current = "recover";
    setWorking(true); props.onBusyChange?.(true); setError("");
    try {
      const result = await shieldedAssetWorkerCall("recoverLetters", { context: props.context }, { timeoutMs: 1_200_000 });
      if (version === epoch.current) setInbox(result);
    } catch { if (version === epoch.current) setError(tr("recoverFailed")); }
    finally { if (version === epoch.current) { activeOperation.current = null; setWorking(false); props.onBusyChange?.(false); } }
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
    {props.context.lettersAddress && !props.recoveryReady ? <p className="text-sm text-ink-muted">{tr("recoveryKeysRequired")}</p> : null}
    {props.mode === "write" ? <div className="space-y-4">
      <p className="text-sm text-ink-muted">{tr("writeHint")}</p>
      <FieldBlock label={tr("budget")}>
        <select className={FIELD_INPUT} aria-label={tr("budget")} value={props.budgetCommitment} disabled={busy} onChange={event => { props.onBudgetChange(event.target.value); prepared.current = null; }}>
          <option value="">{tr("standalone")}</option>
          {props.budgetCommitment && !budgets.some(item => item.handle === props.budgetCommitment) ? <option value={props.budgetCommitment}>{shortHex(props.budgetCommitment)}</option> : null}
          {budgets.map(item => <option key={item.handle} value={item.handle}>{shortHex(item.handle)}</option>)}
        </select>
      </FieldBlock>
      <FieldBlock label={tr("recipientCode")}><textarea aria-label={tr("recipientCode")} className={FIELD_TEXTAREA} rows={3} disabled={busy} value={code} onChange={event => { setCode(event.target.value); prepared.current = null; setSent(""); }} /></FieldBlock>
      <FieldBlock label={tr("body")}><textarea aria-label={tr("body")} className={FIELD_TEXTAREA} rows={6} disabled={busy} value={body} onChange={event => { setBody(event.target.value); prepared.current = null; setSent(""); }} /></FieldBlock>
      <PanelButton disabled={busy || !props.context.lettersAddress || !props.signer || !code.trim() || !body.trim()} onClick={() => void send()}>{working ? tr("working") : tr("send")}</PanelButton>
      {props.budgetCommitment ? <p className="text-xs text-ink-muted">{tr("separateResults")}</p> : null}
    </div> : null}
    {props.mode === "inbox" && inbox ? <div className="space-y-3">
      <p className="text-xs text-ink-muted">{tr("recoveryHint")}</p>
      {inbox.unavailable > 0 ? <p role="alert" className="text-sm text-danger">{t("shielded.privateLetters.unavailable", { count: inbox.unavailable })}</p> : null}
      {inbox.letters.length === 0 && inbox.unavailable === 0 ? <p className="text-sm text-ink-muted">{tr("emptyInbox")}</p> : inbox.letters.map(letter => <article key={letter.messageId} className="space-y-2 rounded-xl bg-surface-alt p-4">
        <p className="text-xs text-ink-muted">{new Date(Number(letter.registeredAt) * 1000).toLocaleString()}{letter.attachment ? ` · ${tr("budget")}: ${shortHex(letter.attachment.budgetCommitment)}` : ""}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-ink">{letter.body}</p>
      </article>)}
    </div> : null}
    {working ? <p role="status" className="text-sm text-ink-muted">{tr("working")}</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {sent ? <p role="status" className="break-all text-sm text-ink-muted">{tr("sent")}: {sent}</p> : null}
  </div>;
}
