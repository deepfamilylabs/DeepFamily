// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { PrivateLettersPanel } from "./PrivateLettersPanel";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function renderPanel(props: Partial<Parameters<typeof PrivateLettersPanel>[0]> = {}) {
  const onSend = vi.fn(async () => true),
    onRefresh = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <PrivateLettersPanel
        mode="write"
        lettersConfigured
        disabled={false}
        canSend
        letters={[]}
        onRefresh={onRefresh}
        onSend={onSend}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onSend, onRefresh };
}

describe("private letters panel", () => {
  it("sends the letter to the trimmed code and clears it once registered", async () => {
    const { onSend } = renderPanel();
    const send = screen.getByRole("button", { name: "加密并寄出" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("收件人收款码"), { target: { value: " dfrecv1 " } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Hello" } });
    await act(async () => fireEvent.click(send));
    expect(onSend).toHaveBeenCalledWith("dfrecv1", "Hello");
    expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the draft when the letter was not registered", async () => {
    const onSend = vi.fn(async () => false);
    renderPanel({ onSend });
    fireEvent.change(screen.getByLabelText("收件人收款码"), { target: { value: "dfrecv1" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Hello" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "加密并寄出" })));
    expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("lists recovered letters with their registration time and refreshes on request", () => {
    const { onRefresh } = renderPanel({
      mode: "inbox",
      letters: [
        {
          messageId: "1",
          sender: "0x0000000000000000000000000000000000000009",
          body: "家书正文",
          transactionHash: "0x01",
          registeredAt: "1700000000",
        },
      ],
    });
    expect(screen.getByText("家书正文")).toBeTruthy();
    expect(screen.getByText(new Date(1_700_000_000_000).toLocaleString())).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新信箱" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("explains an empty inbox and a network without a letter archive", () => {
    renderPanel({ mode: "inbox", lettersConfigured: false });
    expect(screen.getByText("当前网络尚未配置私密家书合约。")).toBeTruthy();
    expect(screen.getByText("当前解锁的钱包尚未解密出家书。")).toBeTruthy();
  });
});
