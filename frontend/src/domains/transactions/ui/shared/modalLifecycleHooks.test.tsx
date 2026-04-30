// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBottomSheetDrag, useResponsiveModalMode } from "../../../../shared/ui";
import { useModalHistoryClose } from "./useModalHistoryClose";

type MatchMediaController = {
  setMatches: (matches: boolean) => void;
};

function mockMatchMedia(initialMatches: boolean): MatchMediaController {
  let matches = initialMatches;
  let listener: ((event: MediaQueryListEvent) => void) | null = null;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: "(min-width: 768px)",
      addEventListener: vi.fn((_type: string, nextListener: EventListener) => {
        listener = nextListener as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn((nextListener: (event: MediaQueryListEvent) => void) => {
        listener = nextListener;
      }),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  });

  return {
    setMatches: (nextMatches: boolean) => {
      matches = nextMatches;
      listener?.({ matches: nextMatches } as MediaQueryListEvent);
    },
  };
}

describe("transaction modal lifecycle hooks", () => {
  beforeEach(() => {
    window.history.replaceState({ page: "start" }, "", "/");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({ page: "start" }, "", "/");
  });

  it("updates responsive modal mode from matchMedia changes", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useResponsiveModalMode());

    expect(result.current).toBe(false);

    act(() => {
      media.setMatches(true);
    });

    expect(result.current).toBe(true);
  });

  it("pushes one mobile history marker and cleans it with back on self-close", () => {
    const onClose = vi.fn();
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});

    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useModalHistoryClose({
          isOpen,
          isDesktop: false,
          modalId: "TestModal",
          onRequestClose: onClose,
        }),
      { initialProps: { isOpen: true } },
    );

    expect(window.history.state.__dfModal).toBe("TestModal");

    act(() => {
      result.current();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ isOpen: false });
    });
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("closes once on mobile back and does not back again during cleanup", () => {
    const onClose = vi.fn();
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ isOpen }) =>
        useModalHistoryClose({
          isOpen,
          isDesktop: false,
          modalId: "TestModal",
          onRequestClose: onClose,
        }),
      { initialProps: { isOpen: true } },
    );

    act(() => {
      window.history.replaceState({ page: "start" }, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { page: "start" } }));
      window.dispatchEvent(new PopStateEvent("popstate", { state: { page: "start" } }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ isOpen: false });
    });
    expect(backSpy).not.toHaveBeenCalled();
  });

  it("does not push history on desktop and removes the popstate listener on cleanup", () => {
    const onClose = vi.fn();
    const pushSpy = vi.spyOn(window.history, "pushState");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useModalHistoryClose({
        isOpen: true,
        isDesktop: true,
        modalId: "TestModal",
        onRequestClose: onClose,
      }),
    );

    unmount();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalledWith("popstate", expect.any(Function));
    expect(removeSpy).not.toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("removes the mobile popstate listener when unmounted", () => {
    const onClose = vi.fn();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useModalHistoryClose({
        isOpen: true,
        isDesktop: false,
        modalId: "TestModal",
        onRequestClose: onClose,
      }),
    );

    unmount();

    expect(addSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("tracks bottom-sheet drag offset, closes past the threshold, and resets on cancel", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useBottomSheetDrag({ isOpen: true, onClose, closeThreshold: 120 }),
    );

    act(() => {
      result.current.startDrag(10);
    });
    expect(result.current.dragging).toBe(true);

    act(() => {
      result.current.updateDrag(70);
    });
    expect(result.current.dragOffset).toBe(60);

    act(() => {
      result.current.cancelDrag();
    });
    expect(result.current.dragging).toBe(false);
    expect(result.current.dragOffset).toBe(0);

    act(() => {
      result.current.startDrag(0);
    });
    act(() => {
      result.current.updateDrag(150);
    });
    act(() => {
      result.current.finishDrag();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.dragging).toBe(false);
    expect(result.current.dragOffset).toBe(0);
  });
});
