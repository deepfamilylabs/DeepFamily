// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeId } from "../../../../shared/model";
import type { TreeRow } from "../../selectors";
import type { NodeUi } from "../nodeUi";
import TreeListRowRenderer from "./treeListRowRenderer";

const ID = "0xabc-v1" as NodeId;

function renderRow(ui: Partial<NodeUi>, themeName?: string) {
  const row = { nodeId: ID, depth: 0, isLast: true, hasChildren: false } as TreeRow;
  const nodeUi: NodeUi = {
    id: ID,
    personHash: "0xabc",
    versionIndex: 1,
    minted: true,
    shortHashText: "0xabc…",
    titleText: "Cao Cao",
    versionText: "v1",
    versionTextWithTotal: "v1",
    endorsementCount: 1,
    gender: 1,
    ...ui,
  };

  return render(
    <TreeListRowRenderer
      index={0}
      style={{}}
      rows={[row]}
      expanded={new Set()}
      toggle={vi.fn()}
      rowHeight={40}
      selectedKey={null}
      nodeUiById={{ [ID]: nodeUi }}
      openNodeById={vi.fn()}
      openEndorseById={vi.fn()}
      themeName={themeName}
    />,
  );
}

describe("TreeListRowRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("gives the NFT badge a real dark background, not the SVG fill it was derived from", () => {
    renderRow({});

    const badge = screen.getByText("NFT");
    expect(badge.className).toContain("bg-emerald-100");
    expect(badge.className).toContain("dark:bg-emerald-800/60");
    // A fill class does nothing on a span, which left the light mint showing in dark mode.
    expect(badge.className).not.toContain("fill-");
  });

  it("colours the NFT badge from the chosen palette, border included", () => {
    renderRow({}, "rose");

    const badge = screen.getByText("NFT");
    expect(badge.className).toContain("dark:bg-rose-800/60");
    expect(badge.className).toContain("border-rose-300");
    expect(badge.className).not.toContain("emerald");
  });

  it("draws the tag badge with background classes too", () => {
    renderRow({ tagText: "Scholar" });

    const tag = screen.getByTitle("Scholar");
    expect(tag.className).toContain("dark:bg-emerald-800/60");
    expect(tag.className).not.toContain("fill-");
  });
});
