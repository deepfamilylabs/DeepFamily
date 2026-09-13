// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID, STORY_ENVELOPE_SCHEMA_ID } from "@deepfamily/protocol-core";
import type { StoryRecord, StoryMetadata } from "../../../shared/model";
import { StoryManuscript } from "../sections/StoryManuscript";
import { StoryRecordPanel } from "../sections/StoryRecordPanel";
import { useStoryEditorController } from "./useStoryEditorController";

const mocks = vi.hoisted(() => ({
  access: {
    scope: {} as object,
    canEdit: true,
    isOwner: true,
    checking: false,
    error: false,
    connected: true,
    correctNetwork: true,
    refresh: vi.fn(),
    recheck: vi.fn(async () => true),
  },
  location: { state: undefined as unknown },
  storyQuery: { data: undefined as any, loading: false, error: null, refetch: vi.fn() },
  addFlow: { runOrThrow: vi.fn() },
  sealFlow: { runOrThrow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  queryClient: { clear: vi.fn() },
  t: (
    key: string,
    fallback?: string | Record<string, unknown>,
    values?: Record<string, unknown>,
  ) => {
    const options = typeof fallback === "object" ? fallback : values;
    return String(typeof fallback === "string" ? fallback : (options?.defaultValue ?? key)).replace(
      /\{\{(\w+)\}\}/g,
      (_, name) => String(options?.[name] ?? ""),
    );
  },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ tokenId: "7" }),
  useLocation: () => mocks.location,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../domains/config", () => ({
  useConfig: () => ({ rpcUrl: "http://localhost:8545", chainId: 31337, contractAddress: "0xabc" }),
}));
vi.mock("../../../domains/person", () => ({
  useNftStoryAccess: () => mocks.access,
  useNFTDetails: () => ({ data: undefined }),
  useStoryData: () => mocks.storyQuery,
  getEditableRecordTypeOptions: () => [],
  getRecordTypeIcon: () => () => null,
  getRecordTypeColorClass: () => "",
  getRecordTypeBorderColorClass: () => "",
}));
vi.mock("../../../domains/transactions", () => ({
  useAddStoryRecordFlow: () => mocks.addFlow,
  useSealStoryFlow: () => mocks.sealFlow,
}));
vi.mock("../../../shared/cache/queryClient", () => ({
  getScopedQueryClient: () => mocks.queryClient,
}));
vi.mock("../../../shared/ui", () => ({
  useToast: () => mocks.toast,
  CopyIconButton: () => null,
}));

function record(index: number, biography = false): StoryRecord {
  return {
    title: "",
    recordIndex: index,
    recordType: biography ? 0 : 1,
    schemaId: biography ? STORY_BIOGRAPHY_SCHEMA_ID : STORY_ENVELOPE_SCHEMA_ID,
    content: biography ? "Mint biography stays in the basic story" : `Ordinary story ${index}`,
    payloadHash: `0x${"1".repeat(64)}`,
    recordHash: `0x${"2".repeat(64)}`,
    timestamp: 1_700_000_000,
    author: "0x0000000000000000000000000000000000000001",
    attachmentCID: "",
    payloadLength: biography ? 180 : 100,
  };
}

function metadata(records: StoryRecord[]): StoryMetadata {
  return {
    totalRecords: records.length,
    totalPayloadLength: records.reduce((sum, item) => sum + item.payloadLength!, 0),
    recordsHead: `0x${"3".repeat(64)}`,
    lastUpdateTime: 1_700_000_000,
    isSealed: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.access, {
    scope: {},
    canEdit: true,
    isOwner: true,
    checking: false,
    error: false,
    connected: true,
    correctNetwork: true,
  });
  mocks.access.recheck.mockReset().mockResolvedValue(true);
  mocks.location.state = undefined;
  mocks.storyQuery.data = undefined;
  mocks.storyQuery.loading = false;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useStoryEditorController biography presentation", () => {
  it("shows an empty ordinary story and no seal action when only the mint biography exists", () => {
    const records = [record(0, true)];
    mocks.storyQuery.data = { records: records, metadata: metadata(records) };
    const { result } = renderHook(() => useStoryEditorController());

    expect(result.current.sortedRecords).toEqual([]);
    expect(result.current.meta).toMatchObject({ totalRecords: 0, totalPayloadLength: 0 });
    render(
      <>
        <StoryManuscript editor={result.current} />
        <StoryRecordPanel editor={result.current} />
      </>,
    );
    expect(screen.queryByRole("button", { name: "Seal permanently" })).toBeNull();
    expect(screen.queryByText(records[0].content)).toBeNull();
    expect(screen.getByText("No profile records yet.")).toBeTruthy();
  });

  it.each([false, true])(
    "appends the first ordinary story at the raw index while displaying #1 (biography: %s)",
    async (hasBiography) => {
      const records = hasBiography ? [record(0, true)] : [];
      mocks.storyQuery.data = { records: records, metadata: metadata(records) };
      const added = record(records.length);
      mocks.addFlow.runOrThrow.mockResolvedValue({
        newRecord: added,
        payloadLength: added.payloadLength,
        recordsHead: `0x${"4".repeat(64)}`,
        events: { StoryRecordAppended: { recordIndex: added.recordIndex, payloadLength: 100 } },
      });
      const { result } = renderHook(() => useStoryEditorController());
      act(() => result.current.form.updateContent("First ordinary story"));
      const untitledHash = result.current.form.draftPayloadHash;
      act(() => result.current.form.updateTitle("  First journey 😀  "));
      const titledHash = result.current.form.draftPayloadHash;
      expect(titledHash).not.toBe(untitledHash);
      await act(async () => result.current.form.submit());

      expect(mocks.addFlow.runOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "  First journey 😀  ",
          recordIndex: records.length,
          recordType: 1,
          expectedPayloadHash: titledHash,
        }),
      );
      expect(result.current.sortedRecords).toEqual([{ ...added, displayIndex: 1 }]);
      expect(result.current.meta).toMatchObject({ totalRecords: 1, totalPayloadLength: 100 });
      expect(mocks.toast.success).toHaveBeenCalledWith("Record #1 added successfully (100 bytes)");
      render(<StoryManuscript editor={result.current} />);
      expect(screen.getByText("#1")).toBeTruthy();
      expect(screen.queryByText("#0")).toBeNull();
    },
  );

  it("keeps Archive seal state but reports only ordinary records after sealing", async () => {
    const records = [record(0, true), record(1), record(2)];
    mocks.storyQuery.data = { records: records, metadata: metadata(records) };
    mocks.sealFlow.runOrThrow.mockResolvedValue({
      totalRecords: 3,
      recordsHead: `0x${"5".repeat(64)}`,
      events: { StorySealed: { totalRecords: 3 } },
    });
    const { result } = renderHook(() => useStoryEditorController());
    await act(async () => result.current.seal.execute());

    expect(result.current.isSealed).toBe(true);
    expect(result.current.meta).toMatchObject({
      totalRecords: 2,
      totalPayloadLength: 200,
      isSealed: true,
    });
    expect(result.current.sortedRecords.map((item) => item.displayIndex)).toEqual([1, 2]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Story sealed successfully (2 records)");
  });

  it("deducts the biography from prefetched metadata before records arrive", () => {
    mocks.location.state = {
      prefetchedStory: {
        tokenId: "7",
        storyMetadata: { ...metadata([record(0, true)]), biographyPayloadLength: 180 },
      },
    };
    mocks.storyQuery.loading = true;
    const { result } = renderHook(() => useStoryEditorController());
    expect(result.current.meta).toMatchObject({ totalRecords: 0, totalPayloadLength: 0 });
    expect(result.current.sortedRecords).toEqual([]);
  });
});

