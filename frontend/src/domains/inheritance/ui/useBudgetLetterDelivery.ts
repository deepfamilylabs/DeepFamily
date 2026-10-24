import { useCallback, useEffect, useRef, useState } from "react";
import type { Signer } from "ethers";
import { useTranslation } from "react-i18next";
import type { ShieldedWorkerContext } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { shieldedAssetWorkerCall, subscribeShieldedAssetWorkerLock } from "../../../shared/workers/shieldedAssetWorkerClient";
import { getWalletConnectionGeneration, subscribeWalletConnectionChange } from "../../wallet";
import { PrivateLetterPreparationExpiredError, submitPrivateLetter, type ProvenPrivateLetter } from "../services/privateLetterChain";

export type BudgetLetterDraft = { code: string; body: string };
type PendingLetter = BudgetLetterDraft & { budget: string; prepared: ProvenPrivateLetter | null; depositId?: string; confirmed?: boolean };
type Delivery = { budget: string; status: "awaitingDeposit" | "sending" | "failed" | "sent"; hash?: string; canUpdateCode: boolean; expired?: boolean };

/** In-memory only: a retry sends the letter for a confirmed budget, never another deposit. */
export function useBudgetLetterDelivery(input: {
  context: ShieldedWorkerContext;
  scope: string;
  signer: Signer | null;
  beginWalletRequest: () => () => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [body, setBody] = useState("");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [replacementCode, setReplacementCode] = useState("");
  const pending = useRef<PendingLetter | null>(null);
  const recipient = useRef<string | null>(null);
  const epoch = useRef(0);
  const clear = useCallback(() => {
    epoch.current++;
    pending.current = null;
    recipient.current = null;
    setEnabled(false);
    setBody("");
    setDelivery(null);
    setReplacementCode("");
  }, []);
  const scope = JSON.stringify([input.scope, { ...input.context, stateReadMode: undefined }]);
  // Signers can contain circular provider references; compare their identity separately.
  useEffect(clear, [scope, input.signer, clear]);
  const previousReadMode = useRef(input.context.stateReadMode);
  useEffect(() => {
    if (previousReadMode.current === input.context.stateReadMode) return;
    previousReadMode.current = input.context.stateReadMode;
    epoch.current++;
    const request = pending.current;
    if (request && (request.confirmed || !request.depositId)) {
      setDelivery({ budget: request.budget, status: "failed", canUpdateCode: !request.prepared });
    }
  }, [input.context.stateReadMode]);
  useEffect(() => subscribeShieldedAssetWorkerLock(clear), [clear]);
  useEffect(() => subscribeWalletConnectionChange(clear), [clear]);
  useEffect(() => () => { epoch.current++; pending.current = null; }, []);

  function selectRecipient(personHash: string) {
    const next = personHash.toLowerCase();
    if (recipient.current !== null && recipient.current !== next) clear();
    recipient.current = next;
  }

  async function preflight(code: string, keyMode: 0 | 1, current: () => boolean): Promise<BudgetLetterDraft | null> {
    if (!enabled) return null;
    if (!body.trim()) throw new Error(t("shielded.privateLetters.bodyRequired"));
    const version = epoch.current;
    const draft = { code, body };
    try {
      await shieldedAssetWorkerCall("validateLetter", { context: input.context, ...draft, keyMode }, { timeoutMs: 1_200_000 });
    } catch {
      throw new Error(t("shielded.privateLetters.preflightFailed"));
    }
    if (!current() || version !== epoch.current) throw new Error(t("shielded.unlockRequired"));
    return draft;
  }

  async function deliver(request: PendingLetter, current: () => boolean) {
    const version = epoch.current;
    const generation = getWalletConnectionGeneration();
    const valid = () => current() && version === epoch.current && pending.current === request && generation === getWalletConnectionGeneration();
    if (!input.signer || !input.context.lettersAddress || !valid()) return;
    setDelivery({ budget: request.budget, status: "sending", canUpdateCode: false });
    try {
      request.prepared ??= await shieldedAssetWorkerCall("prepareLetter", {
        context: input.context, code: request.code, body: request.body, budgetCommitment: request.budget,
      }, { timeoutMs: 1_200_000 });
      if (!valid()) return;
      const result = await submitPrivateLetter({
        address: input.context.lettersAddress, chainId: input.context.chainId,
        signer: input.signer, letter: request.prepared, isCurrent: valid, onWalletRequest: input.beginWalletRequest,
      });
      if (!valid()) return;
      pending.current = null;
      setBody("");
      setReplacementCode("");
      setDelivery({ budget: request.budget, status: "sent", hash: result.transactionHash, canUpdateCode: false });
    } catch (cause) {
      if (!valid()) return;
      const expired = cause instanceof PrivateLetterPreparationExpiredError;
      if (expired) request.prepared = null;
      setDelivery({ budget: request.budget, status: "failed", canUpdateCode: !request.prepared, expired });
    }
  }

  function stageDeposit(draft: BudgetLetterDraft, budget: string, depositId: string) {
    pending.current = { ...draft, budget, depositId, confirmed: false, prepared: null };
    setDelivery({ budget, status: "awaitingDeposit", canUpdateCode: false });
  }
  function hasDeposit(depositId: string) {
    return pending.current?.depositId === depositId && !pending.current.confirmed;
  }
  async function confirmDeposit(depositId: string, current: () => boolean) {
    const request = pending.current;
    if (!request || request.depositId !== depositId || request.confirmed || !current()) return;
    request.confirmed = true;
    await deliver(request, current);
  }
  function cancelDeposit(depositId: string) {
    if (!hasDeposit(depositId)) return;
    pending.current = null;
    setDelivery(null);
  }

  async function start(draft: BudgetLetterDraft, budget: string, current: () => boolean) {
    if (!current()) return;
    const request: PendingLetter = { ...draft, budget, prepared: null };
    pending.current = request;
    await deliver(request, current);
  }
  async function retry(current: () => boolean) {
    const request = pending.current;
    if (!request || (request.depositId && !request.confirmed) || !current()) return;
    if (!request.prepared && replacementCode.trim()) request.code = replacementCode;
    await deliver(request, current);
  }
  return { enabled, setEnabled, body, setBody, delivery, replacementCode, setReplacementCode, preflight, start, retry, clear, stageDeposit, hasDeposit, confirmDeposit, cancelDeposit, selectRecipient };
}
