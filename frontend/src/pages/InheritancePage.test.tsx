// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import InheritancePage from "./InheritancePage";

const mocks = vi.hoisted(() => ({
  wallet: {
    address: null as string | null,
    chainId: 31337 as number | null,
    signer: null as unknown,
    switchOrAddChain: vi.fn(async () => true),
  },
  modules: { status: "blocked", blocker: "loading" } as any,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => (typeof options === "string" ? options : key),
    i18n: { language: "en" },
  }),
}));

vi.mock("../domains/config", () => ({
  useConfig: () => ({
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    readerAddress: "0x0000000000000000000000000000000000000001",
    contractAddress: "0x0000000000000000000000000000000000000002",
    tokenAddress: "0x0000000000000000000000000000000000000003",
  }),
}));

vi.mock("../domains/wallet", () => ({
  useWallet: () => mocks.wallet,
  WalletConnectButton: () => <button type="button">connect-wallet</button>,
}));

vi.mock("../domains/person", () => ({
  PersonHashCalculator: React.forwardRef(function PersonHashCalculatorStub(
    _props: Record<string, unknown>,
    _ref: React.ForwardedRef<unknown>,
  ) {
    return <div data-testid="identity-form" />;
  }),
}));

vi.mock("../domains/inheritance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domains/inheritance")>()),
  useInheritanceModules: () => mocks.modules,
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function renderPage(path = "/inheritance") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/inheritance"
          element={
            <>
              <InheritancePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const readyModules = {
  status: "ready",
  modules: { chainId: 31337, recentReward: 2n * 10n ** 18n },
};

describe("InheritancePage", () => {
  beforeEach(() => {
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.chainId = 31337;
    mocks.wallet.signer = {};
    mocks.modules = readyModules;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks for a wallet first, below the notice about what the feature is", () => {
    mocks.wallet.address = null;
    renderPage();

    expect(screen.getByText("inheritance.notice.legal")).toBeTruthy();
    expect(screen.getByText("inheritance.gate.walletTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "connect-wallet" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens on set-up with the suggested per-period amount, and switches tabs by URL", () => {
    renderPage();

    expect(screen.getByText("inheritance.create.title")).toBeTruthy();
    // 1000 × a 2 DEEP reward × k = 1.
    expect(screen.getByDisplayValue("2000")).toBeTruthy();
    expect(screen.getAllByTestId("identity-form")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "inheritance.tabs.claim" }));
    expect(screen.getByText("inheritance.claim.title")).toBeTruthy();
    expect(screen.getAllByTestId("identity-form")).toHaveLength(2);
    expect(screen.getByTestId("location").textContent).toBe("?tab=claim");
  });

  it("offers a network switch and disables actions while the wallet is elsewhere", () => {
    mocks.wallet.chainId = 1;
    renderPage("/inheritance?tab=deposit");

    expect(screen.getByText("inheritance.gate.wrong-network")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "inheritance.gate.switchNetwork" }));
    expect(mocks.wallet.switchOrAddChain).toHaveBeenCalledWith(31337);

    fireEvent.change(screen.getByLabelText("inheritance.deposit.id"), { target: { value: "4" } });
    const lookup = screen.getByRole("button", { name: "inheritance.deposit.lookup" });
    expect((lookup as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses to act on an inheritance contract from another deployment", () => {
    mocks.modules = { status: "blocked", blocker: "not-wired" };
    renderPage();

    expect(screen.getByRole("alert").textContent).toContain("inheritance.gate.not-wired");
    const review = screen.getByRole("button", { name: "inheritance.create.review" });
    expect((review as HTMLButtonElement).disabled).toBe(true);
  });
});
