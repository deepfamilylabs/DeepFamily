// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StoryEditorPage from "./StoryEditorPage";
import type { StoryRecord } from "../shared/model";

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

vi.mock("react-router-dom", async () => {
  const { createElement } = await import("react");
  return {
    useParams: () => ({ tokenId: mocks.tokenId }),
    useLocation: () => ({ state: mocks.locationState }),
    Link: ({ to, children, ...rest }: any) =>
      createElement("a", { href: String(to), ...rest }, children),
  };
});

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

vi.mock("../domains/config", () => ({
  useConfig: () => ({
    contractAddress: "0x0000000000000000000000000000000000000abc",
    rpcUrl: "https://rpc.local",
    chainId: 123,
  }),
}));

vi.mock("../shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/ui")>();
  return {
    ...actual,
    useToast: () => ({
      success: mocks.toastSuccess,
      error: mocks.toastError,
      show: mocks.toastShow,
    }),
  };
});

vi.mock("../domains/person", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domains/person")>();
  return {
    ...actual,
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
  };
});

vi.mock("../shared/cache/queryClient", () => ({
  getScopedQueryClient: () => ({
    clear: mocks.queryClear,
  }),
}));

vi.mock("../domains/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domains/transactions")>()),
  useAddStoryRecordFlow: () => ({
    runOrThrow: mocks.addStoryRunOrThrow,
  }),
  useSealStoryFlow: () => ({
    runOrThrow: mocks.sealStoryRunOrThrow,
  }),
}));

const bytes32 = (hex: string) => `0x${hex.repeat(32)}`;

const existingRecord: StoryRecord = {
  title: "",
  recordIndex: 0,
  recordHash: bytes32("a1"),
  payloadHash: bytes32("11"),
  content: "existing story",
  timestamp: 100,
  author: "0x00000000000000000000000000000000000000aa",
  recordType: 0,
  attachmentCID: "",
};

function baseStoryData(isSealed = false) {
  return {
    records: [existingRecord],
    fullStory: existingRecord.content,
    integrity: {
      missing: [],
      lengthMatch: true,
      hashMatch: true,
      computedLength: existingRecord.content.length,
      computedHash: bytes32("22"),
    },
    metadata: {
      totalRecords: 1,
      totalPayloadLength: existingRecord.content.length,
      isSealed,
      lastUpdateTime: existingRecord.timestamp,
      recordsHead: bytes32("33"),
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

  it("adds a story record through the transaction flow and invalidates scoped story cache", async () => {
    const addedRecord: StoryRecord = {
      title: "",
      recordIndex: 1,
      payloadHash: bytes32("44"),
      content: "new story",
      timestamp: 200,
      author: "0x00000000000000000000000000000000000000bb",
      recordType: 0,
      attachmentCID: "",
    };
    mocks.addStoryRunOrThrow.mockResolvedValue({
      recordIndex: 1,
      payloadLength: addedRecord.content.length,
      transactionHash: "0xrecord",
      blockNumber: 99,
      newRecord: addedRecord,
      events: {
        StoryRecordAppended: {
          recordIndex: 1,
          payloadLength: addedRecord.content.length,
        },
      },
    });

    render(<StoryEditorPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/Enter story content/), {
      target: { value: "new story" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Review & sign/ }));
    });

    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      if (alerts.length) throw new Error(alerts.map((el) => el.textContent).join("; "));
      expect(mocks.addStoryRunOrThrow).toHaveBeenCalledTimes(1);
    });
    expect(mocks.addStoryRunOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "",
        tokenId: "42",
        recordIndex: 1,
        content: "new story",
        recordType: 1,
        attachmentCID: "",
        expectedPayloadHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42");
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42:meta");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Record #2 added successfully (9 bytes)");
    expect(await screen.findByText("new story")).toBeTruthy();
  });

  it("shows the actionable capacity guidance when a story cannot fit the network limit", async () => {
    const message =
      "Buffered archive gas exceeds the network transaction limit. Split the text into another logical story record.";
    mocks.addStoryRunOrThrow.mockRejectedValue(
      Object.assign(new Error(message), {
        code: "ARCHIVE_VALIDATION_FAILED",
        type: "VALIDATION_ERROR",
      }),
    );
    render(<StoryEditorPage />);
    fireEvent.change(screen.getByPlaceholderText(/Enter story content/), {
      target: { value: "A story" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review & sign/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(screen.getByRole("alert").textContent).not.toContain("Network error");
  });

  it("seals the story through the confirmation dialog and updates local sealed state", async () => {
    mocks.sealStoryRunOrThrow.mockResolvedValue({
      totalRecords: 1,
      recordsHead: bytes32("55"),
      transactionHash: "0xseal",
      blockNumber: 100,
      events: {
        StorySealed: {
          totalRecords: 1,
        },
      },
    });

    render(<StoryEditorPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Seal permanently" })).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Seal permanently" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Seal"));
    });

    await waitFor(() =>
      expect(mocks.sealStoryRunOrThrow).toHaveBeenCalledWith({
        tokenId: "42",
        confirmTransactionPreview: expect.any(Function),
      }),
    );
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42");
    expect(mocks.queryClear).toHaveBeenCalledWith("story:42:meta");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Story sealed successfully (1 records)");
    expect(screen.getAllByText("Sealed").length).toBeGreaterThan(0);
  });
});
