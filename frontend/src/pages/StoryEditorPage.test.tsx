// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StoryEditorPage from "./StoryEditorPage";
import type { StoryChunk } from "../shared/model";

const mocks = vi.hoisted(() => ({
  tokenId: "42",
  locationState: undefined as any,
  nftDetails: null as any,
  storyData: null as any,
  storyLoading: false,
  storyError: null as string | null,
  addStoryRunOrThrow: vi.fn(),
  sealStoryRunOrThrow: vi.fn(),
  queryClear: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastShow: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ tokenId: mocks.tokenId }),
  useLocation: () => ({ state: mocks.locationState }),
}));

vi.mock("react-i18next", () => {
  const interpolate = (template: string, values?: Record<string, unknown>) =>
    template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => String(values?.[key] ?? ""));

  return {
    useTranslation: () => ({
      t: (_key: string, fallbackOrOptions?: string | Record<string, any>, options?: any) => {
        if (typeof fallbackOrOptions === "string") {
          return interpolate(fallbackOrOptions, options);
        }
        if (fallbackOrOptions?.defaultValue) {
          return interpolate(String(fallbackOrOptions.defaultValue), fallbackOrOptions);
        }
        return _key;
      },
    }),
  };
});

vi.mock("../domains/config/context", () => ({
  useConfig: () => ({
    contractAddress: "0x0000000000000000000000000000000000000abc",
    rpcUrl: "https://rpc.local",
    chainId: 123,
  }),
}));

vi.mock("../shared/ui", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    show: mocks.toastShow,
  }),
}));

vi.mock("../domains/person/queries", () => ({
  useNFTDetails: () => ({
    data: mocks.nftDetails,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useStoryData: () => ({
    data: mocks.storyData,
    loading: mocks.storyLoading,
    error: mocks.storyError,
    refetch: vi.fn(),
  }),
}));

vi.mock("../shared/cache/queryClient", () => ({
  getScopedQueryClient: () => ({
    clear: mocks.queryClear,
  }),
}));

vi.mock("../domains/transactions/flows", () => ({
  useAddStoryChunkFlow: () => ({
    runOrThrow: mocks.addStoryRunOrThrow,
  }),
  useSealStoryFlow: () => ({
    runOrThrow: mocks.sealStoryRunOrThrow,
  }),
}));

const bytes32 = (hex: string) => `0x${hex.repeat(32)}`;

const existingChunk: StoryChunk = {
  chunkIndex: 0,
  chunkHash: bytes32("11"),
  content: "existing story",
  timestamp: 100,
  editor: "0x00000000000000000000000000000000000000aa",
  chunkType: 0,
  attachmentCID: "",
};

function baseStoryData(isSealed = false) {
  return {
    chunks: [existingChunk],
    fullStory: existingChunk.content,
    integrity: {
      missing: [],
      lengthMatch: true,
      hashMatch: true,
      computedLength: existingChunk.content.length,
      computedHash: bytes32("22"),
    },
    metadata: {
      totalChunks: 1,
      totalLength: existingChunk.content.length,
      isSealed,
      lastUpdateTime: existingChunk.timestamp,
      fullStoryHash: bytes32("33"),
    },
    loading: false,
    fetchedAt: 1000,
  };
}

describe("StoryEditorPage", () => {
  beforeEach(() => {
    mocks.tokenId = "42";
    mocks.locationState = undefined;
    mocks.nftDetails = {
      personHash: "0xperson",
      versionIndex: 2,
      version: {},
      core: {
        fullName: "Ada Lovelace",
      },
    };
    mocks.storyData = baseStoryData(false);
    mocks.storyLoading = false;
    mocks.storyError = null;
    mocks.addStoryRunOrThrow.mockReset();
    mocks.sealStoryRunOrThrow.mockReset();
    mocks.queryClear.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.toastShow.mockReset();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("adds a story chunk through the transaction flow and invalidates scoped story cache", async () => {
    const addedChunk: StoryChunk = {
      chunkIndex: 1,
      chunkHash: bytes32("44"),
      content: "new story",
      timestamp: 200,
      editor: "0x00000000000000000000000000000000000000bb",
      chunkType: 0,
      attachmentCID: "",
    };
    mocks.addStoryRunOrThrow.mockResolvedValue({
      chunkIndex: 1,
      contentLength: addedChunk.content.length,
      transactionHash: "0xchunk",
      blockNumber: 99,
      newChunk: addedChunk,
      events: {
        StoryChunkAdded: {
          chunkIndex: 1,
          contentLength: addedChunk.content.length,
        },
      },
    });

    render(<StoryEditorPage />);

    await waitFor(() => expect(screen.getByText("Ada Lovelace Biography")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/Enter chunk content/), {
      target: { value: "new story" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Chunk"));
    });

    await waitFor(() => expect(mocks.addStoryRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.addStoryRunOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: "42",
        chunkIndex: 1,
        content: "new story",
        chunkType: 0,
        attachmentCID: "",
        expectedHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42");
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42:meta");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Chunk #1 added successfully (9 bytes)",
    );
    expect(await screen.findByText("new story")).toBeTruthy();
  });

  it("seals the story through the confirmation dialog and updates local sealed state", async () => {
    mocks.sealStoryRunOrThrow.mockResolvedValue({
      totalChunks: 1,
      fullStoryHash: bytes32("55"),
      transactionHash: "0xseal",
      blockNumber: 100,
      events: {
        StorySealed: {
          totalChunks: 1,
        },
      },
    });

    render(<StoryEditorPage />);

    await waitFor(() => expect(screen.getByText("Seal Story")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("Seal Story"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Seal"));
    });

    await waitFor(() => expect(mocks.sealStoryRunOrThrow).toHaveBeenCalledWith({ tokenId: "42" }));
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42");
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42:meta");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Story sealed successfully (1 chunks)");
    expect(screen.getAllByText("Sealed").length).toBeGreaterThan(0);
  });
});
