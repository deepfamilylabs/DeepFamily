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
  familyIndex: "0x0000000000000000000000000000000000000006",
  poolIndex: "0x0000000000000000000000000000000000000006",
  poolToken: "0x0000000000000000000000000000000000000003",
  panelMounted: vi.fn(),
  panelUnmounted: vi.fn(),
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
  }),
  createLineageIndexContract: () => ({}),
}));
vi.mock("../domains/inheritance/ui/ShieldedInheritancePanel", () => ({
  ShieldedInheritancePanel: ({ account, signer }: { account: string; signer: unknown }) => {
    const [unlocked, setUnlocked] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    React.useEffect(() => {
      mocks.panelMounted();
      return () => mocks.panelUnmounted();
    }, []);
    return (
      <div data-testid="shielded-panel">
        <span data-testid="shielded-session-state">{unlocked ? "unlocked" : "locked"}</span>
        <span data-testid="shielded-signer-state">{signer ? "ready" : "reconnecting"}</span>
        <span data-testid="shielded-account">{account}</span>
        <button type="button" onClick={() => setUnlocked(true)}>unlock-test-session</button>
        <input
          aria-label="private-workflow-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));

describe("InheritancePage private pool entry", () => {
  beforeEach(() => {
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.chainId = 31337;
    mocks.wallet.signer = {};
    mocks.poolAddress = "0x0000000000000000000000000000000000000004";
    mocks.poolIndex = mocks.familyIndex;
    mocks.poolToken = mocks.config.tokenAddress;
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

  it("keeps the unlocked workflow mounted through account and temporary signer changes", async () => {
    const { rerender } = render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "fund a child" },
    });

    mocks.wallet.signer = null;
    rerender(<InheritancePage />);
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(screen.getByTestId("shielded-signer-state").textContent).toBe("reconnecting");

    mocks.wallet.address = "0x00000000000000000000000000000000000000bb";
    rerender(<InheritancePage />);
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(screen.getByTestId("shielded-account").textContent).toBe(mocks.wallet.address);

    mocks.wallet.signer = {};
    rerender(<InheritancePage />);
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(screen.getByTestId("shielded-signer-state").textContent).toBe("ready");
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect((screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value).toBe("fund a child");
    expect(mocks.panelMounted).toHaveBeenCalledTimes(1);
    expect(mocks.panelUnmounted).not.toHaveBeenCalled();
  });

  it("releases the workflow on disconnect and starts locked after reconnecting", async () => {
    const { rerender } = render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));

    mocks.wallet.address = null;
    mocks.wallet.signer = null;
    rerender(<InheritancePage />);
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    expect(mocks.panelUnmounted).toHaveBeenCalledTimes(1);

    mocks.wallet.address = "0x00000000000000000000000000000000000000bb";
    mocks.wallet.signer = {};
    rerender(<InheritancePage />);
    expect(screen.getByTestId("shielded-panel")).not.toBe(panel);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("locked");
    expect(mocks.panelMounted).toHaveBeenCalledTimes(2);
  });

  it("releases the workflow on a wrong-network switch and starts locked on return", async () => {
    const { rerender } = render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));

    mocks.wallet.chainId = 1;
    rerender(<InheritancePage />);
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    expect(mocks.panelUnmounted).toHaveBeenCalledTimes(1);

    mocks.wallet.chainId = 31337;
    rerender(<InheritancePage />);
    expect(screen.getByTestId("shielded-panel")).not.toBe(panel);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("locked");
    expect(mocks.panelMounted).toHaveBeenCalledTimes(2);
  });
});
