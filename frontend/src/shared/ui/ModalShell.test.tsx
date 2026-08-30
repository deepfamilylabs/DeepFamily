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

  it("paints a single scrim when a dialog is stacked inside another", () => {
    const scrimCount = () => document.body.querySelectorAll("[aria-hidden].bg-black\\/40").length;

    // The real stack: MintNFT renders its bare ResponsiveModalFrame, and the
    // endorse-required dialog opens inside it. Two 40% layers would read as 64%
    // black with the blur applied twice, so only the outermost shell dims.
    const { rerender } = render(
      <ModalShell isOpen onClose={vi.fn()} bare ariaLabel="Outer modal">
        <button type="button">Outer action</button>
        <ModalShell isOpen onClose={vi.fn()} bare ariaLabel="Inner dialog">
          <button type="button">Inner action</button>
        </ModalShell>
      </ModalShell>,
    );

    expect(scrimCount()).toBe(1);
    expect(screen.getByRole("button", { name: "Inner action" })).toBeTruthy();

    // Depth follows the React tree, so a wrapped child nests just as a bare one does.
    rerender(
      <ModalShell isOpen onClose={vi.fn()} bare ariaLabel="Outer modal">
        <ModalShell isOpen onClose={vi.fn()} ariaLabel="Inner dialog">
          <button type="button">Inner action</button>
        </ModalShell>
      </ModalShell>,
    );
    expect(scrimCount()).toBe(1);

    // Closing the outer shell unmounts the inner one along with the only scrim.
    rerender(
      <ModalShell isOpen={false} onClose={vi.fn()} bare ariaLabel="Outer modal">
        <ModalShell isOpen onClose={vi.fn()} bare ariaLabel="Inner dialog">
          <button type="button">Inner action</button>
        </ModalShell>
      </ModalShell>,
    );
    expect(scrimCount()).toBe(0);
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
