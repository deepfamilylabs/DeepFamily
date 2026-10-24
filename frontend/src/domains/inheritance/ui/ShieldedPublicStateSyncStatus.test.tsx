// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShieldedPublicStateSyncStatus } from "./ShieldedPublicStateSyncStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { completed: number; total: number }) =>
    options ? `${key}:${options.completed}/${options.total}` : key }),
}));
afterEach(cleanup);

describe("ShieldedPublicStateSyncStatus", () => {
  it("starts with a compact summary and expands the real download and verification details", () => {
    const pause = vi.fn();
    render(<ShieldedPublicStateSyncStatus
      progress={[{ domain: "authorization", phase: "download", completed: 8, total: 8 }]}
      paused={false} pauseDisabled={false} onPause={pause}
    />);
    const trigger = screen.getByRole("button", { name: "shielded.publicStateSync.details" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("shielded.publicStateSync.verifying");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/phases.downloaded/)).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const details = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(details?.contains(screen.getByRole("progressbar"))).toBe(true);
    expect(screen.getByText(/phases.downloaded/)).toBeTruthy();
    expect(screen.queryByText(/phases.complete/)).toBeNull();
    expect(screen.getByText("shielded.publicStateSync.count:8/8")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("8");
    fireEvent.click(screen.getByRole("button", { name: "shielded.publicStateSync.pause" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it.each(["download", "verify", "catchup"] as const)("labels the %s phase and each public domain without merging their counts", (phase) => {
    render(<ShieldedPublicStateSyncStatus
      progress={[
        { domain: "authorization", phase, completed: 2, total: 3, resumed: true },
        { domain: "lineage", phase, completed: 1, total: 4 },
      ]}
      paused={false} pauseDisabled={false} onPause={vi.fn()}
    />);
    expect(screen.getByRole("status").textContent).toBe(`shielded.publicStateSync.${phase === "verify" ? "verifying" : "syncing"}`);
    fireEvent.click(screen.getByRole("button", { name: "shielded.publicStateSync.details" }));
    expect(screen.getByText(`shielded.publicStateSync.domains.authorization · shielded.publicStateSync.phases.${phase}`)).toBeTruthy();
    expect(screen.getByText(`shielded.publicStateSync.domains.lineage · shielded.publicStateSync.phases.${phase}`)).toBeTruthy();
    expect(screen.getByText("shielded.publicStateSync.resumed")).toBeTruthy();
    expect(screen.getByText("shielded.publicStateSync.count:2/3")).toBeTruthy();
    expect(screen.getByText("shielded.publicStateSync.count:1/4")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("closes details with Escape or an outside pointer and keeps the trigger accessible", () => {
    render(<ShieldedPublicStateSyncStatus
      progress={[{ domain: "lineage", phase: "verify", completed: 1, total: 4 }]}
      paused={false} pauseDisabled={false} onPause={vi.fn()}
    />);
    const trigger = screen.getByRole("button", { name: "shielded.publicStateSync.details" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("progressbar"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("keeps completed domains in the details only until the remaining domain finishes", () => {
    const props = { paused: false, pauseDisabled: false, onPause: vi.fn() };
    const { rerender } = render(<ShieldedPublicStateSyncStatus {...props}
      progress={[
        { domain: "authorization", phase: "complete", completed: 3, total: 3 },
        { domain: "lineage", phase: "verify", completed: 1, total: 4 },
      ]}
    />);
    fireEvent.click(screen.getByRole("button", { name: "shielded.publicStateSync.details" }));
    expect(screen.getByText("shielded.publicStateSync.domains.authorization · shielded.publicStateSync.phases.complete")).toBeTruthy();
    rerender(<ShieldedPublicStateSyncStatus {...props}
      progress={[
        { domain: "authorization", phase: "complete", completed: 3, total: 3 },
        { domain: "lineage", phase: "complete", completed: 4, total: 4 },
      ]}
    />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<ShieldedPublicStateSyncStatus {...props}
      progress={[{ domain: "lineage", phase: "catchup", completed: 0, total: 0 }]}
    />);
    expect(screen.getByRole("button", { name: "shielded.publicStateSync.details" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("stays hidden when no synchronization event has arrived", () => {
    const { container } = render(<ShieldedPublicStateSyncStatus
      progress={[]} paused={false} pauseDisabled={false} onPause={vi.fn()}
    />);
    expect(container.textContent).toBe("");
  });

  it("shows the paused status without an active progress indicator", () => {
    render(<ShieldedPublicStateSyncStatus
      progress={[{ domain: "lineage", phase: "verify", completed: 1, total: 4 }]}
      paused pauseDisabled={false} onPause={vi.fn()}
    />);
    expect(screen.getByText("shielded.publicStateSync.paused")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not pause a wallet request or transaction", () => {
    const pause = vi.fn();
    render(<ShieldedPublicStateSyncStatus
      progress={[{ domain: "authorization", phase: "catchup", completed: 0, total: 0 }]}
      paused={false} pauseDisabled onPause={pause}
    />);
    fireEvent.click(screen.getByRole("button", { name: "shielded.publicStateSync.details" }));
    expect(screen.getByRole("progressbar").getAttribute("value")).toBeNull();
    const pauseButton = screen.getByRole("button", { name: "shielded.publicStateSync.pause" }) as HTMLButtonElement;
    expect(pauseButton.disabled).toBe(true);
    fireEvent.click(pauseButton);
    expect(pause).not.toHaveBeenCalled();
  });
});
