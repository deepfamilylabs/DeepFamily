// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RootHashHistory from "./RootHashHistory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const HASH = "0x1234567890abcdef";

afterEach(() => {
  cleanup();
});

describe("RootHashHistory", () => {
  it("renders nothing when the history is empty", () => {
    const { container } = render(
      <RootHashHistory
        items={[]}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("is collapsed by default and preserves all history actions", () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();

    render(
      <RootHashHistory
        items={[HASH]}
        onSelect={onSelect}
        onRemove={onRemove}
        onClearAll={onClearAll}
      />,
    );

    const disclosure = screen.getByText("Root hash history").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Root hash history"));
    expect(disclosure?.hasAttribute("open")).toBe(true);

    fireEvent.click(screen.getByTitle(HASH));
    expect(onSelect).toHaveBeenCalledWith(HASH);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith(HASH);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});
