// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import PersonStoryModal from "./PersonStoryModal";
import { buildStorySnapshot, type StoryChunk, type StoryMetadata } from "../../../shared/model";

const mocks = vi.hoisted(() => ({
  t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(options?.[name] ?? "")),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("./EndorseCompactModal", () => ({ default: () => null }));
vi.mock("../../../shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui")>()),
  ResponsiveModalFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useResponsiveModalMode: () => true,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

afterEach(cleanup);

const biography: StoryChunk = {
  chunkIndex: 0,
  schemaId: STORY_BIOGRAPHY_SCHEMA_ID,
  chunkType: 0,
  chunkHash: `0x${"00".repeat(32)}`,
  content: "Original public biography",
  payloadLength: 100,
  timestamp: 1,
  editor: `0x${"01".repeat(20)}`,
  attachmentCID: "",
};
const ordinary = {
  ...biography,
  chunkIndex: 1,
  schemaId: undefined,
  chunkType: 1,
  content: "A later story",
  payloadLength: 50,
};

function renderStory(chunks: StoryChunk[]) {
  const metadata: StoryMetadata = {
    totalChunks: chunks.length,
    totalLength: chunks.reduce((length, chunk) => length + (chunk.payloadLength ?? 0), 0),
    biographyPayloadLength: chunks.some((chunk) => chunk.schemaId === STORY_BIOGRAPHY_SCHEMA_ID)
      ? 100
      : undefined,
    fullStoryHash: `0x${"00".repeat(32)}`,
    lastUpdateTime: 1,
    isSealed: false,
  };
  const getStoryData = vi.fn().mockResolvedValue(buildStorySnapshot(chunks, metadata));
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
    expect(screen.getByText("1 chunks · 50 bytes")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.queryByText("#0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full Text" }));
    expect(screen.getByText("A later story")).toBeTruthy();
    expect(screen.queryByText("Original public biographyA later story")).toBeNull();
  });

  it("does not count a biography-only archive as a story chunk", async () => {
    renderStory([biography]);
    expect(await screen.findByText("Original public biography")).toBeTruthy();
    expect(screen.queryByText(/chunks ·/)).toBeNull();
    expect(screen.queryByText("#0")).toBeNull();
    expect(screen.queryByText("#1")).toBeNull();
  });

  it("keeps unsupported biography bytes in the basic story area", async () => {
    renderStory([{ ...biography, content: "", unsupportedSchema: true, rawPayload: "0x1234" }]);
    expect(await screen.findByText("0x1234")).toBeTruthy();
    expect(screen.getByText("Basic Story")).toBeTruthy();
    expect(screen.queryByText(/chunks ·/)).toBeNull();
    expect(screen.queryByText("#0")).toBeNull();
  });
});
