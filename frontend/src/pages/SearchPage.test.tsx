// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "./SearchPage";

const personHashA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const personHashB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const mocks = vi.hoisted(() => ({
  toastShow: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  personGateway: {
    listVersionEndorsements: vi.fn(),
    listTokenUriHistory: vi.fn(),
    listStoryChunksPage: vi.fn(),
  },
  treeGateway: {
    listPersonVersionsPage: vi.fn(),
    listChildrenPage: vi.fn(),
    listTrustedEndorsersPage: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
          String(options?.[name] ?? ""),
        );
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
        return String(fallbackOrOptions.defaultValue ?? key).replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, name) => String((fallbackOrOptions as Record<string, unknown>)[name] ?? ""),
        );
      }
      return key;
    },
  }),
}));

vi.mock("../shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/ui")>();
  return {
    ...actual,
    useToast: () => ({
      show: mocks.toastShow,
      success: mocks.toastSuccess,
      error: mocks.toastError,
    }),
  };
});

vi.mock("../domains/tree", () => ({
  useTreeGateway: () => mocks.treeGateway,
}));

vi.mock("../shared/crypto/identityHash", () => ({
  generateRandomIdentitySaltHex: () =>
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
}));

vi.mock("../domains/person", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domains/person")>();
  return {
    ...actual,
    usePersonGateway: () => mocks.personGateway,
    PersonHashCalculator: forwardRef((props: any, ref) => {
      useImperativeHandle(ref, () => ({
        hasPassphrase: () => false,
      }));

      useEffect(() => {
        props.onPublicFormChange?.();
      }, [props]);

      return <div data-testid="person-hash-calculator" />;
    }),
  };
});

describe("SearchPage", () => {
  beforeEach(() => {
    mocks.toastShow.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.personGateway.listVersionEndorsements.mockReset();
    mocks.personGateway.listTokenUriHistory.mockReset();
    mocks.personGateway.listStoryChunksPage.mockReset();
    mocks.treeGateway.listPersonVersionsPage.mockReset();
    mocks.treeGateway.listChildrenPage.mockReset();
    mocks.treeGateway.listTrustedEndorsersPage.mockReset();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("queries person versions through treeGateway and paginates within the page shell", async () => {
    mocks.treeGateway.listPersonVersionsPage
      .mockResolvedValueOnce({
        versions: [
          {
            versionIndex: 2,
            tag: "verified",
            addedBy: "0x00000000000000000000000000000000000000aa",
            timestamp: 1710000000,
            metadataCID: "cid://version-2",
            fatherHash: personHashB,
            fatherVersionIndex: 1,
            motherHash: personHashA,
            motherVersionIndex: 3,
          },
        ],
        totalCount: 3,
        hasMore: true,
        nextOffset: 1,
      })
      .mockResolvedValueOnce({
        versions: [
          {
            versionIndex: 3,
            tag: "latest",
            addedBy: "0x00000000000000000000000000000000000000bb",
            timestamp: 1710000100,
            metadataCID: "cid://version-3",
            fatherHash: personHashB,
            fatherVersionIndex: 1,
            motherHash: personHashA,
            motherVersionIndex: 3,
          },
        ],
        totalCount: 3,
        hasMore: false,
        nextOffset: 2,
      });

    render(<SearchPage />);

    fireEvent.click(screen.getByText("search.versionsQuery.title"));
    const hashInput = screen.getByPlaceholderText("search.versionsQuery.placeholder");
    fireEvent.change(hashInput, { target: { value: personHashA } });

    const form = hashInput.closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalledWith(personHashA, 0, 100),
    );
    expect(await screen.findByText("v2")).toBeTruthy();
    expect(screen.getByText("cid://version-2")).toBeTruthy();
    expect(screen.getByText("search.totalResults: 3")).toBeTruthy();

    const section = form!.parentElement;
    expect(section).toBeTruthy();
    fireEvent.click(within(section!).getByText("search.next"));

    await waitFor(() =>
      expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenLastCalledWith(
        personHashA,
        1,
        100,
      ),
    );
    expect(await screen.findByText("v3")).toBeTruthy();
    expect(screen.getByText("cid://version-3")).toBeTruthy();
  });

  it("queries endorsement stats through personGateway and resets the section state", async () => {
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [3, 4],
      endorsementCounts: [11, 7],
      tokenIds: [101, 202],
      totalVersions: 2,
      hasMore: false,
      nextOffset: 2,
    });

    render(<SearchPage />);

    fireEvent.click(screen.getByText("search.endorsementQuery.title"));
    const hashInput = screen.getByPlaceholderText("search.endorsementQuery.placeholder");
    fireEvent.change(hashInput, { target: { value: personHashB } });

    const form = hashInput.closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(personHashB, 0, 100),
    );
    expect(await screen.findByText("v3")).toBeTruthy();
    expect(screen.getByText("#101")).toBeTruthy();
    expect(screen.getByText("search.totalResults: 2")).toBeTruthy();

    const section = form!.parentElement;
    expect(section).toBeTruthy();
    fireEvent.click(within(section!).getByText("search.reset"));

    await waitFor(() => expect(screen.queryByText("#101")).toBeNull());
    expect(screen.queryByText("search.totalResults: 2")).toBeNull();
  });

  it("queries trusted endorsers through treeGateway and resets the section state", async () => {
    const sourceAccount = "0x00000000000000000000000000000000000000cc";
    mocks.treeGateway.listTrustedEndorsersPage.mockResolvedValue({
      accounts: [sourceAccount],
      totalCount: 1,
      hasMore: false,
      nextOffset: 1,
    });

    render(<SearchPage />);

    fireEvent.click(screen.getByText("search.trustedEndorsersQuery.title"));
    const hashInput = screen.getByPlaceholderText("search.trustedEndorsersQuery.placeholder");
    fireEvent.change(hashInput, { target: { value: personHashA } });

    const form = hashInput.closest("form");
    expect(form).toBeTruthy();
    fireEvent.change(within(form!).getByTitle("search.trustedEndorsersQuery.versionPlaceholder"), {
      target: { value: "1" },
    });
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(mocks.treeGateway.listTrustedEndorsersPage).toHaveBeenCalledWith(
        personHashA,
        1,
        0,
        100,
      ),
    );
    expect(await screen.findByTitle(sourceAccount)).toBeTruthy();
    expect(screen.getByText("search.trustedEndorsersQuery.totalSources: 1")).toBeTruthy();

    const section = form!.parentElement;
    expect(section).toBeTruthy();
    fireEvent.click(within(section!).getByText("search.reset"));

    await waitFor(() => expect(screen.queryByTitle(sourceAccount)).toBeNull());
    expect(screen.queryByText("search.trustedEndorsersQuery.totalSources: 1")).toBeNull();
  });
});
