// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import PersonStoryModal from "./PersonStoryModal";
import { buildStorySnapshot, type StoryRecord, type StoryMetadata } from "../../../shared/model";

const mocks = vi.hoisted(() => ({
  canEditStory: false,
  t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(options?.[name] ?? "")),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../queries/useNftStoryAccess", () => ({
  useNftStoryAccess: () => ({ canEdit: mocks.canEditStory }),
}));
vi.mock("./EndorseCompactModal", () => ({ default: () => null }));
vi.mock("../../../shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui")>()),
  ResponsiveModalFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useResponsiveModalMode: () => true,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  mocks.canEditStory = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const biography: StoryRecord = {
  title: "",
  recordIndex: 0,
  schemaId: STORY_BIOGRAPHY_SCHEMA_ID,
  recordType: 0,
  payloadHash: `0x${"00".repeat(32)}`,
  content: "Original public biography",
  payloadLength: 100,
  timestamp: 1,
  author: `0x${"01".repeat(20)}`,
  attachmentCID: "",
};
const ordinary = {
  ...biography,
  recordIndex: 1,
  schemaId: undefined,
  recordType: 1,
  content: "A later story",
  payloadLength: 50,
};

function renderStory(records: StoryRecord[]) {
  const metadata: StoryMetadata = {
    totalRecords: records.length,
    totalPayloadLength: records.reduce((length, record) => length + (record.payloadLength ?? 0), 0),
    biographyPayloadLength: records.some((record) => record.schemaId === STORY_BIOGRAPHY_SCHEMA_ID)
      ? 100
      : undefined,
    recordsHead: `0x${"00".repeat(32)}`,
    lastUpdateTime: 1,
    isSealed: false,
  };
  const getStoryData = vi.fn().mockResolvedValue(buildStorySnapshot(records, metadata));
  return render(
    <PersonStoryModal
      person={{
        id: "person-v-1",
        personHash: "person",
        versionIndex: 1,
        tokenId: "42",
        storyMetadata: metadata,
      }}
      isOpen
      onClose={() => {}}
      getStoryData={getStoryData}
    />,
  );
}

describe("PersonStoryModal archive presentation", () => {
  it("shows biography separately from the numbered ordinary list and full text", async () => {
    renderStory([biography, ordinary]);
    expect(await screen.findByText("Original public biography")).toBeTruthy();
    expect(screen.getAllByText("Original public biography")).toHaveLength(1);
    expect(screen.getByText("1 records · 50 bytes")).toBeTruthy();
    expect(screen.getByText("No. 1")).toBeTruthy();
    expect(screen.queryByText("No. 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full Text" }));
    expect(screen.getByText("A later story")).toBeTruthy();
    expect(screen.queryByText("Original public biographyA later story")).toBeNull();
  });

  it("does not count a biography-only archive as a story record", async () => {
    renderStory([biography]);
    expect(await screen.findByText("Original public biography")).toBeTruthy();
    expect(screen.queryByText(/records ·/)).toBeNull();
    expect(screen.queryByText("No. 0")).toBeNull();
    expect(screen.queryByText("No. 1")).toBeNull();
  });

  it("keeps unsupported biography bytes in the basic story area", async () => {
    renderStory([{ ...biography, content: "", unsupportedSchema: true, rawPayload: "0x1234" }]);
    expect(await screen.findByText("0x1234")).toBeTruthy();
    expect(screen.getByText("Basic Story")).toBeTruthy();
    expect(screen.queryByText(/records ·/)).toBeNull();
    expect(screen.queryByText("No. 0")).toBeNull();
  });
});

it("shows custom biography and ordinary record titles with an untitled biography fallback", async () => {
  const { unmount } = renderStory([
    { ...biography, title: "My early years" },
    { ...ordinary, title: "First journey" },
  ]);
  expect(await screen.findByRole("heading", { name: "My early years" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "First journey" })).toBeTruthy();
  unmount();
  renderStory([{ ...biography, title: " \n " }]);
  expect(await screen.findByRole("heading", { name: "Biography" })).toBeTruthy();
});

it("shows stories but no editable control without ownership access", async () => {
  renderStory([biography, ordinary]);
  expect(await screen.findByText("A later story")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Editable" })).toBeNull();
});

it("shows an editor entry for the permitted owner", async () => {
  mocks.canEditStory = true;
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderStory([biography, ordinary]);
  fireEvent.click(await screen.findByRole("button", { name: "Editable" }));
  expect(open).toHaveBeenCalledWith("/editor/42", "_blank", "noopener,noreferrer");
});
