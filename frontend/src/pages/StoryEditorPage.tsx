import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ethers } from "ethers";
import {
  X,
  Plus,
  Save,
  Lock,
  Clipboard,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  Link,
  User,
  Check,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useConfig } from "../domains/config/context";
import { useToast } from "../shared/ui";
import { computeStoryHash } from "../domains/person";
import { useNFTDetails, useStoryData } from "../domains/person/queries";
import { getScopedQueryClient } from "../shared/cache/queryClient";
import { storyKey } from "../shared/cache/queryKeys";
import type { StoryChunk, StoryChunkCreateData, StoryMetadata, NodeData } from "../shared/model";
import { formatUnixSeconds, formatHashMiddle, shortAddress } from "../shared/model";
import {
  getChunkTypeOptions,
  getChunkTypeI18nKey,
  getChunkTypeIcon,
  getChunkTypeColorClass,
  getChunkTypeBorderColorClass,
} from "../domains/person/config/chunkTypes";
import {
  useAddStoryChunkFlow,
  useSealStoryFlow,
} from "../domains/transactions/flows";

interface PrefetchedState {
  prefetchedStory?: {
    tokenId: string;
    fullName?: string;
    storyMetadata?: StoryMetadata;
    storyChunks?: StoryChunk[];
  };
}

interface ChunkFormData {
  content: string;
  expectedHash?: string;
  chunkType: number;
  attachmentCID: string;
}

