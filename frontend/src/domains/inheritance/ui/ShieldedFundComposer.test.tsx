// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { createRef } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { ShieldedFundComposer } from "./ShieldedFundComposer";
import type { ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

function renderDays(periodDays: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <ShieldedFundComposer
        titleId="fund"
        symbol="DEEP"
        decimals={0}
        busy={false}
        wallet={null}
        identityReady
        heirs={[]}
        entry="public"
        onEntryChange={vi.fn()}
        policyHandle=""
        onPolicyChange={vi.fn()}
        rootVersion=""
        onRootVersionChange={vi.fn()}
        personHash=""
        onPersonHashChange={vi.fn()}
        amount="100"
        onAmountChange={vi.fn()}
        periodDays={periodDays}
        onPeriodDaysChange={vi.fn()}
        periods="3"
        onPeriodsChange={vi.fn()}
        code=""
        onCodeChange={vi.fn()}
        recipientMatches={false}
        recipientMismatch={false}
        recipientInputMethod="receiveCode"
        onRecipientInputMethodChange={vi.fn()}
        recipientFormRef={createRef<ShieldedRecipientCredentialsFormHandle>()}
        onGenerateRecipientCode={vi.fn()}
      />
    </I18nextProvider>,
  );
  return screen.getByRole("textbox", { name: "自定义天数" });
}

describe("custom budget period validation", () => {
  it.each(["", "0", "1.5", "4294967296"])(
    "explains invalid day count %s beside the field",
    (value) => {
      const input = renderDays(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const description = document.getElementById(input.getAttribute("aria-describedby")!);
      expect(description?.textContent).toBe("请输入有效的正整数天数。");
    },
  );

  it("accepts a whole custom interval without an error", () => {
    const input = renderDays("12");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });
});
