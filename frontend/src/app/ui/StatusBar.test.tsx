// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import StatusBar from "./StatusBar";
import type { ChainStatus } from "./useChainStatus";

const mocks = vi.hoisted(() => ({
  status: {
    liveness: "live",
    blockNumber: 1234,
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
  } as ChainStatus,
  setShowNetworkSelection: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("./useChainStatus", () => ({
  useChainStatus: () => mocks.status,
}));

vi.mock("../../domains/wallet", () => ({
  useWallet: () => ({ setShowNetworkSelection: mocks.setShowNetworkSelection }),
}));

function renderBar() {
  return render(
    <MemoryRouter>
      <StatusBar />
    </MemoryRouter>,
  );
}

describe("StatusBar", () => {
  beforeEach(() => {
    mocks.status = {
      liveness: "live",
      blockNumber: 1234,
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
    };
    mocks.setShowNetworkSelection.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("reports the read RPC's liveness, network and head block", () => {
    renderBar();

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Localhost")).toBeTruthy();
    expect(screen.getByText("#1234")).toBeTruthy();
  });

  it("hides the head block until the first poll answers", () => {
    mocks.status = { ...mocks.status, liveness: "connecting", blockNumber: null };
    renderBar();

    expect(screen.getByText("Connecting")).toBeTruthy();
    expect(screen.queryByText(/^#/)).toBeNull();
  });

  it("names an RPC whose chain is not one of the presets", () => {
    mocks.status = { ...mocks.status, chainId: 0 };
    renderBar();

    expect(screen.getByText("Unknown network")).toBeTruthy();
  });

  it("opens network selection from the network chip", () => {
    renderBar();

    fireEvent.click(screen.getByTitle("Change network"));
    expect(mocks.setShowNetworkSelection).toHaveBeenCalledWith(true);
  });

  it("carries what the landing-page footer used to hold alone", () => {
    renderBar();

    expect(screen.getByText("footer.rights")).toBeTruthy();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(hrefs.some((href) => href?.includes("x.com"))).toBe(true);
    expect(hrefs.some((href) => href?.includes("t.me"))).toBe(true);
    expect(hrefs.some((href) => href?.includes("github.com"))).toBe(true);
  });

  it("stays out of the way below md, where the bottom nav owns that edge", () => {
    const { container } = renderBar();

    expect(container.firstElementChild?.className).toContain("hidden md:flex");
  });
});
