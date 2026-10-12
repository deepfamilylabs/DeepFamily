import { useId, type ReactNode, type RefObject } from "react";
import { isAddress } from "ethers";
import { useTranslation } from "react-i18next";
import { buildShieldedAssetSigningMessage } from "@deepfamily/protocol-core";
import type { ShieldedPublicFunds } from "../../../shared/workers/shieldedAssetWorkerTypes";
import {
  FieldBlock,
  PanelButton,
  SuccessNotice,
  WarningNotice,
  radioOptionClassName,
} from "./inheritanceControls";

export type ShieldedFundsRecoveryFormat = "mnemonic" | "shieldedKey";

export interface ShieldedFundsKeyManagerProps {
  flow: "create" | "restore" | "backup";
  funds: ShieldedPublicFunds | null;
  busy: boolean;
  backupFormat: ShieldedFundsRecoveryFormat;
  onBackupFormatChange: (value: ShieldedFundsRecoveryFormat) => void;
  exportedMaterialRef: RefObject<HTMLTextAreaElement>;
  recoveryMaterialRef: RefObject<HTMLTextAreaElement>;
  exportedFingerprint: string;
  externalSaved: boolean;
  onExternalSavedChange: (value: boolean) => void;
  verificationStarted: boolean;
  restorePath: ShieldedFundsRecoveryFormat | "signature";
  onRestorePathChange: (value: ShieldedFundsRecoveryFormat | "signature") => void;
  rootSource: "random" | "walletSignature";
  onRootSourceChange: (value: "random" | "walletSignature") => void;
  account: string;
  canSign: boolean;
  /** Credentials are already unlocked; proofs may be unavailable for their identity suite. */
  identityReady?: boolean;
  /** A scan without a matching historical note does not confirm the original wallet. */
  recoveryScanned?: boolean;
  onCreate: () => void;
  onExport: () => void;
  onBeginVerification: () => void;
  onImport: () => void;
  onRestoreSignature: () => void;
  /** Scans the selected pool, then every verified factory pool; history there can confirm a candidate. */
  onRecover: () => void;
  discoveryReport?: ReactNode;
  /** Restoring for a claim or from the entry screen needs the original key, never a new one. */
  canCreate?: boolean;
  onShowCreate: () => void;
  onShowRestore: () => void;
  /** The initial entry has no workspace navigation and can still open identity unlock. */
  onUnlockIdentity?: () => void;
  onLock: () => void;
  /** The workspace already provides the session exit beside the asset overview. */
  showLock?: boolean;
}

const INPUT =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";
const SECRET_INPUT = `${INPUT} h-auto min-h-24 py-3 font-mono text-xs`;

