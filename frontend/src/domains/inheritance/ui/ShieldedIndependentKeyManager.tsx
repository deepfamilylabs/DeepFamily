import { useId, useState, type ReactNode, type RefObject } from "react";
import { isAddress } from "ethers";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Eye } from "lucide-react";
import { buildShieldedIndependentKeySigningMessage } from "@deepfamily/protocol-core";
import type { ShieldedPublicIndependentKey } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { CopyIconButton } from "../../../shared/ui";
import {
  CHOICE_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  PanelButton,
  SuccessNotice,
  WarningNotice,
  choiceCardClass,
  shortHex,
} from "./inheritanceControls";
import {
  ShieldedRecoveryMaterialView,
  type ShieldedRecoveryMaterialHandle,
} from "./ShieldedRecoveryMaterialView";

export type ShieldedIndependentKeyRecoveryFormat = "mnemonic" | "shieldedKey";

export interface ShieldedIndependentKeyManagerProps {
  flow: "create" | "restore" | "backup";
  independentKey: ShieldedPublicIndependentKey | null;
  /** The key being backed up or restored, also while the backup drill has removed it. */
  fingerprint?: string;
  busy: boolean;
  backupFormat: ShieldedIndependentKeyRecoveryFormat;
  onBackupFormatChange: (value: ShieldedIndependentKeyRecoveryFormat) => void;
  exportedMaterialRef: RefObject<ShieldedRecoveryMaterialHandle>;
  recoveryMaterialRef: RefObject<HTMLTextAreaElement>;
  exportedFingerprint: string;
  externalSaved: boolean;
  onExternalSavedChange: (value: boolean) => void;
  verificationStarted: boolean;
  restorePath: ShieldedIndependentKeyRecoveryFormat | "signature";
  onRestorePathChange: (value: ShieldedIndependentKeyRecoveryFormat | "signature") => void;
  account: string;
  canSign: boolean;
  /** Credentials are already unlocked; proofs may be unavailable for their identity suite. */
  identityReady?: boolean;
  /** A scan without a matching historical note does not confirm the original wallet. */
  recoveryScanned?: boolean;
  /** Each generation method creates the key directly; there is no separate confirm step. */
  onCreate: (source: "random" | "walletSignature") => void;
  onExport: () => void;
  onBeginVerification: () => void;
  onImport: () => void;
  onRestoreSignature: () => void;
  /** Scans the selected pool, then every verified factory pool; history there can confirm a candidate. */
  onRecover: () => void;
  discoveryReport?: ReactNode;
  onShowRestore: () => void;
  onCopyFingerprint: () => void;
  /** The initial entry has no workspace navigation and can still open identity unlock. */
  onUnlockIdentity?: () => void;
  onLock: () => void;
  /** The workspace already provides the session exit beside the asset overview. */
  showLock?: boolean;
  /** In the wallet sheet the main action stays at the bottom while the content scrolls. */
  pinnedActions?: boolean;
}

