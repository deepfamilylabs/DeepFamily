import React from "react";
import { createPortal } from "react-dom";
import { X, Clipboard, Edit2, User, Image, Star, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ethers } from "ethers";
import {
  NodeData,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMinted,
  formatUnixSeconds,
} from "../../../shared/model";
import { useNavigate } from "react-router-dom";
import { useTreeNodeAccess } from "../../tree/context";
import { useEndorseModal } from "./EndorseModalProvider";

export default function NodeDetailModal({
  open,
  onClose,
  nodeData,
  fallback,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  nodeData?: NodeData | null;
  fallback: { hash: string; versionIndex?: number };
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  // Track close origin to coordinate with history state
  const pushedRef = React.useRef(false);
  const closedBySelfRef = React.useRef(false);
  const closedByPopRef = React.useRef(false);
  const copyText = React.useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);
  const [centerHint, setCenterHint] = React.useState<string | null>(null);
  const [entered, setEntered] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState(0);
  const startYRef = React.useRef<number | null>(null);
  const navigate = useNavigate();
  const { getOwnerOf } = useTreeNodeAccess();
  const { openEndorse } = useEndorseModal();
  const [owner, setOwner] = React.useState<string | undefined>(nodeData?.owner);
  const [endorsementCount, setEndorsementCount] = React.useState<number>(
    nodeData?.endorsementCount ?? 0,
  );
  const handleClose = React.useCallback(() => {
    closedBySelfRef.current = true;
    onClose();
  }, [onClose]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // Push a history state on open so mobile back closes modal first
  React.useEffect(() => {
    if (!open) return;
    try {
      window.history.pushState({ __dfNodeDetailModal: true }, "");
      pushedRef.current = true;
    } catch {}
    const onPop = () => {
      // Back pressed: close modal without adding another back
      closedByPopRef.current = true;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // If user closed via modal (click overlay/drag/Escape/button) and we pushed a state,
      // consume the extra history entry so URL stays at the same route.
      if (pushedRef.current && closedBySelfRef.current && !closedByPopRef.current) {
        try {
          window.history.back();
        } catch {}
      }
      pushedRef.current = false;
      closedBySelfRef.current = false;
      closedByPopRef.current = false;
    };
  }, [open, onClose]);
  // Lock background scroll
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  // Enter animation
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setEntered(true));
    } else {
      setEntered(false);
    }
  }, [open]);
  // Keep local owner state in sync and fetch if missing
  React.useEffect(() => {
    setOwner(nodeData?.owner);
  }, [nodeData?.owner]);
  React.useEffect(() => {
    setEndorsementCount(nodeData?.endorsementCount ?? 0);
  }, [nodeData?.endorsementCount, nodeData?.personHash, nodeData?.versionIndex]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!open) return;
        if (!nodeData?.tokenId || nodeData.tokenId === "0") return;
        if (owner) return;
        const addr = await getOwnerOf(String(nodeData.tokenId));
        if (!cancelled) setOwner(addr || undefined);
      } catch {
        if (!cancelled) setOwner(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, nodeData?.tokenId, owner, getOwnerOf]);
  if (!open) return null;

  const hasNFT = isMinted(nodeData);

  const Row: React.FC<{
    label: React.ReactNode;
    value: React.ReactNode;
    copy?: string;
    color?: "purple" | "emerald" | "blue" | "amber" | "pink" | "slate";
  }> = ({ label, value, copy, color = "slate" }) => {
    // xAI Style: "High End" = Clean White/Black + Colored Accent Indicator + Glow
    const containerClasses = {
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

    // Keep labels neutral and clean
    const labelClasses =
      "text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5";

    const valueClasses = "text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed";

    return (
      <div
        className={`group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] ${containerClasses[color]}`}
      >
        <div className="min-w-0 flex-1">
          <div className={labelClasses}>{label}</div>
          <div className="flex items-center gap-3">
            <div className={`font-mono min-w-0 flex-1 break-all leading-relaxed ${valueClasses}`}>
              {value}
            </div>
            {copy ? (
              <button
                aria-label={t("search.copy")}
                onClick={() => onCopy(copy)}
                className="opacity-0 group-hover:opacity-100 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <Clipboard size={14} strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };
  const SmartHash: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text || text === ethers.ZeroHash) return <span>-</span>;
    return <span className="block break-all">{text}</span>;
  };

  const SmartAddress: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text) return <span>-</span>;
    return <span className="block break-all">{text}</span>;
  };
  const onCopy = async (text: string) => {
    const ok = await copyText(text);
    setCenterHint(ok ? t("search.copied") : t("search.copyFailed"));
    window.setTimeout(() => setCenterHint(null), 1200);
  };

  const modal = createPortal(
    <div className="fixed inset-0 z-[1200] overflow-x-hidden touch-pan-y" onClick={handleClose}>
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 pb-[env(safe-area-inset-bottom)] sm:p-4">
        <div
          className={`relative flex flex-col w-full max-w-[720px] ${hasNFT ? "h-[92vh]" : "h-auto max-h-[92vh] mb-2"} sm:h-auto sm:max-h-[85vh] bg-white dark:bg-gray-950 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? "translate-y-0" : "translate-y-full sm:translate-y-0"} will-change-transform ring-1 ring-black/5 dark:ring-white/10`}
          style={{
            transform: dragging ? `translateY(${dragOffset}px)` : undefined,
            transitionDuration: dragging ? "0ms" : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="sticky top-0 bg-white/80 dark:bg-gray-950/80 px-5 py-4 pt-7 sm:pt-6 sm:px-8 border-b border-gray-100 dark:border-gray-800 z-10 relative touch-none cursor-grab active:cursor-grabbing backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-950/60"
            onPointerDown={(e) => {
              (e.currentTarget as any).setPointerCapture?.(e.pointerId);
              startYRef.current = e.clientY;
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onPointerUp={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 120;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) handleClose();
            }}
            onPointerCancel={() => {
              setDragging(false);
              setDragOffset(0);
            }}
            onTouchStart={(e) => {
              startYRef.current = e.touches[0].clientY;
              setDragging(true);
            }}
            onTouchMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onTouchEnd={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 120;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) handleClose();
            }}
          >
            {/* Drag handle */}
            <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-start justify-between gap-4 sm:gap-6">
              <div className="flex items-start gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0 ring-4 ring-white dark:ring-gray-900">
                  <User className="w-6 h-6 sm:w-7 sm:h-7 text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate pr-2 tracking-tight leading-tight">
                    {t("familyTree.personVersionDetail.title")}
                  </div>
                  {/* Endorsement and People Encyclopedia badges under title */}
                  <div className="flex items-center gap-2.5 mt-3 flex-wrap">
                    {nodeData?.personHash && nodeData?.versionIndex !== undefined && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEndorse({
                            personHash: nodeData.personHash,
                            versionIndex: Number(nodeData.versionIndex),
                            fullName: nodeData.fullName,
                            endorsementCount,
                          });
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
                        title={t("people.clickToEndorse", "Click to endorse this version")}
                      >
                        <Star
                          className="w-4 h-4 text-gray-400 group-hover:text-white"
                          strokeWidth={2}
                        />
                        <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                          {endorsementCount}
                        </span>
                      </button>
                    )}
                    {!hasNFT && nodeData?.personHash && nodeData?.versionIndex !== undefined && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const params = new URLSearchParams();
                          if (nodeData?.personHash) params.set("hash", nodeData.personHash);
                          if (nodeData?.versionIndex)
                            params.set("vi", nodeData.versionIndex.toString());
                          window.open(
                            `/actions?tab=mint-nft&${params.toString()}`,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
                        title={t(
                          "familyTree.nodeDetail.mintNFTTooltip",
                          "Mint this person as an NFT",
                        )}
                      >
                        <Image
                          className="w-4 h-4 text-gray-400 group-hover:text-white"
                          strokeWidth={2}
                        />
                        <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                          {t("actions.mintNFT", "Mint NFT")}
                        </span>
                      </button>
                    )}
                    {isMinted(nodeData) && nodeData?.tokenId && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(
                              `/person/${nodeData.tokenId}`,
                              "_blank",
                              "noopener,noreferrer",
                            );
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
                          title={t("familyTree.nodeDetail.viewFullStory", "View Full Story")}
                        >
                          <BookOpen
                            className="w-4 h-4 text-gray-400 group-hover:text-white"
                            strokeWidth={2}
                          />
                          <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                            {t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!nodeData?.tokenId) return;
                            window.open(
                              `/editor/${nodeData.tokenId}`,
                              "_blank",
                              "noopener,noreferrer",
                            );
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none"
                          title={t("familyTree.nodeDetail.editStory", "Edit Story")}
                        >
                          <Edit2
                            className="w-4 h-4 text-gray-400 group-hover:text-white"
                            strokeWidth={2}
                          />
                          <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                            {t("familyTree.nodeDetail.edit", "Edit")}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                aria-label="close"
                className="p-2 rounded-full bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all duration-200 flex-shrink-0 hover:scale-105 active:scale-95"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {centerHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
              <div className="rounded bg-black/80 dark:bg-black/70 text-white px-3 py-1.5 text-xs animate-fade-in">
                {centerHint}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 px-5 pt-3 overflow-y-auto overscroll-contain overflow-x-hidden scroll-smooth text-[13px] text-gray-900 dark:text-gray-100 pb-[calc(env(safe-area-inset-bottom)+4rem)] touch-pan-y">
            <div className="space-y-2.5">
              <Row
                label={t("familyTree.nodeDetail.hash")}
                value={<SmartHash text={nodeData?.personHash || fallback.hash} />}
                copy={nodeData?.personHash || fallback.hash}
                color="purple"
              />
              <Row
                label={t("familyTree.nodeDetail.version")}
                value={
                  nodeData?.versionIndex !== undefined && Number(nodeData.versionIndex) > 0
                    ? String(nodeData.versionIndex)
                    : "-"
                }
                color="purple"
              />
              <Row
                label={t("familyTree.nodeDetail.father")}
                value={<SmartHash text={nodeData?.fatherHash} />}
                copy={
                  nodeData?.fatherHash && nodeData.fatherHash !== ethers.ZeroHash
                    ? nodeData.fatherHash
                    : undefined
                }
                color="blue"
              />
              <Row
                label={t("familyTree.nodeDetail.fatherVersion")}
                value={
                  nodeData && Number(nodeData.fatherVersionIndex) > 0
                    ? String(nodeData.fatherVersionIndex)
                    : "-"
                }
                color="blue"
              />
              <Row
                label={t("familyTree.nodeDetail.mother")}
                value={<SmartHash text={nodeData?.motherHash} />}
                copy={
                  nodeData?.motherHash && nodeData.motherHash !== ethers.ZeroHash
                    ? nodeData.motherHash
                    : undefined
                }
                color="pink"
              />
              <Row
                label={t("familyTree.nodeDetail.motherVersion")}
                value={
                  nodeData && Number(nodeData.motherVersionIndex) > 0
                    ? String(nodeData.motherVersionIndex)
                    : "-"
                }
                color="pink"
              />
              <Row
                label={t("familyTree.nodeDetail.addedBy")}
                value={<SmartAddress text={nodeData?.addedBy} />}
                copy={nodeData?.addedBy}
                color="emerald"
              />
              <Row
                label={t("familyTree.nodeDetail.timestamp")}
                value={formatUnixSeconds(nodeData?.timestamp)}
                color="amber"
              />
              <Row
                label={t("familyTree.nodeDetail.tag")}
                value={nodeData?.tag || "-"}
                color="slate"
              />
              <Row
                label={t("familyTree.nodeDetail.cid")}
                value={
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="block break-all min-w-0">{nodeData?.metadataCID || "-"}</span>
                    {nodeData?.metadataCID && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const cid = nodeData?.metadataCID || "";
                          if (!cid) return;
                          navigate(`/decrypt?cid=${encodeURIComponent(cid)}`);
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
              />
              {/* NFT Section - only when NFT exists */}
              {hasNFT && (
                <div className="pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 px-1">
                    <Image className="w-4 h-4 text-purple-600" />
                    {t("familyTree.nodeDetail.nft")}
                  </h3>
                </div>
              )}
              {hasNFT ? (
                /* Already minted NFT - show NFT info */
                <>
                  <Row
                    label={t("familyTree.nodeDetail.tokenId")}
                    value={nodeData!.tokenId}
                    copy={nodeData!.tokenId}
                    color="purple"
                  />
                  {nodeData?.fullName && (
                    <Row
                      label={t("familyTree.nodeDetail.fullName")}
                      value={nodeData.fullName}
                      color="blue"
                    />
                  )}
                  {nodeData?.gender !== undefined && (
                    <Row
                      label={t("familyTree.nodeDetail.gender")}
                      value={genderTextFn(nodeData.gender, t as any) || "-"}
                      color="emerald"
                    />
                  )}
                  <Row
                    label={t("familyTree.nodeDetail.birth")}
                    value={(() => {
                      const d = birthDateString(nodeData);
                      const parts = [d, nodeData?.birthPlace].filter(Boolean);
                      return parts.length ? parts.join(" · ") : "-";
                    })()}
                    color="emerald"
                  />
                  <Row
                    label={t("familyTree.nodeDetail.death")}
                    value={(() => {
                      const d = deathDateString(nodeData);
                      const parts = [d, nodeData?.deathPlace].filter(Boolean);
                      return parts.length ? parts.join(" · ") : "-";
                    })()}
                    color="slate"
                  />
                  {nodeData?.story && nodeData.story.trim() !== "" && (
                    <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-blue-500/80 hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.25)] transition-all duration-300">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          {t("familyTree.nodeDetail.story")}
                        </div>
                        <div className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto font-medium">
                          {nodeData.story}
                        </div>
                      </div>
                    </div>
                  )}
                  <Row
                    label={t("person.owner", "Owner Address")}
                    value={<SmartAddress text={owner} />}
                    copy={owner}
                    color="amber"
                  />
                  {nodeData?.nftTokenURI && (
                    <Row
                      label={t("familyTree.nodeDetail.uri")}
                      value={nodeData.nftTokenURI}
                      copy={nodeData.nftTokenURI}
                      color="slate"
                    />
                  )}
                </>
              ) : null}
            </div>
            {/* Bottom spacer to ensure last row (e.g., URI) is visible above rounded edge / safe area */}
            <div className="h-4 sm:h-2" />
            {loading && (
              <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">
                {t("familyTree.nodeDetail.loading")}
              </div>
            )}
            {error && (
              <div className="text-center text-xs text-red-500 dark:text-red-400 py-2">{error}</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );

  return modal;
}
