// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyIconButton } from "./CopyIconButton";

describe("CopyIconButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes a labelled copy button with a matching title", () => {
    render(<CopyIconButton label="Copy" onClick={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Copy" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("title")).toBe("Copy");
  });

  it("can stop click propagation when embedded in clickable rows", () => {
    const parentClick = vi.fn();
    const copyClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <CopyIconButton label="Copy" onClick={copyClick} stopPropagation />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(copyClick).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("uses stable size classes", () => {
    render(<CopyIconButton label="Copy" onClick={vi.fn()} size="xs" />);

    const button = screen.getByRole("button", { name: "Copy" });
    expect(button.className).toContain("h-6");
    expect(button.className).toContain("w-6");
  });

  it("keeps hover-revealed copy buttons visible on mobile", () => {
    render(<CopyIconButton label="Copy" onClick={vi.fn()} visibility="group-hover" />);

    const button = screen.getByRole("button", { name: "Copy" });
    expect(button.className).toContain("opacity-100");
    expect(button.className).toContain("md:opacity-0");
    expect(button.className).toContain("md:group-hover:opacity-100");
  });
});
