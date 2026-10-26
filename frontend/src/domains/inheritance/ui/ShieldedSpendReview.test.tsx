// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { ShieldedSpendReview, type ShieldedSpendPlan } from "./ShieldedSpendReview";

const plan: ShieldedSpendPlan = {
  key: "plan-1",
  action: "unshield",
  amount: 120n,
  inputIndex: 2,
  inputAmount: 500n,
  recipientLabel: "0x1111…1111",
};

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

describe("ShieldedSpendReview", () => {
  it("shows the balance used, the amount sent and the change before asking to confirm", () => {
    const onConfirm = vi.fn(),
      onCancel = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ShieldedSpendReview
          plan={plan}
          decimals={0}
          symbol="DEEP"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("heading", { name: "提现预览" })).toBe(document.activeElement);
    expect(screen.getByText("0x1111…1111")).toBeTruthy();
    expect(screen.getByText("第 2 笔余额 · 500 DEEP")).toBeTruthy();
    expect(screen.getByText("380 DEEP")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "取消预览" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("replaces the decision with the progress of the transaction being sent", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ShieldedSpendReview
          plan={plan}
          decimals={0}
          symbol="DEEP"
          running
          stage="submitting"
          onConfirm={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("button", { name: "确认并继续" })).toBeNull();
    expect(screen.getByText("请在钱包中确认交易…").getAttribute("aria-current")).toBe("step");
  });
});
