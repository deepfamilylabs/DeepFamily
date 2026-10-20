// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { formatShieldedTimestamp } from "../model/shieldedBudgetPeriod";
import {
  ShieldedClaimReceipt,
  ShieldedFundReceipt,
  ShieldedSpendReceipt,
} from "./ShieldedTaskReceipts";

const DAY = 86_400n;
const startsAt = 1_792_371_600n;

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function withI18n(node: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("ShieldedFundReceipt", () => {
  it("totals the budget and shows its first and last periods with their estimated dates", () => {
    withI18n(
      <ShieldedFundReceipt
        symbol="DEEP"
        decimals={0}
        walletName="身份凭据"
        available={12_480n}
        rate={100n}
        periods={12n}
        days={30n}
        startsAt={startsAt}
        heirName="曹丕"
        versionLabel="第1版"
        entryLabel="私密（独立密钥）"
        action={<button type="button">确认存入</button>}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览存入" });
    expect(within(receipt).getByText("1,200")).toBeTruthy();
    expect(within(receipt).getByText("12 期 · 每 30 天 100 DEEP")).toBeTruthy();
    expect(within(receipt).getByText("第 1 期 · 100 DEEP")).toBeTruthy();
    expect(within(receipt).getByText("第 12 期 · 100 DEEP")).toBeTruthy();
    expect(
      within(receipt).getByText(`到期：${formatShieldedTimestamp(startsAt + 30n * DAY, "date")}`),
    ).toBeTruthy();
    expect(
      within(receipt).getByText(`到期：${formatShieldedTimestamp(startsAt + 360n * DAY, "date")}`),
    ).toBeTruthy();
    expect(within(receipt).getByText("曹丕")).toBeTruthy();
    expect(within(receipt).getByText("第1版")).toBeTruthy();
    expect(within(receipt).getByText("私密（独立密钥）")).toBeTruthy();
    expect(within(receipt).getByText("12,480 → 11,280 DEEP")).toBeTruthy();
    expect(within(receipt).getByRole("button", { name: "确认存入" })).toBeTruthy();
  });

  it("leaves dates to an existing arrangement's own clock and dashes an incomplete budget", () => {
    withI18n(
      <ShieldedFundReceipt
        symbol="DEEP"
        decimals={0}
        walletName="身份凭据"
        rate={undefined}
        periods={3n}
        days={30n}
        entryLabel="公开预算"
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览存入" });
    expect(within(receipt).getByText("—", { selector: "span" })).toBeTruthy();
    expect(within(receipt).queryByText(/到期：/)).toBeNull();
    expect(within(receipt).getAllByText("—", { selector: "dd" })).toHaveLength(3);
  });
});

describe("ShieldedClaimReceipt", () => {
  it("shows the chosen periods and the balance they add", () => {
    withI18n(
      <ShieldedClaimReceipt
        symbol="DEEP"
        decimals={0}
        walletName="身份凭据"
        available={300n}
        total={300n}
        status="已选 3 期 · 合计 300 DEEP"
        nextDue="下次到期：2026/11/6"
        segments={["selected", "selected", "selected", "upcoming"]}
        budgetName="预算 1 · 剩余 900 DEEP"
        periods={["4", "5", "6"]}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览领取" });
    expect(within(receipt).getByRole("status").textContent).toBe("已选 3 期 · 合计 300 DEEP");
    expect(within(receipt).getByText("下次到期：2026/11/6")).toBeTruthy();
    const periods = within(receipt).getByText("领取期次").parentElement!;
    expect(
      within(periods)
        .getAllByText(/^[456]$/)
        .map((chip) => chip.textContent),
    ).toEqual(["4", "5", "6"]);
    expect(within(receipt).getByText("300 → 600 DEEP")).toBeTruthy();
  });
});

describe("ShieldedSpendReceipt", () => {
  it("replaces the request summary with the plan once it is reviewed", () => {
    const { rerender } = withI18n(
      <ShieldedSpendReceipt
        spendAction="privateTransfer"
        symbol="DEEP"
        decimals={0}
        walletName="身份凭据"
        available={1_200n}
        amount={1_000n}
        recipient="曹植"
        selection="允许使用 10 笔 · 共 1000 DEEP，实际使用见预览"
        action={<button type="button">预览转账</button>}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览转账" });
    expect(within(receipt).getByText("转给收款人")).toBeTruthy();
    expect(within(receipt).getByText("曹植")).toBeTruthy();
    expect(within(receipt).getByText("1,200 → 200 DEEP")).toBeTruthy();
    rerender(
      <I18nextProvider i18n={i18n}>
        <ShieldedSpendReceipt
          spendAction="privateTransfer"
          symbol="DEEP"
          decimals={0}
          walletName="身份凭据"
          amount={1_000n}
          review={<p>plan</p>}
          action={<button type="button">预览转账</button>}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "预览转账" })).toBeNull();
  });
});
