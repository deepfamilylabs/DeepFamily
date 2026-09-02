import React from "react";
import type { TFunction } from "i18next";
import { Book, Edit2, Image, KeyRound, Plus, Star, Trash2 } from "lucide-react";
import { ethers } from "ethers";
import {
  CopyIconButton,
  MODAL_CARD,
  MODAL_FIELD_SM,
  ModalSectionHeading,
} from "../../../shared/ui";
import {
  NodeData,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMetadataUnlockUsable,
  isMinted,
  formatUnixSeconds,
} from "../../../shared/model";

type NodeDetailT = TFunction;

export interface TrustedEndorserAccess {
  connectedAddress?: string | null;
  loadTrustedEndorsers: (personHash: string, versionIndex: number) => Promise<string[]>;
  addTrustedEndorser: (personHash: string, versionIndex: number, account: string) => Promise<void>;
  removeTrustedEndorser: (
    personHash: string,
    versionIndex: number,
    account: string,
  ) => Promise<void>;
}

function SmartHash({ text }: { text?: string | null }) {
  if (!text || text === ethers.ZeroHash) return <span>-</span>;
  return <span className="block break-all">{text}</span>;
}

function SmartAddress({ text }: { text?: string | null }) {
  if (!text) return <span>-</span>;
  return <span className="block break-all">{text}</span>;
}

/**
 * One row of the on-chain record table: fixed label column, value, copy action.
 * Replaces the per-row rounded card with a coloured left rule and a tinted
 * shadow — six accent colours carried no meaning and made the list unscannable.
 */
function NodeDetailRow({
  label,
  value,
  copy,
  copyLabel,
  onCopy,
  action,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  copy?: string;
  copyLabel: string;
  onCopy: (text: string) => void;
  /** Trailing control for rows that offer one (e.g. Unlock). */
  action?: React.ReactNode;
}) {
  return (
    <div className="group flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="w-full shrink-0 break-words text-xs text-ink-muted sm:w-44">{label}</div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-ink">
          {value}
        </div>
        {copy ? (
          <CopyIconButton
            label={copyLabel}
            onClick={() => onCopy(copy)}
            visibility="group-hover"
            size="sm"
          />
        ) : null}
        {action}
      </div>
    </div>
  );
}

export function NodeDetailHeaderActions({
  t,
  nodeData,
  hasNFT,
  endorsementCount,
  onOpenEndorse,
  onOpenMint,
  onOpenPerson,
  onOpenEditor,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  hasNFT: boolean;
  endorsementCount: number;
  onOpenEndorse: () => void;
  onOpenMint: () => void;
  onOpenPerson: () => void;
  onOpenEditor: () => void;
}) {
  const action =
    "inline-flex h-[34px] shrink-0 items-center gap-1.5 px-3 rounded-lg border border-hairline-strong bg-surface text-ink text-[13px] font-semibold transition-colors hover:bg-surface-alt hover:border-primary focus:outline-hidden focus:ring-3 focus:ring-primary/15";

  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
  };

  return (
    <>
      {nodeData?.personHash && nodeData?.versionIndex !== undefined && (
        <button
          type="button"
          aria-label={t("people.clickToEndorse", "Click to endorse this version")}
          onClick={(e) => {
            e.stopPropagation();
            onOpenEndorse();
          }}
          {...stop}
          className="inline-flex h-[34px] shrink-0 items-center gap-1.5 px-3 rounded-lg bg-primary text-white dark:text-orange-950 text-[13px] font-semibold transition-colors hover:bg-primary-hover focus:outline-hidden focus:ring-3 focus:ring-primary/25"
          title={t("people.clickToEndorse", "Click to endorse this version")}
        >
          <Star className="w-[15px] h-[15px]" strokeWidth={1.9} aria-hidden />
          <span>{t("endorse.endorse", "Endorse")}</span>
          <span className="font-mono opacity-80">{endorsementCount}</span>
        </button>
      )}
      {!hasNFT && nodeData?.personHash && nodeData?.versionIndex !== undefined && (
        <button
          type="button"
          aria-label={t("familyTree.nodeDetail.mintNFTTooltip", "Mint this person as an NFT")}
          onClick={(e) => {
            e.stopPropagation();
            onOpenMint();
          }}
          {...stop}
          className={action}
          title={t("familyTree.nodeDetail.mintNFTTooltip", "Mint this person as an NFT")}
        >
          <Image className="w-[15px] h-[15px] text-ink-muted" strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">{t("actions.mintNFT", "Mint NFT")}</span>
        </button>
      )}
      {hasNFT && nodeData?.tokenId && (
        <>
          <button
            type="button"
            aria-label={t("familyTree.nodeDetail.viewFullStory", "View Full Story")}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPerson();
            }}
            {...stop}
            className={action}
            title={t("familyTree.nodeDetail.viewFullStory", "View Full Story")}
          >
            <Book className="w-[15px] h-[15px] text-ink-muted" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">
              {t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
            </span>
          </button>
          <button
            type="button"
            aria-label={t("familyTree.nodeDetail.editStory", "Edit Story")}
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor();
            }}
            {...stop}
            className={action}
            title={t("familyTree.nodeDetail.editStory", "Edit Story")}
          >
            <Edit2 className="w-[15px] h-[15px] text-ink-muted" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t("familyTree.nodeDetail.edit", "Edit")}</span>
          </button>
          <span className="flex-1" />
          <span className="inline-flex shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-full border border-purple-600/25 bg-purple-600/10 text-xs font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/15 dark:text-purple-300">
            <Image className="w-3.5 h-3.5" strokeWidth={1.9} aria-hidden />
            {t("familyTree.nodeDetail.minted", "Minted")} · #{nodeData.tokenId}
          </span>
        </>
      )}
    </>
  );
}

