// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperSpine } from "./PaperSpine";

describe("PaperSpine", () => {
  it("keeps page numbers clear of the rule below them", () => {
    const t = (_key: string, fallback = "", options?: Record<string, unknown>) =>
      fallback.replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(options?.[name] ?? ""));

    render(
      <PaperSpine
        chartIndex={1}
        spreadIndex={1}
        title="贾氏族谱"
        t={t}
        testIdPrefix="paper-test-spine"
        pageOrder="rtl"
      />,
    );

    const pageNumbers = screen.getByTestId("paper-test-spine-1-1-pages");
    expect(pageNumbers.parentElement?.classList.contains("h-9")).toBe(true);
    expect(pageNumbers.parentElement?.classList.contains("items-end")).toBe(true);
    expect(pageNumbers.parentElement?.classList.contains("pb-3")).toBe(true);
    expect(pageNumbers.parentElement?.classList.contains("border-b")).toBe(true);
  });
});
