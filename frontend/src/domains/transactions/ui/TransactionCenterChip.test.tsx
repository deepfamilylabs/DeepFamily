// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { TransactionCenterProvider, useTransactionCenter } from "../context/TransactionCenterContext";
import TransactionCenterChip from "./TransactionCenterChip";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function UnknownApproval() {
  const centre = useTransactionCenter();
  const upsert = centre!.upsert;
  useEffect(() => {
    upsert({
      id: "unknown", kind: "shielded", label: "代币授权", phase: "unknown",
      transactionHash: `0x${"ab".repeat(32)}`,
      error: { type: "transaction", message: i18n.t("transaction.unknown"), details: "" },
    });
  }, [upsert]);
  return <TransactionCenterChip />;
}

describe("transaction centre unknown outcome", () => {
  it("shows a neutral result without a pending spinner and allows clearing it", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <TransactionCenterProvider><UnknownApproval /></TransactionCenterProvider>
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "交易" });
    expect(within(dialog).getByText("代币授权")).toBeTruthy();
    expect(within(dialog).getByText("交易结果尚未确认")).toBeTruthy();
    expect(within(dialog).queryByText("交易失败")).toBeNull();
    expect(within(dialog).queryByText(zh.transaction.pendingDetails)).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "清除已完成" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
