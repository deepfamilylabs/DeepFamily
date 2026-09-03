// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PeoplePage from "./PeoplePage";
import { makeNodeId, type NodeData } from "../shared/model";

const mocks = vi.hoisted(() => ({
  nodesData: {} as Record<string, NodeData>,
  graphNodeIds: [] as string[],
  graphNodeDepths: {} as Record<string, number>,
  loading: false,
  treeErrors: [] as unknown[],
  contractMessage: "",
  treeRefresh: vi.fn(),
  setActivePath: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(/{{\s*(\w+)\s*}}/g, (_match, key) =>
          String(options?.[key] ?? ""),
        );
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
        return String(fallbackOrOptions.defaultValue ?? _key).replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, key) => String((fallbackOrOptions as Record<string, unknown>)[key] ?? ""),
        );
      }
      return _key;
    },
  }),
}));

vi.mock("../app/context", () => ({
  useActivePath: () => ({
    setActivePath: mocks.setActivePath,
  }),
}));

vi.mock("../domains/tree", () => ({
  useTreeGraphData: () => ({
    rootId: mocks.graphNodeIds[0] ?? null,
    rootExists: mocks.graphNodeIds.length > 0,
    nodesData: mocks.nodesData,
  }),
  useTreeStatus: () => ({
    loading: mocks.loading,
    contractMessage: mocks.contractMessage,
    errors: mocks.treeErrors,
    refresh: mocks.treeRefresh,
    clearAllCaches: vi.fn(),
    progress: { created: mocks.graphNodeIds.length, depth: mocks.graphNodeIds.length ? 1 : 0 },
  }),
  useFamilyTreeProjection: () => ({
    graph: {
      nodes: mocks.graphNodeIds.map((id) => ({ id, depth: mocks.graphNodeDepths[id] })),
    },
  }),
  useTreeNodeAccess: () => ({
    getOwnerOf: vi.fn(),
    getStoryData: vi.fn(),
    preloadStoryData: vi.fn(),
  }),
  useTreeMutations: () => ({
    bumpEndorsementCount: vi.fn(),
    invalidateByTx: vi.fn(),
  }),
  MetadataUnlockControl: () => <div data-testid="metadata-unlock-control" />,
}));

vi.mock("../domains/config", () => ({
  useConfig: () => ({ rootHash: "", rootVersionIndex: 1 }),
  FamilyTreeConfigForm: () => <div data-testid="family-tree-config-form" />,
}));

vi.mock("../domains/person", () => ({
  PersonStoryCard: ({ person, onOpen }: any) => (
    <button data-testid={`person-card-${person.tokenId}`} onClick={() => onOpen(person)}>
      {person.fullName}
    </button>
  ),
  PersonStoryModal: ({ person, isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="person-story-modal">
        <span data-testid="person-story-name">{person.fullName}</span>
        <button onClick={onClose}>close-story-modal</button>
      </div>
    ) : null,
}));

vi.mock("../shared/ui", () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
  EmptyState: ({ title, description, action }: any) => (
    <div>
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
  PageHead: ({ title, subtitle, trailing }: any) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {trailing}
    </div>
  ),
}));

function makePerson(overrides: Partial<NodeData>): NodeData {
  const personHash = overrides.personHash ?? "0xperson";
  const versionIndex = overrides.versionIndex ?? 1;
  return {
    personHash,
    versionIndex,
    id: overrides.id ?? makeNodeId(personHash, versionIndex),
    tokenId: overrides.tokenId ?? "1",
    fullName: overrides.fullName ?? "Ada Lovelace",
    endorsementCount: overrides.endorsementCount ?? 1,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPeoplePage(initialEntry = "/people") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/people"
          element={
            <>
              <PeoplePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PeoplePage", () => {
  beforeEach(() => {
    const ada = makePerson({
      personHash: "0xada",
      tokenId: "7",
      fullName: "Ada Lovelace",
      storyMetadata: {
        totalChunks: 1,
        fullStoryHash: "0xstory",
        lastUpdateTime: 1,
        isSealed: false,
        totalLength: 42,
      },
    });
    const grace = makePerson({
      personHash: "0xgrace",
      tokenId: "8",
      fullName: "Grace Hopper",
    });

    mocks.nodesData = {
      [ada.id]: ada,
      [grace.id]: grace,
    };
    mocks.graphNodeIds = [ada.id, grace.id];
    mocks.graphNodeDepths = {};
    mocks.loading = false;
    mocks.treeErrors = [];
    mocks.contractMessage = "";
    mocks.treeRefresh.mockReset();
    mocks.setActivePath.mockReset();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the selected person modal from the URL when the person exists in the current projection", async () => {
    renderPeoplePage("/people?person=7");

    const searchToolbar = screen
      .getByPlaceholderText("Search by name, location, or story content...")
      .closest(".sticky");
    expect(searchToolbar?.classList.contains("top-16")).toBe(true);

    await waitFor(() => expect(screen.getByTestId("person-story-modal")).toBeTruthy());
    expect(screen.getByTestId("person-story-name").textContent).toBe("Ada Lovelace");
    expect(screen.getByTestId("location-search").textContent).toBe("?person=7");
  });

  it("shows a projection mismatch warning and clears the query when dismissed", async () => {
    renderPeoplePage("/people?person=999");

    await waitFor(() =>
      expect(screen.getByText("This person isn’t in the current lineage projection")).toBeTruthy(),
    );
    expect(screen.getByText("Query: 999")).toBeTruthy();

    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => expect(screen.getByTestId("location-search").textContent).toBe(""));
    expect(screen.queryByText("This person isn’t in the current lineage projection")).toBeNull();
  });
  it("filters the list down to a picked generation and shows it as a chip", async () => {
    const [adaId, graceId] = mocks.graphNodeIds;
    mocks.graphNodeDepths = { [adaId]: 0, [graceId]: 1 };

    renderPeoplePage();

    await waitFor(() => expect(screen.getByTestId("person-card-7")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Generations" }));
    fireEvent.click(screen.getByRole("button", { name: "Generation 2" }));

    await waitFor(() => expect(screen.queryByTestId("person-card-7")).toBeNull());
    expect(screen.getByTestId("person-card-8")).toBeTruthy();
    // the panel summary and the toolbar chip both name it
    expect(screen.getAllByText("Generation 2").length).toBeGreaterThan(0);
    expect(screen.getByText("1 filtered results")).toBeTruthy();
  });

  it("keeps a recovered build error off the page — the cold start retries and succeeds", async () => {
    // The tree logs non-fatal errors as it goes and never clears them, so the
    // first cold run's revert used to keep the failure UI up after the retry.
    mocks.treeErrors = [{ message: "execution reverted: InvalidVersionIndex()" }];
    mocks.nodesData = {};
    mocks.graphNodeIds = [];

    renderPeoplePage();

    await waitFor(() => expect(screen.getByText("No stories found")).toBeTruthy());
    expect(screen.queryByText("Could not load people")).toBeNull();
  });

  it("shows the failure only while the session itself reports one", async () => {
    mocks.contractMessage = "Root node not found";
    mocks.nodesData = {};
    mocks.graphNodeIds = [];

    renderPeoplePage();

    await waitFor(() => expect(screen.getByText("Could not load people")).toBeTruthy());
    expect(screen.getByText("Root node not found")).toBeTruthy();
  });

  it("hides the generation control when the projection carries no depths", async () => {
    renderPeoplePage();

    await waitFor(() => expect(screen.getByTestId("person-card-7")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Generations" })).toBeNull();
  });
});
