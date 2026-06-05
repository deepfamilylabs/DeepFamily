import React from "react";
import type { TFunction } from "i18next";
import { BookOpen, Edit2, Image, Plus, ShieldCheck, Star, Trash2 } from "lucide-react";
import { ethers } from "ethers";
import { CopyIconButton } from "../../../shared/ui";
import {
  NodeData,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMinted,
  formatUnixSeconds,
} from "../../../shared/model";

type NodeDetailT = TFunction;
type NodeDetailRowColor = "purple" | "emerald" | "blue" | "amber" | "pink" | "slate";

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

function NodeDetailRow({
  label,
  value,
  copy,
  color = "slate",
  copyLabel,
  onCopy,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  copy?: string;
  color?: NodeDetailRowColor;
  copyLabel: string;
  onCopy: (text: string) => void;
}) {
  const containerClasses: Record<NodeDetailRowColor, string> = {
    purple:
      "border-l-purple-500/80 hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.25)]",
    emerald:
      "border-l-emerald-500/80 hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.25)]",
    blue: "border-l-blue-500/80 hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.25)]",
    amber:
      "border-l-amber-500/80 hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.25)]",
    pink: "border-l-pink-500/80 hover:shadow-[0_8px_30px_-4px_rgba(236,72,153,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(236,72,153,0.25)]",
    slate:
      "border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)]",
  };

  return (
    <div
      className={`group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] ${containerClasses[color]}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
          {label}
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono min-w-0 flex-1 break-all text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed">
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
        </div>
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
  return (
    <div className="flex items-center gap-2.5 mt-2 flex-wrap">
      {nodeData?.personHash && nodeData?.versionIndex !== undefined && (
        <button
          type="button"
          aria-label={t("people.clickToEndorse", "Click to endorse this version")}
          onClick={(e) => {
            e.stopPropagation();
            onOpenEndorse();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
          title={t("people.clickToEndorse", "Click to endorse this version")}
        >
          <Star className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
          <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
            {endorsementCount}
          </span>
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
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
          title={t("familyTree.nodeDetail.mintNFTTooltip", "Mint this person as an NFT")}
        >
          <Image className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
          <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
            {t("actions.mintNFT", "Mint NFT")}
          </span>
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
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
            title={t("familyTree.nodeDetail.viewFullStory", "View Full Story")}
          >
            <BookOpen className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
            <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
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
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
            title={t("familyTree.nodeDetail.editStory", "Edit Story")}
          >
            <Edit2 className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
            <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
              {t("familyTree.nodeDetail.edit", "Edit")}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

export function NodeDetailHashRows({
  t,
  nodeData,
  fallback,
  onCopy,
  onDecryptCid,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  fallback: { hash: string; versionIndex?: number };
  onCopy: (text: string) => void;
  onDecryptCid: (cid: string) => void;
}) {
  const copyLabel = t("search.copy", "Copy");

  return (
    <>
      <NodeDetailRow
        label={t("familyTree.nodeDetail.hash")}
        value={<SmartHash text={nodeData?.personHash || fallback.hash} />}
        copy={nodeData?.personHash || fallback.hash}
        color="purple"
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
        color="purple"
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
        color="blue"
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
        color="blue"
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
        color="pink"
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
        color="pink"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.addedBy")}
        value={<SmartAddress text={nodeData?.addedBy} />}
        copy={nodeData?.addedBy}
        color="emerald"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.timestamp")}
        value={formatUnixSeconds(nodeData?.timestamp)}
        color="amber"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.tag")}
        value={nodeData?.tag || "-"}
        color="slate"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailRow
        label={t("familyTree.nodeDetail.cid")}
        value={
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="block break-all min-w-0">{nodeData?.metadataCID || "-"}</span>
            {nodeData?.metadataCID && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDecryptCid(nodeData.metadataCID!);
                }}
                className="flex-shrink-0 whitespace-nowrap px-4 py-1.5 text-xs font-semibold rounded-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-white dark:hover:text-white hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none"
              >
                {t("familyTree.nodeDetail.decrypt", "Decrypt and View")}
              </button>
            )}
          </div>
        }
        copy={nodeData?.metadataCID ? nodeData.metadataCID : undefined}
        color="slate"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
    </>
  );
}

export function NodeDetailTrustedEndorsersSection({
  t,
  nodeData,
  access,
  onCopy,
}: {
  t: NodeDetailT;
  nodeData?: NodeData | null;
  access?: TrustedEndorserAccess;
  onCopy: (text: string) => void;
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
  const canEdit = Boolean(access && connected && addedBy && connected === addedBy);

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
    <div className="pt-4 space-y-2.5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 px-1">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        {t("familyTree.nodeDetail.trustedEndorsers", "Recommended Sources")}
      </h3>
      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
          {t("familyTree.nodeDetail.trustedLoading", "Loading recommended sources...")}
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
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
                    className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-white hover:bg-red-500 hover:border-red-500 disabled:opacity-50"
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
            color="emerald"
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
        ))
      )}
      {canEdit ? (
        <div className="flex items-center gap-2 px-1">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("familyTree.nodeDetail.trustedAddressPlaceholder", "0x account")}
            aria-label={t(
              "familyTree.nodeDetail.trustedAddressLabel",
              "Recommended account address",
            )}
            className="min-w-0 flex-1 h-9 px-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 font-mono"
          />
          <button
            type="button"
            onClick={() => void addAccount()}
            disabled={pending === "add"}
            className="inline-flex h-9 items-center gap-1.5 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t("familyTree.nodeDetail.addTrusted", "Add")}
          </button>
        </div>
      ) : null}
      {error ? <div className="text-xs text-red-500 dark:text-red-400 px-1">{error}</div> : null}
    </div>
  );
}

function NodeDetailStorySection({ t, story }: { t: NodeDetailT; story?: string }) {
  if (!story?.trim()) return null;

  return (
    <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-blue-500/80 hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.25)] transition-all duration-300">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
          {t("familyTree.nodeDetail.story")}
        </div>
        <div className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto font-medium">
          {story}
        </div>
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
    <>
      <div className="pt-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 px-1">
          <Image className="w-4 h-4 text-purple-600" />
          {t("familyTree.nodeDetail.nft")}
        </h3>
      </div>
      <NodeDetailRow
        label={t("familyTree.nodeDetail.tokenId")}
        value={nodeData!.tokenId}
        copy={nodeData!.tokenId}
        color="purple"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      {nodeData?.fullName && (
        <NodeDetailRow
          label={t("familyTree.nodeDetail.fullName")}
          value={nodeData.fullName}
          color="blue"
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
      )}
      {nodeData?.gender !== undefined && (
        <NodeDetailRow
          label={t("familyTree.nodeDetail.gender")}
          value={genderTextFn(nodeData.gender, t as any) || "-"}
          color="emerald"
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
        color="emerald"
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
        color="slate"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      <NodeDetailStorySection t={t} story={nodeData?.story} />
      <NodeDetailRow
        label={t("person.owner", "Owner Address")}
        value={<SmartAddress text={owner} />}
        copy={owner}
        color="amber"
        copyLabel={copyLabel}
        onCopy={onCopy}
      />
      {nodeData?.nftTokenURI && (
        <NodeDetailRow
          label={t("familyTree.nodeDetail.uri")}
          value={nodeData.nftTokenURI}
          copy={nodeData.nftTokenURI}
          color="slate"
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
      )}
    </>
  );
}
