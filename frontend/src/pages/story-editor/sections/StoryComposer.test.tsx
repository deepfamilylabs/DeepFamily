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
      title: "",
      content: "Example story",
      recordType: 1,
      attachmentURI: "",
      expectedPayloadHash: undefined,
    },
    draftPayloadHash: undefined,
    byteLength: 13,
    segmentBytes: 16_384,
    warningOrangeBytes: 16_184,
    updateTitle: vi.fn(),
    updateContent: vi.fn(),
    updateRecordType: vi.fn(),
    updateAttachmentURI: vi.fn(),
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

  it("flags an over-long attachment URI at the field rather than at signing time", () => {
    const withinLimit = createEditor({
      form: { data: { title: "", content: "Example story", recordType: 1, attachmentURI: "ipfs://bafy" } },
    });
    const { rerender } = render(<StoryComposer editor={withinLimit} />);

    // The optional field only shows its limit after a draft exceeds 256 bytes.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /Review & sign/ }) as HTMLButtonElement).disabled,
    ).toBe(false);

    rerender(
      <StoryComposer
        editor={createEditor({
          form: {
            data: {
              title: "",
              content: "Example story",
              recordType: 1,
              attachmentURI: `https://example.com/${"b".repeat(257)}`,
            },
          },
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    const uri = screen.getByPlaceholderText(/Attachment URI \(optional\)/);
    expect(alert.textContent).toContain("256");
    expect(uri.getAttribute("aria-invalid")).toBe("true");
    expect(uri.getAttribute("aria-describedby")).toBe(alert.id);
    expect(
      (screen.getByRole("button", { name: /Review & sign/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("blocks the write while the draft is empty", () => {
    render(
      <StoryComposer
        editor={createEditor({
          form: { data: { title: "", content: "   ", recordType: 1, attachmentURI: "" } },
        })}
      />,
    );

    const submit = screen.getByRole("button", { name: /Review & sign/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});

// The draft is ordered the way the record reads once archived: the type tag on
// the meta line, then the title, then the body — so reading order, tab order and
// the published entry all agree.
it("accepts an exact optional title between the classification and content fields", () => {
  const updateTitle = vi.fn();
  const { rerender } = render(<StoryComposer editor={createEditor({ form: { updateTitle } })} />);
  const input = screen.getByRole("textbox", { name: "Title (optional)" });
  const type = screen.getByRole("button", { name: "Record Type Summary" });
  const content = screen.getByPlaceholderText(/Enter story content/);
  expect(type.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(input.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(input, { target: { value: "  第一次远行 😀  " } });
  expect(updateTitle).toHaveBeenCalledWith("  第一次远行 😀  ");
  rerender(<StoryComposer editor={createEditor({ editor: { submitting: true } })} />);
  expect(
    (screen.getByRole("textbox", { name: "Title (optional)" }) as HTMLInputElement).disabled,
  ).toBe(true);
});
