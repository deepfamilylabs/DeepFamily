// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { planShieldedValueSpend } from "@deepfamily/protocol-core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en/index.json";
import zh from "../../../locales/zh-CN/index.json";
import type { ShieldedActionPreview } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { ShieldedSpendReview, type ShieldedSpendReviewProps } from "./ShieldedSpendReview";
import {
  ShieldedValueNotePicker,
  ShieldedWalletActions,
  type ShieldedWalletActionsProps,
} from "./ShieldedWalletActions";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: "zh-CN", fallbackLng: "en", resources: {
    en: { translation: en }, "zh-CN": { translation: zh },
  } });
});
beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(cleanup);

const notes = [10000, 100, 10, 1, 20000, 200, 20, 2, 1000].map((amount, index) => ({
  commitment: String(index + 1), amount: String(amount),
}));

function spendPreview(amount: string, action: "privateTransfer" | "unshield"): ShieldedActionPreview {
  const plan = planShieldedValueSpend({ notes, candidateCommitments: notes.map((note) => note.commitment), amount });
  const first = plan.steps[0];
  return {
    handle: "action:1", action, amount, slot: "asset",
    inputs: first.inputCommitments,
    inputAmounts: first.inputCommitments.map((commitment) => notes.find((note) => note.commitment === commitment)!.amount),
    steps: plan.steps.map((step) => ({
      action: step.kind === "merge" ? "privateTransfer" : action,
      inputs: step.inputCommitments,
      outputAmounts: step.outputAmounts.map(String),
    })),
    // Withdrawals have a different prepared-output layout; the review must use the plan.
    outputAmounts: action === "unshield" ? [String(first.outputAmounts[1]), "0"] : first.outputAmounts.map(String),
  };
}

function reviewProps(amount = "1000", action: "privateTransfer" | "unshield" = "privateTransfer"): ShieldedSpendReviewProps {
  return {
    preview: spendPreview(amount, action), action, notes,
    candidateCommitments: notes.map((note) => note.commitment),
    decimals: 0, symbol: "DEEP", recipientLabel: "收款人甲",
    onConfirm: vi.fn(), onCancel: vi.fn(),
  };
}

function renderReview(props: ShieldedSpendReviewProps) {
  return render(<I18nextProvider i18n={i18n}><ShieldedSpendReview {...props} /></I18nextProvider>);
}

