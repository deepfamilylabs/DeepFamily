// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { createRef } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { listShieldedFundingHeirs } from "../model/shieldedFundingOptions";
import { ShieldedFundComposer, type ShieldedFundComposerProps } from "./ShieldedFundComposer";
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

function renderDays(periodDays: string, overrides: Partial<ShieldedFundComposerProps> = {}) {
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
        parentChoice="self"
        onParentChoiceChange={vi.fn()}
        otherParentInput=""
        onOtherParentInputChange={vi.fn()}
        onOtherParentLookup={vi.fn()}
        otherParentLoaded={false}
        parentVersions={[]}
        policies={[]}
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
        findRecipientIdentities={vi.fn()}
        onGenerateRecipientCode={vi.fn()}
        {...overrides}
      />
    </I18nextProvider>,
  );
  return screen.getByRole("textbox", { name: "自定义天数" });
}

describe("public funding", () => {
  it("keeps an eligible child selectable when the payer uses a different suite", () => {
    const child = { personHash: "0x" + "12".repeat(32), identitySuiteId: 2, rootVersionIndex: 1, eligible: true };
    const wallet = {
      notes: [], policies: [], templates: [], claims: [], parentVersions: [1], children: [child], toBlock: 1, blockHash: "hash",
    };
    const heirs = listShieldedFundingHeirs(wallet, "1", new Map([[child.personHash, "Child"]]));
    renderDays("12", { personHash: child.personHash, heirs, rootVersion: "1", wallet, parentVersions: [1] });
    expect((screen.getByRole("radio", { name: /Child/ }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("qualifying parent", () => {
  const wallet = {
    notes: [], policies: [], templates: [], claims: [], parentVersions: [], children: [], toBlock: 1, blockHash: "hash",
  };

  it("asks for a lookup before another person's versions and children", () => {
    const onLookup = vi.fn();
    renderDays("12", { wallet, parentChoice: "other", otherParentInput: "", onOtherParentLookup: onLookup });
    expect((screen.getByRole("radio", { name: "其他人物" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("父母人物哈希")).toBeTruthy();
    expect((screen.getByRole("button", { name: "查找" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先查找资格父母。")).toBeTruthy();
    expect(screen.queryByText("本人在当前网络没有人物版本，可改选其他人物。")).toBeNull();
  });

  it("offers the looked-up parent's versions and shows a lookup error beside the hash", () => {
    renderDays("12", {
      wallet,
      parentChoice: "other",
      otherParentInput: "0x" + "34".repeat(32),
      otherParentLoaded: true,
      otherParentError: "未找到该人物，请核对人物哈希。",
      parentLabel: "Grandparent",
      parentVersions: [3, 1],
    });
    const input = screen.getByLabelText("父母人物哈希");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(
      "未找到该人物，请核对人物哈希。",
    );
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Grandparent");
    expect(screen.getByText("请先选择父母人物版本。")).toBeTruthy();
  });
});

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
