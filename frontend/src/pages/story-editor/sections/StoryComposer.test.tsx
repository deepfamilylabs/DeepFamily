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
      recordType: 1,
      attachmentCID: "",
      expectedPayloadHash: undefined,
    },
    draftPayloadHash: undefined,
    byteLength: 13,
    segmentBytes: 16_384,
    warningOrangeBytes: 16_184,
    updateContent: vi.fn(),
    updateRecordType: vi.fn(),
    updateAttachmentCID: vi.fn(),
    cancel: vi.fn(),
    submit: vi.fn(),
    showRecordTypeDropdown: false,
    setShowRecordTypeDropdown: vi.fn(),
    showRecordTypeHelp: false,
    setShowRecordTypeHelp: vi.fn(),
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
      recordTypeDropdownRef: createRef<HTMLDivElement>(),
    },
    form,
    // value 1 is "Opening", value 2 is "Early Years" in the record type taxonomy
    recordTypeOptions: [
      { value: 1, label: "Summary", icon: TestIcon, color: "text-gray-500" },
      { value: 2, label: "Early Life", icon: TestIcon, color: "text-gray-500" },
    ],
    getByteWarningColor: () => "text-ink-muted",
    getRecordTypeLabel: (value: number) => (value === 1 ? "Summary" : "Early Life"),
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
    const setShowRecordTypeDropdown = vi.fn();
    const updateRecordType = vi.fn();
    const renderComposer = (showRecordTypeDropdown: boolean) => (
      <StoryComposer
        editor={createEditor({
          form: { setShowRecordTypeDropdown, showRecordTypeDropdown, updateRecordType },
        })}
      />
    );

    const { rerender } = render(renderComposer(false));
    const trigger = screen.getByRole("button", { name: "Record Type Summary" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(setShowRecordTypeDropdown).toHaveBeenCalledWith(true);

    rerender(renderComposer(true));

    const openTrigger = screen.getByRole("button", { name: "Record Type Summary" });
    const listbox = screen.getByRole("listbox", { name: "Record Type" });
    const earlyLifeOption = screen.getByRole("option", { name: "Early Life" });

    expect(openTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(openTrigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(screen.getByRole("option", { name: "Summary" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(openTrigger, { key: "ArrowDown" });
    expect(openTrigger.getAttribute("aria-activedescendant")).toBe(earlyLifeOption.id);

    fireEvent.keyDown(openTrigger, { key: "Enter" });
    expect(updateRecordType).toHaveBeenCalledWith(2);

    fireEvent.keyDown(openTrigger, { key: "Escape" });
    expect(setShowRecordTypeDropdown).toHaveBeenCalledWith(false);
  });

  it("keeps the picker inside the click-outside boundary", () => {
    // The controller closes the picker on any mousedown outside
    // recordTypeDropdownRef, and mousedown precedes click — so if the ref covers
    // only the trigger, the panel unmounts before an option's click lands and
    // tags cannot be picked with the mouse at all.
    const recordTypeDropdownRef = createRef<HTMLDivElement>();
    render(
      <StoryComposer
        editor={createEditor({
          form: { showRecordTypeDropdown: true },
          editor: {
            refs: {
              scrollContainerRef: createRef<HTMLDivElement>(),
              formRef: createRef<HTMLDivElement>(),
              textareaRef: createRef<HTMLTextAreaElement>(),
              recordTypeDropdownRef,
            },
          } as Partial<StoryEditorController>,
        })}
      />,
    );

    const boundary = recordTypeDropdownRef.current!;
    expect(boundary).toBeTruthy();
    expect(boundary.contains(screen.getByRole("listbox"))).toBe(true);
    expect(boundary.contains(screen.getByRole("button", { name: "Record Type Summary" }))).toBe(
      true,
    );
  });

  it("groups the tags by taxonomy so the picker explains itself", () => {
    render(<StoryComposer editor={createEditor({ form: { showRecordTypeDropdown: true } })} />);

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
          form: { data: { content: "   ", recordType: 1, attachmentCID: "" } },
        })}
      />,
    );

    const submit = screen.getByRole("button", { name: /Review & sign/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
