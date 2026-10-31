// @vitest-environment jsdom
import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zh from "../../../locales/zh-CN/index.json";
import { ShieldedAssetOverview, type ShieldedOverviewWallet } from "./ShieldedAssetOverview";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { translation: zh } },
  });
});
afterEach(cleanup);

const wallets: ShieldedOverviewWallet[] = [
  { slot: "identity", unlocked: true, available: "1", budget: "0", current: true, checked: true },
  {
    slot: "independent",
    unlocked: false,
    available: "—",
    budget: "—",
    current: false,
    checked: false,
  },
];

type OverviewOptions = Partial<
  Pick<
    ComponentProps<typeof ShieldedAssetOverview>,
    "selectionDisabled" | "busy" | "independentKeyState" | "onReceiveCode" | "onReceiveBudget" | "onOpenIndependentKey" | "syncStatus"
  >
> & { initialWallets?: ShieldedOverviewWallet[] };

function renderOverview({
  initialWallets = wallets,
  selectionDisabled = false,
  busy = false,
  syncStatus,
  independentKeyState = "setup",
  onReceiveCode = vi.fn(),
  onReceiveBudget = vi.fn(),
  onOpenIndependentKey = vi.fn(),
}: OverviewOptions = {}) {
  const onSelectWallet = vi.fn();
  function Overview({ status = syncStatus }: { status?: OverviewOptions["syncStatus"] }) {
    const [currentWallets, setCurrentWallets] = useState(initialWallets);
    return (
      <ShieldedAssetOverview
        person={{
          name: "af",
          avatar: "A",
          hash: "0x01",
          hashLabel: "身份哈希",
          copyLabel: "复制身份哈希",
          onCopy: vi.fn(),
        }}
        symbol="DEEP"
        syncStatus={status}
        busy={busy}
        onRecover={vi.fn()}
        onLock={vi.fn()}
        wallets={currentWallets}
        selectionDisabled={selectionDisabled}
        onSelectWallet={(slot) => {
          onSelectWallet(slot);
          setCurrentWallets((current) =>
            current.map((wallet) => ({
              ...wallet,
              current: wallet.slot === slot,
              checked: wallet.slot === slot,
            })),
          );
        }}
        independentKeyState={independentKeyState}
        onReceiveCode={onReceiveCode}
        onReceiveBudget={onReceiveBudget}
        onOpenIndependentKey={onOpenIndependentKey}
        openSheet={null}
      />
    );
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Overview />
    </I18nextProvider>,
  );
  return {
    onSelectWallet,
    rerenderSyncStatus: (status: OverviewOptions["syncStatus"]) => view.rerender(
      <I18nextProvider i18n={i18n}>
        <Overview status={status} />
      </I18nextProvider>,
    ),
    identityTab: screen.getByRole("tab", { name: "身份凭据" }),
    independentTab: screen.getByRole("tab", { name: "独立密钥" }),
  };
}

/** Below sm only the card of the selected tab is displayed. */
function hiddenOnPhone(name: string) {
  return screen.getByRole("group", { name }).classList.contains("max-sm:hidden");
}

/** Exercise the native label-to-radio association; browser QA covers its stretched hit area. */
function cardSelectionLabel(name: string) {
  const radio = screen.getByRole("radio", { name }) as HTMLInputElement;
  const label = radio.labels?.item(0);
  expect(label).toBeTruthy();
  return label!;
}

