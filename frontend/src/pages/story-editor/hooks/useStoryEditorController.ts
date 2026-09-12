import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../../domains/config";
import { getEditableChunkTypeOptions, useNFTDetails, useStoryData } from "../../../domains/person";
import { useAddStoryChunkFlow, useSealStoryFlow } from "../../../domains/transactions";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { storyKey } from "../../../shared/cache/queryKeys";
import {
  getStoryPresentation,
  type NodeData,
  type StoryChunk,
  type StoryChunkCreateData,
  type StoryMetadata,
} from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import { segmentManuscript } from "../model/manuscriptSegments";
import { buildStoryOutline } from "../model/storyOutline";
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
  STORY_MAX_ATTACHMENT_BYTES,
  STORY_SEGMENT_BYTES,
  STORY_WARNING_ORANGE_BYTES,
  type ChunkFormData,
  type PrefetchedStoryState,
} from "../model/storyEditorModel";

import type { ArchiveTransactionPreview } from "../../../domains/transactions";

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
  const [transactionPreview, setTransactionPreview] = useState<ArchiveTransactionPreview | null>(
    null,
  );
  const previewDecision = useRef<((approved: boolean) => void) | null>(null);
  const confirmTransactionPreview = useCallback(
    (preview: ArchiveTransactionPreview) =>
      new Promise<boolean>((resolve) => {
        previewDecision.current?.(false);
        previewDecision.current = resolve;
        setTransactionPreview(preview);
      }),
    [],
  );
  const resolveTransactionPreview = useCallback((approved: boolean) => {
    previewDecision.current?.(approved);
    previewDecision.current = null;
    setTransactionPreview(null);
  }, []);
  useEffect(
    () => () => {
      previewDecision.current?.(false);
    },
    [],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [showSealConfirm, setShowSealConfirm] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [personName, setPersonName] = useState<string | null>(prefetched?.fullName || null);
  const [nodeDetails, setNodeDetails] = useState<NodeData | null>(null);
  const [showChunkTypeDropdown, setShowChunkTypeDropdown] = useState(false);
  const [runExpanded, setRunExpanded] = useState(false);
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
  const chunkTypeOptions = useMemo(() => getEditableChunkTypeOptions(t), [t]);

  useEffect(() => {
    if (storyQuery.data) setOptimistic(null);
  }, [storyQuery.data]);

  const meta = optimistic?.meta ?? storyQuery.data?.metadata ?? prefetched?.storyMetadata;
  const chunks = optimistic?.chunks ?? storyQuery.data?.chunks ?? prefetchedChunks;
  const presentation = useMemo(() => getStoryPresentation(chunks, meta), [chunks, meta]);
  const displayMeta = useMemo(
    () =>
      meta
        ? { ...meta, totalChunks: presentation.totalChunks, totalLength: presentation.totalLength }
        : undefined,
    [meta, presentation.totalChunks, presentation.totalLength],
  );
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

  // Hash of the chunk as it currently stands. handleSubmit recomputes the value
  // it actually submits; this one exists so the record panel can show the
  // caller what they are about to sign.
  const draftContentHash = useMemo(() => {
    if (!formData.content.trim()) return undefined;
    const chunkTypeValue = Number(formData.chunkType ?? 1);
    if (!Number.isInteger(chunkTypeValue) || chunkTypeValue < 1 || chunkTypeValue > 255) {
      return undefined;
    }
    try {
      return computeContentHash(formData.content, chunkTypeValue, formData.attachmentCID);
    } catch {
      return undefined;
    }
  }, [formData.content, formData.chunkType, formData.attachmentCID]);

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

  const sortedChunks = presentation.chunks;
  const isSealed = meta?.isSealed || false;

  // Contents outline for the left column, and the number the composer's draft
  // will take once it is written.
  const outline = useMemo(
    () => buildStoryOutline(sortedChunks, getChunkTypeLabel, t as never),
    [sortedChunks, getChunkTypeLabel, t],
  );
  const draftDisplayIndex = presentation.totalChunks + 1;

  // Long manuscripts fold their middle; Contents still lists every chunk, so a
  // jump into a folded entry has to open the fold before it can scroll.
  const segments = useMemo(() => segmentManuscript(sortedChunks), [sortedChunks]);
  const collapsedIndexes = useMemo(
    () => new Set(segments.collapsed.map((chunk) => chunk.chunkIndex)),
    [segments.collapsed],
  );
  const revealChunk = useCallback(
    (chunkIndex: number) => {
      if (runExpanded || !collapsedIndexes.has(chunkIndex)) return false;
      setRunExpanded(true);
      return true;
    },
    [collapsedIndexes, runExpanded],
  );
  const toggleRun = useCallback(() => setRunExpanded((prev) => !prev), []);

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
      expectedHash: undefined,
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
          chunkType:
            typeof data.chunkType === "number" &&
            Number.isInteger(data.chunkType) &&
            data.chunkType >= 1 &&
            data.chunkType <= 255
              ? data.chunkType
              : 1,
          attachmentCID: data.attachmentCID ?? "",
          confirmTransactionPreview,
        });

        const newChunks = chunks ? [...chunks, result.newChunk] : [result.newChunk];
        const newFullStoryHash = result.recordsHead;
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

        if (result.events.StoryRecordAppended) {
          toast.success(
            t(
              "storyChunkEditor.success.chunkAdded",
              "Chunk #{{index}} added successfully ({{bytes}} bytes)",
              {
                index: getStoryPresentation(newChunks, newMeta).totalChunks,
                bytes: result.events.StoryRecordAppended.contentLength,
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
    [
      addStoryChunkFlow,
      confirmTransactionPreview,
      toast,
      t,
      chunks,
      meta,
      validTokenId,
      scopedQueryClient,
      storyQuery.refetch,
    ],
  );

  const onSealStory = useCallback(
    async (tid: string) => {
      try {
        const result = await sealStoryFlow.runOrThrow({ tokenId: tid, confirmTransactionPreview });

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
                total: getStoryPresentation(chunks, newMeta).totalChunks,
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
    [
      sealStoryFlow,
      toast,
      t,
      meta,
      chunks,
      validTokenId,
      scopedQueryClient,
      storyQuery.refetch,
      confirmTransactionPreview,
    ],
  );

  const handleSubmit = useCallback(async () => {
    if (!validTokenId) return;

    const trimmedContent = formData.content.trim();
    if (!trimmedContent) {
      setLocalError(t("storyChunkEditor.contentRequired", "Content cannot be empty"));
      return;
    }
    const attachment = formData.attachmentCID;
    if (
      attachment !== attachment.trim() ||
      getByteLength(attachment) > STORY_MAX_ATTACHMENT_BYTES
    ) {
      setLocalError(
        t(
          "archive.attachmentInvalid",
          "Attachment CID must have no surrounding whitespace and fit in 256 UTF-8 bytes",
        ),
      );
      return;
    }

    const chunkTypeValue = Number(formData.chunkType ?? 1);
    if (!Number.isInteger(chunkTypeValue) || chunkTypeValue < 1 || chunkTypeValue > 255) {
      setLocalError(t("storyChunkEditor.invalidChunkType", "Invalid chunk type"));
      return;
    }

    setSubmitting(true);
    setLocalError(null);

    try {
      const expectedHash = computeContentHash(formData.content, chunkTypeValue, attachment);
      const nextIndex = meta?.totalChunks || 0;
      await onAddChunk({
        tokenId: validTokenId,
        chunkIndex: nextIndex,
        content: formData.content,
        expectedHash,
        chunkType: chunkTypeValue,
        attachmentCID: attachment,
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
    setShowSealConfirm(false);
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
    transactionPreview,
    resolveTransactionPreview,
    validTokenId,
    meta: displayMeta,
    nodeDetails,
    personName,
    titleText,
    loading,
    submitting,
    isSealed,
    showEditorForm,
    showError,
    errorMessage,
    showEmptySealed,
    sortedChunks,
    manuscript: {
      head: segments.head,
      collapsed: segments.collapsed,
      tail: segments.tail,
      isExpanded: runExpanded,
      toggle: toggleRun,
      reveal: revealChunk,
    },
    outline,
    draftDisplayIndex,
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
      draftContentHash,
      byteLength: formByteLength,
      segmentBytes: STORY_SEGMENT_BYTES,
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
