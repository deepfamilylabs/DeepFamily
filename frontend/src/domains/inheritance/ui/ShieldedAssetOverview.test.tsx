// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { ShieldedAssetOverview, type ShieldedOverviewWallet } from "./ShieldedAssetOverview";

const wallet: ShieldedOverviewWallet = {
  family: true,
  title: "家庭资格钱包",
  available: "1,200",
  budget: "300",
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

function renderOverview(props: Partial<Parameters<typeof ShieldedAssetOverview>[0]> = {}) {
  const handlers = {
    onRecover: vi.fn(),
    onLock: vi.fn(),
    onReceiveCode: vi.fn(),
    onOpenKeys: vi.fn(),
    onCopy: vi.fn(),
  };
  render(
    <I18nextProvider i18n={i18n}>
      <ShieldedAssetOverview
        person={{
          name: "曹操",
          avatar: "曹操",
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          hashLabel: "身份哈希",
          copyLabel: "复制身份哈希",
          onCopy: handlers.onCopy,
        }}
        symbol="DEEP"
        busy={false}
        onRecover={handlers.onRecover}
        onLock={handlers.onLock}
        wallet={wallet}
        onReceiveCode={handlers.onReceiveCode}
        onOpenKeys={handlers.onOpenKeys}
        openSheet={null}
        {...props}
      />
    </I18nextProvider>,
  );
  return handlers;
}

describe("ShieldedAssetOverview", () => {
  it("names the person, shows both balances and opens the wallet's sheets", () => {
    const handlers = renderOverview();
    const overview = screen.getByRole("region", { name: "资产概览" });
    expect(overview).toBeTruthy();
    expect(screen.getByText("曹操", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("身份哈希")).toBeTruthy();
    expect(screen.getByText("1,200")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByRole("group", { name: "家庭资格钱包" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制身份哈希" }));
    expect(handlers.onCopy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "收款码" }));
    expect(handlers.onReceiveCode).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "密钥" }));
    expect(handlers.onOpenKeys).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(handlers.onRecover).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(handlers.onLock).toHaveBeenCalledOnce();
  });

  it("leaves the hash out for an ordinary wallet and marks a refresh in progress", () => {
    renderOverview({
      person: { name: "普通收款钱包" },
      wallet: { ...wallet, family: false, title: "普通收款钱包", balanceState: "updating" },
      openSheet: "receiveCode",
    });
    expect(screen.queryByText("身份哈希")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("正在更新…");
    expect(screen.getByRole("button", { name: "收款码" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