describe("ShieldedAssetOverview synchronization", () => {
  it("provides a dedicated budget receiving entry without selecting another wallet", () => {
    const onReceiveBudget = vi.fn();
    const onReceiveCode = vi.fn();
    const { onSelectWallet } = renderOverview({ onReceiveBudget, onReceiveCode });
    fireEvent.click(screen.getByRole("button", { name: "身份凭据预算接收凭证" }));
    expect(onReceiveBudget).toHaveBeenCalledExactlyOnceWith("identity");
    expect(onReceiveCode).not.toHaveBeenCalled();
    expect(onSelectWallet).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "独立密钥预算接收凭证" })).toBeNull();
  });
  it("keeps synchronization feedback in the overview without replacing wallet cards", () => {
    const { rerenderSyncStatus } = renderOverview();
    const identityCard = screen.getByRole("group", { name: "身份凭据" });
    const available = within(identityCard).getByText("1");
    rerenderSyncStatus(<span role="status">正在同步公开状态</span>);
    const status = screen.getByText("正在同步公开状态");
    const overview = screen.getByRole("region", { name: "资产概览" });
    expect(overview.contains(status)).toBe(true);
    expect(identityCard.contains(status)).toBe(false);
    expect(screen.getByRole("group", { name: "身份凭据" })).toBe(identityCard);
    expect(within(identityCard).getByText("1")).toBe(available);

    rerenderSyncStatus(null);
    expect(screen.queryByText("正在同步公开状态")).toBeNull();
    expect(screen.getByRole("group", { name: "身份凭据" })).toBe(identityCard);
  });

  it("identifies initially loading balances without presenting an unverified zero", () => {
    renderOverview({
      initialWallets: wallets.map((wallet) => wallet.slot === "identity"
        ? { ...wallet, available: "—", budget: "—", balanceState: "loading" }
        : wallet),
    });
    const identityCard = screen.getByRole("group", { name: "身份凭据" });
    expect(within(identityCard).getAllByText("—")).toHaveLength(2);
    expect(within(identityCard).queryByText("DEEP")).toBeNull();
    expect(within(identityCard).getByRole("status").textContent).toBe("正在读取余额…");
    expect(identityCard.querySelector("dl")?.getAttribute("aria-busy")).toBe("true");
    expect(within(screen.getByRole("group", { name: "独立密钥" })).queryByText("正在读取余额…")).toBeNull();
  });

  it("marks refreshed balances as updating while preserving their verified amounts", () => {
    renderOverview({
      initialWallets: wallets.map((wallet) => wallet.slot === "identity"
        ? { ...wallet, available: "1.25", budget: "3", balanceState: "updating" }
        : wallet),
    });
    const identityCard = screen.getByRole("group", { name: "身份凭据" });
    expect(within(identityCard).getByText("1.25").closest("dd")?.textContent).toBe("1.25DEEP");
    expect(within(identityCard).getByText("3").closest("dd")?.textContent).toBe("3DEEP");
    expect(within(identityCard).getByRole("status").textContent).toBe("正在更新…");
    expect(identityCard.querySelector("dl")?.getAttribute("aria-busy")).toBe("true");
  });

  it("does not describe unrelated busy work as a balance refresh", () => {
    renderOverview({ busy: true });
    const identityCard = screen.getByRole("group", { name: "身份凭据" });
    expect(within(identityCard).queryByText("正在读取余额…")).toBeNull();
    expect(within(identityCard).queryByText("正在更新…")).toBeNull();
    expect(identityCard.querySelector("dl")?.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("ShieldedAssetOverview phone tabs", () => {
  it("switches the current wallet and visible card together with one tap", () => {
    const { onSelectWallet, identityTab, independentTab } = renderOverview();
    expect(screen.getByRole("tablist", { name: "私密钱包余额" })).toBeTruthy();
    expect(identityTab.getAttribute("aria-selected")).toBe("true");
    expect([hiddenOnPhone("身份凭据"), hiddenOnPhone("独立密钥")]).toEqual([false, true]);

    fireEvent.click(independentTab);
    expect(independentTab.getAttribute("aria-selected")).toBe("true");
    expect(identityTab.getAttribute("aria-selected")).toBe("false");
    expect([hiddenOnPhone("身份凭据"), hiddenOnPhone("独立密钥")]).toEqual([true, false]);
    expect(onSelectWallet).toHaveBeenCalledExactlyOnceWith("independent");
    expect((screen.getByRole("radio", { name: "独立密钥" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("keeps the current wallet unchanged when its selected tab is tapped again", () => {
    const { onSelectWallet, identityTab } = renderOverview();
    fireEvent.click(identityTab);
    expect(onSelectWallet).not.toHaveBeenCalled();
  });

  it("accepts a replacement independent key through the already current tab", () => {
    const { onSelectWallet, independentTab } = renderOverview({
      initialWallets: wallets.map((wallet) => ({
        ...wallet,
        current: wallet.slot === "independent",
        checked: false,
      })),
    });
    expect(independentTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(independentTab);
    expect(onSelectWallet).toHaveBeenCalledExactlyOnceWith("independent");
    fireEvent.click(independentTab);
    expect(onSelectWallet).toHaveBeenCalledTimes(1);
  });

  it("selects and focuses the wallet with arrow, Home and End keys", () => {
    const { onSelectWallet, identityTab, independentTab } = renderOverview();
    expect([identityTab.tabIndex, independentTab.tabIndex]).toEqual([0, -1]);
    identityTab.focus();
    fireEvent.keyDown(identityTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(independentTab);
    expect(independentTab.getAttribute("aria-selected")).toBe("true");
    expect([identityTab.tabIndex, independentTab.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(independentTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(identityTab);
    expect(identityTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(identityTab, { key: "End" });
    expect(document.activeElement).toBe(independentTab);
    expect(independentTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(independentTab, { key: "Home" });
    expect(document.activeElement).toBe(identityTab);
    expect(identityTab.getAttribute("aria-selected")).toBe("true");
    expect(onSelectWallet.mock.calls).toEqual([
      ["independent"],
      ["identity"],
      ["independent"],
      ["identity"],
    ]);
  });

  it("blocks pointer and keyboard wallet changes while selection is disabled", () => {
    const { onSelectWallet, identityTab, independentTab } = renderOverview({
      selectionDisabled: true,
    });
    expect((identityTab as HTMLButtonElement).disabled).toBe(true);
    expect((independentTab as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(independentTab);
    fireEvent.keyDown(identityTab, { key: "ArrowRight" });
    fireEvent.keyDown(identityTab, { key: "End" });
    expect(onSelectWallet).not.toHaveBeenCalled();
    expect(identityTab.getAttribute("aria-selected")).toBe("true");
    expect([hiddenOnPhone("身份凭据"), hiddenOnPhone("独立密钥")]).toEqual([false, true]);
  });
});

describe("ShieldedAssetOverview desktop cards", () => {
  it("selects through the card label once and leaves repeated clicks on the current card harmless", () => {
    const { onSelectWallet } = renderOverview();
    fireEvent.click(cardSelectionLabel("独立密钥"));
    expect(onSelectWallet).toHaveBeenCalledExactlyOnceWith("independent");
    expect((screen.getByRole("radio", { name: "独立密钥" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "身份凭据" }) as HTMLInputElement).checked).toBe(
      false,
    );

    fireEvent.click(cardSelectionLabel("独立密钥"));
    expect(onSelectWallet).toHaveBeenCalledTimes(1);
  });

  it("does not select a card through its label when wallet selection is disabled", () => {
    const { onSelectWallet } = renderOverview({ selectionDisabled: true });
    const independentRadio = screen.getByRole("radio", { name: "独立密钥" }) as HTMLInputElement;
    expect(independentRadio.disabled).toBe(true);
    fireEvent.click(cardSelectionLabel("独立密钥"));
    expect(onSelectWallet).not.toHaveBeenCalled();
    expect(independentRadio.checked).toBe(false);
    expect((screen.getByRole("radio", { name: "身份凭据" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("keeps the pinned key unaccepted until the current independent card is explicitly selected", () => {
    const fingerprint = "0x0123456789abcdef0123456789abcdef";
    const { onSelectWallet } = renderOverview({
      initialWallets: wallets.map((wallet) => ({
        ...wallet,
        current: wallet.slot === "independent",
        checked: false,
        ...(wallet.slot === "independent" ? { unlocked: true, fingerprint } : {}),
      })),
      independentKeyState: "ready",
    });
    const independentRadio = screen.getByRole("radio", { name: "独立密钥" }) as HTMLInputElement;
    expect(independentRadio.checked).toBe(false);
    expect(screen.getByTitle(fingerprint)).toBeTruthy();
    expect(onSelectWallet).not.toHaveBeenCalled();

    fireEvent.click(cardSelectionLabel("独立密钥"));
    expect(onSelectWallet).toHaveBeenCalledExactlyOnceWith("independent");
    expect(independentRadio.checked).toBe(true);
  });

  it.each([
    ["ready", "独立密钥收款码", "receiveCode", "independent"],
    ["ready", "密钥", "key", "backup"],
    ["setup", "解锁独立密钥", "key", "restore"],
    ["setup", "新建独立密钥", "key", "create"],
  ] as const)(
    "keeps the %s card's %s action independent from wallet selection",
    (keyState, buttonName, action, argument) => {
      const onReceiveCode = vi.fn();
      const onOpenIndependentKey = vi.fn();
      const { onSelectWallet } = renderOverview({
        independentKeyState: keyState,
        initialWallets: wallets.map((wallet) => ({
          ...wallet,
          unlocked: wallet.slot === "independent" ? keyState === "ready" : wallet.unlocked,
        })),
        onReceiveCode,
        onOpenIndependentKey,
      });
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      expect(onReceiveCode.mock.calls).toEqual(action === "receiveCode" ? [[argument]] : []);
      expect(onOpenIndependentKey.mock.calls).toEqual(action === "key" ? [[argument]] : []);
      expect(onSelectWallet).not.toHaveBeenCalled();
      expect((screen.getByRole("radio", { name: "身份凭据" }) as HTMLInputElement).checked).toBe(
        true,
      );
      expect((screen.getByRole("radio", { name: "独立密钥" }) as HTMLInputElement).checked).toBe(
        false,
      );
    },
  );
});

describe("ShieldedAssetOverview independent key availability", () => {
  it.each([false, true])(
    "keeps setup actions before the balances when the independent key is unlocked=%s",
    (unlocked) => {
      renderOverview({
        independentKeyState: "setup",
        initialWallets: wallets.map((wallet) => wallet.slot === "independent"
          ? { ...wallet, unlocked, fingerprint: unlocked ? "pending-key-fingerprint" : undefined }
          : wallet),
      });
      const card = screen.getByRole("group", { name: "独立密钥" });
      const balances = card.querySelector("dl");
      const actionLabels = ["解锁独立密钥", "新建独立密钥"];
      expect(balances).toBeTruthy();
      expect(within(card).queryByText("未解锁或待验证")).toBeNull();
      expect(within(card).queryByText("备份并验证独立密钥")).toBeNull();
      expect(
        within(card)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(actionLabels);
      for (const actionLabel of actionLabels) {
        const buttons = within(card).getAllByRole("button", { name: actionLabel });
        expect(buttons).toHaveLength(1);
        expect(
          buttons[0].compareDocumentPosition(balances!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    },
  );

  it.each([false, true])(
    "keeps receiving unavailable throughout setup when the independent key is unlocked=%s",
    (unlocked) => {
      const onReceiveCode = vi.fn();
      const onOpenIndependentKey = vi.fn();
      const { onSelectWallet } = renderOverview({
        independentKeyState: "setup",
        initialWallets: wallets.map((wallet) => wallet.slot === "independent"
          ? { ...wallet, unlocked, fingerprint: unlocked ? "pending-key-fingerprint" : undefined }
          : wallet),
        onReceiveCode,
        onOpenIndependentKey,
      });
      const card = screen.getByRole("group", { name: "独立密钥" });
      const unavailable = within(card).getByText(/暂不可用/);
      expect(within(card).queryByRole("button", { name: /收款码/ })).toBeNull();
      expect(within(card).queryByRole("button", { name: "密钥" })).toBeNull();
      expect(within(card).queryByRole("button", { name: "备份并验证独立密钥" })).toBeNull();
      expect(unavailable.closest("button,a,[role='button']")).toBeNull();
      expect(unavailable.closest("[title]")?.getAttribute("title")).toBeTruthy();
      fireEvent.click(unavailable);
      expect(onReceiveCode).not.toHaveBeenCalled();
      expect(onOpenIndependentKey).not.toHaveBeenCalled();
      expect(onSelectWallet).not.toHaveBeenCalled();
    },
  );

  it("offers receiving and key settings after the independent key becomes ready", () => {
    const onReceiveCode = vi.fn();
    const { onSelectWallet } = renderOverview({
      independentKeyState: "ready",
      initialWallets: wallets.map((wallet) => ({ ...wallet, unlocked: true })),
      onReceiveCode,
    });
    const card = screen.getByRole("group", { name: "独立密钥" });
    expect(within(card).queryByText(/暂不可用/)).toBeNull();
    expect(within(card).queryByText("未解锁或待验证")).toBeNull();
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["独立密钥收款码", "独立密钥预算接收凭证", "密钥"]);
    fireEvent.click(within(card).getByRole("button", { name: "独立密钥收款码" }));
    expect(onReceiveCode).toHaveBeenCalledExactlyOnceWith("independent");
    expect(onSelectWallet).not.toHaveBeenCalled();
  });
});
