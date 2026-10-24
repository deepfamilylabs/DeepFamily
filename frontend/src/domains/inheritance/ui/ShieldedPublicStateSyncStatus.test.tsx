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
  it("distinguishes all downloaded pages from verification and wallet completion", () => {
    const pause = vi.fn();
    render(<ShieldedPublicStateSyncStatus
      progress={[{ domain: "authorization", phase: "download", completed: 8, total: 8 }]}
      paused={false} pauseDisabled={false} onPause={pause}
    />);
    expect(screen.getByText(/phases.downloaded/)).toBeTruthy();
    expect(screen.queryByText(/phases.complete/)).toBeNull();
    expect(screen.getByText("shielded.publicStateSync.count:8/8")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("8");
    fireEvent.click(screen.getByRole("button", { name: "shielded.publicStateSync.pause" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it.each(["download", "verify", "catchup", "complete"] as const)("labels the %s phase and each public domain", (phase) => {
    render(<ShieldedPublicStateSyncStatus
      progress={[
        { domain: "authorization", phase, completed: 2, total: 3, resumed: true },
        { domain: "lineage", phase, completed: 1, total: 4 },
      ]}
      paused={false} pauseDisabled={false} onPause={vi.fn()}
    />);
    expect(screen.getByText(`shielded.publicStateSync.domains.authorization · shielded.publicStateSync.phases.${phase}`)).toBeTruthy();
    expect(screen.getByText(`shielded.publicStateSync.domains.lineage · shielded.publicStateSync.phases.${phase}`)).toBeTruthy();
    expect(screen.getByText("shielded.publicStateSync.resumed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shielded.publicStateSync.pause" }) !== null).toBe(phase !== "complete");
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
    expect(screen.getByRole("progressbar").getAttribute("value")).toBeNull();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button"));
    expect(pause).not.toHaveBeenCalled();
  });
});
