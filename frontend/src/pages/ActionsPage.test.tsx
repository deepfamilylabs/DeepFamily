// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ActionsPage from "./ActionsPage";

const mocks = vi.hoisted(() => ({
  address: null as string | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../domains/wallet/context", () => ({
  useWallet: () => ({
    address: mocks.address,
  }),
}));

vi.mock("../domains/wallet/ui", () => ({
  WalletConnectButton: ({ alwaysShowLabel: _alwaysShowLabel, ...props }: any) => (
    <button data-testid="wallet-connect-button" {...props}>
      Connect Wallet
    </button>
  ),
}));

vi.mock("../shared/ui", () => ({
  PageContainer: ({ children, className }: any) => (
    <div data-testid="page-container" data-class-name={className}>
      {children}
    </div>
  ),
}));

vi.mock("../domains/transactions/ui", () => ({
  AddVersionModal: ({ isOpen, onClose, onEndorse }: any) =>
    isOpen ? (
      <div data-testid="add-version-modal">
        <button onClick={() => onEndorse?.("0xadd", 3)}>handoff-to-endorse</button>
        <button onClick={onClose}>close-add-version</button>
      </div>
    ) : null,
  EndorseModal: ({ isOpen, onClose, onMintNFT, initialPersonHash, initialVersionIndex }: any) =>
    isOpen ? (
      <div data-testid="endorse-modal">
        <span data-testid="endorse-hash">{initialPersonHash ?? ""}</span>
        <span data-testid="endorse-version">{String(initialVersionIndex ?? "")}</span>
        <button onClick={() => onMintNFT?.("0xendorse", 5)}>handoff-to-mint</button>
        <button onClick={onClose}>close-endorse</button>
      </div>
    ) : null,
  MintNFTModal: ({ isOpen, onClose, onGoEndorse, initialPersonHash, initialVersionIndex }: any) =>
    isOpen ? (
      <div data-testid="mint-nft-modal">
        <span data-testid="mint-hash">{initialPersonHash ?? ""}</span>
        <span data-testid="mint-version">{String(initialVersionIndex ?? "")}</span>
        <button onClick={() => onGoEndorse?.("0xmint", 7)}>handoff-back-to-endorse</button>
        <button onClick={onClose}>close-mint</button>
      </div>
    ) : null,
}));

function renderActionsPage(initialEntry = "/actions") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/actions" element={<ActionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ActionsPage", () => {
  beforeEach(() => {
    mocks.address = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the wallet-required view when no wallet is connected", () => {
    renderActionsPage();

    expect(screen.getByText("Wallet Connection Required")).toBeTruthy();
    expect(screen.getByTestId("wallet-connect-button")).toBeTruthy();
    expect(screen.queryByText("Start Adding Version")).toBeNull();
  });

  it("opens the add-version modal and hands off to endorse within the page shell", async () => {
    mocks.address = "0x00000000000000000000000000000000000000aa";

    renderActionsPage();

    fireEvent.click(screen.getByText("Start Adding Version"));

    expect(screen.getByTestId("add-version-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("handoff-to-endorse"));

    await waitFor(() => expect(screen.getByTestId("endorse-modal")).toBeTruthy());
    expect(screen.queryByTestId("add-version-modal")).toBeNull();
    expect(screen.getByTestId("endorse-hash").textContent).toBe("0xadd");
    expect(screen.getByTestId("endorse-version").textContent).toBe("3");
  });

  it("auto-opens endorse from URL params and hands off to mint", async () => {
    mocks.address = "0x00000000000000000000000000000000000000aa";

    renderActionsPage("/actions?tab=endorse&open=true&hash=0xfeed&versionIndex=2");

    await waitFor(() => expect(screen.getByTestId("endorse-modal")).toBeTruthy());
    expect(screen.getByTestId("endorse-hash").textContent).toBe("0xfeed");
    expect(screen.getByTestId("endorse-version").textContent).toBe("2");

    fireEvent.click(screen.getByText("handoff-to-mint"));

    await waitFor(() => expect(screen.getByTestId("mint-nft-modal")).toBeTruthy());
    expect(screen.queryByTestId("endorse-modal")).toBeNull();
    expect(screen.getByTestId("mint-hash").textContent).toBe("0xendorse");
    expect(screen.getByTestId("mint-version").textContent).toBe("5");
  });
});
