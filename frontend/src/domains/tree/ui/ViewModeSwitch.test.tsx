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

  it("renders the optional extraAction as a trailing button that triggers its own onClick, not onChange", () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(
      <ViewModeSwitch
        value="tree"
        onChange={onChange}
        labels={labels}
        extraAction={{ label: "Genealogy", onClick }}
      />,
    );

    const extraButton = screen.getByText("Genealogy");
    expect(extraButton).toBeTruthy();

    fireEvent.click(extraButton);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds exactly one trailing button when extraAction is provided", () => {
    const { rerender } = render(<ViewModeSwitch value="tree" onChange={vi.fn()} labels={labels} />);
    // Count-agnostic so hiding/adding inline view modes does not make this brittle.
    const baseCount = screen.getAllByRole("button").length;

    rerender(
      <ViewModeSwitch
        value="tree"
        onChange={vi.fn()}
        labels={labels}
        extraAction={{ label: "Genealogy", onClick: vi.fn() }}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(baseCount + 1);
  });
});
