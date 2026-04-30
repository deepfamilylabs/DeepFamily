// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentCheckbox } from "./ConsentCheckbox";
import { ThemedSelect } from "./ThemedSelect";
import { TransactionButton } from "./TransactionButton";
import { TransactionErrorResult } from "./TransactionErrorResult";
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