/** Public flow state lives in React; recovery secrets stay in uncontrolled textareas. */
export function ShieldedFundsKeyManager(props: ShieldedFundsKeyManagerProps) {
  const { t } = useTranslation();
  const id = useId();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const { funds, busy } = props;
  const backupPending = !!funds?.backupRequired || !!props.exportedFingerprint;
  const verification = props.verificationStarted;
  const backup = props.flow === "backup" || backupPending || verification;
  const restored = !!funds?.recoveryVerified && !funds.backupRequired && !backup;
  const candidate = !!funds && !funds.recoveryVerified && !funds.backupRequired && !backup;
  const sourceLabel = funds
    ? tr(
        funds.rootSource === "random"
          ? "randomSource"
          : funds.rootSource === "walletSignature"
            ? "signatureSource"
            : "importedSource",
      )
    : "";

  const keySummary = funds ? (
    <div className="space-y-1 rounded-xl bg-surface-alt p-3 text-xs text-ink-muted">
      {funds ? <p>{sourceLabel}</p> : null}
      {funds?.signerAddress ? (
        <p className="break-all">
          {tr("sourceWallet")}: {funds.signerAddress}
        </p>
      ) : null}
    </div>
  ) : null;

  const secretInput = (format: ShieldedFundsRecoveryFormat) => (
    <FieldBlock
      label={tr(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
      htmlFor={`${id}-recovery-material`}
      hint={tr(format === "mnemonic" ? "mnemonicHint" : "shieldedKeyHint")}
    >
      <textarea
        key={format}
        id={`${id}-recovery-material`}
        ref={props.recoveryMaterialRef}
        aria-label={tr(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
        className={SECRET_INPUT}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        disabled={busy}
      />
    </FieldBlock>
  );

  const savedBackupConfirmation = props.exportedFingerprint ? (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={props.externalSaved}
          disabled={busy}
          onChange={(event) => props.onExternalSavedChange(event.target.checked)}
        />
        {tr("savedExternal")}
      </label>
      <PanelButton
        variant="primary"
        disabled={busy || !props.externalSaved}
        onClick={props.onBeginVerification}
      >
        {tr("beginIndependentImport")}
      </PanelButton>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {restored ? (
        <>
          <SuccessNotice>
            <p className="font-medium">{tr("fundsRecoveredTitle")}</p>
            {!props.identityReady ? <p>{tr("fundsRestoredIdentityHint")}</p> : null}
          </SuccessNotice>
          {keySummary}
          {props.discoveryReport}
        </>
      ) : verification ? (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-ink">{tr("backupVerifyStep")}</h3>
            <p role="status" className="text-sm text-ink-muted">
              {tr("reenterBackup")}
            </p>
            <p className="text-xs text-ink-muted">{tr("backupVerifyHint")}</p>
          </div>
          {keySummary}
          {secretInput(props.backupFormat)}
          <PanelButton variant="primary" busy={busy} disabled={busy} onClick={props.onImport}>
            {tr("verifySavedBackup")}
          </PanelButton>
        </>
      ) : backup ? (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-ink">{tr("backupSaveStep")}</h3>
            <p className="text-sm text-ink-muted">{tr("independentBackupGate")}</p>
          </div>
          {keySummary}
          {funds ? (
            <>
              <fieldset className="space-y-2" disabled={busy}>
                <legend className="text-sm font-medium text-ink">{tr("backupFormat")}</legend>
                <div className="flex flex-wrap gap-3">
                  {(["mnemonic", "shieldedKey"] as const).map((format) => (
                    <label
                      key={format}
                      className={`${radioOptionClassName(props.backupFormat === format, busy)} text-ink`}
                    >
                      <input
                        type="radio"
                        name={`${id}-backup-format`}
                        checked={props.backupFormat === format}
                        onChange={() => props.onBackupFormatChange(format)}
                      />
                      {tr(format === "mnemonic" ? "mnemonicFormat" : "shieldedKeyFormat")}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-ink-muted">{tr("recoveryFormatsExplanation")}</p>
              <PanelButton disabled={busy} busy={busy} onClick={props.onExport}>
                {tr("exportRecovery")}
              </PanelButton>
              {/* Mount before export so the Worker response can go directly into the DOM. */}
              <div hidden={!props.exportedFingerprint} className="space-y-3">
                <FieldBlock
                  label={tr("exportedRecoveryMaterial")}
                  htmlFor={`${id}-exported-material`}
                  hint={tr("recoveryMaterialSecret")}
                >
                  <textarea
                    id={`${id}-exported-material`}
                    ref={props.exportedMaterialRef}
                    aria-label={tr("exportedRecoveryMaterial")}
                    className={SECRET_INPUT}
                    readOnly
                    rows={4}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="none"
                  />
                </FieldBlock>
                {savedBackupConfirmation}
              </div>
            </>
          ) : (
            <>
              <WarningNotice>{tr("backupSessionLocked")}</WarningNotice>
              {savedBackupConfirmation}
            </>
          )}
        </>
      ) : candidate ? (
        <>
          <WarningNotice>{tr("recoveryCandidate")}</WarningNotice>
          {keySummary}
          {props.recoveryScanned ? (
            <p role="status" className="text-sm text-ink-muted">
              {tr("recoveryCandidateHistoryMissing")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <PanelButton variant="primary" busy={busy} disabled={busy} onClick={props.onRecover}>
              {tr("recover")}
            </PanelButton>
            <PanelButton disabled={busy} onClick={props.onShowRestore}>
              {tr("restoreAnotherMethod")}
            </PanelButton>
          </div>
          {props.discoveryReport}
        </>
      ) : props.flow === "create" ? (
        <>
          <p className="text-sm text-ink-muted">{tr("newWalletExplanation")}</p>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-sm font-medium text-ink">{tr("newSource")}</legend>
            <div className="flex flex-wrap gap-3">
              {(["random", "walletSignature"] as const).map((source) => (
                <label
                  key={source}
                  className={`${radioOptionClassName(props.rootSource === source, busy)} text-ink`}
                >
                  <input
                    type="radio"
                    name={`${id}-new-source`}
                    checked={props.rootSource === source}
                    onChange={() => props.onRootSourceChange(source)}
                  />
                  {tr(source === "random" ? "randomSource" : "signatureSource")}
                </label>
              ))}
            </div>
          </fieldset>
          {props.rootSource === "walletSignature" ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">{tr("createSignatureExplanation")}</p>
              {isAddress(props.account) ? (
                <p className="break-all text-xs text-ink-muted">
                  {tr("sourceWallet")}: {props.account}
                </p>
              ) : null}
              {!props.canSign ? (
                <p className="text-sm text-ink-muted">{tr("connectSignatureWallet")}</p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-ink-muted">{tr("newRootBackupHint")}</p>
          <div className="flex flex-wrap gap-3">
            <PanelButton
              variant="primary"
              busy={busy}
              disabled={busy || (props.rootSource === "walletSignature" && !props.canSign)}
              onClick={props.onCreate}
            >
              {tr("createNew")}
            </PanelButton>
            <PanelButton disabled={busy} onClick={props.onShowRestore}>
              {tr("showRestoreFunds")}
            </PanelButton>
          </div>
        </>
      ) : (
        <>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-sm font-medium text-ink">{tr("restorePath")}</legend>
            <div className="flex flex-wrap gap-3">
              {(["mnemonic", "shieldedKey", "signature"] as const).map((path) => (
                <label
                  key={path}
                  className={`${radioOptionClassName(props.restorePath === path, busy)} text-ink`}
                >
                  <input
                    type="radio"
                    name={`${id}-restore-path`}
                    checked={props.restorePath === path}
                    onChange={() => props.onRestorePathChange(path)}
                  />
                  {tr(
                    path === "mnemonic"
                      ? "mnemonicRestore"
                      : path === "shieldedKey"
                        ? "shieldedKeyRestore"
                        : "signatureRestore",
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {props.restorePath === "signature" ? (
            <div className="space-y-3">
              {isAddress(props.account) ? (
                <>
                  <p className="break-all text-xs text-ink-muted">
                    {tr("sourceWallet")}: {props.account}
                  </p>
                  <details className="text-xs text-ink-muted">
                    <summary className="cursor-pointer">{tr("signatureMessage")}</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-alt p-3">
                      {buildShieldedAssetSigningMessage(props.account)}
                    </pre>
                  </details>
                </>
              ) : null}
              {!props.canSign ? (
                <p className="text-sm text-ink-muted">{tr("connectSignatureWallet")}</p>
              ) : null}
            </div>
          ) : (
            secretInput(props.restorePath)
          )}
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">{tr("recoveryAuthority")}</p>
            <PanelButton
              variant="primary"
              busy={busy}
              disabled={busy || (props.restorePath === "signature" && !props.canSign)}
              onClick={
                props.restorePath === "signature" ? props.onRestoreSignature : props.onImport
              }
            >
              {tr(props.restorePath === "signature" ? "restoreSignature" : "importRecovery")}
            </PanelButton>
          </div>
          {props.canCreate ? (
            <div className="border-t border-hairline pt-4">
              <PanelButton disabled={busy} onClick={props.onShowCreate}>
                {tr("showCreateFunds")}
              </PanelButton>
            </div>
          ) : null}
        </>
      )}
      {props.showLock !== false || props.onUnlockIdentity ? (
        <div className="flex flex-wrap gap-3 border-t border-hairline pt-4">
          {props.onUnlockIdentity ? (
            <PanelButton disabled={busy} onClick={props.onUnlockIdentity}>
              {tr("continueIdentity")}
            </PanelButton>
          ) : null}
          {props.showLock !== false ? (
            <PanelButton onClick={props.onLock}>{t("shielded.lock")}</PanelButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
