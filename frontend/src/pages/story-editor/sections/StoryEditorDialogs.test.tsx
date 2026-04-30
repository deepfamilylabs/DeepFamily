// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryEditorController } from "../hooks/useStoryEditorController";
import { ChunkTypeHelpDialog, SealConfirmDialog } from "./StoryEditorDialogs";

const t = ((_: string, fallback?: string | Record<string, unknown>) => {
  if (typeof fallback === "string") return fallback;
  if (fallback && "defaultValue" in fallback) return String(fallback.defaultValue);
  return _;
}) as StoryEditorController["t"];

function createEditor(
  overrides: {
    form?: Partial<StoryEditorController["form"]>;
    seal?: Partial<StoryEditorController["seal"]>;
    submitting?: boolean;
  } = {},
) {
  return {
    t,
    submitting: overrides.submitting ?? false,
    form: {
      showChunkTypeHelp: false,
      setShowChunkTypeHelp: vi.fn(),
      ...overrides.form,
    },
    seal: {
      showConfirm: false,
      setShowConfirm: vi.fn(),
      execute: vi.fn(),
      handleSeal: vi.fn(),
      ...overrides.seal,
    },
  } as unknown as StoryEditorController;
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StoryEditorDialogs", () => {
  it("exposes the seal confirmation as a modal dialog and restores focus on close", async () => {
    const setShowConfirm = vi.fn();
    const execute = vi.fn();
    const renderDialog = (showConfirm: boolean) => (
      <>
        <button type="button">Before dialog</button>
        <SealConfirmDialog
          editor={createEditor({
            seal: { execute, setShowConfirm, showConfirm },
          })}
        />
      </>
    );

    const { rerender } = render(renderDialog(false));
    const beforeDialog = screen.getByRole("button", { name: "Before dialog" });
    beforeDialog.focus();

    rerender(renderDialog(true));

    const dialog = screen.getByRole("dialog", { name: "Seal Story" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("type")).toBe("button");
    expect(screen.getByRole("button", { name: "Confirm Seal" }).getAttribute("type")).toBe(
      "button",
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(setShowConfirm).toHaveBeenCalledWith(false);

    rerender(renderDialog(false));
    expect(document.activeElement).toBe(beforeDialog);
  });

  it("exposes the chunk type help as a modal dialog and keeps tab focus inside", async () => {
    const setShowChunkTypeHelp = vi.fn();
    const renderDialog = (showChunkTypeHelp: boolean) => (
      <>
        <button type="button">Before dialog</button>
        <ChunkTypeHelpDialog
          editor={createEditor({
            form: { setShowChunkTypeHelp, showChunkTypeHelp },
          })}
        />
      </>
    );

    const { rerender } = render(renderDialog(false));
    const beforeDialog = screen.getByRole("button", { name: "Before dialog" });
    beforeDialog.focus();

    rerender(renderDialog(true));

    const dialog = screen.getByRole("dialog", { name: "Story Chunk Types Guide" });
    const closeButton = screen.getByRole("button", { name: "Close" });

    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(setShowChunkTypeHelp).toHaveBeenCalledWith(false);

    rerender(renderDialog(false));
    expect(document.activeElement).toBe(beforeDialog);
  });
});
