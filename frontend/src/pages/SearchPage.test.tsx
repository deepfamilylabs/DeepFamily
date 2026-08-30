// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "./SearchPage";

const personHashA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const personHashB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const walletAddress = "0xcccccccccccccccccccccccccccccccccccccccc";

const mocks = vi.hoisted(() => ({
  toastShow: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  personGateway: {
    listVersionEndorsements: vi.fn(),
    listTokenUriHistory: vi.fn(),
    listStoryChunksPage: vi.fn(),
    getNFTDetails: vi.fn(),
  },
  treeGateway: {
    listPersonVersionsPage: vi.fn(),
    listChildrenPage: vi.fn(),
    listTrustedEndorsersPage: vi.fn(),
  },
  accountGateway: {
    listVersionsByCreator: vi.fn(),
    listEndorsementsByAccount: vi.fn(),
    listNftsByOwner: vi.fn(),
    resolveMintedIdentities: vi.fn(),
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

vi.mock("../domains/person", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domains/person")>();
  return {
    ...actual,
    usePersonGateway: () => mocks.personGateway,
    useAccountGateway: () => mocks.accountGateway,
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

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  );
}

function queryBox() {
  return screen.getByLabelText("Search the chain");
}

function submitQuery(value: string) {
  const input = queryBox();
  fireEvent.change(input, { target: { value } });
  const form = input.closest("form");
  expect(form).toBeTruthy();
  fireEvent.submit(form!);
}

const versionsPage1 = {
  versions: [
    {
      versionIndex: 2,
      addedBy: "0x00000000000000000000000000000000000000aa",
      timestamp: 1710000000,
      versionCommitment: "0xcommitment-2",
      fatherHash: personHashB,
      fatherVersionIndex: 1,
      motherHash: personHashA,
      motherVersionIndex: 3,
    },
  ],
  totalCount: 3,
  hasMore: true,
  nextOffset: 1,
};

describe("SearchPage", () => {
  beforeEach(() => {
    mocks.toastShow.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.personGateway.listVersionEndorsements.mockReset();
    mocks.personGateway.listTokenUriHistory.mockReset();
    mocks.personGateway.listStoryChunksPage.mockReset();
    mocks.personGateway.getNFTDetails.mockReset();
    mocks.treeGateway.listPersonVersionsPage.mockReset();
    mocks.treeGateway.listChildrenPage.mockReset();
    mocks.treeGateway.listTrustedEndorsersPage.mockReset();
    mocks.accountGateway.listVersionsByCreator.mockReset();
    mocks.accountGateway.listEndorsementsByAccount.mockReset();
    mocks.accountGateway.listNftsByOwner.mockReset();
    mocks.accountGateway.resolveMintedIdentities.mockReset();
    mocks.accountGateway.resolveMintedIdentities.mockResolvedValue({});
    window.localStorage.clear();
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

  it("resolves a person hash from the single query box and paginates its versions", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValueOnce(versionsPage1).mockResolvedValueOnce({
      versions: [
        {
          versionIndex: 3,
          addedBy: "0x00000000000000000000000000000000000000bb",
          timestamp: 1710000100,
          versionCommitment: "0xcommitment-3",
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

    renderPage();
    submitQuery(personHashA);

    await waitFor(() =>
      expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalledWith(personHashA, 0, 100),
    );
    expect(await screen.findByText("v2")).toBeTruthy();
    expect(screen.getByTitle("0xcommitment-2")).toBeTruthy();
    expect(screen.getByText("search.totalResults: 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "search.next" }));

    await waitFor(() =>
      expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenLastCalledWith(personHashA, 1, 100),
    );
    expect(await screen.findByText("v3")).toBeTruthy();
  });

  it("shows mint and endorsement state on version rows without opening the stats tab", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [2],
      endorsementCounts: [9],
      tokenIds: [128],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 1,
    });

    renderPage();
    submitQuery(personHashA);

    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());
    // Enrichment covers exactly the index window the versions page returned.
    await waitFor(() =>
      expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(personHashA, 0, 1),
    );

    expect(await screen.findByText("NFT #128")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("offers an NFT tab for a person and lists the minted tokens by name", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [2, 3],
      endorsementCounts: [9, 1],
      tokenIds: [128, 0],
      totalVersions: 2,
      hasMore: false,
      nextOffset: 2,
    });
    mocks.personGateway.getNFTDetails.mockResolvedValue({
      personHash: personHashA,
      versionIndex: 2,
      version: {},
      metadata: {},
      core: {
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthPlace: "London",
        nftPublicStory: "Wrote the first algorithm intended for a machine.",
      },
    });

    renderPage();
    submitQuery(personHashA);
    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("tab", { name: /NFTs/ }));

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    // The details call already returns the whole identity — surface it, don't drop it.
    expect(screen.getByText("Female")).toBeTruthy();
    expect(screen.getByText(/London/)).toBeTruthy();
    expect(screen.getByText(/1815/)).toBeTruthy();
    expect(
      screen.getByText("Wrote the first algorithm intended for a machine."),
    ).toBeTruthy();
    // The endorsement count came from the stats call, not a second lookup.
    expect(screen.getByText("9")).toBeTruthy();
    // A minted row links to the token's canonical page.
    const wiki = screen.getByRole("link", { name: /Encyclopedia/ });
    expect(wiki.getAttribute("href")).toBe("/person/128");
    // A new tab keeps the search behind it; same-tab navigation would drop it.
    expect(wiki.getAttribute("target")).toBe("_blank");
    expect(wiki.getAttribute("rel")).toContain("noopener");
    // v3 was never minted (token id 0), so it must not appear as an NFT row.
    expect(screen.queryByText("#0")).toBeNull();

    // Clicking the token id resolves it as a subject in its own right.
    mocks.personGateway.listStoryChunksPage.mockResolvedValue({
      chunks: [],
      totalChunks: 0,
      hasMore: false,
      nextOffset: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "#128" }));

    await waitFor(() =>
      expect(mocks.personGateway.listStoryChunksPage).toHaveBeenCalledWith(128, 0, 100),
    );
    expect(await screen.findByText(/familyTree.nodeDetail.tokenId/)).toBeTruthy();
  });

  it("follows a creator address straight from a version row", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.accountGateway.listVersionsByCreator.mockResolvedValue({
      rows: [],
      totalCount: 0,
      hasMore: false,
      nextOffset: 0,
      truncated: false,
    });

    renderPage();
    submitQuery(personHashA);
    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());

    const creator = "0x00000000000000000000000000000000000000aa";
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(creator, "i") }));

    // The address resolves as a subject; no copy-paste round trip.
    await waitFor(() =>
      expect(mocks.accountGateway.listVersionsByCreator).toHaveBeenCalledWith(creator, 0, 100),
    );
  });

  it("scopes story chunks to the person's own NFT instead of asking for a token id", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [2],
      endorsementCounts: [9],
      tokenIds: [128],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 1,
    });
    mocks.personGateway.listStoryChunksPage.mockResolvedValue({
      chunks: [],
      totalChunks: 0,
      hasMore: false,
      nextOffset: 0,
    });

    renderPage();
    submitQuery(personHashA);
    await waitFor(() =>
      expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Story chunks/ }));

    // The version scope resolves the NFT; there is no separate token control.
    await waitFor(() =>
      expect(mocks.personGateway.listStoryChunksPage).toHaveBeenCalledWith(128, 0, 100),
    );
    expect(screen.queryByTitle("search.storyChunksQuery.tokenId")).toBeNull();
    expect(screen.getByText("Version")).toBeTruthy();
    expect(screen.getByText("#128")).toBeTruthy();
  });

  it("names the children that have been minted instead of showing bare hashes", async () => {
    const childA = `0x${"1".repeat(64)}`;
    const childB = `0x${"2".repeat(64)}`;
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.treeGateway.listChildrenPage.mockResolvedValue({
      childHashes: [childA, childB],
      childVersions: [1, 2],
      totalChildren: 2,
      hasMore: false,
      nextOffset: 2,
    });
    mocks.accountGateway.resolveMintedIdentities.mockResolvedValue({
      [`${childA}:1`]: { tokenId: 55, fullName: "Byron Lovelace" },
    });

    renderPage();
    submitQuery(personHashA);
    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Children" }));

    await waitFor(() => expect(mocks.treeGateway.listChildrenPage).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.accountGateway.resolveMintedIdentities).toHaveBeenCalledWith([
        { personHash: childA, versionIndex: 1 },
        { personHash: childB, versionIndex: 2 },
      ]),
    );

    // The minted child gets a name and its token; the unminted one stays a hash.
    expect(await screen.findByText("Byron Lovelace")).toBeTruthy();
    expect(screen.getAllByText("search.childrenQuery.childHash")).toHaveLength(1);

    // The token badge must resolve the NFT, not fall through to the person hash.
    mocks.personGateway.listStoryChunksPage.mockResolvedValue({
      chunks: [],
      totalChunks: 0,
      hasMore: false,
      nextOffset: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: /#55/ }));

    await waitFor(() =>
      expect(mocks.personGateway.listStoryChunksPage).toHaveBeenCalledWith(55, 0, 100),
    );
  });

  it("reuses the resolved hash when switching facets, without re-entering it", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [3, 4],
      endorsementCounts: [11, 7],
      tokenIds: [101, 202],
      totalVersions: 2,
      hasMore: false,
      nextOffset: 2,
    });

    renderPage();
    submitQuery(personHashB);

    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("tab", { name: /Endorsement stats/ }));

    await waitFor(() =>
      expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(personHashB, 0, 100),
    );
    expect(await screen.findByText("#101")).toBeTruthy();
  });

  it("carries the version scope from a result row into the endorsement-sources facet", async () => {
    mocks.treeGateway.listPersonVersionsPage.mockResolvedValue(versionsPage1);
    mocks.treeGateway.listTrustedEndorsersPage.mockResolvedValue({
      accounts: ["0x00000000000000000000000000000000000000cc"],
      totalCount: 1,
      hasMore: false,
      nextOffset: 1,
    });

    renderPage();
    submitQuery(personHashA);

    await waitFor(() => expect(mocks.treeGateway.listPersonVersionsPage).toHaveBeenCalled());
    expect(await screen.findByText("v2")).toBeTruthy();

    // The row action is a plain button; the same-named tab has role="tab".
    fireEvent.click(screen.getByRole("button", { name: "Endorsement sources" }));

    await waitFor(() =>
      expect(mocks.treeGateway.listTrustedEndorsersPage).toHaveBeenCalledWith(
        personHashA,
        2,
        0,
        100,
      ),
    );
    expect(
      await screen.findByText("search.trustedEndorsersQuery.totalSources: 1"),
    ).toBeTruthy();
  });

  it("routes a numeric token id straight to the story-chunks facet", async () => {
    mocks.personGateway.listStoryChunksPage.mockResolvedValue({
      chunks: [
        {
          chunkIndex: 1,
          chunkType: 0,
          chunkHash: "0xchunk-1",
          content: "First chunk",
          timestamp: 1710000000,
        },
      ],
      totalChunks: 1,
      hasMore: false,
      nextOffset: 1,
    });

    mocks.personGateway.getNFTDetails.mockResolvedValue({
      personHash: personHashA,
      versionIndex: 2,
      version: {},
      metadata: {},
      core: {
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        birthPlace: "London",
        nftPublicStory: "Wrote the first algorithm intended for a machine.",
      },
    });

    renderPage();
    submitQuery("128");

    await waitFor(() =>
      expect(mocks.personGateway.listStoryChunksPage).toHaveBeenCalledWith(128, 0, 100),
    );
    expect(await screen.findByText("First chunk")).toBeTruthy();
    expect(mocks.treeGateway.listPersonVersionsPage).not.toHaveBeenCalled();

    // The token IS the scope, so there is nothing to narrow and no scope bar.
    expect(screen.queryByText("Version")).toBeNull();
    expect(screen.queryByLabelText("search.trustedEndorsersQuery.versionIndex")).toBeNull();

    // A token id on its own is meaningless; the minted person must be named.
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Female")).toBeTruthy();
    expect(screen.getByText(/London/)).toBeTruthy();
    expect(
      screen.getByText("Wrote the first algorithm intended for a machine."),
    ).toBeTruthy();
  });

  it("keeps a token search usable when the NFT identity cannot be read", async () => {
    mocks.personGateway.listStoryChunksPage.mockResolvedValue({
      chunks: [],
      totalChunks: 0,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.getNFTDetails.mockRejectedValue(new Error("reader down"));

    renderPage();
    submitQuery("128");

    await waitFor(() => expect(mocks.personGateway.listStoryChunksPage).toHaveBeenCalled());
    expect(await screen.findByText(/familyTree.nodeDetail.tokenId/)).toBeTruthy();
  });

  it("resolves a wallet address to the versions that account created", async () => {
    mocks.accountGateway.listVersionsByCreator.mockResolvedValue({
      rows: [{ personHash: personHashA, versionIndex: 4, blockNumber: 20, timestamp: 1710000000 }],
      totalCount: 1,
      hasMore: false,
      nextOffset: 1,
      truncated: false,
    });

    renderPage();
    submitQuery(walletAddress);

    await waitFor(() =>
      expect(mocks.accountGateway.listVersionsByCreator).toHaveBeenCalledWith(
        walletAddress,
        0,
        100,
      ),
    );
    expect(await screen.findByText("v4")).toBeTruthy();
    expect(mocks.treeGateway.listPersonVersionsPage).not.toHaveBeenCalled();

    // Bare hashes in the account lists get named too, not just children.
    await waitFor(() =>
      expect(mocks.accountGateway.resolveMintedIdentities).toHaveBeenCalledWith([
        { personHash: personHashA, versionIndex: 4 },
      ]),
    );
  });

  it("switches an address subject to the NFTs it holds", async () => {
    mocks.accountGateway.listVersionsByCreator.mockResolvedValue({
      rows: [],
      totalCount: 0,
      hasMore: false,
      nextOffset: 0,
      truncated: false,
    });
    mocks.accountGateway.listNftsByOwner.mockResolvedValue({
      rows: [{ tokenId: 128, personHash: personHashB, versionIndex: 2 }],
      totalCount: 1,
      hasMore: false,
      nextOffset: 1,
      truncated: false,
    });

    renderPage();
    submitQuery(walletAddress);
    await waitFor(() => expect(mocks.accountGateway.listVersionsByCreator).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("tab", { name: /NFTs held/ }));

    await waitFor(() =>
      expect(mocks.accountGateway.listNftsByOwner).toHaveBeenCalledWith(walletAddress, 0, 100),
    );
    expect(await screen.findByText("NFT #128")).toBeTruthy();
  });

  it("flags a hash of the wrong length before anything is queried", async () => {
    renderPage();
    fireEvent.change(queryBox(), { target: { value: "0xabc123" } });

    expect(screen.getByText("search.validation.hashInvalid")).toBeTruthy();
    expect(screen.getByText("currently 6 digits")).toBeTruthy();
    expect(mocks.treeGateway.listPersonVersionsPage).not.toHaveBeenCalled();
  });
});
