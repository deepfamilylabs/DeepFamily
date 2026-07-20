// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

function ToastHarness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success("Saved")}>
        Show success
      </button>
      <button type="button" onClick={() => toast.error("Failed")}>
        Show error
      </button>
    </div>
  );
}

describe("ToastProvider", () => {
  afterEach(() => {
    cleanup();
  });

  it("announces success toasts as polite status messages", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show success" }));

    const toast = screen.getByText("Saved").closest("[role='status']");
    expect(toast).toBeTruthy();
    expect(toast?.getAttribute("aria-live")).toBe("polite");
    expect(toast?.getAttribute("aria-atomic")).toBe("true");
    expect(toast?.parentElement?.parentElement?.className).toContain("z-11000");
  });

  it("announces error toasts as assertive alerts", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show error" }));

    const toast = screen.getByText("Failed").closest("[role='alert']");
    expect(toast).toBeTruthy();
    expect(toast?.getAttribute("aria-live")).toBe("assertive");
    expect(toast?.getAttribute("aria-atomic")).toBe("true");
  });
});