/** Two or three mutually exclusive choices, shown as one segmented control. */
function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="mb-2 text-[13px] font-medium text-ink/80">{legend}</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-1 rounded-xl bg-surface-muted p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-[9px] px-2.5 text-center text-[13px] font-medium transition-colors ${
                selected ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"
              } ${disabled ? "cursor-default" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={name}
                className={`${CHOICE_INPUT} h-3.5 w-3.5`}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Public flow state lives in React; recovery secrets stay in the DOM and in uncontrolled inputs. */
export function ShieldedIndependentKeyManager(props: ShieldedIndependentKeyManagerProps) {
  const { t } = useTranslation();
  const id = useId();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const { independentKey, busy } = props;
  const [creatingSource, setCreatingSource] = useState<"random" | "walletSignature" | null>(null);
  const backupPending = !!independentKey?.backupRequired || !!props.exportedFingerprint;
  const verification = props.verificationStarted;
  const backup = props.flow === "backup" || backupPending || verification;
  const restored = !!independentKey?.recoveryVerified && !independentKey.backupRequired && !backup;
  const candidate = !!independentKey && !independentKey.recoveryVerified && !independentKey.backupRequired && !backup;
  const fingerprint = independentKey?.keyFingerprint || props.fingerprint || "";
  const sourceLabel = independentKey
    ? tr(
        independentKey.rootSource === "random"
          ? "randomSource"
          : independentKey.rootSource === "walletSignature"
            ? "signatureSource"
            : "importedSource",
      )
    : "";

  const keySummary =
    sourceLabel || fingerprint ? (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface-alt px-3.5 py-3 text-xs text-ink-muted">
        {sourceLabel ? (
          <span className="rounded-full border border-hairline bg-surface px-2 py-0.5 font-medium text-ink/80">
            {sourceLabel}
          </span>
        ) : null}
        {fingerprint ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{tr("keyFingerprint")}</span>
            <code className="min-w-0 truncate font-mono text-ink/80" title={fingerprint}>
              {shortHex(fingerprint)}
            </code>
            <CopyIconButton
              size="xs"
              label={tr("copyKeyFingerprint")}
              onClick={props.onCopyFingerprint}
            />
          </span>
        ) : null}
      </div>
    ) : null;

  const stepper = backup ? (
    <ol className="flex items-center gap-2.5">
      {(
        [
          { label: tr("backupSaveStep"), state: verification ? "done" : "current" },
          { label: tr("backupVerifyStep"), state: verification ? "current" : "pending" },
        ] as const
      ).map((step, index) => (
        <li
          key={step.label}
          aria-current={step.state === "current" ? "step" : undefined}
          className={`flex min-w-0 items-center gap-2.5 ${index > 0 ? "flex-1" : ""}`}
        >
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`h-0.5 min-w-4 flex-1 rounded-full ${verification ? "bg-success" : "bg-hairline"}`}
            />
          ) : null}
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.state === "done"
                  ? "bg-success text-white"
                  : step.state === "current"
                    ? "bg-orange-700 text-white dark:bg-primary dark:text-orange-950"
                    : "bg-surface-muted text-ink-muted"
              }`}
            >
              {step.state === "done" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={`min-w-0 text-[13px] ${
                step.state === "current" ? "font-semibold text-ink" : "font-medium text-ink-muted"
              }`}
            >
              {step.label}
            </span>
          </span>
        </li>
      ))}
    </ol>
  ) : null;

  const secretInput = (format: ShieldedIndependentKeyRecoveryFormat) => (
    <FieldBlock
      label={tr(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
      htmlFor={`${id}-recovery-material`}
    >
      <textarea
        key={format}
        id={`${id}-recovery-material`}
        ref={props.recoveryMaterialRef}
        aria-label={tr(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput")}
        className={`${FIELD_TEXTAREA} min-h-24 py-3 text-[13px]`}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        disabled={busy}
      />
    </FieldBlock>
  );

  // The sheet body pads 1.25rem / 1.75rem sideways and 1.5rem below; the bar spans that edge.
  const actions = (children: ReactNode) =>
    props.pinnedActions ? (
      <div className="sticky bottom-0 z-10 -mx-5 -mb-6 border-t border-hairline/70 bg-surface px-5 pb-6 pt-4 sm:-mx-7 sm:px-7">
        {children}
      </div>
    ) : (
      children
    );

  const savedConfirmation = (
    <>
      <label
        className={`flex items-start gap-2.5 px-3.5 py-3 text-sm leading-relaxed text-ink ${choiceCardClass(
          props.externalSaved,
          busy || !props.exportedFingerprint,
        )}`}
      >
        <input
          type="checkbox"
          className={`${CHOICE_INPUT} mt-0.5 h-[18px] w-[18px] rounded`}
          checked={props.externalSaved}
          disabled={busy || !props.exportedFingerprint}
          onChange={(event) => props.onExternalSavedChange(event.target.checked)}
        />
        {tr("savedExternal")}
      </label>
      {actions(
        <PanelButton
          variant="primary"
          size="large"
          className="w-full"
          disabled={busy || !props.exportedFingerprint || !props.externalSaved}
          onClick={props.onBeginVerification}
        >
          {tr("beginIndependentImport")}
        </PanelButton>,
      )}
    </>
  );

  return (
    <div className="min-w-0 space-y-5">
      {stepper}
      {restored ? (
        <>
          <SuccessNotice>
            <p className="font-medium">{tr("independentKeyRecoveredTitle")}</p>
            {!props.identityReady ? <p>{tr("independentKeyRestoredIdentityHint")}</p> : null}
          </SuccessNotice>
          {keySummary}
          {props.discoveryReport}
        </>
      ) : verification ? (
        <>
          <div className="space-y-2">
            <p role="status" className="text-sm leading-relaxed text-ink">
              {tr("reenterBackup")}
            </p>
            <p className="text-[13px] leading-relaxed text-ink-muted">{tr("backupVerifyHint")}</p>
          </div>
          {keySummary}
          {secretInput(props.backupFormat)}
          {actions(
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={busy}
              onClick={props.onImport}
            >
              {tr("verifySavedBackup")}
            </PanelButton>,
          )}
        </>
      ) : backup ? (
        <>
          <p className="text-sm leading-relaxed text-ink">{tr("independentBackupGate")}</p>
          {keySummary}
          {independentKey ? (
            <>
              <div className="space-y-2">
                <Segmented
                  name={`${id}-backup-format`}
                  legend={tr("backupFormat")}
                  value={props.backupFormat}
                  disabled={busy}
                  onChange={props.onBackupFormatChange}
                  options={[
                    { value: "mnemonic", label: tr("mnemonicFormat") },
                    { value: "shieldedKey", label: tr("shieldedKeyFormat") },
                  ]}
                />
                <p className="text-xs leading-relaxed text-ink-muted">
                  {tr("recoveryFormatsExplanation")}
                </p>
              </div>
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    id={`${id}-exported-material`}
                    className="text-[13px] font-medium text-ink/80"
                  >
                    {tr("exportedRecoveryMaterial")}
                  </span>
                  <PanelButton size="compact" busy={busy} disabled={busy} onClick={props.onExport}>
                    {busy ? null : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                    {tr("exportRecovery")}
                  </PanelButton>
                </div>
                {/* Mounted before export so the Worker response can go directly into the DOM. */}
                <ShieldedRecoveryMaterialView
                  ref={props.exportedMaterialRef}
                  format={props.backupFormat}
                  labelledBy={`${id}-exported-material`}
                />
                <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-xs leading-relaxed text-ink">
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <span>{tr("recoveryMaterialSecret")}</span>
                </p>
              </div>
              {savedConfirmation}
            </>
          ) : (
            <>
              <WarningNotice>{tr("backupSessionLocked")}</WarningNotice>
              {props.exportedFingerprint ? savedConfirmation : null}
            </>
          )}
        </>
      ) : candidate ? (
        <>
          <WarningNotice>{tr("recoveryCandidate")}</WarningNotice>
          {keySummary}
          {props.recoveryScanned ? (
            <p role="status" className="text-sm leading-relaxed text-ink-muted">
              {tr("recoveryCandidateHistoryMissing")}
            </p>
          ) : null}
          {props.discoveryReport}
          {actions(
            <div className="flex flex-wrap gap-3">
              <PanelButton variant="primary" busy={busy} disabled={busy} onClick={props.onRecover}>
                {tr("recover")}
              </PanelButton>
              <PanelButton disabled={busy} onClick={props.onShowRestore}>
                {tr("restoreAnotherMethod")}
              </PanelButton>
            </div>,
          )}
        </>
      ) : props.flow === "create" ? (
        <>
          <fieldset className="min-w-0 space-y-2" disabled={busy}>
            <legend className="mb-2 text-[13px] font-medium text-ink/80">{tr("newSource")}</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-2">
              {(["random", "walletSignature"] as const).map((source) => {
                // Nothing is preselected; choosing a method creates the key and stays
                // checked only while that creation runs, so a failure can be retried.
                const unavailable = source === "walletSignature" && !props.canSign;
                const checked = busy && creatingSource === source;
                return (
                  <label
                    key={source}
                    className={`flex min-h-12 items-center gap-3 px-3.5 text-sm font-medium text-ink ${choiceCardClass(
                      checked,
                      busy || unavailable,
                    )}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-new-source`}
                      className={CHOICE_INPUT}
                      checked={checked}
                      disabled={unavailable}
                      onChange={() => {
                        setCreatingSource(source);
                        props.onCreate(source);
                      }}
                    />
                    {tr(source === "random" ? "randomSource" : "signatureSource")}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {!props.canSign ? (
            <p className="text-sm text-ink-muted">{tr("connectSignatureWallet")}</p>
          ) : null}
        </>
      ) : (
        <>
          <Segmented
            name={`${id}-restore-path`}
            legend={tr("restorePath")}
            value={props.restorePath}
            disabled={busy}
            onChange={props.onRestorePathChange}
            options={[
              { value: "mnemonic", label: tr("mnemonicRestore") },
              { value: "shieldedKey", label: tr("shieldedKeyRestore") },
              { value: "signature", label: tr("signatureRestore") },
            ]}
          />
          {props.restorePath === "signature" ? (
            <div className="space-y-3">
              {isAddress(props.account) ? (
                <details className="text-xs text-ink-muted">
                  <summary className="cursor-pointer">{tr("signatureMessage")}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-alt p-3">
                    {buildShieldedIndependentKeySigningMessage(props.account)}
                  </pre>
                </details>
              ) : null}
              {!props.canSign ? (
                <p className="text-sm text-ink-muted">{tr("connectSignatureWallet")}</p>
              ) : null}
            </div>
          ) : (
            secretInput(props.restorePath)
          )}
          {actions(
            <PanelButton
              variant="primary"
              size="large"
              className="w-full"
              busy={busy}
              disabled={busy || (props.restorePath === "signature" && !props.canSign)}
              onClick={
                props.restorePath === "signature" ? props.onRestoreSignature : props.onImport
              }
            >
              {tr(props.restorePath === "signature" ? "restoreSignature" : "importRecovery")}
            </PanelButton>,
          )}
        </>
      )}
      {props.showLock !== false || props.onUnlockIdentity ? (
        <div className="flex flex-wrap gap-3 border-t border-hairline/70 pt-4">
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
