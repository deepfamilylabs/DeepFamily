// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewContainer from "./ViewContainer";

vi.mock("./ColorPalette", () => ({
  default: () => <div data-testid="color-palette" />,
}));

vi.mock("./ForceGraphView", () => ({
  default: () => <div data-testid="force-view" />,
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

vi.mock("../../person/ui", () => ({
  EndorseModalProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="endorse-provider">{children}</div>
  ),
  NodeDetailProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="node-detail-provider">{children}</div>
  ),
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
  force: "Force",
  virtual: "List",
};

function renderViewContainer(
  overrides: Partial<React.ComponentProps<typeof ViewContainer>> = {},
) {
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
    ["force", "force-view"],
    ["dag", "dag-view"],
    ["tree", "tree-view"],
    ["virtual", "virtual-view"],
  ] as const)(
    "renders the %s tree UI view through the domain public entry",
    async (viewMode, testId) => {
      renderViewContainer({ viewMode });

      expect(await screen.findByTestId(testId)).toBeTruthy();
      expect(screen.getByTestId("endorse-provider")).toBeTruthy();
      expect(screen.getByTestId("node-detail-provider")).toBeTruthy();
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
