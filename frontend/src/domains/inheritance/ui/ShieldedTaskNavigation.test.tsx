// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { ShieldedTaskNavigation } from "./ShieldedTaskNavigation";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function renderNavigation(claimablePeriods: number, busy = false) {
  const onActionChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ShieldedTaskNavigation
        action="fund"
        busy={busy}
        symbol="DEEP"
        claimablePeriods={claimablePeriods}
        onActionChange={onActionChange}
      />
    </I18nextProvider>,
  );
  return { onActionChange, navigation: screen.getByRole("navigation", { name: "资产与预算" }) };
}

describe("ShieldedTaskNavigation", () => {
  it("lists every task under its group and marks the current one", () => {
    const { onActionChange, navigation } = renderNavigation(0);
    expect(
      within(navigation)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["存款", "转账", "提现", "存入", "领取"]);
    expect(within(navigation).getByRole("group", { name: "私密资产" })).toBeTruthy();
    const budgets = within(navigation).getByRole("group", { name: "子女预算" });
    expect(within(navigation).getAllByRole("group")).toHaveLength(2);
    expect(within(budgets).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "存入", "领取",
    ]);
    expect(within(budgets).getByRole("button", { name: "存入" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "存款" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(budgets).getByRole("button", { name: "领取" }));
    expect(onActionChange).toHaveBeenCalledWith("claim");
  });

  it("counts claimable periods on the claim task without changing its name", () => {
    renderNavigation(3);
    const claim = screen.getByRole("button", { name: "领取" });
    expect(claim.textContent).toBe("领取3");
    expect(document.getElementById(claim.getAttribute("aria-describedby")!)?.textContent).toBe(
      "领取期次 3",
    );
  });

  it("keeps every task disabled while an operation runs", () => {
    const { navigation } = renderNavigation(0, true);
    expect(
      within(navigation)
        .getAllByRole("button")
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
