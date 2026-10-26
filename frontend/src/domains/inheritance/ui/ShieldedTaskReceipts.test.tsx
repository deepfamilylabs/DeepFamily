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
  it("totals the budget and shows its first and last periods", () => {
    withI18n(
      <ShieldedFundReceipt
        symbol="DEEP"
        decimals={0}
        walletName="家庭资格钱包"
        available={12_480n}
        rate={100n}
        periods={12n}
        days={30n}
        startsAt={startsAt}
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
    expect(within(receipt).getByText("家庭资格钱包")).toBeTruthy();
    expect(within(receipt).getByText("12,480 → 11,280 DEEP")).toBeTruthy();
    expect(within(receipt).getByRole("button", { name: "确认存入" })).toBeTruthy();
  });

  it("dashes an incomplete budget and leaves dates to the budget's own clock", () => {
    withI18n(
      <ShieldedFundReceipt
        symbol="DEEP"
        decimals={0}
        walletName="家庭资格钱包"
        rate={undefined}
        periods={3n}
        days={30n}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览存入" });
    expect(within(receipt).getByText("—", { selector: "span" })).toBeTruthy();
    expect(within(receipt).queryByText(/到期：/)).toBeNull();
  });
});

describe("ShieldedClaimReceipt", () => {
  it("shows the chosen period and the balance it adds", () => {
    withI18n(
      <ShieldedClaimReceipt
        symbol="DEEP"
        decimals={0}
        walletName="家庭资格钱包"
        available={300n}
        total={100n}
        status="已选 1 期 · 合计 100 DEEP"
        nextDue="下次到期：2026/11/6"
        segments={["selected", "upcoming"]}
        budgetName="预算 1 · 剩余 200 DEEP"
        periods={["4"]}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览领取" });
    expect(within(receipt).getByRole("status").textContent).toBe("已选 1 期 · 合计 100 DEEP");
    expect(within(receipt).getByText("下次到期：2026/11/6")).toBeTruthy();
    expect(within(receipt).getByText("4")).toBeTruthy();
    expect(within(receipt).getByText("300 → 400 DEEP")).toBeTruthy();
  });
});

describe("ShieldedSpendReceipt", () => {
  it("summarises the request until a review replaces it", () => {
    const view = withI18n(
      <ShieldedSpendReceipt
        spendAction="privateTransfer"
        symbol="DEEP"
        decimals={0}
        walletName="普通收款钱包"
        available={500n}
        amount={120n}
        recipient="dfrecv…"
        selection="所选余额：500 DEEP"
        action={<button type="button">预览转账</button>}
      />,
    );
    const receipt = screen.getByRole("complementary", { name: "预览转账" });
    expect(within(receipt).getByText("转给收款人")).toBeTruthy();
    expect(within(receipt).getByText("所选余额：500 DEEP")).toBeTruthy();
    expect(within(receipt).getByText("500 → 380 DEEP")).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ShieldedSpendReceipt
          spendAction="privateTransfer"
          symbol="DEEP"
          decimals={0}
          walletName="普通收款钱包"
          review={<p>review</p>}
          action={<button type="button">预览转账</button>}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "预览转账" })).toBeNull();
  });
});