export function NodeDetailHashRows({
  t,
  nodeData,
  fallback,
  onCopy,
  onRequestMetadataUnlock,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  fallback: { hash: string; versionIndex?: number };
  onCopy: (text: string) => void;
  /** Omitted where batch unlocking is unavailable; the row then offers no action. */
  onRequestMetadataUnlock?: () => void;
}) {
  const copyLabel = t("search.copy", "Copy");
  const unlockedMetadata = nodeData && isMetadataUnlockUsable(nodeData) ? nodeData : undefined;
  const metadataUnlocked = Boolean(unlockedMetadata);

  return (
    <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
      <NodeDetailRow
        label={t("familyTree.nodeDetail.hash")}
        value={<SmartHash text={nodeData?.personHash || fallback.hash} />}
        copy={nodeData?.personHash || fallback.hash}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.version")}
        value={
          nodeData?.versionIndex !== undefined && Number(nodeData.versionIndex) > 0
            ? String(nodeData.versionIndex)
            : "-"
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.father")}
        value={<SmartHash text={nodeData?.fatherHash} />}
        copy={
          nodeData?.fatherHash && nodeData.fatherHash !== ethers.ZeroHash
            ? nodeData.fatherHash
            : undefined
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.fatherVersion")}
        value={
          nodeData && Number(nodeData.fatherVersionIndex) > 0
            ? String(nodeData.fatherVersionIndex)
            : "-"
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.mother")}
        value={<SmartHash text={nodeData?.motherHash} />}
        copy={
          nodeData?.motherHash && nodeData.motherHash !== ethers.ZeroHash
            ? nodeData.motherHash
            : undefined
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.motherVersion")}
        value={
          nodeData && Number(nodeData.motherVersionIndex) > 0
            ? String(nodeData.motherVersionIndex)
            : "-"
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.addedBy")}
        value={<SmartAddress text={nodeData?.addedBy} />}
        copy={nodeData?.addedBy}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.timestamp")}
        value={formatUnixSeconds(nodeData?.timestamp)}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.versionCommitment", "Version Commitment")}
        value={<SmartHash text={nodeData?.versionCommitment} />}
        copy={nodeData?.versionCommitment}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.metadataPointer", "Metadata Pointer")}
        value={<SmartAddress text={nodeData?.metadataPointer} />}
        copy={nodeData?.metadataPointer}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.metadataPayloadHash", "Metadata Payload Hash")}
        value={<SmartHash text={nodeData?.metadataPayloadHash} />}
        copy={nodeData?.metadataPayloadHash}
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.metadataPayloadLength", "Metadata Size")}
        value={
          Number.isInteger(nodeData?.metadataPayloadLength)
            ? `${nodeData!.metadataPayloadLength} bytes`
            : "-"
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.privateMetadata", "Private Version Metadata")}
        value={
          metadataUnlocked
            ? t("familyTree.nodeDetail.unlockedOnDevice", "Unlocked on this device")
            : t("familyTree.nodeDetail.locked", "Locked")
        }
        copyLabel={copyLabel}
        onCopy={onCopy}
        action={
          !metadataUnlocked && onRequestMetadataUnlock ? (
            <button
              type="button"
              onClick={onRequestMetadataUnlock}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-primary hover:bg-surface-alt focus:outline-hidden focus-visible:ring-3 focus-visible:ring-primary/15"
            >
              <KeyRound className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
              {t("metadataUnlock.openButton", "Unlock versions")}
            </button>
          ) : null
        }
      />
      {metadataUnlocked ? (
        <>
          <NodeDetailRow
            label={t("familyTree.nodeDetail.tag")}
            value={unlockedMetadata!.tag ?? ""}
            copy={unlockedMetadata!.tag || undefined}
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
          <NodeDetailStorySection
            label={t("familyTree.nodeDetail.versionBiography", "Encrypted Version Biography")}
            story={unlockedMetadata!.biography}
          />
        </>
      ) : null}
    </div>
  );
}

export function NodeDetailTrustedEndorsersSection({
  t,
  nodeData,
  access,
  owner,
  onCopy,
  managerResolving,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  access?: TrustedEndorserAccess;
  owner?: string;
  onCopy: (text: string) => void;
  /** True only while the manager lookup is still in flight. */
  managerResolving?: boolean;
}) {
  const [accounts, setAccounts] = React.useState<string[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const personHash = nodeData?.personHash;
  const versionIndex = Number(nodeData?.versionIndex || 0);
  const connected = access?.connectedAddress?.toLowerCase();
  const addedBy = nodeData?.addedBy?.toLowerCase();
  const ownerAddress = owner?.toLowerCase();
  const managerAddress = isMinted(nodeData) ? ownerAddress : addedBy;
  // Both sources arrive asynchronously — `addedBy` with the version details,
  // `owner` from a separate lookup that only starts once tokenId is known. While
  // one is in flight we cannot tell "not permitted" from "still checking", and
  // rendering read-only for both made the editor look absent on a first open.
  // Once the lookup settles without a manager we fall through to read-only
  // rather than spinning forever.
  const managerUnknown =
    Boolean(access && connected) && !managerAddress && Boolean(managerResolving);
  const canEdit = Boolean(access && connected && managerAddress && connected === managerAddress);

  const reload = React.useCallback(async () => {
    if (!access || !personHash || !versionIndex) return;
    setLoading(true);
    setError(null);
    try {
      setAccounts(await access.loadTrustedEndorsers(personHash, versionIndex));
    } catch {
      setError(t("familyTree.nodeDetail.trustedLoadFailed", "Failed to load recommended sources."));
    } finally {
      setLoading(false);
    }
  }, [access, personHash, t, versionIndex]);

  React.useEffect(() => {
    setAccounts([]);
    setInput("");
    setError(null);
    void reload();
  }, [reload]);

  if (!access || !personHash || !versionIndex) return null;

  const copyLabel = t("search.copy", "Copy");
  const normalizedInput = input.trim();
  const addAccount = async () => {
    if (!canEdit) return;
    if (!ethers.isAddress(normalizedInput)) {
      setError(t("familyTree.nodeDetail.invalidTrustedAddress", "Enter a valid account address."));
      return;
    }
    setPending("add");
    setError(null);
    try {
      await access.addTrustedEndorser(personHash, versionIndex, ethers.getAddress(normalizedInput));
      setInput("");
      await reload();
    } catch {
      setError(
        t("familyTree.nodeDetail.trustedUpdateFailed", "Failed to update recommended sources."),
      );
    } finally {
      setPending(null);
    }
  };

  const removeAccount = async (account: string) => {
    if (!canEdit) return;
    setPending(account.toLowerCase());
    setError(null);
    try {
      await access.removeTrustedEndorser(personHash, versionIndex, account);
      await reload();
    } catch {
      setError(
        t("familyTree.nodeDetail.trustedUpdateFailed", "Failed to update recommended sources."),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2.5">
      <ModalSectionHeading>
        {t("familyTree.nodeDetail.trustedEndorsers", "Recommended Sources")}
      </ModalSectionHeading>
      <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
        {loading ? (
          <div className="px-4 py-2.5 text-xs text-ink-muted">
            {t("familyTree.nodeDetail.trustedLoading", "Loading recommended sources...")}
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-4 py-2.5 text-xs text-ink-muted">
            {t("familyTree.nodeDetail.trustedEmpty", "No recommended sources. Filtering is off.")}
          </div>
        ) : (
          accounts.map((account) => (
            <NodeDetailRow
              key={account.toLowerCase()}
              label={t("familyTree.nodeDetail.trustedAccount", "Recommended Account")}
              value={
                <div className="flex items-center gap-2">
                  <SmartAddress text={account} />
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void removeAccount(account)}
                      disabled={pending === account.toLowerCase()}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-subtle transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                      aria-label={t(
                        "familyTree.nodeDetail.removeTrusted",
                        "Remove recommended source",
                      )}
                      title={t("familyTree.nodeDetail.removeTrusted", "Remove recommended source")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              }
              copy={account}
              copyLabel={copyLabel}
              onCopy={onCopy}
            />
          ))
        )}
        {managerUnknown ? (
          <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-ink-muted">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-hairline-strong border-t-transparent" />
            {t("familyTree.nodeDetail.trustedCheckingPermission", "Checking edit permission…")}
          </div>
        ) : canEdit ? (
          <div className="flex items-center gap-2 px-4 py-2.5">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("familyTree.nodeDetail.trustedAddressPlaceholder", "0x account")}
              aria-label={t(
                "familyTree.nodeDetail.trustedAddressLabel",
                "Recommended account address",
              )}
              className={`${MODAL_FIELD_SM} min-w-0 flex-1 font-mono`}
            />
            <button
              type="button"
              onClick={() => void addAccount()}
              disabled={pending === "add"}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-primary hover:bg-surface-alt disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t("familyTree.nodeDetail.addTrusted", "Add")}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <div className="text-xs text-danger">{error}</div> : null}
    </div>
  );
}

function NodeDetailStorySection({ label, story }: { label: React.ReactNode; story?: string }) {
  if (!story?.trim()) return null;

  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:gap-4">
      <div className="w-full shrink-0 break-words text-xs text-ink-muted sm:w-44">{label}</div>
      <div className="min-w-0 flex-1 max-h-[200px] overflow-y-auto whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-ink">
        {story}
      </div>
    </div>
  );
}

export function NodeDetailNftSection({
  t,
  nodeData,
  owner,
  onCopy,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  owner?: string;
  onCopy: (text: string) => void;
}) {
  if (!isMinted(nodeData)) return null;
  const copyLabel = t("search.copy", "Copy");

  return (
    <div className="space-y-2.5">
      <ModalSectionHeading>{t("familyTree.nodeDetail.nft")}</ModalSectionHeading>
      <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
        <NodeDetailRow
          label={t("familyTree.nodeDetail.tokenId")}
          value={nodeData!.tokenId}
          copy={nodeData!.tokenId}
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
        {nodeData?.fullName && (
          <NodeDetailRow
            label={t("familyTree.nodeDetail.fullName")}
            value={nodeData.fullName}
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
        )}
        {nodeData?.gender !== undefined && (
          <NodeDetailRow
            label={t("familyTree.nodeDetail.gender")}
            value={genderTextFn(nodeData.gender, t as any) || "-"}
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
        )}
        <NodeDetailRow
          label={t("familyTree.nodeDetail.birth")}
          value={(() => {
            const d = birthDateString(nodeData);
            const parts = [d, nodeData?.birthPlace].filter(Boolean);
            return parts.length ? parts.join(" · ") : "-";
          })()}
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
        <NodeDetailRow
          label={t("familyTree.nodeDetail.death")}
          value={(() => {
            const d = deathDateString(nodeData);
            const parts = [d, nodeData?.deathPlace].filter(Boolean);
            return parts.length ? parts.join(" · ") : "-";
          })()}
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
        <NodeDetailStorySection
          label={t("familyTree.nodeDetail.nftPublicStory", "Public NFT Summary")}
          story={nodeData?.nftPublicStory}
        />
        <NodeDetailRow
          label={t("person.owner", "Owner Address")}
          value={<SmartAddress text={owner} />}
          copy={owner}
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
        {nodeData?.nftTokenURI && (
          <NodeDetailRow
            label={t("familyTree.nodeDetail.uri")}
            value={nodeData.nftTokenURI}
            copy={nodeData.nftTokenURI}
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
        )}
      </div>
    </div>
  );
}
