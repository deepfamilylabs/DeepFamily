import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../../domains/config";
import { getChunkTypeOptions, useNFTDetails, useStoryData } from "../../../domains/person";
import { useAddStoryChunkFlow, useSealStoryFlow } from "../../../domains/transactions";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { storyKey } from "../../../shared/cache/queryKeys";
import {
  computeStoryHash,
  type NodeData,
  type StoryChunk,
  type StoryChunkCreateData,
  type StoryMetadata,
} from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import {
  buildNodeDetailsFromNft,
  computeContentHash,
  formatStoryHash,
  getByteLength,
  getByteWarningColor,
  getValidTokenId,
  initialChunkFormData,
  isChunkFormDirty,
  mapStorySealError,
  mapStorySubmitError,
  normalizeStoryChunks,
  sortStoryChunks,
  STORY_MAX_ATTACHMENT_CHARS,
  STORY_MAX_CHUNK_BYTES,
  STORY_WARNING_ORANGE_BYTES,
  type ChunkFormData,
  type PrefetchedStoryState,
} from "../model/storyEditorModel";

export function useStoryEditorController() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const { contractAddress, rpcUrl, chainId } = useConfig();
  const toast = useToast();

  const prefetched = (location.state as PrefetchedStoryState | undefined)?.prefetchedStory;
  const prefetchedChunks = useMemo(
    () => normalizeStoryChunks(prefetched?.storyChunks),
    [prefetched?.storyChunks],
  );

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: "instant" as any });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  const [optimistic, setOptimistic] = useState<{
    meta?: StoryMetadata;
    chunks?: StoryChunk[];
  } | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [formData, setFormData] = useState<ChunkFormData>(initialChunkFormData);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showSealConfirm, setShowSealConfirm] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [personName, setPersonName] = useState<string | null>(prefetched?.fullName || null);
  const [nodeDetails, setNodeDetails] = useState<NodeData | null>(null);
  const [showChunkTypeDropdown, setShowChunkTypeDropdown] = useState(false);
  const [showChunkTypeHelp, setShowChunkTypeHelp] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chunkTypeDropdownRef = useRef<HTMLDivElement | null>(null);

  const validTokenId = useMemo(() => getValidTokenId(tokenId), [tokenId]);
  const scopedQueryClient = useMemo(
    () => getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    [rpcUrl, contractAddress, chainId],
  );
  const addStoryChunkFlow = useAddStoryChunkFlow();
  const sealStoryFlow = useSealStoryFlow();
  const nftQuery = useNFTDetails(validTokenId);
  const storyQuery = useStoryData(validTokenId);
  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);

  useEffect(() => {
    if (storyQuery.data) setOptimistic(null);
  }, [storyQuery.data]);

  const meta = optimistic?.meta ?? storyQuery.data?.metadata ?? prefetched?.storyMetadata;
  const chunks = optimistic?.chunks ?? storyQuery.data?.chunks ?? prefetchedChunks;
  const loading = !meta && storyQuery.loading;
  const queryError = meta ? null : storyQuery.error;

  const getChunkTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      const numericType = Number(type ?? 0);
      const match = chunkTypeOptions.find((option) => option.value === numericType);
      return match ? match.label : t("chunkTypes.unknown", "Unknown");
    },
    [chunkTypeOptions, t],
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          toast.success(t("search.copied"));
          return;
        }
      } catch {}
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          toast.success(t("search.copied"));
        } else {
          toast.error(t("search.copyFailed"));
        }
      } catch {
        toast.error(t("search.copyFailed"));
      }
    },
    [toast, t],
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const isDirty = useMemo(() => isChunkFormDirty(formData), [formData]);

  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty]);

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

  useEffect(() => {
    if (prefetched?.fullName) {
      setPersonName(prefetched.fullName);
    }
  }, [prefetched?.fullName]);

  useEffect(() => {
    if (!nftQuery.data) return;
    const core = nftQuery.data.core;
    if (core?.fullName) setPersonName(core.fullName);
    setNodeDetails(buildNodeDetailsFromNft(nftQuery.data, validTokenId));
  }, [nftQuery.data, validTokenId]);

  const sortedChunks = useMemo(() => sortStoryChunks(chunks), [chunks]);
  const isSealed = meta?.isSealed || false;

  const handleCancelEdit = useCallback(() => {
    setFormData(initialChunkFormData);
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

  const updateContent = useCallback((content: string) => {
    setFormData((prev) => ({
      ...prev,
      content,
      expectedHash: content ? computeContentHash(content) : undefined,
    }));
  }, []);

  const updateChunkType = useCallback((chunkType: number) => {
    setFormData((prev) => ({ ...prev, chunkType }));
    setShowChunkTypeDropdown(false);
  }, []);

  const updateAttachmentCID = useCallback((attachmentCID: string) => {
    setFormData((prev) => ({ ...prev, attachmentCID }));
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

        const newChunks = chunks ? [...chunks, result.newChunk] : [result.newChunk];
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
        setOptimistic({ meta: newMeta, chunks: newChunks });

        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }
        storyQuery.refetch();

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
      } catch (error) {
        const message = mapStorySubmitError(error, t);
        toast.error(message);
        throw error;
      }
    },
    [addStoryChunkFlow, toast, t, chunks, meta, validTokenId, scopedQueryClient, storyQuery.refetch],
  );

  const onSealStory = useCallback(
    async (tid: string) => {
      try {
        const result = await sealStoryFlow.runOrThrow({ tokenId: tid });

        const newMeta: StoryMetadata | undefined = meta
          ? {
              ...meta,
              isSealed: true,
              totalChunks: result.totalChunks,
              fullStoryHash: result.fullStoryHash,
            }
          : undefined;
        setOptimistic((prev) => ({
          meta: newMeta,
          chunks: prev?.chunks ?? chunks,
        }));

        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }
        storyQuery.refetch();

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
      } catch (error) {
        const message = mapStorySealError(error, t);
        toast.error(message);
        throw error;
      }
    },
    [sealStoryFlow, toast, t, meta, chunks, validTokenId, scopedQueryClient, storyQuery.refetch],
  );

  const handleSubmit = useCallback(async () => {
    if (!validTokenId) return;

    const trimmedContent = formData.content.trim();
    if (!trimmedContent) {
      setLocalError(t("storyChunkEditor.contentRequired", "Content cannot be empty"));
      return;
    }
    const byteLen = getByteLength(trimmedContent);
    if (byteLen > STORY_MAX_CHUNK_BYTES) {
      setLocalError(t("storyChunkEditor.contentTooLongBytes", "Content cannot exceed 2048 bytes"));
      return;
    }

    const trimmedAttachment = formData.attachmentCID.trim();
    if (trimmedAttachment.length > STORY_MAX_ATTACHMENT_CHARS) {
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
    } catch (error: any) {
      setLocalError(mapStorySubmitError(error, t));
    } finally {
      setSubmitting(false);
    }
  }, [validTokenId, formData, meta, onAddChunk, handleCancelEdit, t]);

  const handleSeal = useCallback(() => {
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
    } catch (error: any) {
      setLocalError(mapStorySealError(error, t));
      setShowSealConfirm(false);
    } finally {
      setSubmitting(false);
    }
  }, [validTokenId, onSealStory, t]);

  const titleText = personName
    ? t("storyChunkEditor.titleWithName", { name: personName, defaultValue: "{{name}} Biography" })
    : t("storyChunkEditor.titleFallback", { defaultValue: "Biography" });
  const showEditorForm = !isSealed;
  const showError = Boolean(queryError || localError);
  const showEmptySealed = !loading && sortedChunks.length === 0 && !showError && isSealed;
  const errorMessage = queryError || localError;
  const formByteLength = getByteLength(formData.content);

  return {
    t,
    validTokenId,
    meta,
    nodeDetails,
    titleText,
    loading,
    submitting,
    isSealed,
    showEditorForm,
    showError,
    errorMessage,
    showEmptySealed,
    sortedChunks,
    expandedChunks,
    toggleChunkExpansion,
    copyText,
    formatHash: formatStoryHash,
    getByteLength,
    getByteWarningColor,
    chunkTypeOptions,
    getChunkTypeLabel,
    refs: {
      scrollContainerRef,
      formRef,
      textareaRef,
      chunkTypeDropdownRef,
    },
    form: {
      data: formData,
      byteLength: formByteLength,
      maxBytes: STORY_MAX_CHUNK_BYTES,
      warningOrangeBytes: STORY_WARNING_ORANGE_BYTES,
      updateContent,
      updateChunkType,
      updateAttachmentCID,
      cancel: handleCancelEdit,
      submit: handleSubmit,
      showChunkTypeDropdown,
      setShowChunkTypeDropdown,
      showChunkTypeHelp,
      setShowChunkTypeHelp,
    },
    seal: {
      handleSeal,
      showConfirm: showSealConfirm,
      setShowConfirm: setShowSealConfirm,
      execute: executeSeal,
    },
  };
}

export type StoryEditorController = ReturnType<typeof useStoryEditorController>;
