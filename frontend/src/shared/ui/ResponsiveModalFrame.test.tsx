// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { User } from "lucide-react";
import { ResponsiveModalFrame } from "./ResponsiveModalFrame";
import { OVERLAY_Z_INDEX } from "./overlayLayers";

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

function renderFrame({
  isDesktop = false,
  onClose = vi.fn(),
}: {
  isDesktop?: boolean;
  onClose?: () => void;
} = {}) {
  const view = render(
    <ResponsiveModalFrame
      isOpen
      onClose={onClose}
      isDesktop={isDesktop}
      ariaLabel="Responsive modal"
      icon={<User aria-hidden="true" />}
      title="Example"
      description="Description"
      entered
    >
      <button type="button">Inner action</button>
    </ResponsiveModalFrame>,
  );

  return { ...view, onClose };
}

describe("ResponsiveModalFrame", () => {
  it("allows backdrop close on mobile but not on desktop", () => {
    const mobile = renderFrame({ isDesktop: false });
    fireEvent.click(screen.getByRole("dialog", { name: "Responsive modal" }));
    expect(mobile.onClose).toHaveBeenCalledTimes(1);

    cleanup();

    const desktop = renderFrame({ isDesktop: true });
    fireEvent.click(screen.getByRole("dialog", { name: "Responsive modal" }));
    expect(desktop.onClose).not.toHaveBeenCalled();
  });

  it("uses the app modal overlay layer by default", () => {
    renderFrame();

    expect(screen.getByRole("dialog", { name: "Responsive modal" }).className).toContain(
      OVERLAY_Z_INDEX.appModal,
    );
  });

  it("does not close when clicking inside the panel", () => {
    const { onClose } = renderFrame();

    fireEvent.click(screen.getByRole("button", { name: "Inner action" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the close button and Escape", () => {
    const { onClose } = renderFrame();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes after dragging the header past the bottom sheet threshold", () => {
    const { onClose } = renderFrame();
    const handle = document.querySelector(".cursor-grab");

    expect(handle).not.toBeNull();

    fireEvent.pointerDown(handle!, { clientY: 0 });
    fireEvent.pointerMove(handle!, { clientY: 150 });
    fireEvent.pointerUp(handle!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
