import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUnits, parseUnits, type Signer } from "ethers";
import { ReceiveWorkerClient, type ReceiveWorkerContext } from "../../../shared/workers/receiveWorkerClient";
import type { WalletStateView, WalletNoteView, WalletLetterView, WalletQualificationView } from "../../../shared/workers/walletWorkerTypes";
import { ReceiveChain } from "../../../shared/clients/receiveChain";
import { WalletConnectButton } from "../../wallet";
import { FIELD_INPUT, FIELD_TEXTAREA, FieldBlock, PanelButton } from "./inheritanceControls";
import { CopyIconButton } from "../../../shared/ui";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";
import { normalizeFriendlyError } from "../../../shared/lib/errors";

type Task = "receive" | "shield" | "transfer" | "budget" | "unshield" | "letter";
const LOCKED: WalletStateView = { unlocked: false, codeCount: "0", credentialCount: 0, backupChanged: false };
function downloadBackup(bytes: Uint8Array, chainId: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
  const link = document.createElement("a"); link.href = url; link.download = `wallet-${chainId}-${Date.now()}.dfwallet`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function InheritanceWorkspace({ context, signer, account, symbol, decimals, loading = false }: {
  context: ReceiveWorkerContext; signer: Signer | null; account: string | null; symbol: string; decimals: number | null; loading?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`walletProtocol.${key}`);
  const client = useRef<ReceiveWorkerClient | null>(null);
  if (!client.current) client.current = new ReceiveWorkerClient();
  const current = useRef({ context, signer, account }); current.current = { context, signer, account };
  const submissionEpoch = useRef(0);
  const [state, setState] = useState<WalletStateView>(LOCKED);
  const [notes, setNotes] = useState<WalletNoteView[]>([]), [letters, setLetters] = useState<WalletLetterView[]>([]);
  const [task, setTask] = useState<Task>("receive"), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const [password, setPassword] = useState(""), [backupFile, setBackupFile] = useState<Uint8Array | null>(null);
  const identityForm = useRef<PersonHashCalculatorHandle>(null);
  const [walletKind, setWalletKind] = useState<"ordinary" | "family">("ordinary");
  const [qualificationFile, setQualificationFile] = useState<Uint8Array | null>(null), [qualificationPassword, setQualificationPassword] = useState("");
  const [qualifications, setQualifications] = useState<WalletQualificationView[]>([]), [selectedQualifications, setSelectedQualifications] = useState<number[]>([]);
  const [code, setCode] = useState(""), [recipientCode, setRecipientCode] = useState("");
  const [expiryDays, setExpiryDays] = useState("365"), [amount, setAmount] = useState("");
  const [noteHandle, setNoteHandle] = useState(""), [recipientAddress, setRecipientAddress] = useState(account ?? "");
  const [rule, setRule] = useState(""), [periods, setPeriods] = useState("1"), [body, setBody] = useState("");
  const [ruleRate, setRuleRate] = useState(""), [ruleDays, setRuleDays] = useState("30"), [familyChoice, setFamilyChoice] = useState("0");
  const values = notes.filter(note => note.kind === "value"), budgets = notes.filter(note => note.kind === "budget");
  const units = (value: string) => decimals === null ? value : formatUnits(value, decimals);
  const parseAmount = (value: string) => {
    const parsed = decimals === null ? (/^[1-9]\d*$/u.test(value) ? BigInt(value) : 0n) : parseUnits(value, decimals);
    if (parsed <= 0n) throw new Error(tr("invalidAmount")); return String(parsed);
  };
  const worker = () => { if (!client.current) throw new Error(tr("locked")); return client.current; };
  useEffect(() => () => { ++submissionEpoch.current; client.current?.close(); client.current = null; }, []);
  useEffect(() => { setNotes([]); setLetters([]); setNoteHandle(""); setRule(""); setStatus(""); setError(""); }, [context.deployment.poolAddress]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setStatus("");
    try { await operation(); } catch (failure) {
      const friendly = normalizeFriendlyError(failure, t);
      setError(friendly.type === "UNKNOWN_ERROR" ? (failure instanceof Error ? failure.message : tr("failed")) : friendly.message);
    }
    finally { setBusy(false); }
  };
  const recover = async () => {
    const result = await worker().call("walletRecover", {}, current.current.context);
    setState(result.state); setNotes(result.notes); setLetters(result.letters);
    setNoteHandle(previous => result.notes.some(item => item.handle === previous && item.kind === "value") ? previous : result.notes.find(item => item.kind === "value")?.handle ?? "");
    await refreshQualifications();
  };
  const refreshQualifications = async () => {
    const result = await worker().call("walletReadQualifications", {}, current.current.context);
    setQualifications(result.qualifications); setSelectedQualifications(result.qualifications.filter(item => item.selected).map(item => item.index));
  };
  const create = () => run(async () => {
    if (password.length < 12) throw new Error(tr("passwordLength"));
    const rawPassphrase = password; setPassword("");
    const form = identityForm.current;
    if (walletKind === "family" && (!form || !form.passphrasesMatch())) throw new Error(tr("identityConfirmation"));
    const identity = walletKind === "family" ? { fields: form!.getRawIdentityFields(), rawPassphrase: form!.getSecretInputs().passphrase } : undefined;
    form?.clearSecretInputs();
    const result = await worker().call("walletCreate", { rawPassphrase, ...(identity ? { identity } : {}) }, context);
    downloadBackup(result.backup, String(context.deployment.chainId)); setState(result.state); setStatus(tr("created"));
    setQualifications([]); setSelectedQualifications([]);
  });
  const restore = () => run(async () => {
    if (!backupFile) throw new Error(tr("chooseBackup"));
    const rawPassphrase = password; setPassword("");
    const result = await worker().call("walletRestore", { backup: backupFile, rawPassphrase }, context);
    setState(result.state); setBackupFile(null); await recover(); setStatus(tr("restored"));
  });
  const backup = () => run(async () => {
    if (password.length < 12) throw new Error(tr("passwordLength"));
    const rawPassphrase = password; setPassword("");
    const result = await worker().call("walletBackup", { rawPassphrase }, context);
    downloadBackup(result.backup, String(context.deployment.chainId)); setState(result.state); setStatus(tr("backedUp"));
  });
  const generateCode = () => run(async () => {
    if (password.length < 12) throw new Error(tr("passwordLength"));
    const days = Number(expiryDays); if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error(tr("invalidExpiry"));
    const rawPassphrase = password; setPassword("");
    const result = await worker().call("walletCreateCode", { expiresAt: String(BigInt(Math.floor(Date.now() / 1000)) + BigInt(days) * 86400n), rawPassphrase, credentialIndices: selectedQualifications }, context);
    downloadBackup(result.backup, String(context.deployment.chainId)); setCode(result.code); setState(result.state); setStatus(tr("codeReady"));
  });
  const importQualifications = () => run(async () => {
    if (!qualificationFile) throw new Error(tr("chooseQualifications"));
    if (password.length < 12) throw new Error(tr("passwordLength"));
    const rawPassphrase = password, sourcePassphrase = qualificationPassword; setPassword(""); setQualificationPassword("");
    const result = await worker().call("walletImportQualifications", { backup: qualificationFile, sourcePassphrase, rawPassphrase }, context);
    downloadBackup(result.backup, String(context.deployment.chainId)); setQualificationFile(null); setState(result.state);
    await refreshQualifications(); setStatus(tr("qualificationsImported"));
  });
  const lock = () => { ++submissionEpoch.current; worker().close(); client.current = new ReceiveWorkerClient(); setState(LOCKED); setNotes([]); setLetters([]); setPassword(""); setCode(""); setQualifications([]); setSelectedQualifications([]); setQualificationPassword(""); setQualificationFile(null); setStatus(tr("locked")); };
  const submit = (override?: { claim: WalletNoteView }) => run(async () => {
    const expected = current.current;
    const expectedEpoch = submissionEpoch.current;
    if (!expected.signer || !expected.account) throw new Error(tr("connect"));
    const assertCurrent = () => {
      if (submissionEpoch.current !== expectedEpoch || current.current.signer !== expected.signer || current.current.account !== expected.account || current.current.context.deployment.poolAddress !== expected.context.deployment.poolAddress) throw new Error(tr("walletChanged"));
    };
    const chain = new ReceiveChain(expected.context.deployment, expected.signer, {
      beforeTransaction: assertCurrent,
      onRevocationPreparation: (completed, total) => setStatus(t("walletProtocol.preparingQualification", { completed, total })),
      prepareRevocationScans: async status => {
        assertCurrent();
        return (await worker().call("prepareRevocationScans", status, expected.context)).revocationScans;
      },
    });
    let transaction;
    if (override) {
      const prepared = await worker().call("walletPrepareClaim", { noteHandle: override.claim.handle, periodIndex: override.claim.claimPeriod }, expected.context);
      assertCurrent(); transaction = await chain.sendClaim(prepared, prepared.inputShardId);
    } else if (task === "shield") {
      const prepared = await worker().call("walletPrepareShield", { amount: parseAmount(amount) }, expected.context);
      assertCurrent(); transaction = await chain.sendShield(prepared);
    } else if (task === "unshield") {
      const prepared = await worker().call("walletPrepareUnshield", { amount: parseAmount(amount), recipient: recipientAddress, noteHandle }, expected.context);
      assertCurrent(); transaction = await chain.sendUnshield(prepared);
    } else if (task === "transfer") {
      const prepared = await worker().call("walletPrepareTransfer", { amount: parseAmount(amount), code: recipientCode.trim(), noteHandle }, expected.context);
      assertCurrent(); transaction = await chain.sendTransfer(prepared, prepared.inputShardId);
    } else if (task === "budget") {
      const prepared = await worker().call("walletPrepareDeposit", { code: recipientCode.trim(), rule: rule.trim(), budgetPeriods: periods, noteHandle }, expected.context);
      assertCurrent(); transaction = await chain.sendDeposit(prepared, prepared.inputShardId);
    } else if (task === "letter") {
      const message = await worker().call("prepareLetter", { code: recipientCode.trim(), body, asOf: String(Math.floor(Date.now() / 1000)), messageId: BigInt(crypto.getRandomValues(new BigUint64Array(1))[0]) || 1n }, expected.context);
      assertCurrent(); transaction = await chain.sendLetter(message);
    } else return;
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error(tr("failed"));
    setStatus(tr("confirmed")); if (state.unlocked) await recover();
  });
  const createRule = () => run(async () => {
    const result = await worker().call("walletCreateRule", { credentialIndex: Number(familyChoice), rate: parseAmount(ruleRate), periodDays: ruleDays }, context);
    setRule(result.rule); setStatus(tr("ruleReady"));
  });
  const working = busy || loading;
  return <div className="min-w-0 space-y-5">
    <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-ink">{tr("wallet")}</h2>{state.unlocked ? <PanelButton size="compact" onClick={lock} disabled={working}>{tr("lock")}</PanelButton> : null}</div>
      {!state.unlocked ? <>
        <p className="text-sm text-ink-muted">{tr("backupDescription")}</p>
        <FieldBlock label={tr("backupFile")}><input aria-label={tr("backupFile")} type="file" accept=".dfwallet,application/octet-stream" disabled={working} onChange={event => { const file = event.target.files?.[0]; if (file) void file.arrayBuffer().then(bytes => setBackupFile(new Uint8Array(bytes))); }} /></FieldBlock>
        {!backupFile ? <>
          <FieldBlock label={tr("walletKind")}><select aria-label={tr("walletKind")} className={FIELD_INPUT} value={walletKind} onChange={event => setWalletKind(event.target.value as "ordinary" | "family")} disabled={working}><option value="ordinary">{tr("ordinaryWallet")}</option><option value="family">{tr("familyWallet")}</option></select></FieldBlock>
          <p className="text-sm text-ink-muted">{tr(walletKind === "family" ? "familyWalletDescription" : "ordinaryWalletDescription")}</p>
          {walletKind === "family" ? <PersonHashCalculator ref={identityForm} showTitle={false} collapsible={false} computeHash={false} requirePassphraseConfirmation /> : null}
        </> : null}
      </> : <p className="text-sm text-ink-muted">{tr("unlocked")}{state.credentialCount > 0 ? ` · ${t("walletProtocol.qualifications", { count: state.credentialCount })}` : ""}</p>}
      <FieldBlock label={tr("backupPassword")}><input aria-label={tr("backupPassword")} className={FIELD_INPUT} type="password" value={password} autoComplete={state.unlocked ? "current-password" : "new-password"} onChange={event => setPassword(event.target.value)} disabled={working} /></FieldBlock>
      <div className="flex flex-wrap gap-2">{!state.unlocked ? <><PanelButton variant="primary" busy={busy} disabled={working || Boolean(backupFile)} onClick={() => void create()}>{tr("create")}</PanelButton><PanelButton disabled={working || !backupFile} onClick={() => void restore()}>{tr("restore")}</PanelButton></> : <><PanelButton onClick={() => void backup()} disabled={working}>{tr("backup")}</PanelButton><PanelButton disabled={working} onClick={() => void run(recover)}>{tr("refresh")}</PanelButton></>}</div>
      {state.backupChanged ? <p role="status" className="text-sm text-warning">{tr("backupChanged")}</p> : null}
    </section>
    <nav aria-label={tr("tasks")} className="flex flex-wrap gap-2">{(["receive", "shield", "transfer", "budget", "unshield", "letter"] as const).map(item => <button key={item} type="button" disabled={working} onClick={() => { setTask(item); setError(""); setStatus(""); }} aria-pressed={task === item} className={`rounded-xl px-4 py-2 text-sm font-medium border ${task === item ? "border-primary bg-primary/10 text-ink" : "border-hairline text-ink-muted"}`}>{tr(item)}</button>)}</nav>
    <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4">
      <h2 className="font-semibold text-ink">{tr(task)}</h2>
      {task === "receive" ? <>
        <p className="text-sm text-ink-muted">{tr("receiveDescription")}</p>
        <FieldBlock label={tr("expiryDays")}><input className={FIELD_INPUT} type="number" min="1" max="3650" value={expiryDays} onChange={event => setExpiryDays(event.target.value)} disabled={working} /></FieldBlock>
        {qualifications.length ? <fieldset className="space-y-2"><legend className="text-sm font-medium">{tr("codeQualifications")}</legend><p className="text-xs text-ink-muted">{tr("codeQualificationsDescription")}</p>{qualifications.map(item => <label key={item.index} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedQualifications.includes(item.index)} disabled={working || !item.current || (!selectedQualifications.includes(item.index) && selectedQualifications.length >= 2)} onChange={event => setSelectedQualifications(previous => event.target.checked ? [...previous, item.index] : previous.filter(index => index !== item.index))} />{t("walletProtocol.qualification", { index: item.index + 1 })}{!item.current ? ` · ${tr("qualificationWithdrawn")}` : ""}</label>)}</fieldset> : null}
        <PanelButton variant="primary" disabled={working || !state.unlocked} busy={busy} onClick={() => void generateCode()}>{tr("generateCode")}</PanelButton>
        {code ? <div className="space-y-2"><textarea className={FIELD_TEXTAREA} rows={7} value={code} readOnly aria-label={tr("receiveCode")} /><CopyIconButton label={tr("copyCode")} onClick={() => void navigator.clipboard.writeText(code)} /></div> : null}
      </> : <>
        {task === "transfer" || task === "budget" || task === "letter" ? <FieldBlock label={tr("receiveCode")}><textarea className={FIELD_TEXTAREA} rows={4} value={recipientCode} onChange={event => setRecipientCode(event.target.value)} disabled={working} autoComplete="off" /></FieldBlock> : null}
        {task !== "shield" && task !== "letter" ? <FieldBlock label={tr("balanceSource")}><select className={FIELD_INPUT} value={noteHandle} onChange={event => setNoteHandle(event.target.value)} disabled={working}><option value="">{tr("selectBalance")}</option>{values.map((note, i) => <option key={note.handle} value={note.handle}>{`${i + 1}. ${units(note.amount)} ${symbol}`}</option>)}</select></FieldBlock> : null}
        {task === "shield" || task === "transfer" || task === "unshield" ? <FieldBlock label={`${tr("amount")} (${symbol})`}><input className={FIELD_INPUT} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={working} /></FieldBlock> : null}
        {task === "unshield" ? <FieldBlock label={tr("withdrawAddress")}><input className={FIELD_INPUT} value={recipientAddress} onChange={event => setRecipientAddress(event.target.value)} disabled={working} /></FieldBlock> : null}
        {task === "budget" ? <><p className="text-sm text-ink-muted">{tr("depositDescription")}</p><FieldBlock label={tr("rule")}><textarea className={FIELD_TEXTAREA} rows={3} value={rule} onChange={event => setRule(event.target.value)} disabled={working} /></FieldBlock><FieldBlock label={tr("periods")}><input className={FIELD_INPUT} type="number" min="1" value={periods} onChange={event => setPeriods(event.target.value)} disabled={working} /></FieldBlock></> : null}
        {task === "letter" ? <FieldBlock label={tr("letterBody")}><textarea className={FIELD_TEXTAREA} rows={7} value={body} onChange={event => setBody(event.target.value)} disabled={working} /></FieldBlock> : null}
        {signer ? <PanelButton variant="primary" busy={busy} disabled={working || (task !== "letter" && !state.unlocked)} onClick={() => void submit()}>{tr("submit")}</PanelButton> : <WalletConnectButton alwaysShowLabel />}
      </>}
    </section>
    {state.unlocked ? <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4"><h2 className="font-semibold text-ink">{tr("importQualifications")}</h2><p className="text-sm text-ink-muted">{tr("importQualificationsDescription")}</p><FieldBlock label={tr("qualificationBackup")}><input aria-label={tr("qualificationBackup")} type="file" accept=".dfwallet,application/octet-stream" disabled={working} onChange={event => { const file = event.target.files?.[0]; if (file) void file.arrayBuffer().then(bytes => setQualificationFile(new Uint8Array(bytes))); }} /></FieldBlock><FieldBlock label={tr("qualificationPassword")}><input aria-label={tr("qualificationPassword")} className={FIELD_INPUT} type="password" autoComplete="off" value={qualificationPassword} onChange={event => setQualificationPassword(event.target.value)} disabled={working} /></FieldBlock><PanelButton disabled={working || !qualificationFile} onClick={() => void importQualifications()}>{tr("importQualificationsAndBackup")}</PanelButton></section> : null}
    {state.unlocked ? <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4"><h2 className="font-semibold text-ink">{tr("balance")}</h2><p className="text-xl tabular-nums">{units(String(values.reduce((sum, item) => sum + BigInt(item.amount), 0n)))} {symbol}</p><h3 className="font-medium">{tr("budgets")}</h3>{budgets.length ? budgets.map((note, i) => <div key={note.handle} className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3"><div><p>{`${tr("budget")} ${i + 1} · ${units(note.amount)} ${symbol}`}</p><p className="text-xs text-ink-muted">{t("walletProtocol.schedule", { amount: units(note.rate ?? "0"), symbol, days: note.periodDays })}</p></div><PanelButton size="compact" disabled={working || !signer || note.claimPeriod === undefined} onClick={() => void submit({ claim: note })}>{tr("claim")}</PanelButton></div>) : <p className="text-sm text-ink-muted">{tr("noBudgets")}</p>}</section> : null}
    {state.unlocked && state.credentialCount > 0 ? <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4"><h2 className="font-semibold">{tr("createRule")}</h2><p className="text-sm text-ink-muted">{tr("ruleDescription")}</p><FieldBlock label={tr("familyQualification")}><select className={FIELD_INPUT} value={familyChoice} onChange={event => setFamilyChoice(event.target.value)}>{Array.from({ length: state.credentialCount }, (_, i) => <option key={i} value={i}>{t("walletProtocol.qualification", { index: i + 1 })}</option>)}</select></FieldBlock><FieldBlock label={`${tr("amountPerPeriod")} (${symbol})`}><input className={FIELD_INPUT} value={ruleRate} onChange={event => setRuleRate(event.target.value)} /></FieldBlock><FieldBlock label={tr("periodDays")}><input className={FIELD_INPUT} type="number" min="1" value={ruleDays} onChange={event => setRuleDays(event.target.value)} /></FieldBlock><PanelButton disabled={working} onClick={() => void createRule()}>{tr("createRule")}</PanelButton>{rule ? <><textarea className={FIELD_TEXTAREA} value={rule} readOnly rows={3} aria-label={tr("rule")} /><CopyIconButton label={tr("copyRule")} onClick={() => void navigator.clipboard.writeText(rule)} /></> : null}</section> : null}
    {letters.length ? <section className="rounded-[20px] border border-hairline bg-surface p-5 space-y-4"><h2 className="font-semibold">{tr("inbox")}</h2>{letters.map(letter => <article key={`${letter.sender}:${letter.messageId}`} className="whitespace-pre-wrap break-words border-t border-hairline pt-3 text-sm">{letter.body}</article>)}</section> : null}
    {error ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p> : null}
    {status ? <p role="status" className="text-sm text-ink-muted">{status}</p> : null}
    {busy ? <PanelButton size="compact" onClick={() => { lock(); setBusy(false); }}>{tr("cancel")}</PanelButton> : null}
  </div>;
}
