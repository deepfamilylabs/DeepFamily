// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryEditorController } from "../hooks/useStoryEditorController";
import { StoryComposer } from "./StoryComposer";

const t = ((
  _: string,
  fallback?: string | Record<string, unknown>,
  values?: Record<string, unknown>,
) => {
  const options = typeof fallback === "object" ? fallback : values;
  const base = typeof fallback === "string" ? fallback : String(options?.defaultValue ?? _);
  return base.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ""));
}) as unknown as StoryEditorController["t"];

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
      chunkType: 1,
      attachmentCID: "",
      expectedHash: undefined,
    },
    draftContentHash: undefined,
    byteLength: 13,
    segmentBytes: 16_384,
    warningOrangeBytes: 16_184,
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
    submitting: false,
    draftDisplayIndex: 3,
    refs: {
      scrollContainerRef: createRef<HTMLDivElement>(),
      formRef: createRef<HTMLDivElement>(),
      textareaRef: createRef<HTMLTextAreaElement>(),
      chunkTypeDropdownRef: createRef<HTMLDivElement>(),
    },
    form,
    // value 1 is "Opening", value 2 is "Early Years" in the chunk type taxonomy
    chunkTypeOptions: [
      { value: 1, label: "Summary", icon: TestIcon, color: "text-gray-500" },
      { value: 2, label: "Early Life", icon: TestIcon, color: "text-gray-500" },
    ],
    getByteWarningColor: () => "text-ink-muted",
    getChunkTypeLabel: (value: number) => (value === 1 ? "Summary" : "Early Life"),
    formatHash: (value: string) => value,
    copyText: vi.fn(),
    ...overrides.editor,
  } as unknown as StoryEditorController;
}

afterEach(() => {
  cleanup();
});

describe("StoryComposer", () => {
  it("keeps listbox semantics and the keyboard model for the inline tag picker", () => {
    const setShowChunkTypeDropdown = vi.fn();
    const updateChunkType = vi.fn();
    const renderComposer = (showChunkTypeDropdown: boolean) => (
      <StoryComposer
        editor={createEditor({
          form: { setShowChunkTypeDropdown, showChunkTypeDropdown, updateChunkType },
        })}
      />
    );

    const { rerender } = render(renderComposer(false));
    const trigger = screen.getByRole("button", { name: "Chunk Type Summary" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(setShowChunkTypeDropdown).toHaveBeenCalledWith(true);

    rerender(renderComposer(true));

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
    expect(updateChunkType).toHaveBeenCalledWith(2);

    fireEvent.keyDown(openTrigger, { key: "Escape" });
    expect(setShowChunkTypeDropdown).toHaveBeenCalledWith(false);
  });

  it("keeps the picker inside the click-outside boundary", () => {
    // The controller closes the picker on any mousedown outside
    // chunkTypeDropdownRef, and mousedown precedes click — so if the ref covers
    // only the trigger, the panel unmounts before an option's click lands and
    // tags cannot be picked with the mouse at all.
    const chunkTypeDropdownRef = createRef<HTMLDivElement>();
    render(
      <StoryComposer
        editor={createEditor({
          form: { showChunkTypeDropdown: true },
          editor: {
            refs: {
              scrollContainerRef: createRef<HTMLDivElement>(),
              formRef: createRef<HTMLDivElement>(),
              textareaRef: createRef<HTMLTextAreaElement>(),
              chunkTypeDropdownRef,
            },
          } as Partial<StoryEditorController>,
        })}
      />,
    );

    const boundary = chunkTypeDropdownRef.current!;
    expect(boundary).toBeTruthy();
    expect(boundary.contains(screen.getByRole("listbox"))).toBe(true);
    expect(boundary.contains(screen.getByRole("button", { name: "Chunk Type Summary" }))).toBe(
      true,
    );
  });

  it("groups the tags by taxonomy so the picker explains itself", () => {
    render(<StoryComposer editor={createEditor({ form: { showChunkTypeDropdown: true } })} />);

    expect(screen.getByRole("group", { name: "Opening" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Early Years" })).toBeTruthy();
    expect(screen.getByText(/Tags describe content, not chapters/).textContent).toBeTruthy();
  });

  it("announces the byte budget and wires it to the textarea", () => {
    render(<StoryComposer editor={createEditor({ form: { byteLength: 17_000 } })} />);

    const textarea = screen.getByPlaceholderText(/Enter story content/);
    const byteStatus = screen.getByText(/17000 bytes/).closest("[role='status']")!;

    expect(textarea.getAttribute("aria-invalid")).toBe("false");
    expect(textarea.getAttribute("aria-describedby")).toBe(byteStatus.id);
    expect(byteStatus.getAttribute("aria-live")).toBe("polite");
    expect(byteStatus.textContent).toContain("of 16,384 per record");
  });

  it("blocks the write while the draft is empty", () => {
    render(
      <StoryComposer
        editor={createEditor({
          form: { data: { content: "   ", chunkType: 1, attachmentCID: "" } },
        })}
      />,
    );

    const submit = screen.getByRole("button", { name: /Review & sign/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
