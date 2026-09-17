// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { segmentManuscript } from "../model/manuscriptSegments";
import type { StoryEditorController } from "../hooks/useStoryEditorController";
import { StoryManuscript } from "./StoryManuscript";

const t = ((
  key: string,
  fallback?: string | Record<string, unknown>,
  values?: Record<string, unknown>,
) => {
  const options = typeof fallback === "object" ? fallback : values;
  const base = typeof fallback === "string" ? fallback : String(options?.defaultValue ?? key);
  return base.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ""));
}) as unknown as StoryEditorController["t"];

function record(index: number, recordType: number) {
  return {
    title: "",
    recordIndex: index,
    displayIndex: index + 1,
    recordType,
    content: `Body of record ${index + 1}`,
    payloadHash: `0x${String(index).repeat(4)}`,
    timestamp: 1_700_000_000,
    author: "0x0000000000000000000000000000000000000001",
    attachmentURI: "",
    payloadLength: 40,
  };
}

function createEditor(
  records: ReturnType<typeof record>[],
  overrides: Partial<StoryEditorController> = {},
) {
  const segments = segmentManuscript(records);
  return {
    t,
    loading: false,
    showError: false,
    errorMessage: null,
    showEmptySealed: false,
    showEditorForm: false,
    sortedRecords: records,
    order: { value: "written", set: vi.fn() },
    manuscript: {
      head: segments.head,
      collapsed: segments.collapsed,
      tail: segments.tail,
      isExpanded: false,
      toggle: vi.fn(),
      reveal: vi.fn(),
    },
    expandedRecords: new Set<number>(),
    toggleRecordExpansion: vi.fn(),
    getRecordTypeLabel: (value: number) => `Type ${value}`,
    getByteLength: (value: string) => value.length,
    formatHash: (value: string) => value,
    copyText: vi.fn(),
    refs: { scrollContainerRef: createRef<HTMLDivElement>() },
    ...overrides,
  } as unknown as StoryEditorController;
}

afterEach(() => {
  cleanup();
});

describe("StoryManuscript fold", () => {
  it("renders every entry when the manuscript is short enough", () => {
    const records = [record(0, 1), record(1, 2), record(2, 3)];
    render(<StoryManuscript editor={createEditor(records)} />);

    expect(document.querySelectorAll("article")).toHaveLength(3);
    expect(screen.queryByText(/records collapsed/)).toBeNull();
  });

  it("folds the middle and summarises what it hides", () => {
    const records = [
      record(0, 1),
      record(1, 2),
      record(2, 3),
      record(3, 5),
      record(4, 7),
      record(5, 16),
    ];
    const editor = createEditor(records);
    render(<StoryManuscript editor={editor} />);

    // head (2) + tail (1) stay on the page; the middle three are behind the fold
    expect(document.querySelectorAll("article")).toHaveLength(3);
    expect(screen.getByText(/Body of record 1/)).toBeTruthy();
    expect(screen.getByText(/Body of record 6/)).toBeTruthy();
    expect(screen.queryByText(/Body of record 3/)).toBeNull();

    const row = screen.getByRole("button", { expanded: false });
    expect(row.textContent).toContain("3 records collapsed");
    expect(row.textContent).toContain("Type 3");
    expect(row.textContent).toContain("Type 5");
    expect(row.textContent).toContain("Type 7");

    fireEvent.click(row);
    expect(editor.manuscript.toggle).toHaveBeenCalledTimes(1);
  });

  it("drops the stand-in summary once the entries are actually on the page", () => {
    const records = [
      record(0, 1),
      record(1, 2),
      record(2, 3),
      record(3, 5),
      record(4, 7),
      record(5, 16),
    ];
    const editor = createEditor(records);
    editor.manuscript.isExpanded = true;
    render(<StoryManuscript editor={editor} />);

    expect(document.querySelectorAll("article")).toHaveLength(6);

    // one control at each end of the run, so the way back is never a scroll away
    const rows = screen.getAllByRole("button", { expanded: true });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent).toBe("Collapse 3 records");

    // nothing is collapsed any more, and the types are visible below
    expect(screen.queryByText(/records collapsed/)).toBeNull();
    expect(rows[0].textContent).not.toContain("Type 3");

    fireEvent.click(rows[1]);
    expect(editor.manuscript.toggle).toHaveBeenCalledTimes(1);
  });

  it("keeps a single control while the run is folded", () => {
    const records = [
      record(0, 1),
      record(1, 2),
      record(2, 3),
      record(3, 5),
      record(4, 7),
      record(5, 16),
    ];
    render(<StoryManuscript editor={createEditor(records)} />);

    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);
  });
});
