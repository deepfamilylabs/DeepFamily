// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { TransactionCenterProvider, useTransactionCenter } from "./TransactionCenterContext";
import { useTransactionCenterEntry } from "../ui/shared/useTransactionCenterEntry";
import type { TransactionPhase } from "../ui/shared/transactionPhase";

afterEach(() => {
  cleanup();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TransactionCenterProvider>{children}</TransactionCenterProvider>
);

describe("transaction centre", () => {
  it("keeps the newest first and counts only what is still working", () => {
    const { result } = renderHook(() => useTransactionCenter(), { wrapper });

    act(() => {
      result.current!.upsert({ id: "a", kind: "mint", label: "Mint NFT", phase: "busy" });
      result.current!.upsert({ id: "b", kind: "endorse", label: "Endorse", phase: "done" });
    });

    expect(result.current!.records.map((record) => record.id)).toEqual(["b", "a"]);
    expect(result.current!.pendingCount).toBe(1);
  });

  it("merges a later phase into the record rather than adding another", () => {
    const { result } = renderHook(() => useTransactionCenter(), { wrapper });

    act(() => {
      result.current!.upsert({ id: "a", kind: "mint", label: "Mint NFT", phase: "busy" });
    });
    act(() => {
      result.current!.upsert({
        id: "a",
        kind: "mint",
        label: "Mint NFT",
        phase: "done",
        transactionHash: "0xmint",
      });
    });

    expect(result.current!.records).toHaveLength(1);
    expect(result.current!.records[0].phase).toBe("done");
    expect(result.current!.records[0].transactionHash).toBe("0xmint");
    expect(result.current!.pendingCount).toBe(0);
  });

  it("clears what has settled and leaves what has not", () => {
    const { result } = renderHook(() => useTransactionCenter(), { wrapper });

    act(() => {
      result.current!.upsert({ id: "a", kind: "mint", label: "Mint", phase: "busy" });
      result.current!.upsert({ id: "b", kind: "endorse", label: "Endorse", phase: "failed" });
      result.current!.upsert({ id: "c", kind: "addVersion", label: "Add", phase: "done" });
    });
    act(() => {
      result.current!.clearSettled();
    });

    expect(result.current!.records.map((record) => record.id)).toEqual(["a"]);
  });
});

describe("useTransactionCenterEntry", () => {
  function Probe({ phase }: { phase: TransactionPhase }) {
    useTransactionCenterEntry({ kind: "mint", label: "Mint NFT", phase });
    const centre = useTransactionCenter();
    return <span data-testid="ids">{centre!.records.map((record) => record.phase).join(",")}</span>;
  }

  const ids = () => screen.getByTestId("ids").textContent;

  it("opens no entry while the form is still the user's turn", () => {
    render(
      <TransactionCenterProvider>
        <Probe phase="form" />
      </TransactionCenterProvider>,
    );

    expect(ids()).toBe("");
  });

  it("follows one run through its phases and starts a new entry for the next", () => {
    const { rerender } = render(
      <TransactionCenterProvider>
        <Probe phase="busy" />
      </TransactionCenterProvider>,
    );
    expect(ids()).toBe("busy");

    rerender(
      <TransactionCenterProvider>
        <Probe phase="done" />
      </TransactionCenterProvider>,
    );
    expect(ids()).toBe("done");

    // Back to the form, then a second attempt: a second transaction, not a
    // rewrite of the first.
    rerender(
      <TransactionCenterProvider>
        <Probe phase="form" />
      </TransactionCenterProvider>,
    );
    rerender(
      <TransactionCenterProvider>
        <Probe phase="busy" />
      </TransactionCenterProvider>,
    );
    expect(ids()).toBe("busy,done");
  });
});
