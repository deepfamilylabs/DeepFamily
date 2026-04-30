// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => {
  cleanup();
});

describe("ConfirmDialog", () => {
  it("exposes dialog semantics and closes from the close button", () => {
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete item"
        message="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete item" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("supports Escape and Enter keyboard actions", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Confirm action"
        message="Proceed with this action?"
        confirmText="Proceed"
        cancelText="Cancel"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog and restores previous focus on close", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const renderDialog = (open: boolean) => (
      <>
        <button type="button">Before dialog</button>
        <ConfirmDialog
          open={open}
          title="Confirm action"
          message="Proceed with this action?"
          confirmText="Proceed"
          cancelText="Cancel"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </>
    );

    const { rerender } = render(renderDialog(false));
    const beforeDialog = screen.getByRole("button", { name: "Before dialog" });

    beforeDialog.focus();
    expect(document.activeElement).toBe(beforeDialog);

    rerender(renderDialog(true));

    const dialog = screen.getByRole("dialog", { name: "Confirm action" });

    await waitFor(() => expect(document.activeElement).toBe(dialog));

    rerender(renderDialog(false));

    expect(document.activeElement).toBe(beforeDialog);
  });
});
