// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "./ModalShell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("ModalShell", () => {
  it("moves focus into the dialog, traps tab navigation, and restores focus on close", async () => {
    const onClose = vi.fn();
    const renderShell = (isOpen: boolean) => (
      <>
        <button type="button">Before modal</button>
        <ModalShell
          isOpen={isOpen}
          onClose={onClose}
          ariaLabel="Example modal"
          hideCloseButton
        >
          <button type="button">First action</button>
          <button type="button">Second action</button>
        </ModalShell>
      </>
    );

    const { rerender } = render(renderShell(false));
    const beforeModal = screen.getByRole("button", { name: "Before modal" });

    beforeModal.focus();
    expect(document.activeElement).toBe(beforeModal);

    rerender(renderShell(true));

    const dialog = screen.getByRole("dialog", { name: "Example modal" });
    const first = screen.getByRole("button", { name: "First action" });
    const second = screen.getByRole("button", { name: "Second action" });

    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    second.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(second);

    rerender(renderShell(false));
    expect(document.activeElement).toBe(beforeModal);
  });

  it("dims the page behind the dialog in both bare and wrapped modes", () => {
    const scrimsOf = (container: HTMLElement | Document) =>
      (container === document ? document.body : container).querySelectorAll(
        "[aria-hidden].bg-black\\/40",
      );

    const { rerender } = render(
      <ModalShell isOpen onClose={vi.fn()} ariaLabel="Wrapped modal">
        <button type="button">Action</button>
      </ModalShell>,
    );
    expect(scrimsOf(document)).toHaveLength(1);

    // `bare` hands layout to the children but must keep the scrim, otherwise the
    // panel renders directly over an undimmed page.
    rerender(
      <ModalShell isOpen onClose={vi.fn()} bare ariaLabel="Bare modal">
        <button type="button">Action</button>
      </ModalShell>,
    );
    expect(scrimsOf(document)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Action" })).toBeTruthy();
  });

  it("closes from Escape", () => {
    const onClose = vi.fn();

    render(
      <ModalShell isOpen onClose={onClose} ariaLabel="Example modal">
        <button type="button">Action</button>
      </ModalShell>,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
