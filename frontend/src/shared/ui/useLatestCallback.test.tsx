// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useLatestCallback } from "./useLatestCallback";

it("keeps event subscriptions stable while reading the latest committed state", () => {
  const { result, rerender } = renderHook(
    ({ prefix }) => useLatestCallback((value: string) => prefix + value),
    { initialProps: { prefix: "old:" } },
  );
  const listener = result.current;
  expect(listener("event")).toBe("old:event");
  rerender({ prefix: "new:" });
  expect(result.current).toBe(listener);
  expect(listener("event")).toBe("new:event");
});
