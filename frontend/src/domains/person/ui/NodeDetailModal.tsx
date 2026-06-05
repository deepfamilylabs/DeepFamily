import React from "react";
import { User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NodeData, isMinted } from "../../../shared/model";
import { useNavigate } from "react-router-dom";
import { ResponsiveModalFrame, useResponsiveModalMode, useToast } from "../../../shared/ui";
import { useEndorseModal } from "./EndorseModalProvider";
import {
  NodeDetailHeaderActions,
  NodeDetailHashRows,
  NodeDetailNftSection,
  NodeDetailTrustedEndorsersSection,
  type TrustedEndorserAccess,
} from "./NodeDetailModalSections";

interface NodeDetailModalProps {
  open: boolean;
  onClose: () => void;
  nodeData?: NodeData | null;
  fallback: { hash: string; versionIndex?: number };
  loading?: boolean;
  error?: string | null;
  getOwnerOf?: (tokenId: string) => Promise<string | null | undefined>;
  trustedEndorserAccess?: TrustedEndorserAccess;
}

export default function NodeDetailModal({
  open,
  onClose,
  nodeData,
  fallback,
  loading,
  error,
  getOwnerOf,
  trustedEndorserAccess,
}: NodeDetailModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
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
  const [entered, setEntered] = React.useState(false);
  const isDesktop = useResponsiveModalMode();
  const navigate = useNavigate();
  const { openEndorse } = useEndorseModal();
  const [owner, setOwner] = React.useState<string | undefined>(nodeData?.owner);
  const [endorsementCount, setEndorsementCount] = React.useState<number>(
    nodeData?.endorsementCount ?? 0,
  );
  const handleClose = React.useCallback(() => {
    closedBySelfRef.current = true;
    onClose();
  }, [onClose]);

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
        const addr = await getOwnerOf?.(String(nodeData.tokenId));
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

  const onCopy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) {
      toast.success(t("search.copied"));
    } else {
      toast.error(t("search.copyFailed"));
    }
  };

  const openMint = () => {
    const params = new URLSearchParams();
    if (nodeData?.personHash) params.set("hash", nodeData.personHash);
    if (nodeData?.versionIndex) params.set("vi", nodeData.versionIndex.toString());
    window.open(`/actions?tab=mint-nft&${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const openPerson = () => {
    if (!nodeData?.tokenId) return;
    window.open(`/person/${nodeData.tokenId}`, "_blank", "noopener,noreferrer");
  };

  const openEditor = () => {
    if (!nodeData?.tokenId) return;
    window.open(`/editor/${nodeData.tokenId}`, "_blank", "noopener,noreferrer");
  };

  const headerActions = (
    <NodeDetailHeaderActions
      t={t}
      nodeData={nodeData}
      hasNFT={hasNFT}
      endorsementCount={endorsementCount}
      onOpenEndorse={() => {
        if (!nodeData?.personHash || nodeData.versionIndex === undefined) return;
        openEndorse({
          personHash: nodeData.personHash,
          versionIndex: Number(nodeData.versionIndex),
          fullName: nodeData.fullName,
          endorsementCount,
        });
      }}
      onOpenMint={openMint}
      onOpenPerson={openPerson}
      onOpenEditor={openEditor}
    />
  );

  return (
    <ResponsiveModalFrame
      isOpen={open}
      onClose={handleClose}
      isDesktop={isDesktop}
      ariaLabel={t("familyTree.personVersionDetail.title")}
      icon={<User className="w-6 h-6 text-white" strokeWidth={2.5} />}
      title={t("familyTree.personVersionDetail.title")}
      description={headerActions}
      entered={entered}
      closeLabel={t("common.close", "Close")}
    >
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain overflow-x-hidden scroll-smooth text-[13px] text-gray-900 dark:text-gray-100 touch-pan-y">
        <div className="p-6 space-y-2.5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <NodeDetailHashRows
            t={t}
            nodeData={nodeData}
            fallback={fallback}
            onCopy={onCopy}
            onDecryptCid={(cid) => navigate(`/decrypt?cid=${encodeURIComponent(cid)}`)}
          />
          <NodeDetailNftSection t={t} nodeData={nodeData} owner={owner} onCopy={onCopy} />
          <NodeDetailTrustedEndorsersSection
            t={t}
            nodeData={nodeData}
            access={trustedEndorserAccess}
            owner={owner}
            onCopy={onCopy}
          />
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
    </ResponsiveModalFrame>
  );
}
