// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en/index.json";
import zh from "../../../locales/zh-CN/index.json";
import type {
  ShieldedClaimSummary,
  ShieldedWalletSummary,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { buildShieldedClaimSchedule, ShieldedClaimComposer } from "./ShieldedClaimComposer";

const DAY = 86_400n;
const start = 1_775_779_200n; // 2026-04-10T00:00:00Z

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: { en: { translation: en }, "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function claim(overrides: Partial<ShieldedClaimSummary> = {}): ShieldedClaimSummary {
  return {
    handle: "identity:budget",
    slot: "identity",
    budgets: ["11"],
    periodIndices: ["3", "4", "5"],
    amount: "300",
    amountPerPeriod: "100",
    totalRemaining: "900",
    periodDays: "30",
    status: "claimable",
    nextDueAt: String(start + 7n * 30n * DAY),
    nextPeriodIndex: "6",
    futurePeriods: "6",
    ...overrides,
  };
}

const budget = {
  commitment: "11",
  ownerCommitment: "1",
  slot: "identity" as const,
  kind: "budget" as const,
  amount: "900",
  amountPerPeriod: "100",
  periodDays: "30",
  eligibleFrom: String(start),
};

describe("buildShieldedClaimSchedule", () => {
  it("lists due periods with their dates, then every funded period that is not due yet", () => {
    const rows = buildShieldedClaimSchedule(claim(), budget);
    expect(rows.map((row) => row.kind)).toEqual([
      "claimable",
      "claimable",
      "claimable",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(rows[0]).toEqual({
      kind: "claimable",
      index: "3",
      period: 4n,
      dueAt: start + 4n * 30n * DAY,
    });
    expect(rows[3]).toEqual({ kind: "upcoming", period: 7n, dueAt: start + 7n * 30n * DAY });
    expect(rows[8]).toEqual({ kind: "upcoming", period: 12n, dueAt: start + 12n * 30n * DAY });
  });

  it("shortens a long schedule to its next periods and its last one", () => {
    const rows = buildShieldedClaimSchedule(
      claim({ periodIndices: [], futurePeriods: "40" }),
      budget,
    );
    expect(rows.map((row) => (row.kind === "gap" ? "gap" : String(row.period)))).toEqual([
      "7",
      "8",
      "9",
      "10",
      "11",
      "gap",
      "46",
    ]);
  });

  it("lists only the claimable periods when the schedule ahead is unknown", () => {
    const rows = buildShieldedClaimSchedule(
      claim({ nextDueAt: undefined, nextPeriodIndex: undefined, futurePeriods: undefined }),
      undefined,
    );
    expect(rows).toEqual([
      { kind: "claimable", index: "3", period: 4n, dueAt: undefined },
      { kind: "claimable", index: "4", period: 5n, dueAt: undefined },
      { kind: "claimable", index: "5", period: 6n, dueAt: undefined },
    ]);
  });
});

describe("ShieldedClaimComposer", () => {
  const wallet = {
    toBlock: 1,
    blockHash: "0x1",
    notes: [budget],
    policies: [],
    templates: [],
    claims: [claim()],
    parentVersions: [],
    children: [],
  } as ShieldedWalletSummary;

  function renderComposer(claimPeriods: string[], onClaimPeriodsChange = vi.fn()) {
    render(
      <I18nextProvider i18n={i18n}>
        <ShieldedClaimComposer
          titleId="claim"
          symbol="DEEP"
          decimals={0}
          busy={false}
          wallet={wallet}
          slot="identity"
          identityReady
          independentKeyReady={false}
          claimHandle="identity:budget"
          onClaimChange={vi.fn()}
          claimPeriods={claimPeriods}
          onClaimPeriodsChange={onClaimPeriodsChange}
        />
      </I18nextProvider>,
    );
    return onClaimPeriodsChange;
  }

  it("offers due periods as choices and shows the periods ahead as a schedule", () => {
    const onChange = renderComposer(["3", "4", "5"]);
    const periods = screen.getByRole("group", { name: "领取期次" });
    expect(within(periods).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(periods).getByText("暂未到期")).toBeTruthy();
    expect(within(periods).getByText("第 7 期 · 100 DEEP")).toBeTruthy();
    expect(within(periods).getByText("第 12 期 · 100 DEEP")).toBeTruthy();
    // Period 6 is index 5; unchecking it keeps the other two due periods.
    fireEvent.click(screen.getByRole("checkbox", { name: "第 6 期 · 100 DEEP" }));
    expect(onChange).toHaveBeenCalledWith(["3", "4"]);
  });

  it("names the budget by its remaining amount and its interval", () => {
    renderComposer([]);
    const budgets = screen.getByRole("group", { name: "选择预算" });
    expect(within(budgets).getByText("预算 1 · 剩余 900 DEEP")).toBeTruthy();
    expect(within(budgets).getByText("每 30 天")).toBeTruthy();
    expect((within(budgets).getByRole("radio") as HTMLInputElement).checked).toBe(true);
  });
});
