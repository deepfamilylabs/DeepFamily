// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getAllByText("Life Story").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/world/).length).toBeGreaterThan(0);
    expect(mocks.getStoryData).not.toHaveBeenCalled();
    expect(mocks.getNodeByTokenId).not.toHaveBeenCalled();
  });

  it("keeps stories readable and hides the edit entry without ownership access", async () => {
    renderPersonPage("/person/42");
    expect(await screen.findByRole("button", { name: "No. 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Story" })).toBeNull();
  });

  it("opens the editor only when ownership access permits editing", async () => {
    mocks.storyAccess.canEdit = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderPersonPage("/person/42");
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit Story" }))[0]);
    expect(open).toHaveBeenCalledWith("/editor/42", "_blank", "noopener,noreferrer");
  });

  it("does not follow the edit query parameter without ownership access", async () => {
    renderPersonPage("/person/42?edit=1");
    expect(await screen.findByRole("button", { name: "No. 1" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "No. 0" })).toBeNull();
    expect(screen.getByRole("button", { name: "No. 1" })).toBeTruthy();
    for (const label of screen.getAllByText("Total Records")) {
      expect(label.parentElement?.textContent).toBe("Total Records1");
    }
    for (const label of screen.getAllByText("Total payload bytes")) {
      expect(label.parentElement?.textContent).toBe("Total payload bytes50 B");
    }
  });
  it("folds a long section behind a row that names the hidden titles", async () => {
    const records = Array.from({ length: 6 }, (_, index) =>
      makeRecord({
        recordIndex: index,
        recordType: 4,
        title: index >= 3 ? `Event ${index + 1}` : "",
        content: `Entry ${index + 1}`,
      }),
    );
    const person = makePerson({
      storyMetadata: makeMetadata({ totalRecords: 6 }),
      storyRecords: records,
    });
    mocks.nodesData = { [person.id]: person };
    renderPersonPage("/person/42");

    const fold = await screen.findByRole("button", { name: /3 records collapsed/ });
    expect(fold.textContent).toContain("Event 4, Event 5, Event 6");
    expect(screen.queryByText("Entry 4")).toBeNull();

    fireEvent.click(fold);
    expect(screen.getByText("Entry 6")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse 3 records" }));
    expect(screen.queryByText("Entry 6")).toBeNull();
  });

  it("keeps a Contents target current while the page scrolls to it", async () => {
    const records = [1, 2, 3].map((type, index) =>
      makeRecord({ recordIndex: index, recordType: type, content: `Story ${type}` }),
    );
    const person = makePerson({
      storyMetadata: makeMetadata({ totalRecords: 3 }),
      storyRecords: records,
    });
    mocks.nodesData = { [person.id]: person };
    renderPersonPage("/person/42");

    const contents = await screen.findByRole("navigation", { name: "Contents" });
    const summary = within(contents).getByRole("button", { name: /^Summary/ });
    fireEvent.click(summary);
    expect(summary.getAttribute("aria-current")).toBe("location");

    // The smooth scroll passes other sections; the reading position must not follow it.
    await act(async () => {
      fireEvent.scroll(window);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(summary.getAttribute("aria-current")).toBe("location");
  });

  it("opens a record's provenance from its number", async () => {
    renderPersonPage("/person/42");
    const shortHash = `${zeroHash.slice(0, 10)}…${zeroHash.slice(-8)}`;

    const handle = await screen.findByRole("button", { name: "No. 1" });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(shortHash)).toBeNull();

    fireEvent.click(handle);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(shortHash)).toBeTruthy();
  });
});
