// @vitest-environment jsdom
import React, { useLayoutEffect } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TransactionCenterProvider,
  useTransactionCenter,
} from "../../context/TransactionCenterContext";
import { useTransactionCenterEntry, type TransactionSettlement } from "./useTransactionCenterEntry";
import type { TransactionPhase } from "./transactionPhase";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TransactionCenterProvider>{children}</TransactionCenterProvider>
);

describe("captured transaction settlement", () => {
  it("starts a fresh busy entry for an explicit retry of a failed submission", () => {
    const oldError = { type: "NETWORK_ERROR", message: "Old failure", details: "Old failure" };
    const { result, rerender } = renderHook(
      ({ phase }: { phase: TransactionPhase }) => ({
        entry: useTransactionCenterEntry({ kind: "mint", label: "Mint NFT", phase,
          error: phase === "failed" ? oldError : null }),
        centre: useTransactionCenter(),
      }),
      { wrapper, initialProps: { phase: "failed" as TransactionPhase } },
    );
    const oldId = result.current.centre!.records[0].id;
    let settle!: (outcome: TransactionSettlement) => void;
    act(() => { settle = result.current.entry.captureSettlement({ newEntry: true }); });
    const nextId = result.current.centre!.records[0].id;
    expect(nextId).not.toBe(oldId);
    expect(result.current.centre!.records[0]).toMatchObject({ phase: "busy" });
    expect(result.current.centre!.records[0].error).toBeUndefined();
    rerender({ phase: "busy" });
    act(() => settle({ phase: "done", transactionHash: "0xretry", error: null }));
    expect(result.current.centre!.records.find((record) => record.id === oldId)?.phase).toBe("failed");
    expect(result.current.centre!.records.find((record) => record.id === nextId)).toMatchObject({ phase: "done", transactionHash: "0xretry" });
  });

  it("opens an entry synchronously before the submission's busy render", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: TransactionPhase }) => ({
        entry: useTransactionCenterEntry({ kind: "addVersion", label: "Add Version", phase }),
        centre: useTransactionCenter(),
      }),
      { wrapper, initialProps: { phase: "form" as TransactionPhase } },
    );
    let settle!: (outcome: TransactionSettlement) => void;
    act(() => {
      settle = result.current.entry.captureSettlement();
    });
    expect(result.current.centre!.records).toHaveLength(1);
    const id = result.current.centre!.records[0].id;
    expect(result.current.centre!.pendingCount).toBe(1);

    rerender({ phase: "busy" });
    act(() => settle({ phase: "done", transactionHash: "0xconfirmed" }));
    rerender({ phase: "done" });

    expect(result.current.centre!.records).toHaveLength(1);
    expect(result.current.centre!.records[0]).toMatchObject({
      id,
      phase: "done",
      transactionHash: "0xconfirmed",
    });
  });

  it("settles the original entry after closing it and starting a different run", () => {
    const { result, rerender } = renderHook(
      ({ phase, label }: { phase: TransactionPhase; label: string }) => ({
        entry: useTransactionCenterEntry({ kind: "addVersion", label, phase }),
        centre: useTransactionCenter(),
      }),
      { wrapper, initialProps: { phase: "busy" as TransactionPhase, label: "Original person" } },
    );
    let settleOriginal!: (outcome: TransactionSettlement) => void;
    act(() => {
      settleOriginal = result.current.entry.captureSettlement();
    });
    const originalId = result.current.centre!.records[0].id;
    rerender({ phase: "form", label: "Original person" });
    rerender({ phase: "busy", label: "Next person" });
    const nextId = result.current.centre!.records[0].id;
    expect(nextId).not.toBe(originalId);

    act(() => settleOriginal({ phase: "done", transactionHash: "0xoriginal" }));

    expect(result.current.centre!.records).toHaveLength(2);
    expect(result.current.centre!.records.find((record) => record.id === originalId)).toMatchObject(
      {
        label: "Original person",
        phase: "done",
        transactionHash: "0xoriginal",
      },
    );
    expect(result.current.centre!.records.find((record) => record.id === nextId)).toMatchObject({
      label: "Next person",
      phase: "busy",
    });
    expect(result.current.centre!.pendingCount).toBe(1);
  });

  it("keeps a captured settlement alive after the modal unmounts", () => {
    let settle!: (outcome: TransactionSettlement) => void;
    function Modal() {
      const entry = useTransactionCenterEntry({
        kind: "addVersion",
        label: "Add Version",
        phase: "busy",
      });
      useLayoutEffect(() => {
        settle = entry.captureSettlement();
      }, []);
      return null;
    }
    function Records() {
      const centre = useTransactionCenter();
      return <output data-testid="records">{JSON.stringify(centre!.records)}</output>;
    }
    const view = render(
      <TransactionCenterProvider>
        <Modal />
        <Records />
      </TransactionCenterProvider>,
    );
    expect(JSON.parse(screen.getByTestId("records").textContent!)).toHaveLength(1);
    view.rerender(
      <TransactionCenterProvider>
        <Records />
      </TransactionCenterProvider>,
    );
    act(() => settle({ phase: "done", transactionHash: "0xbackground" }));

    expect(JSON.parse(screen.getByTestId("records").textContent!)).toMatchObject([
      { phase: "done", transactionHash: "0xbackground" },
    ]);
  });
});
