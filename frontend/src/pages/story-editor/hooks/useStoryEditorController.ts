import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../../domains/config";
import { getEditableRecordTypeOptions, useNFTDetails, useStoryData } from "../../../domains/person";
import { useAddStoryRecordFlow, useSealStoryFlow } from "../../../domains/transactions";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { storyKey } from "../../../shared/cache/queryKeys";
import {
  getStoryPresentation,
  type NodeData,
  type StoryRecord,
  type StoryRecordCreateData,
  type StoryMetadata,
} from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import { segmentManuscript } from "../model/manuscriptSegments";
import { buildStoryOutline } from "../model/storyOutline";
import {
  buildNodeDetailsFromNft,
  computeStoryPayloadHash,
  formatStoryHash,
  getByteLength,
  getByteWarningColor,
  getValidTokenId,
  initialRecordFormData,
  isRecordFormDirty,
  mapStorySealError,
  mapStorySubmitError,
  normalizeStoryRecords,
  STORY_MAX_ATTACHMENT_BYTES,
  STORY_SEGMENT_BYTES,
  STORY_WARNING_ORANGE_BYTES,
  type RecordFormData,
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
  const prefetchedRecords = useMemo(
    () => normalizeStoryRecords(prefetched?.storyRecords),
    [prefetched?.storyRecords],
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
    records?: StoryRecord[];
  } | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [formData, setFormData] = useState<RecordFormData>(initialRecordFormData);
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
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());
  const [personName, setPersonName] = useState<string | null>(prefetched?.fullName || null);
  const [nodeDetails, setNodeDetails] = useState<NodeData | null>(null);
  const [showRecordTypeDropdown, setShowRecordTypeDropdown] = useState(false);
  const [runExpanded, setRunExpanded] = useState(false);
  const [showRecordTypeHelp, setShowRecordTypeHelp] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recordTypeDropdownRef = useRef<HTMLDivElement | null>(null);

  const validTokenId = useMemo(() => getValidTokenId(tokenId), [tokenId]);
  const scopedQueryClient = useMemo(
    () => getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    [rpcUrl, contractAddress, chainId],
  );
  const addStoryRecordFlow = useAddStoryRecordFlow();
  const sealStoryFlow = useSealStoryFlow();
  const nftQuery = useNFTDetails(validTokenId);
  const storyQuery = useStoryData(validTokenId);
  const recordTypeOptions = useMemo(() => getEditableRecordTypeOptions(t), [t]);

  useEffect(() => {
    if (storyQuery.data) setOptimistic(null);
  }, [storyQuery.data]);

  const meta = optimistic?.meta ?? storyQuery.data?.metadata ?? prefetched?.storyMetadata;
  const records = optimistic?.records ?? storyQuery.data?.records ?? prefetchedRecords;
  const presentation = useMemo(() => getStoryPresentation(records, meta), [records, meta]);
  const displayMeta = useMemo(
    () =>
      meta
        ? { ...meta, totalRecords: presentation.totalRecords, totalPayloadLength: presentation.totalPayloadLength }
        : undefined,
    [meta, presentation.totalRecords, presentation.totalPayloadLength],
  );
  const loading = !meta && storyQuery.loading;
  const queryError = meta ? null : storyQuery.error;

  const getRecordTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      const numericType = Number(type ?? 0);
      const match = recordTypeOptions.find((option) => option.value === numericType);
      return match ? match.label : t("recordTypes.unknown", "Unknown");
    },
    [recordTypeOptions, t],
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

  const isDirty = useMemo(() => isRecordFormDirty(formData), [formData]);

  // Hash of the record as it currently stands. handleSubmit recomputes the value
  // it actually submits; this one exists so the record panel can show the
  // caller what they are about to sign.
  const draftPayloadHash = useMemo(() => {
    if (!formData.content.trim()) return undefined;
    const recordTypeValue = Number(formData.recordType ?? 1);
    if (!Number.isInteger(recordTypeValue) || recordTypeValue < 1 || recordTypeValue > 255) {
      return undefined;
    }
    try {
      return computeStoryPayloadHash(formData.content, recordTypeValue, formData.attachmentCID);
    } catch {
      return undefined;
    }
  }, [formData.content, formData.recordType, formData.attachmentCID]);

  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        recordTypeDropdownRef.current &&
        !recordTypeDropdownRef.current.contains(event.target as Node)
      ) {
        setShowRecordTypeDropdown(false);
      }
    };
    if (showRecordTypeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showRecordTypeDropdown]);

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

  const sortedRecords = presentation.records;
  const isSealed = meta?.isSealed || false;

  // Contents outline for the left column, and the number the composer's draft
  // will take once it is written.
  const outline = useMemo(
    () => buildStoryOutline(sortedRecords, getRecordTypeLabel, t as never),
    [sortedRecords, getRecordTypeLabel, t],
  );
  const draftDisplayIndex = presentation.totalRecords + 1;

  // Long manuscripts fold their middle; Contents still lists every record, so a
  // jump into a folded entry has to open the fold before it can scroll.
  const segments = useMemo(() => segmentManuscript(sortedRecords), [sortedRecords]);
  const collapsedIndexes = useMemo(
    () => new Set(segments.collapsed.map((record) => record.recordIndex)),
    [segments.collapsed],
  );
  const revealRecord = useCallback(
    (recordIndex: number) => {
      if (runExpanded || !collapsedIndexes.has(recordIndex)) return false;
      setRunExpanded(true);
      return true;
    },
    [collapsedIndexes, runExpanded],
  );
  const toggleRun = useCallback(() => setRunExpanded((prev) => !prev), []);

  const handleCancelEdit = useCallback(() => {
    setFormData(initialRecordFormData);
    setLocalError(null);
  }, []);

  const toggleRecordExpansion = useCallback((recordIndex: number) => {
    setExpandedRecords((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(recordIndex)) {
        newSet.delete(recordIndex);
      } else {
        newSet.add(recordIndex);
      }
      return newSet;
    });
  }, []);

  const updateContent = useCallback((content: string) => {
    setFormData((prev) => ({
      ...prev,
      content,
      expectedPayloadHash: undefined,
    }));
  }, []);

  const updateRecordType = useCallback((recordType: number) => {
    setFormData((prev) => ({ ...prev, recordType }));
    setShowRecordTypeDropdown(false);
  }, []);

  const updateAttachmentCID = useCallback((attachmentCID: string) => {
    setFormData((prev) => ({ ...prev, attachmentCID }));
  }, []);

  const onAddRecord = useCallback(
    async (data: StoryRecordCreateData) => {
      try {
        const result = await addStoryRecordFlow.runOrThrow({
          tokenId: data.tokenId,
          recordIndex: data.recordIndex,
          content: data.content,
          expectedPayloadHash: data.expectedPayloadHash || "",
          recordType:
            typeof data.recordType === "number" &&
            Number.isInteger(data.recordType) &&
            data.recordType >= 1 &&
            data.recordType <= 255
              ? data.recordType
              : 1,
          attachmentCID: data.attachmentCID ?? "",
          confirmTransactionPreview,
        });

        const newRecords = records ? [...records, result.newRecord] : [result.newRecord];
        const newRecordsHead = result.recordsHead;
        const newMeta: StoryMetadata | undefined = meta
          ? {
              ...meta,
              totalRecords: (meta.totalRecords || 0) + 1,
              lastUpdateTime: result.newRecord.timestamp,
              totalPayloadLength: (meta.totalPayloadLength || 0) + result.payloadLength,
              recordsHead: newRecordsHead,
            }
          : undefined;
        setOptimistic({ meta: newMeta, records: newRecords });

        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }
        storyQuery.refetch();

        if (result.events.StoryRecordAppended) {
          toast.success(
            t(
              "storyRecordEditor.success.recordAdded",
              "Record #{{index}} added successfully ({{bytes}} bytes)",
              {
                index: getStoryPresentation(newRecords, newMeta).totalRecords,
                bytes: result.events.StoryRecordAppended.payloadLength,
              },
            ),
          );
        } else {
          toast.success(
            t("storyRecordEditor.success.recordAddedGeneric", "Story record added successfully"),
          );
        }
      } catch (error) {
        const message = mapStorySubmitError(error, t);
        toast.error(message);
        throw error;
      }
    },
    [
      addStoryRecordFlow,
      confirmTransactionPreview,
      toast,
      t,
      records,
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
              totalRecords: result.totalRecords,
              recordsHead: result.recordsHead,
            }
          : undefined;
        setOptimistic((prev) => ({
          meta: newMeta,
          records: prev?.records ?? records,
        }));

        if (validTokenId) {
          scopedQueryClient.clear(storyKey(validTokenId));
          scopedQueryClient.clear(`${storyKey(validTokenId)}:meta`);
        }
        storyQuery.refetch();

        if (result.events.StorySealed) {
          toast.success(
            t(
              "storyRecordEditor.success.storySealed",
              "Story sealed successfully ({{total}} records)",
              {
                total: getStoryPresentation(records, newMeta).totalRecords,
              },
            ),
          );
        } else {
          toast.success(
            t("storyRecordEditor.success.storySealedGeneric", "Story sealed successfully"),
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
      records,
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
      setLocalError(t("storyRecordEditor.contentRequired", "Content cannot be empty"));
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

    const recordTypeValue = Number(formData.recordType ?? 1);
    if (!Number.isInteger(recordTypeValue) || recordTypeValue < 1 || recordTypeValue > 255) {
      setLocalError(t("storyRecordEditor.invalidRecordType", "Invalid record type"));
      return;
    }

    setSubmitting(true);
    setLocalError(null);

    try {
      const expectedPayloadHash = computeStoryPayloadHash(formData.content, recordTypeValue, attachment);
      const nextIndex = meta?.totalRecords || 0;
      await onAddRecord({
        tokenId: validTokenId,
        recordIndex: nextIndex,
        content: formData.content,
        expectedPayloadHash,
        recordType: recordTypeValue,
        attachmentCID: attachment,
      });

      handleCancelEdit();
    } catch (error: any) {
      setLocalError(mapStorySubmitError(error, t));
    } finally {
      setSubmitting(false);
    }
  }, [validTokenId, formData, meta, onAddRecord, handleCancelEdit, t]);

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
    ? t("storyRecordEditor.titleWithName", { name: personName, defaultValue: "{{name}} Biography" })
    : t("storyRecordEditor.titleFallback", { defaultValue: "Biography" });
  const showEditorForm = !isSealed;
  const showError = Boolean(queryError || localError);
  const showEmptySealed = !loading && sortedRecords.length === 0 && !showError && isSealed;
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
    sortedRecords,
    manuscript: {
      head: segments.head,
      collapsed: segments.collapsed,
      tail: segments.tail,
      isExpanded: runExpanded,
      toggle: toggleRun,
      reveal: revealRecord,
    },
    outline,
    draftDisplayIndex,
    expandedRecords,
    toggleRecordExpansion,
    copyText,
    formatHash: formatStoryHash,
    getByteLength,
    getByteWarningColor,
    recordTypeOptions,
    getRecordTypeLabel,
    refs: {
      scrollContainerRef,
      formRef,
      textareaRef,
      recordTypeDropdownRef,
    },
    form: {
      data: formData,
      draftPayloadHash,
      byteLength: formByteLength,
      segmentBytes: STORY_SEGMENT_BYTES,
      warningOrangeBytes: STORY_WARNING_ORANGE_BYTES,
      updateContent,
      updateRecordType,
      updateAttachmentCID,
      cancel: handleCancelEdit,
      submit: handleSubmit,
      showRecordTypeDropdown,
      setShowRecordTypeDropdown,
      showRecordTypeHelp,
      setShowRecordTypeHelp,
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
