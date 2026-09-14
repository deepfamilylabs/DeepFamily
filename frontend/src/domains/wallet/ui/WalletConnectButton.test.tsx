// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletConnectButton from "./WalletConnectButton";

const mocks = vi.hoisted(() => ({
  wallet: {
    address: "0x00000000000000000000000000000000000000aa" as string | null,
    balance: "1.23456",
    isConnecting: false,
    chainId: 1,
    connect: vi.fn(),
    disconnect: vi.fn(),
    setShowNetworkSelection: vi.fn(),
    switchOrAddChain: vi.fn(),
  },
  configChainId: 1,
  isSupportedChain: vi.fn(),
  getNetworkConfig: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  deepBalance: { status: "ready", amount: "113,777.000", symbol: "DEEP" } as any,
  deepBalanceCalls: [] as Array<[string | null, boolean]>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? _key;
      return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? "")) : text;
    },
  }),
}));

vi.mock("../context", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("../../config", () => ({
  useConfig: () => ({
    chainId: mocks.configChainId,
  }),
}));

vi.mock("../../../shared/config", () => ({
  isSupportedChain: (...args: any[]) => mocks.isSupportedChain(...args),
  getNetworkConfig: (...args: any[]) => mocks.getNetworkConfig(...args),
}));

// The real shared copy button; only the toast is observed.
vi.mock("../../../shared/ui", async () => {
  const { CopyIconButton } = await vi.importActual<any>("../../../shared/ui/CopyIconButton");
  return { CopyIconButton, useToast: () => mocks.toast };
});

vi.mock("./useDeepBalance", () => ({
  useDeepBalance: (address: string | null, enabled: boolean) => {
    mocks.deepBalanceCalls.push([address, enabled]);
    return mocks.deepBalance;
  },
}));

const ADDRESS = "0x327C00000000000000000000000000000000Ab12";

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  return screen.getByRole("menu", { name: "Account" });
}

