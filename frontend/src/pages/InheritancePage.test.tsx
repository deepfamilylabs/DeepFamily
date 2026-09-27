// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InheritancePage from "./InheritancePage";

const mocks = vi.hoisted(() => ({
  wallet: {
    address: "0x00000000000000000000000000000000000000aa" as string | null,
    chainId: 31337 as number | null,
    signer: {} as unknown,
    switchOrAddChain: vi.fn(async () => true),
  },
  config: {
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    contractAddress: "0x0000000000000000000000000000000000000002",
    tokenAddress: "0x0000000000000000000000000000000000000003",
  },
  poolAddress: "0x0000000000000000000000000000000000000004",
  registryAddress: "0x0000000000000000000000000000000000000005",
  familyIndex: "0x0000000000000000000000000000000000000006",
  poolIndex: "0x0000000000000000000000000000000000000006",
  poolToken: "0x0000000000000000000000000000000000000003",
  poolRegistry: "0x0000000000000000000000000000000000000005",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../domains/config", () => ({ useConfig: () => mocks.config }));
vi.mock("../domains/wallet", () => ({
  useWallet: () => mocks.wallet,
  WalletConnectButton: () => <button type="button">connect-wallet</button>,
}));
vi.mock("../shared/config/env", () => ({
  getShieldedPoolAddress: () => mocks.poolAddress,
  getShieldedKeyRegistryAddress: () => mocks.registryAddress,
}));
vi.mock("../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => ({
    getNetwork: async () => ({ chainId: 31337n }),
  }),
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({ lineageIndex: async () => mocks.familyIndex }),
  createDeepTokenContract: () => ({ decimals: async () => 18n }),
  createShieldedPoolContract: () => ({
    LINEAGE_INDEX: async () => mocks.poolIndex,
    TOKEN: async () => mocks.poolToken,
    KEY_REGISTRY: async () => mocks.poolRegistry,
  }),
  createShieldedKeyRegistryContract: () => ({
    LINEAGE_INDEX: async () => mocks.familyIndex,
  }),
  createLineageIndexContract: () => ({}),
}));
vi.mock("../domains/inheritance/ui/ShieldedInheritancePanel", () => ({
  ShieldedInheritancePanel: () => <div data-testid="shielded-panel">new private actions</div>,
}));

describe("InheritancePage private pool entry", () => {
  beforeEach(() => {
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.chainId = 31337;
    mocks.wallet.signer = {};
    mocks.poolAddress = "0x0000000000000000000000000000000000000004";
    mocks.registryAddress = "0x0000000000000000000000000000000000000005";
    mocks.poolIndex = mocks.familyIndex;
    mocks.poolToken = mocks.config.tokenAddress;
    mocks.poolRegistry = mocks.registryAddress;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks for a transaction wallet before opening the private pool", () => {
    mocks.wallet.address = null;
    render(<InheritancePage />);
    expect(screen.getByText("shielded.title")).toBeTruthy();
    expect(screen.getByRole("button", { name: "connect-wallet" })).toBeTruthy();
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
  });

  it("opens only the private pool after checking its deployment wiring", async () => {
    render(<InheritancePage />);
    expect(await screen.findByTestId("shielded-panel")).toBeTruthy();
  });

  it("does not show actions when the pool is missing", () => {
    mocks.poolAddress = "";
    render(<InheritancePage />);
    expect(screen.getByRole("alert").textContent).toContain("shielded.configurationMissing");
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
  });

  it("rejects a pool bound to another lineage index", async () => {
    mocks.poolIndex = "0x0000000000000000000000000000000000000007";
    render(<InheritancePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.configurationMismatch"),
    );
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
  });

  it("offers a network switch and hides the actions on the wrong chain", async () => {
    mocks.wallet.chainId = 1;
    render(<InheritancePage />);
    await screen.findByText("shielded.wrongNetwork");
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "inheritance.gate.switchNetwork" }));
    expect(mocks.wallet.switchOrAddChain).toHaveBeenCalledWith(31337);
  });
});
