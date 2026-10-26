// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InheritancePage from "./InheritancePage";
const registry = "0x0000000000000000000000000000000000000006";
const pool = "0x0000000000000000000000000000000000000004";
const mocks = vi.hoisted(() => ({
  config: {
    rpcUrl: "http://localhost:8545",
    chainId: 31337,
    tokenAddress: "0x0000000000000000000000000000000000000003",
  },
  wallet: {
    address: "0x0000000000000000000000000000000000000005" as string | null,
    chainId: 31337,
    signer: {},
    switchOrAddChain: vi.fn(async () => true),
  },
  pins: undefined as unknown,
  factory: "0x0000000000000000000000000000000000000007",
  token: "0x0000000000000000000000000000000000000003",
  registry: "0x0000000000000000000000000000000000000006",
  translate: (key: string) => key,
  resolve: vi.fn(),
  panel: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../domains/config", () => ({ useConfig: () => mocks.config }));
vi.mock("../domains/wallet", () => ({
  useWallet: () => mocks.wallet,
  WalletConnectButton: () => <button type="button">connect</button>,
}));
vi.mock("../shared/zk/proofConfiguration", () => ({
  get configuredProofManifest() {
    return mocks.pins;
  },
}));
vi.mock("../shared/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/config/env")>()),
  getShieldedPoolFactoryAddress: () => mocks.factory,
  getLetterArchiveAddress: () => "",
}));
vi.mock("../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => ({
    getNetwork: async () => ({ chainId: BigInt(mocks.config.chainId) }),
    getBlockNumber: async () => 100,
  }),
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createShieldedPoolFactoryContract: () => ({
    RECEIVE_REGISTRY: async () => mocks.registry,
    DEEP_TOKEN: async () => mocks.token,
  }),
}));
vi.mock("../domains/inheritance/services/shieldedAssetRegistry", () => ({
  readShieldedAsset: async (address: string) => ({
    address,
    kind: "erc20",
    symbol: "DEEP",
    decimals: 18,
  }),
  resolveShieldedAssetPool: mocks.resolve,
}));
vi.mock("../domains/inheritance/ui/ShieldedInheritancePanel", () => ({
  ShieldedInheritancePanel: (props: { head: React.ReactNode }) => {
    mocks.panel(props);
    React.useEffect(() => () => mocks.unmount(), []);
    return <div data-testid="panel">{props.head}</div>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.rpcUrl = "http://localhost:8545";
  mocks.config.chainId = 31337;
  mocks.wallet.address = "0x0000000000000000000000000000000000000005";
  mocks.wallet.chainId = 31337;
  mocks.token = mocks.config.tokenAddress;
  mocks.registry = registry;
  mocks.pins = { version: 1, chainId: "31337", registryAddress: registry, circuits: {} };
  mocks.resolve.mockResolvedValue({ poolAddress: pool });
});
afterEach(cleanup);
describe("inheritance page", () => {
  it("asks for a connected wallet before reading any pool", () => {
    mocks.wallet.address = null;
    render(<InheritancePage />);
    expect(screen.getByText("inheritance.gate.walletTitle")).toBeTruthy();
    expect(screen.getByText("shielded.connectWallet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "connect" })).toBeTruthy();
    expect(mocks.panel).not.toHaveBeenCalled();
  });
  it("opens the panel only with matching pinned chain and registry", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("panel");
    expect(screen.getByRole("heading", { name: "shielded.title" })).toBeTruthy();
    expect(mocks.panel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modules: expect.objectContaining({
          assetSymbol: "DEEP",
          tokenDecimals: 18,
          context: expect.objectContaining({
            deployment: { chainId: 31337n, registryAddress: registry, poolAddress: pool },
            manifest: mocks.pins,
          }),
        }),
        signer: mocks.wallet.signer,
        account: mocks.wallet.address,
      }),
    );
  });
  it.each(["pins", "registry", "token"])(
    "rejects mismatched %s without opening a wallet",
    async (kind) => {
      if (kind === "pins")
        mocks.pins = { version: 1, chainId: "1", registryAddress: registry, circuits: {} };
      if (kind === "registry") mocks.registry = "0x0000000000000000000000000000000000000008";
      if (kind === "token") mocks.token = "0x0000000000000000000000000000000000000008";
      render(<InheritancePage />);
      expect((await screen.findByRole("alert")).textContent).toBe("shielded.configurationMismatch");
      expect(mocks.panel).not.toHaveBeenCalled();
    },
  );
  it("requires trusted proof configuration", async () => {
    mocks.pins = undefined;
    render(<InheritancePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("shielded.configurationMissing");
    expect(mocks.panel).not.toHaveBeenCalled();
  });
  it("offers to create the pool an asset does not have yet", async () => {
    mocks.resolve.mockResolvedValue(null);
    render(<InheritancePage />);
    expect(await screen.findByText("shielded.assets.noPool")).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.assets.create" })).toBeTruthy();
    expect(mocks.panel).not.toHaveBeenCalled();
  });
  it("keeps a wallet on another network out of the panel and offers to switch", async () => {
    mocks.wallet.chainId = 1;
    render(<InheritancePage />);
    const alert = await screen.findByText("shielded.wrongNetwork");
    expect(alert).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "inheritance.gate.switchNetwork" }));
    expect(mocks.wallet.switchOrAddChain).toHaveBeenCalledWith(31337);
    expect(mocks.panel).not.toHaveBeenCalled();
  });
  it("disposes the private panel when the RPC scope changes", async () => {
    const view = render(<InheritancePage />);
    await screen.findByTestId("panel");
    mocks.config.rpcUrl = "http://localhost:9545";
    view.rerender(<InheritancePage />);
    await waitFor(() => expect(mocks.unmount).toHaveBeenCalledOnce());
    await screen.findByTestId("panel");
  });
});
