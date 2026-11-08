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
    handle: "action:1", action, amount, slot: "independent",
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
  it("hides stop after the final transaction broadcasts and keeps it before submission", () => {
    const props = { ...reviewProps("3"), running: true };
    const { rerender } = renderReview({ ...props, stage: "submitting" });
    expect(screen.getByRole("button", { name: "停止后续交易" })).toBeTruthy();
    rerender(<I18nextProvider i18n={i18n}><ShieldedSpendReview {...props} stage="confirming" /></I18nextProvider>);
    expect(screen.queryByRole("button", { name: "停止后续交易" })).toBeNull();
    expect(screen.getByText("链上确认")).toBeTruthy();
  });

  it.each(["privateTransfer", "unshield"] as const)("shows the covering single note and its change for %s", (action) => {
    renderReview(reviewProps("3", action));
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).queryByText("允许使用：9 笔，共 31,333 DEEP")).toBeNull();
    expect(within(review).getByText("本次计划实际使用：1 笔，共 10 DEEP")).toBeTruthy();
    expect(within(review).queryByText("本步使用 1 笔，共 10 DEEP")).toBeNull();
    expect(within(review).getByText("第 3 笔余额 · 10 DEEP")).toBeTruthy();
    expect(within(review).queryByText("第 4 笔余额 · 1 DEEP")).toBeNull();
    expect(within(review).queryByText("第 8 笔余额 · 2 DEEP")).toBeNull();
    expect(within(review).getByText("共 1 笔交易")).toBeTruthy();
    expect(within(review).getByText("找零（仍归你所有）").parentElement!.textContent).toBe("找零（仍归你所有）7 DEEP");
    // The amount heads the review once and closes the final step once.
    expect(within(review).getAllByText("3 DEEP")).toHaveLength(1);
    expect(within(review).getByText("3", { selector: "span" })).toBeTruthy();
  });

  it.each(["privateTransfer", "unshield"] as const)("distinguishes 9 candidates from the one actual input for %s", (action) => {
    const props = reviewProps("1000", action);
    props.manualSelection = true;
    renderReview(props);
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("允许使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("本次计划实际使用：1 笔，共 1,000 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 9 笔余额 · 1,000 DEEP")).toBeTruthy();
    expect(within(review).queryByText("本步使用 1 笔，共 1,000 DEEP")).toBeNull();
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
    fireEvent.click(within(review).getByRole("button", { name: "确认交易计划" }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("keeps picker indices from all balances while counting only the permitted candidates", () => {
    const props = reviewProps();
    props.manualSelection = true;
    props.candidateCommitments = ["9"];
    renderReview(props);
    expect(screen.getByText("允许使用：1 笔，共 1,000 DEEP")).toBeTruthy();
    expect(screen.getByText("第 9 笔余额 · 1,000 DEEP")).toBeTruthy();
  });

  it("keeps the same actual inputs and change when manual selection reveals the permitted range", () => {
    const props = reviewProps("2000");
    const { rerender } = renderReview(props);
    expect(screen.queryByText("允许使用：9 笔，共 31,333 DEEP")).toBeNull();
    rerender(<I18nextProvider i18n={i18n}>
      <ShieldedSpendReview {...props} manualSelection />
    </I18nextProvider>);
    expect(screen.getByText("允许使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(screen.getByText("本次计划实际使用：1 笔，共 10,000 DEEP")).toBeTruthy();
    expect(screen.getByText("第 1 笔余额 · 10,000 DEEP")).toBeTruthy();
    expect(screen.getByText("找零（仍归你所有）").parentElement!.textContent).toBe("找零（仍归你所有）8,000 DEEP");
    expect(screen.queryByText("本步使用 1 笔，共 10,000 DEEP")).toBeNull();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("still rejects unavailable candidates when automatic mode hides their summary", () => {
    const props = reviewProps();
    props.candidateCommitments = ["unavailable"];
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const suppressExpectedError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", suppressExpectedError);
    try {
      expect(() => renderReview(props)).toThrow("Spend preview candidate is unavailable");
    } finally {
      window.removeEventListener("error", suppressExpectedError);
      errorOutput.mockRestore();
    }
  });

  it.each(["privateTransfer", "unshield"] as const)("displays the complete merge and final %s steps without exposing planned identifiers", (action) => {
    renderReview(reviewProps("31333", action));
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("本次计划实际使用：9 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("共 3 笔交易")).toBeTruthy();
    expect(within(review).getByText("第 1 / 3 步：合并余额")).toBeTruthy();
    expect(within(review).getByText("第 2 / 3 步：合并余额")).toBeTruthy();
    expect(within(review).getByText("本步使用 4 笔，共 31,330 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 2 步生成的余额 · 31,330 DEEP")).toBeTruthy();
    expect(within(review).getByText(`第 3 / 3 步：${action === "unshield" ? "提现" : "转账"}`)).toBeTruthy();
    expect(within(review).getByText("本步使用 4 笔，共 31,200 DEEP")).toBeTruthy();
    expect(within(review).getByText("本步使用 3 笔，共 31,333 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 1 步生成的余额 · 31,200 DEEP")).toBeTruthy();
    expect(within(review).getByText("第 4 笔余额 · 1 DEEP")).toBeTruthy();
    expect(within(review).getByText("本次确认适用于所示交易计划；每笔交易仍需在钱包中确认。计划变化时会重新核对。停止后续交易不会撤回已完成交易。")).toBeTruthy();
    expect(review.textContent).not.toContain("planned:");
    expect(review.textContent).not.toContain("witness");
  });

  it("uses the current first-step input amounts from the Worker preview", () => {
    const props = reviewProps("2000");
    props.preview.inputAmounts = ["10001"];
    props.preview.steps[0].outputAmounts = ["2000", "8001"];
    renderReview(props);
    expect(screen.getByText("第 1 笔余额 · 10,001 DEEP")).toBeTruthy();
    expect(screen.getByText("本次计划实际使用：1 笔，共 10,001 DEEP")).toBeTruthy();
    expect(screen.queryByText("本步使用 1 笔，共 10,001 DEEP")).toBeNull();
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
    expect(screen.queryByText("允许使用：2 笔，共 31,333 DEEP")).toBeNull();
    expect(screen.queryByText("第 10 笔余额 · 31,332 DEEP")).toBeNull();
    expect(screen.getByText("本次确认适用于所示交易计划；每笔交易仍需在钱包中确认。计划变化时会重新核对。停止后续交易不会撤回已完成交易。")).toBeTruthy();
  });

  it("moves keyboard focus to the heading for each new preview", () => {
    const props = reviewProps();
    const { rerender } = renderReview(props);
    const heading = screen.getByRole("heading", { name: "转账预览" });
    expect(document.activeElement).toBe(heading);
    screen.getByRole("button", { name: "确认交易计划" }).focus();
    rerender(<I18nextProvider i18n={i18n}>
      <ShieldedSpendReview {...props} preview={{ ...props.preview, handle: "action:2" }} />
    </I18nextProvider>);
    expect(document.activeElement).toBe(heading);
  });

  it("renders the same plan and explicit actions in English", async () => {
    await i18n.changeLanguage("en");
    renderReview(reviewProps("2000", "unshield"));
    expect(screen.getByRole("region", { name: "Balance use preview" })).toBeTruthy();
    expect(screen.queryByText("Permitted: 9 balances, 31,333 DEEP total")).toBeNull();
    expect(screen.getByText("Balances used by this plan: 1, 10,000 DEEP total")).toBeTruthy();
    expect(screen.getByText("Change (still yours)").parentElement!.textContent).toBe("Change (still yours)8,000 DEEP");
    expect(screen.getByRole("button", { name: "Confirm transaction plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel preview" })).toBeTruthy();
  });

  it("keeps one working marker inside the shared timeline while preserving the full running plan", () => {
    const props = { ...reviewProps("31333"), running: true, stage: "proving" as const };
    const { container, rerender } = renderReview(props);
    const review = screen.getByRole("region", { name: "余额使用预览" });
    expect(within(review).getByText("第 1 / 3 步：合并余额")).toBeTruthy();
    expect(within(review).getByText("第 3 / 3 步：转账")).toBeTruthy();
    expect(within(review).getAllByRole("status")).toHaveLength(1);
    const timeline = within(review).getByRole("status");
    expect(timeline.className).toContain("rounded-xl border border-hairline");
    expect(timeline.querySelectorAll(".animate-spin")).toHaveLength(1);
    // The plan heading and active step marker do not repeat the timeline spinner.
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
    expect(within(review).queryByRole("button", { name: "确认交易计划" })).toBeNull();
    fireEvent.click(within(review).getByRole("button", { name: "停止后续交易" }));
    expect(props.onCancel).toHaveBeenCalledOnce();

    rerender(<I18nextProvider i18n={i18n}>
      <ShieldedSpendReview {...props} stage="submitting" activity="awaiting" />
    </I18nextProvider>);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(within(review).getByText("请在钱包中确认交易…")).toBeTruthy();
    expect(within(review).getByRole("button", { name: "停止后续交易" })).toBeTruthy();
  });
});

describe("balance candidate picker", () => {
  it("shows the range restriction hint and individual balances only in manual mode", () => {
    const onChange = vi.fn();
    const onAutomaticChange = vi.fn();
    const props = {
      notes, selectedCommitments: notes.map((note) => note.commitment), onChange,
      decimals: 0, symbol: "DEEP", busy: false, onAutomaticChange,
    };
    const hint = i18n.t("shielded.walletKeys.valueCandidatesHint", { symbol: "DEEP" });
    const { rerender } = render(<I18nextProvider i18n={i18n}>
      <ShieldedValueNotePicker {...props} automatic />
    </I18nextProvider>);
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("shielded.walletKeys.manualValueSelection") }));
    expect(onAutomaticChange).toHaveBeenCalledWith(false);
    rerender(<I18nextProvider i18n={i18n}>
      <ShieldedValueNotePicker {...props} automatic={false} />
    </I18nextProvider>);
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(9);
    expect(onChange).not.toHaveBeenCalled();
  });

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
    expect(screen.queryByText("允许使用 8 笔 · 共 30,333 DEEP，实际使用见预览")).toBeNull();
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
