// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShieldedProgressList, SHIELDED_APPROVAL_STAGES } from "./ShieldedTaskReceipt";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it("uses the shared timeline with one live status and one working marker", () => {
  const { container, rerender } = render(<ShieldedProgressList stage="proving" />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").getAttribute("aria-label")).toBe("transaction.center: shielded.stageLabels.proving");
  expect(screen.getByText("shielded.stageLabels.proving")).toBeTruthy();
  expect(screen.queryByText("shielded.stages.proving")).toBeNull();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(screen.queryByText("shielded.stages.submitting")).toBeNull();
  expect(screen.queryByText("shielded.stages.confirming")).toBeNull();
  rerender(<ShieldedProgressList stage="submitting" />);
  expect(screen.getByRole("status").getAttribute("aria-label")).toBe("transaction.center: shielded.stageLabels.submitting");
  expect(screen.getByText("shielded.stages.submitting")).toBeTruthy();
  // The wallet is waiting for its user; the shared awaiting marker does not spin.
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
  expect(screen.queryByText("shielded.stages.proving")).toBeNull();
  expect(screen.getByText("shielded.stageLabels.proving")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
});

it("starts its fixed timeline at preparation and resumes work after wallet confirmation", () => {
  const { container, rerender } = render(<ShieldedProgressList stage="preparing" />);
  expect(screen.getByText("shielded.stageLabels.preparing")).toBeTruthy();
  expect(screen.queryByText("shielded.walletKeys.preparing")).toBeNull();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  expect(screen.queryByText("shielded.stages.submitting")).toBeNull();
  rerender(<ShieldedProgressList stage="checkingGas" />);
  expect(screen.getByText("shielded.stageLabels.checkingGas")).toBeTruthy();
  expect(screen.queryByText("shielded.stages.checkingGas")).toBeNull();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  rerender(<ShieldedProgressList stage="confirming" />);
  expect(screen.getByText("shielded.stageLabels.confirming")).toBeTruthy();
  expect(screen.queryByText("shielded.stages.confirming")).toBeNull();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
});

it("accepts the operation's actual activity without adding another spinner", () => {
  const { container, rerender } = render(<ShieldedProgressList stage="submitting" activity="working" />);
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  rerender(<ShieldedProgressList stage="submitting" activity="awaiting" />);
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
  expect(screen.getByText("shielded.stages.submitting")).toBeTruthy();
});

it("keeps the approval timeline limited to its actual wallet and chain steps", () => {
  const { container } = render(<ShieldedProgressList stage="confirming" stages={SHIELDED_APPROVAL_STAGES} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByText("shielded.stageLabels.proving")).toBeNull();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
});