describe("ShieldedSpendReview", () => {
  it.each(["privateTransfer", "unshield"] as const)("shows the exact 1 + 2 selection in one %s without change", (action) => {
    renderReview(reviewProps("3", action));
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("允许使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("本次计划实际使用：2 笔，共 3 DEEP")).toBeTruthy();
    expect(within(review).getByText("本步使用 2 笔，共 3 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 4 笔余额 · 1 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 8 笔余额 · 2 DEEP")).toBeTruthy();
    expect(within(review).queryByText("第 3 笔余额 · 10 DEEP")).toBeNull();
    expect(within(review).getByText("共 1 笔交易；每步最多使用 8 笔余额，逐步确认。")).toBeTruthy();
    expect(within(review).getByText("找零（仍归你所有）").parentElement!.textContent).toBe("找零（仍归你所有）0 DEEP");
    // The amount heads the review once and closes the final step once.
    expect(within(review).getAllByText("3 DEEP")).toHaveLength(1);
    expect(within(review).getByText("3", { selector: "span" })).toBeTruthy();
  });

  it.each(["privateTransfer", "unshield"] as const)("distinguishes 9 candidates from the one actual input for %s", (action) => {
    const props = reviewProps("1000", action);
    renderReview(props);
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("允许使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("本次计划实际使用：1 笔，共 1,000 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 9 笔余额 · 1,000 DEEP")).toBeTruthy();
    expect(within(review).getByText("本步使用 1 笔，共 1,000 DEEP")).toBeTruthy();
    expect(within(review).queryByText("第 1 笔余额 · 10,000 DEEP")).toBeNull();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole("button", { name: "取消预览" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it.each(["privateTransfer", "unshield"] as const)("shows 2000 sent and 8000 change from the 10000 input for %s", (action) => {
    const props = reviewProps("2000", action);
    renderReview(props);
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("本次计划实际使用：1 笔，共 10,000 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 1 笔余额 · 10,000 DEEP")).toBeTruthy();
    const change = within(review).getByText("找零（仍归你所有）").parentElement!;
    expect(change.textContent).toBe("找零（仍归你所有）8,000 DEEP");
    expect(within(review).getAllByText("2,000 DEEP")).toHaveLength(1);
    expect(within(review).getByText("2,000", { selector: "span" })).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "确认并继续" }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("keeps picker indices from all balances while counting only the permitted candidates", () => {
    const props = reviewProps();
    props.candidateCommitments = ["9"];
    renderReview(props);
    expect(screen.getByText("允许使用：1 笔，共 1,000 DEEP")).toBeTruthy();
    expect(screen.getByText("第 9 笔余额 · 1,000 DEEP")).toBeTruthy();
  });

  it.each(["privateTransfer", "unshield"] as const)("displays the complete merge and final %s steps without exposing planned identifiers", (action) => {
    renderReview(reviewProps("31333", action));
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("本次计划实际使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("共 2 笔交易；每步最多使用 8 笔余额，逐步确认。")).toBeTruthy();
    expect(within(review).getByText("第 1 / 2 步：合并余额")).toBeTruthy();
    expect(within(review).getByText(`第 2 / 2 步：${action === "unshield" ? "提现" : "转账"}`)).toBeTruthy();
    expect(within(review).getByText("本步使用 8 笔，共 31,332 DEEP")).toBeTruthy();
    expect(within(review).getByText("本步使用 2 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 1 步生成的余额 · 31,332 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 4 笔余额 · 1 DEEP")).toBeTruthy();
    expect(within(review).getByText("确认仅执行下一步。取消会停止后续步骤，已完成的交易不会撤回。")).toBeTruthy();
    expect(review.textContent).not.toContain("planned:");
    expect(review.textContent).not.toContain("witness");
  });

  it("uses the current first-step input amounts from the Worker preview", () => {
    const props = reviewProps("2000");
    props.preview.inputAmounts = ["10001"];
    props.preview.steps[0].outputAmounts = ["2000", "8001"];
    renderReview(props);
    expect(screen.getByText("第 1 笔余额 · 10,001 DEEP")).toBeTruthy();
    expect(screen.getByText("本步使用 1 笔，共 10,001 DEEP")).toBeTruthy();
  });

  it("labels confirmed merge outputs and preserves remaining original indices in the next preview", () => {
    const props = reviewProps("31333");
    const mergedCommitment = "100";
    props.notes = [...notes, { commitment: mergedCommitment, amount: "31332" }];
    props.generatedCommitments = [mergedCommitment];
    props.candidateCommitments = ["4", mergedCommitment];
    props.preview = {
      ...props.preview,
      inputs: [mergedCommitment, "4"],
      inputAmounts: ["31332", "1"],
      steps: [{ action: "privateTransfer", inputs: [mergedCommitment, "4"], outputAmounts: ["31333", "0"] }],
    };
    renderReview(props);
    expect(screen.getByText("已合并余额 · 31,332 DEEP")).toBeTruthy();
    expect(screen.getByText("第 4 笔余额 · 1 DEEP")).toBeTruthy();
    expect(screen.getByText("本次计划实际使用：2 笔，共 31,333 DEEP")).toBeTruthy();
    expect(screen.getByText("允许使用：2 笔，共 31,333 DEEP")).toBeTruthy();
    expect(screen.queryByText("第 10 笔余额 · 31,332 DEEP")).toBeNull();
    expect(screen.getByText("确认仅执行下一步。取消会停止后续步骤，已完成的交易不会撤回。")).toBeTruthy();
  });

  it("moves keyboard focus to the heading for each new preview", () => {
    const props = reviewProps();
    const { rerender } = renderReview(props);
    const heading = screen.getByRole("heading", { name: "转账预览" });
    expect(document.activeElement).toBe(heading);
    screen.getByRole("button", { name: "确认并继续" }).focus();
    rerender(<I18nextProvider i18n={i18n}>
      <ShieldedSpendReview {...props} preview={{ ...props.preview, handle: "action:2" }} />
    </I18nextProvider>);
    expect(document.activeElement).toBe(heading);
  });

  it("renders the same plan and explicit actions in English", async () => {
    await i18n.changeLanguage("en");
    renderReview(reviewProps("2000", "unshield"));
    expect(screen.getByRole("region", { name: "Balance use preview" })).toBeTruthy();
    expect(screen.getByText("Permitted: 9 balances, 31,333 DEEP total")).toBeTruthy();
    expect(screen.getByText("Balances used by this plan: 1, 10,000 DEEP total")).toBeTruthy();
    expect(screen.getByText("Change (still yours)").parentElement!.textContent).toBe("Change (still yours)8,000 DEEP");
    expect(screen.getByRole("button", { name: "Confirm and continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel preview" })).toBeTruthy();
  });
});

describe("balance candidate picker", () => {
  it("permits a ninth candidate and labels its total as permission rather than actual use", () => {
    const onChange = vi.fn();
    render(<I18nextProvider i18n={i18n}>
      <ShieldedValueNotePicker notes={notes} selectedCommitments={notes.slice(0, 8).map((note) => note.commitment)}
        onChange={onChange} decimals={0} symbol="DEEP" busy={false} />
    </I18nextProvider>);
    const ninth = screen.getByRole("checkbox", { name: "第 9 笔余额 · 1,000 DEEP" }) as HTMLInputElement;
    expect(ninth.disabled).toBe(false);
    fireEvent.click(ninth);
    expect(onChange).toHaveBeenCalledWith(notes.map((note) => note.commitment));
    expect(screen.getByText("选择允许使用的余额")).toBeTruthy();
    expect(screen.getByText("允许使用 8 笔 · 共 30,333 DEEP，实际使用见预览")).toBeTruthy();
  });
});

describe("wallet spend action", () => {
  const propsFor = (): ShieldedWalletActionsProps => ({
    titleId: "withdrawal-title", action: "unshield", symbol: "DEEP", decimals: 0, busy: false,
    amount: "1000", onAmountChange: vi.fn(),
    recipient: { method: "receiveCode", onMethodChange: vi.fn(), code: "", onCodeChange: vi.fn(),
      credentialsFormRef: createRef(), onGenerateCode: vi.fn(), verified: false,
      needsConfirmation: false, confirmed: false, onConfirmedChange: vi.fn() },
    withdrawalRecipient: "0x123", onWithdrawalRecipientChange: vi.fn(), values: notes,
    selectedCommitments: ["9"], onSelectedCommitmentsChange: vi.fn(),
  });
  it("edits a withdrawal and leaves its confirmation to the receipt beside it", () => {
    const props = propsFor();
    render(<I18nextProvider i18n={i18n}><ShieldedWalletActions {...props} /></I18nextProvider>);
    expect(screen.getByRole("heading", { name: "提现至普通钱包" }).id).toBe("withdrawal-title");
    fireEvent.change(screen.getByLabelText("金额（DEEP）"), { target: { value: "1500" } });
    expect(props.onAmountChange).toHaveBeenCalledWith("1500");
    fireEvent.change(screen.getByLabelText("收款钱包地址"), { target: { value: "0x456" } });
    expect(props.onWithdrawalRecipientChange).toHaveBeenCalledWith("0x456");
    expect((screen.getByRole("checkbox", { name: "第 9 笔余额 · 1,000 DEEP" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
