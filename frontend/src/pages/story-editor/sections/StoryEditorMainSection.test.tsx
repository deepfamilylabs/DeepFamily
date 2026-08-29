// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryEditorController } from "../hooks/useStoryEditorController";
import { StoryEditorMainSection } from "./StoryEditorMainSection";

const t = ((_: string, fallback?: string | Record<string, unknown>) => {
  if (typeof fallback === "string") return fallback;
  if (fallback && "defaultValue" in fallback) return String(fallback.defaultValue);
  return _;
}) as StoryEditorController["t"];

function TestIcon({ className, size }: { className?: string; size?: number }) {
  return <svg aria-hidden="true" className={className} height={size} width={size} />;
}

function createEditor(
  overrides: {
    form?: Partial<StoryEditorController["form"]>;
    editor?: Partial<StoryEditorController>;
  } = {},
) {
  const form = {
    data: {
      content: "Example story",
      chunkType: 0,
      attachmentCID: "",
      expectedHash: undefined,
    },
    byteLength: 13,
    maxBytes: 16_384,
    warningOrangeBytes: 14_000,
    updateContent: vi.fn(),
    updateChunkType: vi.fn(),
    updateAttachmentCID: vi.fn(),
    cancel: vi.fn(),
    submit: vi.fn(),
    showChunkTypeDropdown: false,
    setShowChunkTypeDropdown: vi.fn(),
    showChunkTypeHelp: false,
    setShowChunkTypeHelp: vi.fn(),
    ...overrides.form,
  };

  return {
    t,
    titleText: "Ada Biography",
    loading: false,
    submitting: false,
    isSealed: false,
    showEditorForm: true,
    showError: false,
    errorMessage: null,
    showEmptySealed: false,
    meta: {
      totalChunks: 1,
      isSealed: false,
    },
    refs: {
      scrollContainerRef: createRef<HTMLDivElement>(),
      formRef: createRef<HTMLDivElement>(),
      textareaRef: createRef<HTMLTextAreaElement>(),
      chunkTypeDropdownRef: createRef<HTMLDivElement>(),
    },
    form,
    seal: {
      handleSeal: vi.fn(),
      showConfirm: false,
      setShowConfirm: vi.fn(),
      execute: vi.fn(),
    },
    chunkTypeOptions: [
      { value: 0, label: "Summary", icon: TestIcon, color: "text-gray-500" },
      { value: 1, label: "Early Life", icon: TestIcon, color: "text-gray-500" },
    ],
    getByteWarningColor: () => "text-gray-500",
    formatHash: (value: string) => value,
    copyText: vi.fn(),
    ...overrides.editor,
  } as unknown as StoryEditorController;
}

afterEach(() => {
  cleanup();
});

describe("StoryEditorMainSection", () => {
  it("exposes the chunk type dropdown as a keyboard listbox", () => {
    const setShowChunkTypeDropdown = vi.fn();
    const updateChunkType = vi.fn();
    const renderSection = (showChunkTypeDropdown: boolean) => (
      <StoryEditorMainSection
        editor={createEditor({
          form: {
            setShowChunkTypeDropdown,
            showChunkTypeDropdown,
            updateChunkType,
          },
        })}
      />
    );

    const { rerender } = render(renderSection(false));
    const trigger = screen.getByRole("button", { name: "Chunk Type Summary" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(setShowChunkTypeDropdown).toHaveBeenCalledWith(true);

    rerender(renderSection(true));

    const openTrigger = screen.getByRole("button", { name: "Chunk Type Summary" });
    const listbox = screen.getByRole("listbox", { name: "Chunk Type" });
    const earlyLifeOption = screen.getByRole("option", { name: "Early Life" });

    expect(openTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(openTrigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(screen.getByRole("option", { name: "Summary" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(openTrigger, { key: "ArrowDown" });

    expect(openTrigger.getAttribute("aria-activedescendant")).toBe(earlyLifeOption.id);

    fireEvent.keyDown(openTrigger, { key: "Enter" });
    expect(updateChunkType).toHaveBeenCalledWith(1);

    fireEvent.keyDown(openTrigger, { key: "Escape" });
    expect(setShowChunkTypeDropdown).toHaveBeenCalledWith(false);
  });

  it("announces editor errors, loading state, and byte limit status", () => {
    render(
      <StoryEditorMainSection
        editor={createEditor({
          editor: {
            showError: true,
            errorMessage: "Failed to load story",
            loading: true,
          },
          form: {
            byteLength: 17_000,
          },
        })}
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("Failed to load story"))).toBe(true);

    const textarea = screen.getByPlaceholderText(/Enter chunk content/);
    const byteStatus = screen.getByText("17000/16384 bytes");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(textarea.getAttribute("aria-describedby")).toBe(byteStatus.id);
    expect(byteStatus.getAttribute("role")).toBe("alert");
    expect(byteStatus.getAttribute("aria-live")).toBe("assertive");

    const loading = screen.getByRole("status");
    expect(loading.getAttribute("aria-live")).toBe("polite");
    expect(loading.getAttribute("aria-busy")).toBe("true");
  });
});
