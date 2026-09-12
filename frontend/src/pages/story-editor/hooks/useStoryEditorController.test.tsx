// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID, STORY_CHUNK_SCHEMA_ID } from "@deepfamily/protocol-core";
import type { StoryChunk, StoryMetadata } from "../../../shared/model";
import { StoryManuscript } from "../sections/StoryManuscript";
import { StoryRecordPanel } from "../sections/StoryRecordPanel";
import { useStoryEditorController } from "./useStoryEditorController";

const mocks = vi.hoisted(() => ({
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
  useNFTDetails: () => ({ data: undefined }),
  useStoryData: () => mocks.storyQuery,
  getEditableChunkTypeOptions: () => [],
  getChunkTypeIcon: () => () => null,
  getChunkTypeColorClass: () => "",
  getChunkTypeBorderColorClass: () => "",
}));
vi.mock("../../../domains/transactions", () => ({
  useAddStoryChunkFlow: () => mocks.addFlow,
  useSealStoryFlow: () => mocks.sealFlow,
}));
vi.mock("../../../shared/cache/queryClient", () => ({
  getScopedQueryClient: () => mocks.queryClient,
}));
vi.mock("../../../shared/ui", () => ({
  useToast: () => mocks.toast,
  CopyIconButton: () => null,
}));

function chunk(index: number, biography = false): StoryChunk {
  return {
    chunkIndex: index,
    chunkType: biography ? 0 : 1,
    schemaId: biography ? STORY_BIOGRAPHY_SCHEMA_ID : STORY_CHUNK_SCHEMA_ID,
    content: biography ? "Mint biography stays in the basic story" : `Ordinary story ${index}`,
    chunkHash: `0x${"1".repeat(64)}`,
    recordHash: `0x${"2".repeat(64)}`,
    timestamp: 1_700_000_000,
    editor: "0x0000000000000000000000000000000000000001",
    attachmentCID: "",
    payloadLength: biography ? 180 : 100,
  };
}

function metadata(chunks: StoryChunk[]): StoryMetadata {
  return {
    totalChunks: chunks.length,
    totalLength: chunks.reduce((sum, item) => sum + item.payloadLength!, 0),
    fullStoryHash: `0x${"3".repeat(64)}`,
    lastUpdateTime: 1_700_000_000,
    isSealed: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
    const records = [chunk(0, true)];
    mocks.storyQuery.data = { chunks: records, metadata: metadata(records) };
    const { result } = renderHook(() => useStoryEditorController());

    expect(result.current.sortedChunks).toEqual([]);
    expect(result.current.meta).toMatchObject({ totalChunks: 0, totalLength: 0 });
    render(
      <>
        <StoryManuscript editor={result.current} />
        <StoryRecordPanel editor={result.current} />
      </>,
    );
    expect(screen.queryByRole("button", { name: "Seal permanently" })).toBeNull();
    expect(screen.queryByText(records[0].content)).toBeNull();
    expect(screen.getByText("No profile chunks yet.")).toBeTruthy();
  });

  it.each([false, true])(
    "appends the first ordinary story at the raw index while displaying #1 (biography: %s)",
    async (hasBiography) => {
      const records = hasBiography ? [chunk(0, true)] : [];
      mocks.storyQuery.data = { chunks: records, metadata: metadata(records) };
      const added = chunk(records.length);
      mocks.addFlow.runOrThrow.mockResolvedValue({
        newChunk: added,
        contentLength: added.payloadLength,
        recordsHead: `0x${"4".repeat(64)}`,
        events: { StoryRecordAppended: { chunkIndex: added.chunkIndex, contentLength: 100 } },
      });
      const { result } = renderHook(() => useStoryEditorController());
      act(() => result.current.form.updateContent("First ordinary story"));
      await act(async () => result.current.form.submit());

      expect(mocks.addFlow.runOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ chunkIndex: records.length, chunkType: 1 }),
      );
      expect(result.current.sortedChunks).toEqual([{ ...added, displayIndex: 1 }]);
      expect(result.current.meta).toMatchObject({ totalChunks: 1, totalLength: 100 });
      expect(mocks.toast.success).toHaveBeenCalledWith("Chunk #1 added successfully (100 bytes)");
      render(<StoryManuscript editor={result.current} />);
      expect(screen.getByText("#1")).toBeTruthy();
      expect(screen.queryByText("#0")).toBeNull();
    },
  );

  it("keeps Archive seal state but reports only ordinary chunks after sealing", async () => {
    const records = [chunk(0, true), chunk(1), chunk(2)];
    mocks.storyQuery.data = { chunks: records, metadata: metadata(records) };
    mocks.sealFlow.runOrThrow.mockResolvedValue({
      totalChunks: 3,
      fullStoryHash: `0x${"5".repeat(64)}`,
      events: { StorySealed: { totalChunks: 3 } },
    });
    const { result } = renderHook(() => useStoryEditorController());
    await act(async () => result.current.seal.execute());

    expect(result.current.isSealed).toBe(true);
    expect(result.current.meta).toMatchObject({ totalChunks: 2, totalLength: 200, isSealed: true });
    expect(result.current.sortedChunks.map((item) => item.displayIndex)).toEqual([1, 2]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Story sealed successfully (2 chunks)");
  });

  it("deducts the biography from prefetched metadata before records arrive", () => {
    mocks.location.state = {
      prefetchedStory: {
        tokenId: "7",
        storyMetadata: { ...metadata([chunk(0, true)]), biographyPayloadLength: 180 },
      },
    };
    mocks.storyQuery.loading = true;
    const { result } = renderHook(() => useStoryEditorController());
    expect(result.current.meta).toMatchObject({ totalChunks: 0, totalLength: 0 });
    expect(result.current.sortedChunks).toEqual([]);
  });
});
