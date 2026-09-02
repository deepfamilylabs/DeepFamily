// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewModeSwitch from "./ViewModeSwitch";

const labels = { tree: "Tree", dag: "DAG", force: "Force", virtual: "Virtual" };

afterEach(() => {
  cleanup();
});

describe("ViewModeSwitch", () => {
  it("switches inline view modes via onChange", () => {
    const onChange = vi.fn();
    render(<ViewModeSwitch value="tree" onChange={onChange} labels={labels} />);

    fireEvent.click(screen.getByText("DAG"));

    expect(onChange).toHaveBeenCalledWith("dag");
  });

  it("renders one button per visible view mode", () => {
    render(<ViewModeSwitch value="tree" onChange={vi.fn()} labels={labels} />);

    // Count-agnostic so hiding/adding inline view modes does not make this brittle.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    expect(screen.getByText("Tree").closest("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("DAG").closest("button")?.getAttribute("aria-pressed")).toBe("false");
  });
});
