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
  health: {
    reader: "ok",
    root: "ok",
    problem: null as string | null,
    isChecking: false,
  },
  networkName: "Localhost",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolating like the real `t`, so a message that fails to name its
    // network cannot pass as one that does.
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? "")) : text;
    },
  }),
}));

vi.mock("./useChainStatus", () => ({
  useChainStatus: () => mocks.status,
}));

vi.mock("../../domains/config", () => ({
  RpcNetworkList: () => <div data-testid="rpc-network-list" />,
  useDataSourceHealth: () => mocks.health,
  useNetworkName: () => mocks.networkName,
  DATA_SOURCE_PROBLEM_TEXT: {
    rootMissing: {
      labelKey: "dataSource.rootMissing",
      labelFallback: "Root not found",
      detailKey: "dataSource.rootMissingDetail",
      detailFallback: "This root person is not recorded on this network",
    },
  },
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
    mocks.health = { reader: "ok", root: "ok", problem: null, isChecking: false };
    mocks.networkName = "Localhost";
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

  it("shows whatever the shared resolver calls the chain, presets or not", () => {
    mocks.networkName = "My Local";
    renderBar();

    expect(screen.getByText("My Local")).toBeTruthy();
  });

  it("switches the read RPC from the same chip that reports it", () => {
    renderBar();
    const chip = screen.getByTitle("Change network");
    expect(screen.queryByTestId("rpc-network-list")).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByTestId("rpc-network-list")).toBeTruthy();
    expect(chip.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(chip);
    expect(screen.queryByTestId("rpc-network-list")).toBeNull();
  });

  it("dismisses the network menu on Escape and on a click outside it", () => {
    renderBar();
    const chip = screen.getByTitle("Change network");

    fireEvent.click(chip);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("rpc-network-list")).toBeNull();

    fireEvent.click(chip);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("rpc-network-list")).toBeNull();
  });

  it("names what is missing behind a live RPC, in place of the liveness word", () => {
    mocks.health = { reader: "ok", root: "missing", problem: "rootMissing", isChecking: false };
    const { container } = renderBar();

    expect(screen.getByText("Root not found")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
    // The tooltip names the chain, so it reads on its own.
    // The chip already names the chain right beside it.
    expect(screen.getByTitle("This root person is not recorded on this network")).toBeTruthy();
    expect(container.querySelector(".bg-warning")).toBeTruthy();
    expect(container.querySelector(".bg-success")).toBeNull();
  });

  it("lets an unreachable RPC speak for itself rather than blaming the data", () => {
    mocks.status = { ...mocks.status, liveness: "offline" };
    mocks.health = {
      reader: "unreachable",
      root: "idle",
      problem: "readerUnreachable",
      isChecking: false,
    };
    renderBar();

    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("says nothing about the data source while the answer is still coming", () => {
    mocks.health = { reader: "ok", root: "checking", problem: "rootMissing", isChecking: true };
    renderBar();

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("Root not found")).toBeNull();
  });

  it("carries what the landing-page footer used to hold alone", () => {
    renderBar();

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
