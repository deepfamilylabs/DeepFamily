import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WalletLetterView } from "../../../shared/workers/walletWorkerTypes";
import { formatShieldedTimestamp } from "../model/shieldedBudgetPeriod";
import { FIELD_TEXTAREA, FieldBlock, PanelButton } from "./inheritanceControls";

export type PrivateLetterView = "write" | "inbox";

/** Writes a letter to any receive code, or lists the letters this wallet can open. */
export function PrivateLettersPanel(props: {
  mode: PrivateLetterView;
  titleId?: string;
  lettersConfigured: boolean;
  disabled: boolean;
  canSend: boolean;
  /** Letters recovered with the wallet, or null before the first recovery. */
  letters: readonly WalletLetterView[] | null;
  onRefresh: () => void;
  /** Resolves true once the letter is registered on chain. */
  onSend: (code: string, body: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.privateLetters.${key}`);
  const [code, setCode] = useState("");
  const [body, setBody] = useState("");
  const busy = props.disabled;
  async function send() {
    if (await props.onSend(code.trim(), body)) {
      setCode("");
      setBody("");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={props.titleId} className="mr-auto ui-heading text-xl text-ink">
          {tr(props.mode)}
        </h2>
        {props.mode === "inbox" ? (
          <PanelButton
            size="compact"
            disabled={busy || !props.lettersConfigured}
            onClick={props.onRefresh}
          >
            {tr("refresh")}
          </PanelButton>
        ) : null}
      </div>
      {!props.lettersConfigured ? (
        <p className="text-sm text-ink-muted">{tr("notConfigured")}</p>
      ) : null}
      {props.mode === "write" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">{tr("writeHint")}</p>
          <FieldBlock label={tr("recipientCode")}>
            <textarea
              aria-label={tr("recipientCode")}
              className={FIELD_TEXTAREA}
              rows={3}
              disabled={busy}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={tr("body")}>
            <textarea
              aria-label={tr("body")}
              className={FIELD_TEXTAREA}
              rows={6}
              disabled={busy}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </FieldBlock>
          <PanelButton
            disabled={
              busy || !props.lettersConfigured || !props.canSend || !code.trim() || !body.trim()
            }
            onClick={() => void send()}
          >
            {busy ? tr("working") : tr("send")}
          </PanelButton>
        </div>
      ) : null}
      {props.mode === "inbox" && props.letters ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">{tr("recoveryHint")}</p>
          {props.letters.length === 0 ? (
            <p className="text-sm text-ink-muted">{tr("emptyInbox")}</p>
          ) : (
            props.letters.map((letter) => (
              <article
                key={`${letter.sender}:${letter.messageId}`}
                className="space-y-2 rounded-xl bg-surface-alt p-4"
              >
                <p className="text-xs text-ink-muted">
                  {formatShieldedTimestamp(BigInt(letter.registeredAt)) ?? ""}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{letter.body}</p>
              </article>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
