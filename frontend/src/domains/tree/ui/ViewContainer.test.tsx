// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewContainer from "./ViewContainer";

vi.mock("./ColorPalette", () => ({
  default: () => <div data-testid="color-palette" />,
}));

vi.mock("./DagView", () => ({
  default: () => <div data-testid="dag-view" />,
}));

vi.mock("./TreeLayoutView", () => ({
  default: () => <div data-testid="tree-view" />,
}));

vi.mock("./TreeListView", () => ({
  default: () => <div data-testid="virtual-view" />,
}));

vi.mock("../context", () => ({
  FamilyTreeViewConfigProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tree-config-provider">{children}</div>
  ),
}));

vi.mock("./LoadingSkeleton", () => ({
  default: () => <div data-testid="loading-skeleton" />,
}));

const viewModeLabels = {
  tree: "Tree",
  dag: "DAG",
  virtual: "List",
};

function renderViewContainer(overrides: Partial<React.ComponentProps<typeof ViewContainer>> = {}) {
  return render(
    <ViewContainer
      viewMode="tree"
      hasRoot
      contractMessage=""
      loading={false}
      viewModeLabels={viewModeLabels}
      onViewModeChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ViewContainer", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ["dag", "dag-view"],
    ["tree", "tree-view"],
    ["virtual", "virtual-view"],
  ] as const)(
    "renders the %s tree UI view through the domain public entry",
    async (viewMode, testId) => {
      renderViewContainer({ viewMode });

      expect(await screen.findByTestId(testId)).toBeTruthy();
      expect(screen.getByTestId("tree-config-provider")).toBeTruthy();
    },
  );

  it("renders loading and contract messages when no root is available", () => {
    const { rerender } = renderViewContainer({ hasRoot: false, loading: true });

    expect(screen.getByTestId("loading-skeleton")).toBeTruthy();

    rerender(
      <ViewContainer
        viewMode="tree"
        hasRoot={false}
        contractMessage="Select a root first"
        loading={false}
        viewModeLabels={viewModeLabels}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Select a root first")).toBeTruthy();
  });
});
