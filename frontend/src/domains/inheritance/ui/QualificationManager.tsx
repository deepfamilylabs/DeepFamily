import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReceiveChain } from "../../../shared/clients/receiveChain";
import type {
  ReceiveWorkerClient,
  ReceiveWorkerContext,
} from "../../../shared/workers/receiveWorkerClient";
import type {
  QualificationManagementView,
  QualificationSourceView,
  WalletStateView,
} from "../../../shared/workers/walletWorkerTypes";
import { CopyIconButton } from "../../../shared/ui";
import {
  FIELD_INPUT,
  FIELD_TEXTAREA,
  FieldBlock,
  PanelButton,
  TaskSection,
  shortHex,
} from "./inheritanceControls";

export interface QualificationOperation {
  worker: ReceiveWorkerClient;
  context: ReceiveWorkerContext;
  account: string | null;
  chain: ReceiveChain | null;
  assertCurrent(): void;
}
interface Props {
  busy: boolean;
  openOperation(): QualificationOperation;
  run(operation: () => Promise<void>): Promise<void>;
  save(result: { state: WalletStateView; backup: Uint8Array }): Promise<void>;
  changed(): Promise<void>;
}
function downloadPackage(bytes: Uint8Array, id: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `qualification-${id.slice(0, 16)}.dfqualification`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Public requests and encrypted handoffs only; all openings remain in the wallet worker. */
export function QualificationManager(props: Props) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`qualificationManager.${key}`);
  const initial = useRef(props),
    alive = useRef(true);
  const [view, setView] = useState<QualificationManagementView>({
    requests: [],
    sources: [],
    canRequest: false,
  });
  const [tab, setTab] = useState<"request" | "source" | "roles">("request");
  const [password, setPassword] = useState("");
  const [parent, setParent] = useState(""),
    [version, setVersion] = useState("1"),
    [endorser, setEndorser] = useState("");
  const [request, setRequest] = useState(""),
    [kind, setKind] = useState<"fact" | "trust">("fact");
  const [requestId, setRequestId] = useState(""),
    [sourceId, setSourceId] = useState("");
  const [sourceTransaction, setSourceTransaction] = useState(""),
    [issueTransaction, setIssueTransaction] = useState("");
  const [withdrawRelationship, setWithdrawRelationship] = useState(false),
    [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedRequest = view.requests.find((item) => item.id === requestId);
  const selectedSource = view.sources.find((item) => item.id === sourceId);
  const passwordForAction = () => {
    if (password.length < 12) throw new Error(t("walletProtocol.passwordLength"));
    const value = password;
    setPassword("");
    return value;
  };
  const assertActive = (operation: QualificationOperation) => {
    operation.assertCurrent();
    if (!alive.current) throw new Error(t("walletProtocol.walletChanged"));
  };
  const refresh = async (operation: QualificationOperation) => {
    const result = await operation.worker.call(
      "walletReadQualificationManagement",
      {},
      operation.context,
    );
    assertActive(operation);
    setView(result);
    setRequestId((previous) =>
      result.requests.some((item) => item.id === previous)
        ? previous
        : (result.requests.slice(-1)[0]?.id ?? ""),
    );
    setSourceId((previous) =>
      result.sources.some((item) => item.id === previous)
        ? previous
        : (result.sources.slice(-1)[0]?.id ?? ""),
    );
  };
  useEffect(() => {
    alive.current = true;
    const first = initial.current;
    void first.run(async () => {
      const operation = first.openOperation();
      const result = await operation.worker.call(
        "walletReadQualificationManagement",
        {},
        operation.context,
      );
      operation.assertCurrent();
      if (!alive.current) return;
      setView(result);
      setRequestId(result.requests.slice(-1)[0]?.id ?? "");
      setSourceId(result.sources.slice(-1)[0]?.id ?? "");
    });
    return () => {
      alive.current = false;
    };
  }, []);
  const act = (action: (operation: QualificationOperation) => Promise<void>) =>
    props.run(async () => {
      setNotice("");
      const operation = props.openOperation();
      await action(operation);
    });
  const save = async (
    operation: QualificationOperation,
    result: { state: WalletStateView; backup: Uint8Array },
  ) => {
    assertActive(operation);
    await props.save(result);
    assertActive(operation);
  };
  const requireChain = (operation: QualificationOperation) => {
    if (!operation.chain || !operation.account) throw new Error(t("walletProtocol.connect"));
    return operation.chain;
  };
  const createRequest = () =>
    act(async (operation) => {
      const result = await operation.worker.call(
        "walletCreateQualificationRequest",
        {
          parentPersonHash: parent.trim(),
          parentVersion: version,
          endorser: endorser.trim(),
          rawPassphrase: passwordForAction(),
        },
        operation.context,
      );
      await save(operation, result);
      await refresh(operation);
      setRequestId(result.requestId);
      setRequest(result.request);
      setNotice(tr("requestCreated"));
    });
  const importPackage = (file: File) =>
    act(async (operation) => {
      const rawPassphrase = passwordForAction();
      if (file.size > 8192) throw new Error(tr("invalidPackage"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      assertActive(operation);
      const result = await operation.worker.call(
        "walletImportSourcePackage",
        { package: bytes, rawPassphrase },
        operation.context,
      );
      await save(operation, result);
      await refresh(operation);
      setRequestId(result.requestId);
      setNotice(tr("packageImported"));
    });
  const confirmSource = async (
    operation: QualificationOperation,
    draftId: string,
    transactionHash: string,
    rawPassphrase: string,
  ) => {
    const result = await operation.worker.call(
      "walletConfirmSourcePublication",
      { draftId, ...(transactionHash ? { transactionHash } : {}), rawPassphrase },
      operation.context,
    );
    await save(operation, result);
    downloadPackage(result.package, draftId);
    await refresh(operation);
    setSourceTransaction("");
    setNotice(tr("sourceConfirmed"));
  };
  const publish = (source?: QualificationSourceView) =>
    act(async (operation) => {
      const chain = requireChain(operation),
        rawPassphrase = passwordForAction();
      const prepared = await operation.worker.call(
        "walletPrepareSourcePublication",
        {
          kind: source?.kind ?? kind,
          request: source?.request ?? request.trim(),
          controller: operation.account!,
          rawPassphrase,
          ...(source ? { draftId: source.id } : {}),
        },
        operation.context,
      );
      await save(operation, prepared);
      setSourceId(prepared.draftId);
      // The encrypted controller backup is saved before a publication can make its roles active.
      assertActive(operation);
      const transaction =
        prepared.kind === "fact"
          ? await chain.sendSourceFact(prepared)
          : await chain.sendSourceTrust(prepared);
      assertActive(operation);
      setSourceTransaction(transaction.hash);
      const receipt = await transaction.wait();
      assertActive(operation);
      if (!receipt || receipt.status !== 1) throw new Error(t("walletProtocol.failed"));
      await confirmSource(operation, prepared.draftId, transaction.hash, rawPassphrase);
    });
  const issue = () =>
    act(async (operation) => {
      const chain = requireChain(operation),
        rawPassphrase = passwordForAction();
      const prepared = await operation.worker.call(
        "walletPrepareQualificationIssue",
        { requestId, rawPassphrase },
        operation.context,
      );
      await save(operation, prepared);
      assertActive(operation);
      const transaction = await chain.sendCredentialRegistration(prepared);
      assertActive(operation);
      setIssueTransaction(transaction.hash);
      const receipt = await transaction.wait();
      assertActive(operation);
      if (!receipt || receipt.status !== 1) throw new Error(t("walletProtocol.failed"));
      const result = await operation.worker.call(
        "walletConfirmQualificationIssue",
        { requestId, transactionHash: transaction.hash, rawPassphrase },
        operation.context,
      );
      await save(operation, result);
      await refresh(operation);
      await props.changed();
      setIssueTransaction("");
      setNotice(tr("qualificationIssued"));
    });
  const revoke = () =>
    act(async (operation) => {
      if (!revokeConfirmed || !selectedSource) throw new Error(tr("confirmRevocation"));
      const chain = requireChain(operation);
      const prepared = await operation.worker.call(
        "walletPrepareRoleRevocation",
        { sourceId, withdrawRelationship },
        operation.context,
      );
      assertActive(operation);
      const transaction = await chain.sendRoleRevocation(prepared);
      const receipt = await transaction.wait();
      assertActive(operation);
      if (!receipt || receipt.status !== 1) throw new Error(t("walletProtocol.failed"));
      await refresh(operation);
      await props.changed();
      setRevokeConfirmed(false);
      setNotice(tr("revoked"));
    });
  const field = (label: string, value: string, change: (value: string) => void, type = "text") => (
    <FieldBlock label={tr(label)}>
      <input
        aria-label={tr(label)}
        className={FIELD_INPUT}
        value={value}
        type={type}
        disabled={props.busy}
        autoComplete="off"
        onChange={(event) => change(event.target.value)}
      />
    </FieldBlock>
  );
  return (
    <section
      data-testid="qualification-manager"
      className="min-w-0 space-y-5"
      aria-label={tr("title")}
    >
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{tr("description")}</p>
      <nav
        aria-label={tr("actions")}
        className="flex flex-wrap gap-2 border-b border-hairline pb-4"
      >
        {(["request", "source", "roles"] as const).map((value) => (
          <PanelButton
            key={value}
            size="compact"
            disabled={props.busy}
            aria-pressed={tab === value}
            variant={tab === value ? "primary" : "secondary"}
            onClick={() => {
              setTab(value);
              setNotice("");
            }}
          >
            {tr(value)}
          </PanelButton>
        ))}
        <PanelButton size="compact" disabled={props.busy} onClick={() => void act(refresh)}>
          {tr("refresh")}
        </PanelButton>
      </nav>
      {field("backupPassword", password, setPassword, "password")}
      <p className="text-xs leading-relaxed text-ink-muted">{tr("backupHint")}</p>
      {tab === "request" ? (
        <div data-testid="qualification-request">
          <TaskSection id="qualification-request-create" step={1} title={tr("createRequest")}>
            {!view.canRequest ? (
              <p className="text-sm text-ink-muted">{tr("familyWalletRequired")}</p>
            ) : (
              <>
                {field("parentHash", parent, setParent)}
                <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                  {field("parentVersion", version, setVersion, "number")}
                  {field("endorser", endorser, setEndorser)}
                </div>
                <PanelButton
                  disabled={props.busy || !parent || !endorser}
                  onClick={() => void createRequest()}
                >
                  {tr("createRequest")}
                </PanelButton>
              </>
            )}
          </TaskSection>
          <TaskSection id="qualification-request-sources" step={2} title={tr("receiveSources")}>
            <FieldBlock label={tr("savedRequest")}>
              <select
                aria-label={tr("savedRequest")}
                className={FIELD_INPUT}
                value={requestId}
                disabled={props.busy}
                onChange={(event) => setRequestId(event.target.value)}
              >
                <option value="">{tr("chooseRequest")}</option>
                {view.requests.map((item, index) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >{`${index + 1}. ${shortHex(item.parentPersonHash)} · ${item.parentVersion}`}</option>
                ))}
              </select>
            </FieldBlock>
            {selectedRequest ? (
              <>
                <FieldBlock label={tr("requestText")}>
                  <textarea
                    aria-label={tr("requestText")}
                    className={FIELD_TEXTAREA}
                    value={selectedRequest.request}
                    readOnly
                    rows={4}
                  />
                </FieldBlock>
                <CopyIconButton
                  label={tr("copyRequest")}
                  onClick={() => void navigator.clipboard.writeText(selectedRequest.request)}
                />
                <p className="text-sm text-ink-muted">{tr("shareRequest")}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    {tr("fact")}: {tr(selectedRequest.hasFact ? "received" : "waiting")}
                  </span>
                  <span>
                    {tr("trust")}: {tr(selectedRequest.hasTrust ? "received" : "waiting")}
                  </span>
                </div>
                <FieldBlock label={tr("packageFile")}>
                  <input
                    aria-label={tr("packageFile")}
                    type="file"
                    accept=".dfqualification,application/octet-stream"
                    disabled={props.busy || !password}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void importPackage(file);
                    }}
                  />
                </FieldBlock>
              </>
            ) : (
              <p className="text-sm text-ink-muted">{tr("noRequests")}</p>
            )}
          </TaskSection>
          <div data-testid="qualification-issue">
            <TaskSection id="qualification-request-issue" step={3} title={tr("issue")}>
              <p className="text-sm leading-relaxed text-ink-muted">{tr("issueDescription")}</p>
              <PanelButton
                variant="primary"
                disabled={
                  props.busy ||
                  !selectedRequest?.hasFact ||
                  !selectedRequest.hasTrust ||
                  selectedRequest.issued
                }
                onClick={() => void issue()}
              >
                {tr("issue")}
              </PanelButton>
              {selectedRequest?.issued ? (
                <p role="status" className="text-sm text-success">
                  {tr("qualificationIssued")}
                </p>
              ) : null}
              {selectedRequest && !selectedRequest.issued ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-ink-muted">
                    {tr("resumeRegistration")}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {field("issueTransaction", issueTransaction, setIssueTransaction)}
                    <p className="text-xs text-ink-muted">{tr("recoveryLookup")}</p>
                    <PanelButton
                      disabled={props.busy}
                      onClick={() =>
                        void act(async (operation) => {
                          const result = await operation.worker.call(
                            "walletConfirmQualificationIssue",
                            {
                              requestId,
                              ...(issueTransaction.trim()
                                ? { transactionHash: issueTransaction.trim() }
                                : {}),
                              rawPassphrase: passwordForAction(),
                            },
                            operation.context,
                          );
                          await save(operation, result);
                          await refresh(operation);
                          await props.changed();
                          setIssueTransaction("");
                          setNotice(tr("qualificationIssued"));
                        })
                      }
                    >
                      {tr("confirmRegistration")}
                    </PanelButton>
                  </div>
                </details>
              ) : null}
            </TaskSection>
          </div>
        </div>
      ) : null}
      {tab === "source" ? (
        <div data-testid="qualification-source" className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{tr("sourceDescription")}</p>
          <FieldBlock label={tr("incomingRequest")}>
            <textarea
              aria-label={tr("incomingRequest")}
              className={FIELD_TEXTAREA}
              rows={4}
              disabled={props.busy}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={tr("sourceKind")}>
            <select
              aria-label={tr("sourceKind")}
              className={FIELD_INPUT}
              value={kind}
              disabled={props.busy}
              onChange={(event) => setKind(event.target.value as "fact" | "trust")}
            >
              <option value="fact">{tr("fact")}</option>
              <option value="trust">{tr("trust")}</option>
            </select>
          </FieldBlock>
          <PanelButton
            variant="primary"
            disabled={props.busy || !request.trim()}
            onClick={() => void publish()}
          >
            {tr("publish")}
          </PanelButton>
          <p className="text-xs leading-relaxed text-ink-muted">{tr("sourceBackupHint")}</p>
        </div>
      ) : null}
      {tab === "roles" ? (
        <div data-testid="qualification-roles" className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{tr("rolesDescription")}</p>
          <FieldBlock label={tr("savedSource")}>
            <select
              aria-label={tr("savedSource")}
              className={FIELD_INPUT}
              value={sourceId}
              disabled={props.busy}
              onChange={(event) => {
                setSourceId(event.target.value);
                setRevokeConfirmed(false);
                setWithdrawRelationship(false);
              }}
            >
              <option value="">{tr("chooseSource")}</option>
              {view.sources.map((item, index) => (
                <option
                  key={item.id}
                  value={item.id}
                >{`${index + 1}. ${tr(item.kind)} · ${shortHex(item.kind === "fact" ? item.childPersonHash : item.parentPersonHash)} · ${tr(item.revoked ? "revokedStatus" : item.published ? "published" : "draft")}`}</option>
              ))}
            </select>
          </FieldBlock>
          {selectedSource ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">{tr("controller")}</dt>
                <dd className="break-all">{selectedSource.controller}</dd>
                <dt className="text-ink-muted">{tr("parentHash")}</dt>
                <dd className="break-all">{selectedSource.parentPersonHash}</dd>
                <dt className="text-ink-muted">{tr("endorser")}</dt>
                <dd className="break-all">{selectedSource.endorser}</dd>
              </dl>
              {selectedSource.published ? (
                <PanelButton
                  disabled={props.busy || selectedSource.revoked}
                  onClick={() =>
                    void act(async (operation) => {
                      const result = await operation.worker.call(
                        "walletExportSourcePackage",
                        { sourceId },
                        operation.context,
                      );
                      assertActive(operation);
                      downloadPackage(result.package, sourceId);
                      setNotice(tr("packageExported"));
                    })
                  }
                >
                  {tr("exportPackage")}
                </PanelButton>
              ) : (
                <div className="space-y-3">
                  <PanelButton disabled={props.busy} onClick={() => void publish(selectedSource)}>
                    {tr("resumePublication")}
                  </PanelButton>
                  {field("sourceTransaction", sourceTransaction, setSourceTransaction)}
                  <p className="text-xs text-ink-muted">{tr("recoveryLookup")}</p>
                  <PanelButton
                    disabled={props.busy}
                    onClick={() =>
                      void act((operation) =>
                        confirmSource(
                          operation,
                          sourceId,
                          sourceTransaction.trim(),
                          passwordForAction(),
                        ),
                      )
                    }
                  >
                    {tr("confirmPublication")}
                  </PanelButton>
                </div>
              )}
              {selectedSource.published && !selectedSource.revoked ? (
                <div className="space-y-3 border-t border-hairline pt-4">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={withdrawRelationship}
                      disabled={props.busy}
                      onChange={(event) => setWithdrawRelationship(event.target.checked)}
                    />
                    {tr(selectedSource.kind === "fact" ? "withdrawEndorsement" : "withdrawTrust")}
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      aria-label={tr("confirmRevocation")}
                      type="checkbox"
                      checked={revokeConfirmed}
                      disabled={props.busy}
                      onChange={(event) => setRevokeConfirmed(event.target.checked)}
                    />
                    {tr("confirmRevocation")}
                  </label>
                  <PanelButton
                    disabled={props.busy || !revokeConfirmed}
                    onClick={() => void revoke()}
                  >
                    {tr("revoke")}
                  </PanelButton>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-muted">{tr("noSources")}</p>
          )}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