describe("WalletConnectButton", () => {
  beforeEach(() => {
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.balance = "1.23456";
    mocks.wallet.isConnecting = false;
    mocks.wallet.chainId = 1;
    mocks.wallet.connect.mockReset();
    mocks.wallet.disconnect.mockReset();
    mocks.wallet.setShowNetworkSelection.mockReset();
    mocks.wallet.switchOrAddChain.mockReset();
    mocks.configChainId = 1;
    mocks.isSupportedChain.mockReset();
    mocks.isSupportedChain.mockReturnValue(true);
    mocks.getNetworkConfig.mockReset();
    mocks.getNetworkConfig.mockImplementation((chainId: number) => {
      if (chainId === 1030) return { name: "Conflux eSpace", nativeCurrency: { symbol: "CFX" } };
      if (chainId === 1)
        return {
          name: "Ethereum Mainnet",
          blockExplorer: "https://etherscan.io/",
          nativeCurrency: { symbol: "ETH" },
        };
      if (chainId === 10) return { name: "Optimism", nativeCurrency: { symbol: "ETH" } };
      return undefined;
    });
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
    mocks.deepBalance = { status: "ready", amount: "113,777.000", symbol: "DEEP" };
    mocks.deepBalanceCalls = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("formats balances with the connected network's native currency", () => {
    mocks.wallet.chainId = 1030;
    mocks.configChainId = 1030;
    const { rerender } = render(<WalletConnectButton />);

    expect(screen.getByText("1.235 CFX")).toBeTruthy();

    mocks.wallet.balance = "0.000000000000000123";
    rerender(<WalletConnectButton />);

    expect(screen.getByText("< 0.001 CFX")).toBeTruthy();

    mocks.wallet.balance = "1.23456";
    mocks.wallet.chainId = 1;
    mocks.configChainId = 1;
    rerender(<WalletConnectButton />);

    expect(screen.getByText("1.235 ETH")).toBeTruthy();

    mocks.wallet.chainId = 999;
    mocks.configChainId = 999;
    rerender(<WalletConnectButton />);

    expect(screen.getByText("1.235 NATIVE")).toBeTruthy();
  });

  it("is a round wallet icon on a phone, with no abbreviated address", () => {
    mocks.wallet.address = ADDRESS;
    render(<WalletConnectButton showBalance={false} />);

    const button = screen.getByRole("button", { name: "Account" });
    expect(button.getAttribute("title")).toBe(ADDRESS);
    expect(button.className).toContain("h-9 w-9");
    expect(button.querySelector("svg.lucide-wallet")?.getAttribute("class")).toContain("sm:hidden");

    // Only the 6+4 address, and only from sm up.
    expect(screen.queryByText("0x32…Ab12")).toBeNull();
    expect(screen.getByText("0x327C…Ab12").className).toContain("hidden");
    expect(screen.getByText("0x327C…Ab12").className).toContain("sm:inline");

    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("copies the full address with the shared copy button and says so in a toast", async () => {
    mocks.wallet.address = ADDRESS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WalletConnectButton showBalance={false} />);

    const menu = openMenu();
    expect(menu.textContent).toContain(ADDRESS);
    expect(menu.textContent).toContain("Ethereum Mainnet");

    const copy = within(menu).getByRole("button", { name: "Copy address" });
    // The project's CopyIconButton, not a one-off menu row.
    expect(copy.getAttribute("title")).toBe("Copy address");
    expect(copy.className).toContain("rounded-lg");
    expect(within(menu).queryByRole("menuitem", { name: /Copy/ })).toBeNull();

    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Copied"));
  });

  it("reports a failed copy the same way the rest of the app does", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    render(<WalletConnectButton showBalance={false} />);

    fireEvent.click(within(openMenu()).getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Failed to copy"));
  });

  it("lists the native and DEEP balances, reading DEEP only while the menu is open", () => {
    render(<WalletConnectButton showBalance={false} />);
    expect(mocks.deepBalanceCalls.every(([, enabled]) => enabled === false)).toBe(true);

    const menu = openMenu();
    expect(mocks.deepBalanceCalls[mocks.deepBalanceCalls.length - 1]).toEqual([
      "0x00000000000000000000000000000000000000aa",
      true,
    ]);

    const rows = within(menu).getAllByRole("definition");
    const terms = within(menu)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms).toEqual(["ETH", "DEEP"]);
    expect(rows.map((row) => row.textContent)).toEqual(["1.235", "113,777.000"]);
  });

  it("shows DEEP as pending while it loads and as a dash when it cannot be read", () => {
    mocks.deepBalance = { status: "loading" };
    const { rerender } = render(<WalletConnectButton showBalance={false} />);
    let menu = openMenu();
    expect(within(menu).getAllByRole("definition")[1].textContent).toBe("…");

    mocks.deepBalance = { status: "unavailable" };
    rerender(<WalletConnectButton showBalance={false} />);
    menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("definition")[1].textContent).toBe("—");
  });

  it("links the explorer and disconnects from the menu", () => {
    mocks.wallet.address = ADDRESS;
    render(<WalletConnectButton showBalance={false} />);

    openMenu();
    const explorer = screen.getByRole("menuitem", { name: "View on explorer" });
    expect(explorer.getAttribute("href")).toBe(`https://etherscan.io/address/${ADDRESS}`);
    expect(explorer.getAttribute("target")).toBe("_blank");

    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(mocks.wallet.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the explorer out when the network has none", () => {
    mocks.wallet.chainId = 1030;
    mocks.configChainId = 1030;
    render(<WalletConnectButton showBalance={false} />);

    openMenu();
    expect(screen.queryByRole("menuitem", { name: "View on explorer" })).toBeNull();
  });

  it("dismisses the menu on Escape and on a click outside it", () => {
    render(<WalletConnectButton showBalance={false} />);

    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("marks a wrong network and switches it from the menu", () => {
    mocks.wallet.chainId = 11155111;
    mocks.configChainId = 10;

    render(<WalletConnectButton showBalance={false} />);

    // Amber dot on a phone, warning icon from sm.
    const button = screen.getByRole("button", { name: "Account" });
    expect(button.querySelector(".bg-amber-500")).toBeTruthy();
    expect(screen.getByLabelText("Wrong Network").getAttribute("class")).toContain("sm:block");

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Switch to Optimism" }));

    expect(mocks.wallet.switchOrAddChain).toHaveBeenCalledWith(10);
    expect(mocks.wallet.setShowNetworkSelection).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers no network switch while on the configured network", () => {
    render(<WalletConnectButton showBalance={false} />);

    expect(screen.queryByLabelText("Wrong Network")).toBeNull();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /Switch/ })).toBeNull();
  });

  it("still asks to connect when no wallet is connected", () => {
    mocks.wallet.address = null;
    render(<WalletConnectButton />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(mocks.wallet.connect).toHaveBeenCalledTimes(1);
  });
});
