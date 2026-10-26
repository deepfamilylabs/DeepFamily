// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import type { WalletNoteView } from "../../../shared/workers/walletWorkerTypes";
import { ShieldedClaimComposer, buildShieldedClaimSchedule } from "./ShieldedClaimComposer";

const DAY = 86_400n;
const budget = (overrides: Partial<WalletNoteView> = {}): WalletNoteView => ({
  handle: "21",
  kind: "budget",
  amount: "30",
  codeIndex: "1",
  rate: "10",
  periodDays: "1",
  eligibleFrom: "1000",
  ...overrides,
});

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

describe("buildShieldedClaimSchedule", () => {
  it("lists the due period, then the funded periods after it", () => {
    expect(buildShieldedClaimSchedule(budget({ claimPeriod: "2" }), 1000n + 4n * DAY)).toEqual([
      { kind: "claimable", index: "2", period: 3n, dueAt: 1000n + 3n * DAY },
      { kind: "upcoming", period: 4n, dueAt: 1000n + 4n * DAY },
      { kind: "upcoming", period: 5n, dueAt: 1000n + 5n * DAY },
    ]);
  });

  it("starts after the periods that have already fallen due when none is claimable", () => {
    expect(buildShieldedClaimSchedule(budget({ amount: "20" }), 1000n + DAY + 5n)).toEqual([
      { kind: "upcoming", period: 2n, dueAt: 1000n + 2n * DAY },
      { kind: "upcoming", period: 3n, dueAt: 1000n + 3n * DAY },
    ]);
  });

  it("shortens a long schedule to its first periods and its last", () => {
    const rows = buildShieldedClaimSchedule(
      budget({ amount: "200", claimPeriod: "0" }),
      1000n + DAY,
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "claimable",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "gap",
      "upcoming",
    ]);
    expect(rows[rows.length - 1]).toEqual({
      kind: "upcoming",
      period: 20n,
      dueAt: 1000n + 20n * DAY,
    });
  });
});

describe("ShieldedClaimComposer", () => {
  it("offers the due period of the chosen budget and keeps later ones visible", () => {
    const onClaimPeriodsChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ShieldedClaimComposer
          titleId="claim"
          symbol="DEEP"
          decimals={0}
          busy={false}
          budgets={[budget({ claimPeriod: "0" })]}
          now={1000n + DAY}
          claimHandle="21"
          onClaimChange={vi.fn()}
          claimPeriods={["0"]}
          onClaimPeriodsChange={onClaimPeriodsChange}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("预算 1 · 剩余 30 DEEP")).toBeTruthy();
    const due = screen.getByRole("checkbox", { name: "第 1 期 · 10 DEEP" }) as HTMLInputElement;
    expect(due.checked).toBe(true);
    expect(screen.getByText("暂未到期")).toBeTruthy();
    expect(screen.getByText("第 3 期 · 10 DEEP")).toBeTruthy();
    fireEvent.click(due);
    expect(onClaimPeriodsChange).toHaveBeenCalledWith([]);
  });

  it("says when there is no budget to claim", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ShieldedClaimComposer
          titleId="claim"
          symbol="DEEP"
          decimals={0}
          busy={false}
          budgets={[]}
          now={0n}
          claimHandle=""
          onClaimChange={vi.fn()}
          claimPeriods={[]}
          onClaimPeriodsChange={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("暂无待领取预算。");
  });
});
