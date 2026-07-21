// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletConnectButton from "./WalletConnectButton";

const mocks = vi.hoisted(() => ({
  wallet: {
    address: "0x00000000000000000000000000000000000000aa",
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
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
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
      if (chainId === 1030) return { nativeCurrency: { symbol: "CFX" } };
      if (chainId === 1) return { nativeCurrency: { symbol: "ETH" } };
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("formats balances with the connected network's native currency", () => {
    mocks.wallet.chainId = 1030;
    const { rerender } = render(<WalletConnectButton />);

    expect(screen.getByText("1.235 CFX")).toBeTruthy();

    mocks.wallet.balance = "0.000000000000000123";
    rerender(<WalletConnectButton />);

    expect(screen.getByText("< 0.001 CFX")).toBeTruthy();

    mocks.wallet.balance = "1.23456";
    mocks.wallet.chainId = 1;
    rerender(<WalletConnectButton />);

    expect(screen.getByText("1.235 ETH")).toBeTruthy();

    mocks.wallet.chainId = 999;
    rerender(<WalletConnectButton />);

    expect(screen.getByText("1.235 NATIVE")).toBeTruthy();
  });

  it("routes wrong-network action to switchOrAddChain when config chain is supported", () => {
    mocks.wallet.chainId = 11155111;
    mocks.configChainId = 10;

    render(<WalletConnectButton />);

    fireEvent.click(screen.getByTitle("Click to switch network"));

    expect(mocks.wallet.switchOrAddChain).toHaveBeenCalledWith(10);
    expect(mocks.wallet.setShowNetworkSelection).not.toHaveBeenCalled();
  });
});