export default function StoryEditorPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const { contractAddress, rpcUrl, chainId } = useConfig();
  const toast = useToast();

  const prefetched = (location.state as PrefetchedState | undefined)?.prefetchedStory;

  const convertChunkTypeToNumber = useCallback(
    (type: number | string | null | undefined): number => {
      if (type === null || type === undefined || type === "") return 0;
      if (typeof type === "number" && Number.isFinite(type)) return type;
      if (typeof type === "string") {
        const trimmed = type.trim();
        if (!trimmed) return 0;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      const parsed = Number(type as any);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    [],
  );

  const prefetchedChunks = prefetched?.storyChunks
    ? prefetched.storyChunks.map((chunk) => ({
        ...chunk,
        chunkType: convertChunkTypeToNumber(chunk.chunkType),
        attachmentCID: chunk.attachmentCID ?? "",
      }))
    : undefined;

  // Ensure window starts at top when entering the editor page
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: "instant" as any });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  const [meta, setMeta] = useState<StoryMetadata | undefined>(prefetched?.storyMetadata);
  const [chunks, setChunks] = useState<StoryChunk[] | undefined>(prefetchedChunks);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  // Editor state
  const MAX_CHUNK_BYTES = 2048;
  const WARNING_ORANGE_BYTES = MAX_CHUNK_BYTES - 200;
  const WARNING_YELLOW_BYTES = MAX_CHUNK_BYTES - 400;
  const MAX_ATTACHMENT_CHARS = 256;

  const [formData, setFormData] = useState<ChunkFormData>({
    content: "",
    chunkType: 0,
    attachmentCID: "",
    expectedHash: undefined,
  });
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showSealConfirm, setShowSealConfirm] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [personName, setPersonName] = useState<string | null>(prefetched?.fullName || null);
  const [nodeDetails, setNodeDetails] = useState<NodeData | null>(null);
  const [showChunkTypeDropdown, setShowChunkTypeDropdown] = useState(false);
  const [showChunkTypeHelp, setShowChunkTypeHelp] = useState(false);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chunkTypeDropdownRef = useRef<HTMLDivElement | null>(null);

  const validTokenId = useMemo(
    () => (tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined),
    [tokenId],
  );
  const scopedQueryClient = useMemo(
    () => getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    [rpcUrl, contractAddress, chainId],
  );
  const addStoryChunkFlow = useAddStoryChunkFlow();
  const sealStoryFlow = useSealStoryFlow();

  // ---------- domain query hooks ----------
  const nftQuery = useNFTDetails(validTokenId);
  const storyQuery = useStoryData(validTokenId);

  const computeContentHash = useCallback((content: string): string => {
    // Use encodePacked to match the contract's _hashString function
    return ethers.keccak256(ethers.toUtf8Bytes(content));
  }, []);

  const formatHash = useCallback((hash?: string) => formatHashMiddle(hash), []);

  const getByteLength = useCallback((str: string) => new TextEncoder().encode(str).length, []);

  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);

  const getChunkTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      const numericType = convertChunkTypeToNumber(type);
      const match = chunkTypeOptions.find((opt) => opt.value === numericType);
      return match ? match.label : t("chunkTypes.unknown", "Unknown");
    },
    [chunkTypeOptions, convertChunkTypeToNumber, t],
  );

  const resolveAttachmentUrl = useCallback((cid: string) => {
    if (!cid) return "";
    if (cid.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${cid.slice(7)}`;
    }
    return cid;
  }, []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          toast.show(t("search.copied"));
          return;
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
        toast.show(ok ? t("search.copied") : t("search.copyFailed"));
      } catch {
        toast.show(t("search.copyFailed"));
      }
    },
    [toast, t],
  );

  const scrollToForm = useCallback(() => {
    const doScroll = () => {
      if (scrollContainerRef.current) {
        try {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        } catch {}
      }
      if (formRef.current) {
        try {
          formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {}
      }
      if (textareaRef.current) {
        try {
          textareaRef.current.focus({ preventScroll: true });
        } catch {}
      }
    };
    requestAnimationFrame(() => {
      doScroll();
      requestAnimationFrame(() => {
        doScroll();
        setTimeout(doScroll, 60);
      });
    });
  }, []);

  // Sync story hook data → local state (unless already prefetched or user has made local edits)
  const storyHydrated = useRef(false);
  useEffect(() => {
    if (storyHydrated.current) return; // once local edits start, don't overwrite
    if (storyQuery.data) {
      setMeta(storyQuery.data.metadata);
      setChunks(storyQuery.data.chunks);
      storyHydrated.current = true;
    }
  }, [storyQuery.data]);

  // Surface hook loading/error into local state (only while initial load)
  useEffect(() => {
    if (!storyHydrated.current) {
      setLoading(storyQuery.loading);
      setError(storyQuery.error);
    }
  }, [storyQuery.loading, storyQuery.error]);

  // Warn before unload if there are unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Dirty detection: changed content vs initial
  const isDirty = useMemo(() => {
    const trimmed = (formData.content || "").trim();
    return (
      trimmed.length > 0 || (formData.attachmentCID || "").length > 0 || formData.chunkType !== 0
    );
  }, [formData.content, formData.attachmentCID, formData.chunkType]);

  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        chunkTypeDropdownRef.current &&
        !chunkTypeDropdownRef.current.contains(event.target as Node)
      ) {
        setShowChunkTypeDropdown(false);
      }
    };
    if (showChunkTypeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showChunkTypeDropdown]);

  const sortedChunks = useMemo(() => {
    return [...(chunks || [])].sort((a, b) => a.chunkIndex - b.chunkIndex);
  }, [chunks]);

  const isSealed = meta?.isSealed || false;

  const handleCancelEdit = useCallback(() => {
    setFormData({ content: "", chunkType: 0, attachmentCID: "", expectedHash: undefined });
    setLocalError(null);
  }, []);

  const toggleChunkExpansion = useCallback((chunkIndex: number) => {
    setExpandedChunks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(chunkIndex)) {
        newSet.delete(chunkIndex);
      } else {
        newSet.add(chunkIndex);
      }
      return newSet;
    });
  }, []);

  const onAddChunk = useCallback(
    async (data: StoryChunkCreateData) => {
      try {
        const result = await addStoryChunkFlow.runOrThrow({
          tokenId: data.tokenId,
          chunkIndex: data.chunkIndex,
          content: data.content,
          expectedHash: data.expectedHash || "",
          chunkType: data.chunkType ?? 0,
          attachmentCID: data.attachmentCID ?? "",
        });

        // After successful operation, immediately update local state
        const newChunks = chunks ? [...chunks, result.newChunk] : [result.newChunk];
        setChunks(newChunks);

        // Update total chunks count and fullStoryHash in metadata
        const newFullStoryHash = computeStoryHash(newChunks);
        const newMeta: StoryMetadata | undefined = meta
          ? {
              ...meta,
              totalChunks: (meta.totalChunks || 0) + 1,
              lastUpdateTime: result.newChunk.timestamp,
              totalLength: (meta.totalLength || 0) + result.contentLength,
              fullStoryHash: newFullStoryHash,
            }
          : undefined;
        setMeta(newMeta);

        // Invalidate story cache so next read gets fresh data
        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }

        // Show success message with event data if available
        if (result.events.StoryChunkAdded) {
          toast.success(
            t(
              "storyChunkEditor.success.chunkAdded",
              "Chunk #{{index}} added successfully ({{bytes}} bytes)",
              {
                index: result.events.StoryChunkAdded.chunkIndex,
                bytes: result.events.StoryChunkAdded.contentLength,
              },
            ),
          );
        } else {
          toast.success(
            t("storyChunkEditor.success.chunkAddedGeneric", "Story chunk added successfully"),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("storyChunkEditor.operationFailed", "Operation failed");
        toast.error(message);
        throw err;
      }
    },
    [addStoryChunkFlow, toast, t, chunks, meta, validTokenId, scopedQueryClient],
  );

  const onSealStory = useCallback(
    async (tid: string) => {
      try {
        const result = await sealStoryFlow.runOrThrow({ tokenId: tid });

        // After successful operation, immediately update sealed status and fullStoryHash in metadata
        const newMeta: StoryMetadata | undefined = meta
          ? {
              ...meta,
              isSealed: true,
              totalChunks: result.totalChunks,
              fullStoryHash: result.fullStoryHash,
            }
          : undefined;
        setMeta(newMeta);

        // Invalidate story cache so next read gets fresh data
        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }

        // Show success message with event data if available
        if (result.events.StorySealed) {
          toast.success(
            t(
              "storyChunkEditor.success.storySealed",
              "Story sealed successfully ({{total}} chunks)",
              {
                total: result.events.StorySealed.totalChunks,
              },
            ),
          );
        } else {
          toast.success(
            t("storyChunkEditor.success.storySealedGeneric", "Story sealed successfully"),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("storyChunkEditor.operationFailed", "Operation failed");
        toast.error(message);
        throw err;
      }
    },
    [sealStoryFlow, toast, t, meta, validTokenId, scopedQueryClient],
  );

  const handleSubmit = useCallback(async () => {
    if (!validTokenId) return;

    const trimmedContent = formData.content.trim();
    if (!trimmedContent) {
      setLocalError(t("storyChunkEditor.contentRequired", "Content cannot be empty"));
      return;
    }
    const byteLen = getByteLength(trimmedContent);
    if (byteLen > MAX_CHUNK_BYTES) {
      setLocalError(t("storyChunkEditor.contentTooLongBytes", "Content cannot exceed 2048 bytes"));
      return;
    }

    const trimmedAttachment = formData.attachmentCID.trim();
    if (trimmedAttachment.length > MAX_ATTACHMENT_CHARS) {
      setLocalError(
        t("storyChunkEditor.attachmentTooLong", "Attachment CID cannot exceed 256 characters"),
      );
      return;
    }

    const chunkTypeValue = Number(formData.chunkType || 0);
    if (!Number.isFinite(chunkTypeValue) || chunkTypeValue < 0 || chunkTypeValue > 255) {
      setLocalError(t("storyChunkEditor.invalidChunkType", "Invalid chunk type"));
      return;
    }

    setSubmitting(true);
    setLocalError(null);

    try {
      const expectedHash = computeContentHash(trimmedContent);

      const nextIndex = meta?.totalChunks || 0;
      await onAddChunk({
        tokenId: validTokenId,
        chunkIndex: nextIndex,
        content: trimmedContent,
        expectedHash,
        chunkType: chunkTypeValue,
        attachmentCID: trimmedAttachment,
      });

      handleCancelEdit();
    } catch (err: any) {
      const errorType = err?.type || err?.code;
      let message =
        err instanceof Error
          ? err.message
          : t("storyChunkEditor.operationFailed", "Operation failed");

      if (errorType === "USER_REJECTED") {
        message = t("storyChunkEditor.errors.userRejected", "Transaction was rejected by user");
      } else if (errorType === "WALLET_POPUP_TIMEOUT") {
        message = t(
          "storyChunkEditor.errors.walletTimeout",
          "Wallet confirmation timed out. Please reopen your wallet and confirm in Fluent.",
        );
      } else if (errorType === "WALLET_REQUEST_PENDING") {
        message = t(
          "storyChunkEditor.errors.walletPending",
          "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
        );
      }

      setLocalError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    validTokenId,
    formData.content,
    getByteLength,
    computeContentHash,
    meta,
    onAddChunk,
    handleCancelEdit,
    t,
  ]);

  const handleSeal = useCallback(async () => {
    if (!validTokenId) return;
    setShowSealConfirm(true);
  }, [validTokenId]);

  const executeSeal = useCallback(async () => {
    if (!validTokenId) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      await onSealStory(validTokenId);
      setShowSealConfirm(false);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const errorType = err?.type || err?.code;
      let translatedError: string;

      // Check for specific error patterns
      if (errorMessage.toLowerCase().includes("no wallet connected") || errorType === "NO_WALLET") {
        translatedError = t(
          "storyChunkEditor.errors.noWallet",
          "No wallet connected. Please connect your wallet first.",
        );
      } else if (errorType === "USER_REJECTED") {
        translatedError = t(
          "storyChunkEditor.errors.userRejected",
          "Transaction was rejected by user",
        );
      } else if (errorType === "WALLET_POPUP_TIMEOUT") {
        translatedError = t(
          "storyChunkEditor.errors.walletTimeout",
          "Wallet confirmation timed out. Please reopen your wallet and confirm.",
        );
      } else if (errorType === "WALLET_REQUEST_PENDING") {
        translatedError = t(
          "storyChunkEditor.errors.walletPending",
          "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
        );
      } else {
        translatedError =
          err instanceof Error ? err.message : t("storyChunkEditor.sealFailed", "Seal failed");
      }

      setLocalError(translatedError);
      setShowSealConfirm(false);
    } finally {
      setSubmitting(false);
    }
  }, [validTokenId, onSealStory, t]);

  const getByteWarningColor = (byteLen: number) => {
    if (byteLen > MAX_CHUNK_BYTES) return "text-red-600 dark:text-red-400 font-semibold";
    if (byteLen > WARNING_ORANGE_BYTES) return "text-orange-600 dark:text-orange-400 font-medium";
    if (byteLen > WARNING_YELLOW_BYTES) return "text-yellow-600 dark:text-yellow-500";
    return "text-gray-500 dark:text-gray-400";
  };

  useEffect(() => {
    if (prefetched?.fullName) {
      setPersonName(prefetched.fullName);
    }
  }, [prefetched?.fullName]);

  // Derive person name and node details from NFT query hook
  useEffect(() => {
    if (!nftQuery.data) return;
    const core = nftQuery.data.core;
    if (core?.fullName) setPersonName(core.fullName);
    // Build a minimal NodeData-like object from NFT details for display
    setNodeDetails({
      id: `${nftQuery.data.personHash}:${nftQuery.data.versionIndex}`,
      personHash: nftQuery.data.personHash,
      versionIndex: nftQuery.data.versionIndex,
      fullName: core?.fullName,
      gender: core?.gender,
      birthYear: core?.birthYear,
      birthMonth: core?.birthMonth,
      birthDay: core?.birthDay,
      birthPlace: core?.birthPlace,
      deathYear: core?.deathYear,
      deathMonth: core?.deathMonth,
      deathDay: core?.deathDay,
      deathPlace: core?.deathPlace,
      tokenId: validTokenId,
    } as NodeData);
  }, [nftQuery.data, validTokenId]);

  const titleText = personName
    ? t("storyChunkEditor.titleWithName", { name: personName, defaultValue: "{{name}} Biography" })
    : t("storyChunkEditor.titleFallback", { defaultValue: "Biography" });

  const metadataItems = useMemo(() => {
    if (!meta) return [];
    return [
      {
        key: "chunks",
        label: t("storyChunkEditor.chunks", "Chunks"),
        value: meta.totalChunks ?? 0,
        mono: true,
      },
      {
        key: "length",
        label: t("storyChunkEditor.totalLength", "Length"),
        value: meta.totalLength ?? 0,
        mono: true,
      },
    ];
  }, [meta, t]);

  const showEditorForm = !isSealed;
  const showError = Boolean(error || localError);
  const showEmptySealed = !loading && sortedChunks.length === 0 && !showError && isSealed;
  const errorMessage = error || localError;

  return (
    <>
      <div data-story-editor-page className="w-full py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
          <section className="xl:col-span-2 flex flex-col gap-6">
            <header className="flex items-end justify-between gap-4 pb-2">
              <div className="min-w-0 space-y-1">
                <h2 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
                    {titleText}
                  </span>
                  {isSealed && <Lock className="text-orange-500" size={24} />}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {meta?.isSealed && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/30">
                    <Lock size={10} />
                    {t("person.sealed", "Sealed")}
                  </div>
                )}
                {!isSealed && meta && meta.totalChunks > 0 && (
                  <button
                    onClick={handleSeal}
                    disabled={submitting}
                    className="group flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-gray-200/50 transition-all hover:scale-105 hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:shadow-none"
                    type="button"
                  >
                    <Lock size={14} className="transition-transform group-hover:rotate-12" />
                    {t("storyChunkEditor.seal", "Seal Story")}
                  </button>
                )}
              </div>
            </header>

            <div ref={scrollContainerRef} className="flex flex-col gap-6">
              {showError && (
                <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                  <p className="mb-1 font-bold text-red-800 dark:text-red-300">
                    {t("common.error", "Error")}
                  </p>
                  <p>{errorMessage}</p>
                </section>
              )}

              {showEditorForm && (
                <section
                  ref={formRef}
                  className="relative flex flex-col gap-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none sm:p-8"
                >
                  <header className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100/50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                        <Plus size={18} />
                      </span>
                      {t("storyChunkEditor.addChunk", "Add New Chunk")}
                    </h3>
                    <button
                      onClick={handleCancelEdit}
                      disabled={submitting}
                      className="rounded-full p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 hover:rotate-90 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                      aria-label={t("common.close", "Close") as string}
                      type="button"
                    >
                      <X size={20} />
                    </button>
                  </header>

                  <div className="space-y-4">
                    <textarea
                      ref={textareaRef}
                      value={formData.content}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          content: e.target.value,
                          expectedHash: e.target.value
                            ? computeContentHash(e.target.value)
                            : undefined,
                        }))
                      }
                      placeholder={t(
                        "storyChunkEditor.contentPlaceholderBytes",
                        "Enter chunk content (max 2048 bytes, approximately 2048 English characters or ~680 Chinese characters)",
                      )}
                      className="h-[500px] w-full resize-none rounded-2xl border-0 bg-gray-50 p-6 text-base leading-relaxed text-gray-900 transition-all placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-orange-500/20 active:ring-orange-500/20 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-800"
                      disabled={submitting}
                    />

                    <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 mb-2">
                          <label className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {t("storyChunkEditor.chunkTypeLabel", "Chunk Type")}
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowChunkTypeHelp(true)}
                            className="text-gray-400 hover:text-orange-600 dark:text-gray-500 dark:hover:text-orange-400 transition-colors"
                            aria-label="Help"
                          >
                            <HelpCircle size={14} />
                          </button>
                        </div>
                        <div ref={chunkTypeDropdownRef} className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              !submitting && setShowChunkTypeDropdown(!showChunkTypeDropdown)
                            }
                            disabled={submitting}
                            className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-all hover:border-gray-300 hover:bg-gray-50 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
                          >
                            {(() => {
                              const selected = chunkTypeOptions.find(
                                (opt) => opt.value === formData.chunkType,
                              );
                              const Icon = selected?.icon || FileText;
                              return (
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Icon size={16} className={selected?.color || "text-gray-400"} />
                                  <span className="truncate">
                                    {selected?.label || "Select type"}
                                  </span>
                                </div>
                              );
                            })()}
                            <ChevronDown
                              size={16}
                              className={`flex-shrink-0 text-gray-400 transition-transform ${showChunkTypeDropdown ? "rotate-180" : ""}`}
                            />
                          </button>

                          {showChunkTypeDropdown && (
                            <div className="absolute z-50 mt-2 w-full rounded-xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                              <div className="max-h-60 overflow-y-auto py-2">
                                {chunkTypeOptions.map((option) => {
                                  const Icon = option.icon;
                                  const isSelected = option.value === formData.chunkType;
                                  return (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => {
                                        setFormData((prev) => ({
                                          ...prev,
                                          chunkType: option.value,
                                        }));
                                        setShowChunkTypeDropdown(false);
                                      }}
                                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                                        isSelected
                                          ? "bg-orange-50 text-orange-900 dark:bg-orange-900/20 dark:text-orange-100"
                                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                      }`}
                                    >
                                      <Icon size={16} className={option.color} />
                                      <span className="flex-1 truncate font-medium">
                                        {option.label}
                                      </span>
                                      {isSelected && (
                                        <Check
                                          size={16}
                                          className="flex-shrink-0 text-orange-600 dark:text-orange-400"
                                        />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col sm:min-w-0">
                        <label className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                          {t("storyChunkEditor.attachmentLabel", "Attachment CID (optional)")}
                        </label>
                        <input
                          value={formData.attachmentCID}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              attachmentCID: e.target.value,
                            }))
                          }
                          placeholder={t(
                            "storyChunkEditor.attachmentPlaceholder",
                            "CID (e.g. bafy...) or leave empty",
                          )}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 transition-all hover:border-gray-300 hover:bg-gray-50 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
                          disabled={submitting}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col justify-between gap-3 text-sm sm:flex-row sm:items-center pt-2">
                      <div
                        className={`font-medium ${getByteWarningColor(getByteLength(formData.content))}`}
                      >
                        {getByteLength(formData.content)}/{MAX_CHUNK_BYTES} bytes
                        {getByteLength(formData.content) > WARNING_ORANGE_BYTES &&
                          getByteLength(formData.content) <= MAX_CHUNK_BYTES && (
                            <span className="ml-2 text-xs">
                              ({MAX_CHUNK_BYTES - getByteLength(formData.content)} remaining)
                            </span>
                          )}
                        {getByteLength(formData.content) > MAX_CHUNK_BYTES && (
                          <span className="ml-2 text-xs">
                            ({getByteLength(formData.content) - MAX_CHUNK_BYTES} over limit!)
                          </span>
                        )}
                      </div>

                      {formData.expectedHash && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t("storyChunkEditor.hashLabel", "Hash")}:
                          </span>
                          <code className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {formatHash(formData.expectedHash)}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyText(formData.expectedHash || "")}
                            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                            aria-label={t("search.copy", "Copy") as string}
                          >
                            <Clipboard size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <footer className="flex flex-col gap-3 pt-2 sm:flex-row">
                    <button
                      onClick={handleSubmit}
                      disabled={
                        submitting ||
                        !formData.content.trim() ||
                        getByteLength(formData.content) > MAX_CHUNK_BYTES
                      }
                      className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-400 to-red-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-orange-500/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale"
                      type="button"
                    >
                      <Save size={16} />
                      {submitting
                        ? t("storyChunkEditor.saving", "Saving...")
                        : t("storyChunkEditor.save", "Save Chunk")}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={submitting}
                      className="rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-bold text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      type="button"
                    >
                      {t("storyChunkEditor.cancel", "Cancel")}
                    </button>
                  </footer>
                </section>
              )}

              {loading && (
                <section className="flex flex-col items-center justify-center gap-4 py-12 text-gray-500 dark:text-gray-400">
                  <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400"></div>
                  <p className="text-sm font-medium">
                    {t("storyChunkEditor.loading", "Loading...")}
                  </p>
                </section>
              )}

              {showEmptySealed && (
                <section className="py-12 text-center text-gray-500 dark:text-gray-400">
                  <Lock size={48} className="mx-auto mb-4 opacity-50" />
                  <p className="text-sm font-medium">
                    {t("storyChunkEditor.noChunksSealed", "This story is sealed with no chunks.")}
                  </p>
                </section>
              )}
            </div>
          </section>
          <aside className="xl:col-span-1 flex flex-col gap-6">
            {sortedChunks.length > 0 ? (
              <section className="flex flex-col flex-shrink-0 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none">
                <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t("storyChunkEditor.chunks", "Existing Chunks")}
                  </h3>
                  <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                    {sortedChunks.length}
                  </span>
                </header>
                <ul className="max-h-[600px] overflow-y-auto p-4 space-y-3">
                  {sortedChunks.map((chunk) => {
                    const isExpanded = expandedChunks.has(chunk.chunkIndex);
                    const preview =
                      chunk.content.length > 60
                        ? `${chunk.content.slice(0, 60)}...`
                        : chunk.content;
                    return (
                      <li key={chunk.chunkIndex}>
                        <div
                          className={`w-full text-left flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                            isExpanded
                              ? "bg-white border-orange-200 shadow-md shadow-orange-100 dark:bg-gray-800 dark:border-orange-900/50 dark:shadow-none"
                              : "bg-gray-50/50 border-transparent hover:bg-white hover:border-gray-100 hover:shadow-sm dark:bg-gray-800/30 dark:hover:bg-gray-800 dark:hover:border-gray-700"
                          }`}
                          onClick={() => toggleChunkExpansion(chunk.chunkIndex)}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleChunkExpansion(chunk.chunkIndex);
                            }}
                            className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                            type="button"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => toggleChunkExpansion(chunk.chunkIndex)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  #{chunk.chunkIndex}
                                </span>
                                {(() => {
                                  const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
                                  const iconColor = getChunkTypeColorClass(chunk.chunkType);
                                  const borderColor = getChunkTypeBorderColorClass(chunk.chunkType);
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <ChunkIcon size={14} className={iconColor} />
                                      <span
                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${iconColor} ${borderColor} bg-white dark:bg-gray-900`}
                                      >
                                        {getChunkTypeLabel(chunk.chunkType)}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                              <div
                                className="flex items-center gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  {chunk.content.length}
                                </span>
                              </div>
                            </div>
                            <p
                              className={`text-xs text-gray-600 dark:text-gray-400 ${isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}
                            >
                              {isExpanded ? chunk.content : preview}
                            </p>
                            {isExpanded && (
                              <div
                                className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  <User size={12} className="flex-shrink-0" />
                                  {chunk.editor ? (
                                    <>
                                      <span className="truncate" title={chunk.editor}>
                                        {shortAddress(chunk.editor)}
                                      </span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyText(chunk.editor);
                                        }}
                                        className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                        aria-label={t("search.copy")}
                                        title={t("search.copy")}
                                        type="button"
                                      >
                                        <Clipboard size={12} />
                                      </button>
                                    </>
                                  ) : (
                                    <span>-</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  <Clock size={12} className="flex-shrink-0" />
                                  <span>{formatUnixSeconds(chunk.timestamp)}</span>
                                </div>
                                {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                    <Link size={12} className="flex-shrink-0" />
                                    <span className="truncate font-mono">
                                      {chunk.attachmentCID}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        copyText(chunk.attachmentCID);
                                      }}
                                      className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                      aria-label={t("search.copy")}
                                      title={t("search.copy")}
                                      type="button"
                                    >
                                      <Clipboard size={12} />
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  <Hash size={12} className="flex-shrink-0" />
                                  <span className="font-mono truncate" title={chunk.chunkHash}>
                                    {formatHash(chunk.chunkHash)}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyText(chunk.chunkHash);
                                    }}
                                    className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                    aria-label={t("search.copy")}
                                    title={t("search.copy")}
                                    type="button"
                                  >
                                    <Clipboard size={12} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm font-medium text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500">
                {t("storyChunkEditor.noChunks")}
              </div>
            )}

            {meta && (
              <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none">
                <header className="border-b border-gray-100 px-6 py-4 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t("person.metadata", "Metadata")}
                  </h3>
                </header>
                <div className="p-4 space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                      {t("person.tokenId", "Token ID")}
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                      #{validTokenId || "-"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                      {t("person.totalChunks", "Total Chunks")}
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                      {meta.totalChunks}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                      {t("person.totalLength", "Total Length")}
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                      {meta.totalLength}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                      {t("person.lastUpdate", "Last Update")}
                    </span>
                    <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                      {meta.lastUpdateTime
                        ? formatUnixSeconds(meta.lastUpdateTime)
                        : t("common.na", "N/A")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                      {t("person.status", "Status")}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${meta.isSealed ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}
                    >
                      {meta.isSealed
                        ? t("person.sealed", "Sealed")
                        : t("person.editable", "Editable")}
                    </span>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">
                      {t("person.storyHash", "Story Hash")}
                    </div>
                    <div className="flex items-center">
                      <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                        {meta.fullStoryHash || "-"}
                      </div>
                      {meta.fullStoryHash && (
                        <button
                          onClick={() => copyText(meta.fullStoryHash!)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t("search.copy") as string}
                          title={t("search.copy") as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  {nodeDetails?.personHash && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">
                        {t("person.personHashLabel", "Person Hash")}
                      </div>
                      <div className="flex items-center">
                        <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                          {nodeDetails.personHash}
                        </div>
                        <button
                          onClick={() => copyText(nodeDetails.personHash!)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t("search.copy") as string}
                          title={t("search.copy") as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                  {nodeDetails?.versionIndex !== undefined && nodeDetails.versionIndex > 0 && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">
                        {t("person.versionLabel", "Version:")}
                      </div>
                      <div className="flex items-center">
                        <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                          {nodeDetails.versionIndex}
                        </div>
                        <button
                          onClick={() => copyText(`${nodeDetails.versionIndex}`)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t("search.copy") as string}
                          title={t("search.copy") as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      {/* Seal Confirmation Dialog */}
      {showSealConfirm &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            data-seal-dialog
          >
            <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="p-8">
                <div className="flex flex-col items-center text-center gap-4 mb-8">
                  <div className="flex-shrink-0 w-16 h-16 rounded-full bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
                    <Lock size={32} className="text-orange-600 dark:text-orange-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                      {t("storyChunkEditor.sealDialog.title", "Seal Story")}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
                      {t(
                        "storyChunkEditor.sealDialog.description",
                        "Are you sure you want to seal the story? Once sealed, it cannot be modified.",
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={() => setShowSealConfirm(false)}
                    disabled={submitting}
                    className="flex-1 px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-full disabled:opacity-50 transition-colors"
                  >
                    {t("storyChunkEditor.sealDialog.cancel", "Cancel")}
                  </button>
                  <button
                    onClick={executeSeal}
                    disabled={submitting}
                    className="flex-1 px-4 py-3 text-sm font-bold text-white bg-gradient-to-r from-orange-400 to-red-600 hover:shadow-lg shadow-orange-500/20 rounded-full disabled:opacity-50 transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>{t("storyChunkEditor.saving", "Saving...")}</span>
                      </>
                    ) : (
                      <>
                        <Lock size={16} />
                        <span>{t("storyChunkEditor.sealDialog.confirm", "Confirm Seal")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Chunk Type Help Modal */}
      {showChunkTypeHelp &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            onClick={() => setShowChunkTypeHelp(false)}
            data-chunk-help-dialog
          >
            <div
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-3xl border border-gray-100 dark:border-gray-800 max-h-[75vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <HelpCircle size={24} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {t("storyChunkEditor.chunkTypeHelp.title", "Story Chunk Types Guide")}
                  </h3>
                </div>
                <button
                  onClick={() => setShowChunkTypeHelp(false)}
                  className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 hover:rotate-90"
                  aria-label="Close"
                  type="button"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="overflow-y-auto p-8 space-y-8">
                {/* Introduction */}
                <div className="prose dark:prose-invert max-w-none">
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {t(
                      "storyChunkEditor.chunkTypeHelp.intro",
                      "Story chunks are content type tags for organizing biographical narratives and life stories. These 19 types allow flexible storytelling - you can use multiple chunks of the same type in any order.",
                    )}
                  </p>
                </div>

                {/* Opening Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.opening", "Opening")}
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50">
                      {(() => {
                        const Icon = getChunkTypeIcon(0);
                        return (
                          <Icon
                            size={16}
                            className={getChunkTypeColorClass(0) + " flex-shrink-0 mt-0.5"}
                          />
                        );
                      })()}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {t("chunkTypes.summary", "Summary")}
                        </span>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          {t(
                            "storyChunkEditor.chunkTypeHelp.summaryDesc",
                            "Brief overview of the person's life and significance",
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Early Years Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.earlyYears", "Early Years")}
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {(() => {
                          const Icon = getChunkTypeIcon(1);
                          return (
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(1) + " flex-shrink-0 mt-0.5"}
                            />
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t("chunkTypes.earlyLife", "Early Life")}
                          </span>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {t(
                              "storyChunkEditor.chunkTypeHelp.earlyLifeDesc",
                              "Birth, childhood, family background",
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {(() => {
                          const Icon = getChunkTypeIcon(2);
                          return (
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(2) + " flex-shrink-0 mt-0.5"}
                            />
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t("chunkTypes.education", "Education")}
                          </span>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {t(
                              "storyChunkEditor.chunkTypeHelp.educationDesc",
                              "Schools, degrees, mentors, academic training",
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Main Narrative Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.mainNarrative", "Main Narrative")}
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {(() => {
                          const Icon = getChunkTypeIcon(3);
                          return (
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(3) + " flex-shrink-0 mt-0.5"}
                            />
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t("chunkTypes.lifeEvents", "Life Events")}
                          </span>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {t(
                              "storyChunkEditor.chunkTypeHelp.lifeEventsDesc",
                              "Chronological life story from birth to present/death. Can include career, family, society - a complete timeline.",
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Specialized Topics Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.specializedTopics", "Specialized Topics")}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 italic">
                    {t(
                      "storyChunkEditor.chunkTypeHelp.specializedDesc",
                      "Thematic deep dives extracted from life narrative",
                    )}
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        value: 4,
                        key: "career",
                        desc: "Professional history, positions, job transitions",
                      },
                      {
                        value: 5,
                        key: "works",
                        desc: "Publications, creations, products, projects",
                      },
                      {
                        value: 6,
                        key: "achievements",
                        desc: "Awards, honors, recognitions, milestones",
                      },
                      {
                        value: 7,
                        key: "philosophy",
                        desc: "Beliefs, values, theoretical contributions",
                      },
                      { value: 8, key: "quotes", desc: "Famous sayings, memorable statements" },
                    ].map(({ value, key, desc }) => {
                      const Icon = getChunkTypeIcon(value);
                      return (
                        <div
                          key={value}
                          className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(value) + " flex-shrink-0 mt-0.5"}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t(`chunkTypes.${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                              </span>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {t(`storyChunkEditor.chunkTypeHelp.${key}Desc`, desc)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Personal Life Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.personalLife", "Personal Life")}
                  </h4>
                  <div className="space-y-2">
                    {[
                      { value: 9, key: "family", desc: "Spouse, children, close relatives" },
                      {
                        value: 10,
                        key: "lifestyle",
                        desc: "Hobbies, habits, interests, daily routines",
                      },
                      {
                        value: 11,
                        key: "relations",
                        desc: "Friendships, mentorships, collaborations, rivalries",
                      },
                    ].map(({ value, key, desc }) => {
                      const Icon = getChunkTypeIcon(value);
                      return (
                        <div
                          key={value}
                          className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(value) + " flex-shrink-0 mt-0.5"}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t(`chunkTypes.${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                              </span>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {t(`storyChunkEditor.chunkTypeHelp.${key}Desc`, desc)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Social Engagement Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.socialEngagement", "Social Engagement")}
                  </h4>
                  <div className="space-y-2">
                    {[
                      {
                        value: 12,
                        key: "activities",
                        desc: "Public service, charity, speeches, social causes",
                      },
                      {
                        value: 13,
                        key: "anecdotes",
                        desc: "Interesting stories, lesser-known facts",
                      },
                      { value: 14, key: "controversies", desc: "Disputes, criticisms, scandals" },
                    ].map(({ value, key, desc }) => {
                      const Icon = getChunkTypeIcon(value);
                      return (
                        <div
                          key={value}
                          className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(value) + " flex-shrink-0 mt-0.5"}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t(`chunkTypes.${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                              </span>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {t(`storyChunkEditor.chunkTypeHelp.${key}Desc`, desc)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Closing Section */}
                <section>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.closing", "Closing")}
                  </h4>
                  <div className="space-y-2">
                    {[
                      {
                        value: 15,
                        key: "legacy",
                        desc: "Historical impact, influence, commemorations",
                      },
                      {
                        value: 16,
                        key: "gallery",
                        desc: "Photos, videos, audio, documents, and multimedia",
                      },
                      { value: 17, key: "references", desc: "Sources, citations, bibliography" },
                      {
                        value: 18,
                        key: "notes",
                        desc: "Additional remarks, corrections, clarifications",
                      },
                    ].map(({ value, key, desc }) => {
                      const Icon = getChunkTypeIcon(value);
                      return (
                        <div
                          key={value}
                          className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Icon
                              size={16}
                              className={getChunkTypeColorClass(value) + " flex-shrink-0 mt-0.5"}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t(`chunkTypes.${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                              </span>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {t(`storyChunkEditor.chunkTypeHelp.${key}Desc`, desc)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Usage Notes */}
                <section className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 uppercase tracking-wide">
                    {t("storyChunkEditor.chunkTypeHelp.usageNotes", "Usage Notes")}
                  </h4>
                  <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">
                        •
                      </span>
                      <span>
                        {t(
                          "storyChunkEditor.chunkTypeHelp.note1",
                          "These are content type tags, not exclusive chapters - you can have multiple chunks of the same type",
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">
                        •
                      </span>
                      <span>
                        {t(
                          "storyChunkEditor.chunkTypeHelp.note2",
                          "Types are not mutually exclusive - feel free to use types in any order",
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">
                        •
                      </span>
                      <span>
                        {t(
                          "storyChunkEditor.chunkTypeHelp.note3",
                          "Life Events: For chronological narrative (birth → childhood → adulthood → death)",
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">
                        •
                      </span>
                      <span>
                        {t(
                          "storyChunkEditor.chunkTypeHelp.note4",
                          "Career: For focused professional history (jobs, companies, positions)",
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">
                        •
                      </span>
                      <span>
                        {t(
                          "storyChunkEditor.chunkTypeHelp.note5",
                          "Early Life vs Life Events: Early Life for childhood snippets, Life Events for full timeline",
                        )}
                      </span>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
