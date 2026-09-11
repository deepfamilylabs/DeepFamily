// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { AddVersionSuccessResult } from "./AddVersionSuccessResult";

afterEach(() => {
  cleanup();
});

const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (match, name) =>
    options && name in options ? String(options[name]) : match,
  );

const personHash = `0x${"c8".repeat(32)}`;
const fatherHash = `0x${"33".repeat(32)}`;
const motherHash = `0x${"fd".repeat(32)}`;

const renderResult = (added: Record<string, unknown>, rewardAmount: bigint = 0n) =>
  render(
    <AddVersionSuccessResult
      t={t}
      successResult={{
        hash: personHash,
        index: 1,
        rewardAmount,
        transactionHash: "0xtx",
        events: { PersonVersionAdded: added },
      }}
    />,
  );

const labels = () =>
  Array.from(screen.getByRole("status").querySelectorAll("dt")).map((dt) => dt.textContent);

describe("AddVersionSuccessResult", () => {
  it("carries the edges a genealogy is made of, not just the node", () => {
    renderResult({ fatherHash, fatherVersionIndex: 0, motherHash, motherVersionIndex: 2 });

    expect(labels()).toEqual(["Hash", "Version", "Father", "Mother", "Transaction"]);
    // An unpinned link names the person, not one of their versions, so it says
    // nothing about a version; a pinned one does.
    expect(screen.getByText(fatherHash)).toBeTruthy();
    expect(screen.getByText(`${motherHash} · version 2`)).toBeTruthy();
  });

  it("omits a parent that was never linked", () => {
    renderResult({ fatherHash: ethers.ZeroHash, fatherVersionIndex: 0, motherHash, motherVersionIndex: 0 });

    expect(labels()).toEqual(["Hash", "Version", "Mother", "Transaction"]);
  });

  it("copies the parent hash alone, not the version it is pinned to", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderResult({ fatherHash, fatherVersionIndex: 7, motherHash: ethers.ZeroHash });

    fireEvent.click(screen.getByRole("button", { name: "Copy Father" }));
    expect(writeText).toHaveBeenCalledWith(fatherHash);
  });

  it("shows a reward only when something was mined", () => {
    renderResult({ fatherHash: ethers.ZeroHash, motherHash: ethers.ZeroHash }, 1_000_000_000_000_000_000n);

    expect(labels()).toEqual(["Hash", "Version", "Reward", "Transaction"]);
    expect(screen.getByText("1 DEEP")).toBeTruthy();
  });
});
