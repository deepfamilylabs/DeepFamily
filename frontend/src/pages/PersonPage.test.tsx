// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PersonPage from "./PersonPage";
import { makeNodeId, type NodeData, type StoryChunk, type StoryMetadata } from "../shared/model";

const zeroHash = `0x${"0".repeat(64)}`;

const mocks = vi.hoisted(() => ({
  nodesData: {} as Record<string, NodeData>,
  getStoryData: vi.fn(),
  getNodeByTokenId: vi.fn(),
  getOwnerOf: vi.fn(),
  configUpdate: vi.fn(),
  toastShow: vi.fn(),
  t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
    if (typeof fallbackOrOptions === "string") {
      return fallbackOrOptions.replace(
        /{{\s*(\w+)\s*}}/g,
        (_match, name) => String(options?.[name] ?? ""),
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
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: mocks.t,
  }),
}));

vi.mock("../domains/config", () => ({
  useConfig: () => ({
    update: mocks.configUpdate,
  }),
}));

vi.mock("../domains/tree", () => ({
  useTreeGraphData: () => ({
    nodesData: mocks.nodesData,
  }),
  useTreeNodeAccess: () => ({
    getStoryData: mocks.getStoryData,
    getNodeByTokenId: mocks.getNodeByTokenId,
    getOwnerOf: mocks.getOwnerOf,
  }),
}));

vi.mock("../shared/ui", () => ({
  useToast: () => ({
    show: mocks.toastShow,
  }),
}));

function makeChunk(overrides: Partial<StoryChunk>): StoryChunk {
  return {
    chunkIndex: 0,
    chunkHash: zeroHash,
    content: "hello",
    timestamp: 1,
    editor: "0x0000000000000000000000000000000000000000",
    chunkType: 0,
    attachmentCID: "",
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<StoryMetadata> = {}): StoryMetadata {
  return {
    totalChunks: 2,
    fullStoryHash: zeroHash,
    lastUpdateTime: 1,
    isSealed: false,
    totalLength: 11,
    ...overrides,
  };
}

function makePerson(overrides: Partial<NodeData>): NodeData {
  const personHash = overrides.personHash ?? "0xada";
  const versionIndex = overrides.versionIndex ?? 1;
  return {
    personHash,
    versionIndex,
    id: makeNodeId(personHash, versionIndex),
    tokenId: "42",
    fullName: "Ada Lovelace",
    owner: "0x00000000000000000000000000000000000000aa",
    storyMetadata: makeMetadata(),
    storyChunks: [
      makeChunk({ chunkIndex: 0, content: "hello " }),
      makeChunk({ chunkIndex: 1, content: "world", chunkType: 1 }),
    ],
    storyFetchedAt: Date.now(),
    ...overrides,
  };
}

function renderPersonPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/person/:tokenId" element={<PersonPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PersonPage", () => {
  beforeEach(() => {
    const person = makePerson({});
    mocks.nodesData = {
      [person.id]: person,
    };
    mocks.getStoryData.mockReset();
    mocks.getNodeByTokenId.mockReset();
    mocks.getOwnerOf.mockReset();
    mocks.configUpdate.mockReset();
    mocks.toastShow.mockReset();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders cached person story data without refetching fresh chunks", async () => {
    renderPersonPage("/person/42");

    await waitFor(() => expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Profile Data").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/world/).length).toBeGreaterThan(0);
    expect(mocks.getStoryData).not.toHaveBeenCalled();
    expect(mocks.getNodeByTokenId).not.toHaveBeenCalled();
  });

  it("shows an inline validation error for invalid token ids", async () => {
    renderPersonPage("/person/not-a-token");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Invalid token ID")).toBeTruthy();
  });
});
