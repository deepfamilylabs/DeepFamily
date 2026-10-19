// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ShieldedRecoveryMaterialView,
  type ShieldedRecoveryMaterialHandle,
} from "./ShieldedRecoveryMaterialView";

afterEach(cleanup);

const words = Array.from({ length: 24 }, (_, index) => `word${index + 1}`);

function renderView(format: "mnemonic" | "shieldedKey") {
  const ref = createRef<ShieldedRecoveryMaterialHandle>();
  render(
    <>
      <span id="material-label">backup</span>
      <ShieldedRecoveryMaterialView ref={ref} format={format} labelledBy="material-label" />
    </>,
  );
  return { ref, region: screen.getByRole("group", { name: "backup" }) };
}

describe("ShieldedRecoveryMaterialView", () => {
  it("masks all 24 numbered words until the backup is written in, and empties them on clear", () => {
    const { ref, region } = renderView("mnemonic");
    expect(region.querySelectorAll("li")).toHaveLength(24);
    expect(region.textContent).not.toContain("word1");
    act(() => ref.current!.show(` ${words.join("  ")} `));
    // Each cell holds its number, its word, and a mask that only shows while the word is empty.
    const cells = Array.from(region.querySelectorAll("li"), (cell) =>
      Array.from(cell.querySelectorAll("span:not([aria-hidden])"), (part) => part.textContent).join(
        " ",
      ),
    );
    expect(cells[0]).toBe("1 word1");
    expect(cells[23]).toBe("24 word24");
    act(() => ref.current!.clear());
    expect(region.textContent).not.toContain("word");
  });

  it("shows unexpected material whole instead of splitting it into the word grid", () => {
    const { ref, region } = renderView("mnemonic");
    act(() => ref.current!.show("one two three"));
    expect(
      Array.from(region.querySelectorAll("li span:not([aria-hidden])"), (part) => part.textContent),
    ).not.toContain("one");
    expect(region.textContent).toContain("one two three");
  });

  it("writes a Shielded Key as one block and clears it", () => {
    const { ref, region } = renderView("shieldedKey");
    act(() => ref.current!.show("0xabc123"));
    expect(region.textContent).toContain("0xabc123");
    act(() => ref.current!.clear());
    expect(region.textContent).not.toContain("0xabc123");
  });
});
