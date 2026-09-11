// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentCheckbox } from "./ConsentCheckbox";
import { ThemedSelect } from "./ThemedSelect";
import { TransactionButton } from "./TransactionButton";
import { TransactionErrorResult } from "./TransactionErrorResult";
import { TransactionPreviewPanel } from "./TransactionPreviewPanel";
import { TransactionTimeline, buildTimeline, useTimelineProgress } from "./TransactionTimeline";
import { TransactionSuccessSummary } from "./TransactionSuccessSummary";
import { TransactionProgress } from "./TransactionProgress";

afterEach(() => {
  cleanup();
});

describe("transaction UI primitives", () => {
  it("announces transaction progress as a polite busy status", () => {
    render(<TransactionProgress title="Submitting transaction" message="Waiting for signature" />);

    const status = screen.getByRole("status");

    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Submitting transaction")).toBeTruthy();
    expect(screen.getByText("Waiting for signature")).toBeTruthy();
  });

  it("takes focus and names itself when the wallet-bound preview appears", () => {
    render(
      <TransactionPreviewPanel
        title="Review before opening your wallet"
        description="These exact details will be submitted."
        preview={{
          canonicalPayload: "0x00",
          payloadHash: "0xhash",
          payloadBytes: 1,
          segmentCount: 1,
          estimated: true,
          estimatedGas: 100n,
          gasLimit: 120n,
          estimatedFee: 200n,
          maximumFee: 240n,
          nativeSymbol: "ETH",
        }}
      />,
    );

    const panel = screen.getByRole("group", { name: "Review before opening your wallet" });

    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("marks everything before the current step done and everything after pending", () => {
    const steps = buildTimeline({
      steps: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      currentId: "b",
    });

    expect(steps.map((step) => step.state)).toEqual(["done", "current", "pending"]);
  });

  it("marks the step a failed flow stopped on rather than still working it", () => {
    const steps = buildTimeline({
      steps: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      currentId: "b",
      failed: true,
    });

    expect(steps.map((step) => step.state)).toEqual(["done", "failed"]);
  });

  it("names the step it is on so the whole list is not read out as the status", () => {
    render(
      <TransactionTimeline
        label="Transactions"
        steps={buildTimeline({
          steps: [
            { id: "proof", label: "Generate proof" },
            { id: "confirm", label: "Waiting for confirmation", detail: "Still on chain" },
          ],
          currentId: "confirm",
        })}
      />,
    );

    const status = screen.getByRole("status", { name: "Transactions: Waiting for confirmation" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    // A detail belongs to the current step only.
    expect(screen.getByText("Still on chain")).toBeTruthy();
  });

  it("never walks the marker backwards when a signal arrives out of step order", () => {
    const steps = ["prepare", "proof", "encrypt", "review", "confirm"] as const;
    const { result, rerender } = renderHook(
      ({ current }: { current: string | null }) => useTimelineProgress(steps, current),
      { initialProps: { current: "prepare" as string | null } },
    );

    rerender({ current: "proof" });
    expect(result.current).toBe("proof");

    // Encryption reports as "prepare" in some flows; progress does not reverse.
    rerender({ current: "prepare" });
    expect(result.current).toBe("proof");

    rerender({ current: "review" });
    expect(result.current).toBe("review");
    rerender({ current: "prepare" });
    expect(result.current).toBe("review");
  });

  it("starts over once the run ends", () => {
    const steps = ["a", "b"] as const;
    const { result, rerender } = renderHook(
      ({ current }: { current: string | null }) => useTimelineProgress(steps, current),
      { initialProps: { current: "b" as string | null } },
    );
    expect(result.current).toBe("b");

    rerender({ current: null });
    expect(result.current).toBeNull();

    rerender({ current: "a" });
    expect(result.current).toBe("a");
  });

  it("drops a detail that only restates its own step label", () => {
    const steps = buildTimeline({
      steps: [
        { id: "proof", label: "生成零知识证明", detail: "生成零知识证明..." },
        { id: "wait", label: "Waiting", detail: "Still on chain" },
      ],
      currentId: "proof",
    });

    expect(steps[0].detail).toBeUndefined();
    expect(steps[1].detail).toBe("Still on chain");
  });

  it("copies a hash from the row it belongs to, with no provider in sight", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(
      <TransactionSuccessSummary
        t={(_key: string, fallback: string) => fallback}
        title="Minted"
        description="Done"
        rows={[
          { label: "Hash", value: "0xabc", mono: true },
          { label: "Reward", value: "12 DEEP" },
        ]}
      />,
    );

    // A plain amount needs no copy button; a hash does.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(writeText).toHaveBeenCalledWith("0xabc");
  });

  it("announces transaction errors assertively and keeps retry actionable", () => {
    const retry = vi.fn();

    render(
      <TransactionErrorResult
        title="Transaction failed"
        error={{
          type: "CALL_EXCEPTION",
          message: "Execution reverted",
          details: "Execution reverted by contract",
        }}
        typeLabel="Type"
        messageLabel="Message"
        detailsLabel="Details"
        retry={{ label: "Try again", onClick: retry }}
      />,
    );

    const alert = screen.getByRole("alert");

    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByText("Execution reverted")).toBeTruthy();
    expect(screen.getByText("Execution reverted by contract")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard selection in themed selects", () => {
    const onChange = vi.fn();

    render(
      <ThemedSelect
        value={1}
        onChange={onChange}
        options={[
          { value: 1, label: "One" },
          { value: 2, label: "Two" },
          { value: 3, label: "Three" },
        ]}
      />,
    );

    const button = screen.getByRole("button", { name: "One" });

    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(button, { key: "ArrowDown" });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(button, { key: "ArrowDown" });
    fireEvent.keyDown(button, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("supports pointer selection in themed selects", () => {
    function SelectHarness() {
      const [value, setValue] = useState(1);

      return (
        <ThemedSelect
          value={value}
          onChange={setValue}
          options={[
            { value: 1, label: "One" },
            { value: 2, label: "Two" },
          ]}
        />
      );
    }

    render(<SelectHarness />);

    fireEvent.click(screen.getByRole("button", { name: "One" }));

    const option = screen.getByRole("option", { name: "Two" });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Two" })).toBeTruthy();
  });

  it("closes themed selects with Escape", () => {
    render(
      <ThemedSelect
        value={1}
        onChange={vi.fn()}
        options={[
          { value: 1, label: "One" },
          { value: 2, label: "Two" },
        ]}
      />,
    );

    const button = screen.getByRole("button", { name: "One" });

    fireEvent.keyDown(button, { key: " " });
    expect(screen.queryByRole("listbox")).not.toBeNull();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("labels and toggles consent checkboxes", () => {
    function ConsentHarness() {
      const [checked, setChecked] = useState(false);

      return (
        <ConsentCheckbox checked={checked} onChange={() => setChecked((value) => !value)}>
          I understand this action is permanent
        </ConsentCheckbox>
      );
    }

    render(<ConsentHarness />);

    const checkbox = screen.getByRole("checkbox", {
      name: "I understand this action is permanent",
    }) as HTMLInputElement;

    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
  });

  it("keeps transaction buttons accessible and actionable", () => {
    const onClick = vi.fn();

    render(
      <TransactionButton variant="primary" onClick={onClick}>
        Submit transaction
      </TransactionButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit transaction" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
