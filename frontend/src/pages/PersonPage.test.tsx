// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PersonPage from "./PersonPage";
import { makeNodeId, type NodeData, type StoryRecord, type StoryMetadata } from "../shared/model";

const zeroHash = `0x${"0".repeat(64)}`;

const mocks = vi.hoisted(() => ({
  nodesData: {} as Record<string, NodeData>,
  getStoryData: vi.fn(),
  getNodeByTokenId: vi.fn(),
  getOwnerOf: vi.fn(),
  storyAccess: { canEdit: false, checking: false },
  configUpdate: vi.fn(),
  toastShow: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

vi.mock("../domains/person", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domains/person")>()),
  useNftStoryAccess: () => mocks.storyAccess,
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

function makeRecord(overrides: Partial<StoryRecord>): StoryRecord {
  return {
    title: "",
    recordIndex: 0,
    payloadHash: zeroHash,
    content: "hello",
    timestamp: 1,
    author: "0x0000000000000000000000000000000000000000",
    recordType: 0,
    attachmentCID: "",
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<StoryMetadata> = {}): StoryMetadata {
  return {
    totalRecords: 2,
    recordsHead: zeroHash,
    lastUpdateTime: 1,
    isSealed: false,
    totalPayloadLength: 11,
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
    storyRecords: [
      makeRecord({ title: "", recordIndex: 0, content: "hello " }),
      makeRecord({ title: "", recordIndex: 1, content: "world", recordType: 1 }),
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
        <Route path="/editor/:tokenId" element={<div>Editor route</div>} />
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
    mocks.storyAccess = { canEdit: false, checking: false };
    mocks.getStoryData.mockReset();
    mocks.getNodeByTokenId.mockReset();
    mocks.getOwnerOf.mockReset();
    mocks.configUpdate.mockReset();
    mocks.toastShow.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders cached person story data without refetching fresh records", async () => {
    renderPersonPage("/person/42");

    await waitFor(() => expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Profile Data").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/world/).length).toBeGreaterThan(0);
    expect(mocks.getStoryData).not.toHaveBeenCalled();
    expect(mocks.getNodeByTokenId).not.toHaveBeenCalled();
  });

  it("keeps stories readable and hides the edit entry without ownership access", async () => {
    renderPersonPage("/person/42");
    expect(await screen.findByText("#1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Story" })).toBeNull();
  });

  it("opens the editor only when ownership access permits editing", async () => {
    mocks.storyAccess.canEdit = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderPersonPage("/person/42");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Story" }));
    expect(open).toHaveBeenCalledWith("/editor/42", "_blank", "noopener,noreferrer");
  });

  it("does not follow the edit query parameter without ownership access", async () => {
    renderPersonPage("/person/42?edit=1");
    expect(await screen.findByText("#1")).toBeTruthy();
    expect(screen.queryByText("Editor route")).toBeNull();
  });

  it("follows the edit query parameter after ownership is verified", async () => {
    mocks.storyAccess.canEdit = true;
    renderPersonPage("/person/42?edit=1");
    expect(await screen.findByText("Editor route")).toBeTruthy();
  });

  it("shows an inline validation error for invalid token ids", async () => {
    renderPersonPage("/person/not-a-token");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Invalid token ID")).toBeTruthy();
  });

  it("shows the archived biography once as the basic story and counts only later records", async () => {
    const person = makePerson({
      storyMetadata: makeMetadata({ totalPayloadLength: 150, biographyPayloadLength: 100 }),
      storyRecords: [
        makeRecord({
          schemaId: STORY_BIOGRAPHY_SCHEMA_ID,
          content: "Original public biography",
          payloadLength: 100,
        }),
        makeRecord({
          title: "",
          recordIndex: 1,
          recordType: 1,
          content: "A later story",
          payloadLength: 50,
        }),
      ],
    });
    mocks.nodesData = { [person.id]: person };
    renderPersonPage("/person/42");

    expect(await screen.findByText("Original public biography")).toBeTruthy();
    expect(screen.getAllByText("Original public biography")).toHaveLength(1);
    expect(screen.queryByText("#0")).toBeNull();
    expect(screen.getByText("#1")).toBeTruthy();
    for (const label of screen.getAllByText("Total Records")) {
      expect(label.parentElement?.textContent).toBe("Total Records1");
    }
    for (const label of screen.getAllByText("Total payload bytes")) {
      expect(label.parentElement?.textContent).toBe("Total payload bytes50");
    }
  });
});
