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
  loading: false,
  setActivePath: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, key) => String(options?.[key] ?? ""),
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

vi.mock("../domains/tree/context", () => ({
  useTreeGraphData: () => ({
    nodesData: mocks.nodesData,
  }),
  useTreeStatus: () => ({
    loading: mocks.loading,
  }),
  useFamilyTreeProjection: () => ({
    graph: {
      nodes: mocks.graphNodeIds.map((id) => ({ id })),
    },
  }),
}));

vi.mock("../domains/person/ui", () => ({
  PersonStoryCard: ({ person, onOpen }: any) => (
    <button data-testid={`person-card-${person.tokenId}`} onClick={() => onOpen(person)}>
      {person.fullName}
    </button>
  ),
  StoryChunksModal: ({ person, isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="story-chunks-modal">
        <span data-testid="story-chunks-name">{person.fullName}</span>
        <button onClick={onClose}>close-story-modal</button>
      </div>
    ) : null,
}));

vi.mock("../shared/ui", () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
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
      storyMetadata: { totalChunks: 1, fullStoryHash: "0xstory", lastUpdateTime: 1, isSealed: false, totalLength: 42 },
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
    mocks.loading = false;
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

    await waitFor(() => expect(screen.getByTestId("story-chunks-modal")).toBeTruthy());
    expect(screen.getByTestId("story-chunks-name").textContent).toBe("Ada Lovelace");
    expect(screen.getByTestId("location-search").textContent).toBe("?person=7");
  });

  it("shows a projection mismatch warning and clears the query when dismissed", async () => {
    renderPeoplePage("/people?person=999");

    await waitFor(() =>
      expect(screen.getByText("This person isn’t in the current tree projection")).toBeTruthy(),
    );
    expect(screen.getByText("Query: 999")).toBeTruthy();

    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => expect(screen.getByTestId("location-search").textContent).toBe(""));
    expect(screen.queryByText("This person isn’t in the current tree projection")).toBeNull();
  });
});