describe("story editor write authorization", () => {
  it("blocks both writes and sealing when access is denied, even with prefetched data", async () => {
    const records = [record(0)];
    mocks.location.state = {
      prefetchedStory: { storyRecords: records, storyMetadata: metadata(records) },
    };
    mocks.access.canEdit = false;
    mocks.access.isOwner = false;
    const { result } = renderHook(() => useStoryEditorController());
    act(() => result.current.form.updateContent("Denied draft"));
    await act(async () => {
      await result.current.form.submit();
      result.current.seal.handleSeal();
      await result.current.seal.execute();
    });
    expect(result.current.showEditorForm).toBe(false);
    expect(result.current.seal.showConfirm).toBe(false);
    expect(mocks.addFlow.runOrThrow).not.toHaveBeenCalled();
    expect(mocks.sealFlow.runOrThrow).not.toHaveBeenCalled();
  });

  it("rechecks ownership before sending either transaction", async () => {
    mocks.storyQuery.data = { records: [record(0)], metadata: metadata([record(0)]) };
    mocks.access.recheck.mockResolvedValue(false);
    const { result } = renderHook(() => useStoryEditorController());
    act(() => result.current.form.updateContent("Draft before transfer"));
    await act(async () => {
      await result.current.form.submit();
    });
    await act(async () => {
      await result.current.seal.execute();
    });
    expect(mocks.access.recheck).toHaveBeenCalledTimes(2);
    expect(mocks.addFlow.runOrThrow).not.toHaveBeenCalled();
    expect(mocks.sealFlow.runOrThrow).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain("Only the current NFT owner");
  });

  it("closes an open seal confirmation when the wallet loses ownership", () => {
    mocks.storyQuery.data = { records: [record(0)], metadata: metadata([record(0)]) };
    const { result, rerender } = renderHook(() => useStoryEditorController());
    act(() => result.current.seal.handleSeal());
    expect(result.current.seal.showConfirm).toBe(true);
    mocks.access.canEdit = false;
    mocks.access.isOwner = false;
    rerender();
    expect(result.current.showEditorForm).toBe(false);
    expect(result.current.seal.showConfirm).toBe(false);
  });
});

describe("story preview scope", () => {
  it.each([false, true])(
    "cancels old-scope submissions after a wallet/context switch (preview visible: %s)",
    async (previewVisible) => {
      mocks.storyQuery.data = { records: [record(0)], metadata: metadata([record(0)]) };
      let releasePreflight!: () => void;
      const preflight = new Promise<void>((resolve) => {
        releasePreflight = resolve;
      });
      const decisions: boolean[] = [];
      mocks.addFlow.runOrThrow.mockImplementation(async (args) => {
        if (!previewVisible) await preflight;
        const approved = await args.confirmTransactionPreview({ kind: "Story" });
        decisions.push(approved);
        throw new Error("Cancelled");
      });
      const { result, rerender } = renderHook(() => useStoryEditorController());
      act(() => result.current.form.updateContent("Draft for original scope"));
      let submission!: Promise<void>;
      act(() => {
        submission = result.current.form.submit();
      });
      await waitFor(() => expect(mocks.addFlow.runOrThrow).toHaveBeenCalled());
      if (previewVisible)
        await waitFor(() => expect(result.current.transactionPreview).not.toBeNull());
      mocks.access.scope = {};
      rerender();
      await act(async () => {
        releasePreflight();
        await submission;
      });
      expect(decisions).toEqual([false]);
      expect(result.current.transactionPreview).toBeNull();
    },
  );
});
