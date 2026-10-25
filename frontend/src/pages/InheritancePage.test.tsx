// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InheritancePage from "./InheritancePage";
const registry = "0x0000000000000000000000000000000000000006";
const pool = "0x0000000000000000000000000000000000000004";
const mocks = vi.hoisted(() => ({
  config: { rpcUrl: "http://localhost:8545", chainId: 31337, tokenAddress: "0x0000000000000000000000000000000000000003" },
  wallet: { address: "0x0000000000000000000000000000000000000005", chainId: 31337, signer: {} },
  pins: undefined as unknown, factory: "0x0000000000000000000000000000000000000007", token: "0x0000000000000000000000000000000000000003", registry: "0x0000000000000000000000000000000000000006",
  translate: (key: string) => key, resolve: vi.fn(), workspace: vi.fn(), unmount: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../domains/config", () => ({ useConfig: () => mocks.config }));
vi.mock("../domains/wallet", () => ({ useWallet: () => mocks.wallet }));
vi.mock("../shared/zk/proofConfiguration", () => ({ get configuredProofManifest() { return mocks.pins; } }));
vi.mock("../shared/config/env", () => ({ getShieldedPoolFactoryAddress: () => mocks.factory, getLetterArchiveAddress: () => "" }));
vi.mock("../shared/clients/providerRegistry", () => ({ getReadonlyProvider: () => ({ getNetwork: async () => ({ chainId: BigInt(mocks.config.chainId) }), getBlockNumber: async () => 100 }) }));
vi.mock("../shared/clients/contractFactory", () => ({ createShieldedPoolFactoryContract: () => ({ RECEIVE_REGISTRY: async () => mocks.registry, DEEP_TOKEN: async () => mocks.token }) }));
vi.mock("../domains/inheritance/services/shieldedAssetRegistry", () => ({ readShieldedAsset: async () => ({ symbol: "DEEP", decimals: 18 }), resolveShieldedAssetPool: mocks.resolve }));
vi.mock("../domains/inheritance/ui/InheritanceWorkspace", () => ({ InheritanceWorkspace: (props: unknown) => { mocks.workspace(props); React.useEffect(() => () => mocks.unmount(), []); return <div data-testid="workspace" />; } }));
vi.mock("../shared/ui", () => ({ PageHead: ({ title }: { title: string }) => <h1>{title}</h1> }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.config.rpcUrl = "http://localhost:8545"; mocks.config.chainId = 31337; mocks.wallet.chainId = 31337;
  mocks.token = mocks.config.tokenAddress; mocks.registry = registry;
  mocks.pins = { version: 1, chainId: "31337", registryAddress: registry, circuits: {} };
  mocks.resolve.mockResolvedValue({ poolAddress: pool });
});
afterEach(cleanup);
describe("canonical receiving page", () => {
  it("opens the workspace only with matching pinned chain and registry", async () => {
    render(<InheritancePage />); await screen.findByTestId("workspace");
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ context: expect.objectContaining({ deployment: { chainId: 31337n, registryAddress: registry, poolAddress: pool } }), signer: mocks.wallet.signer }));
  });
  it.each(["pins", "registry", "token"])("rejects mismatched %s without opening a wallet", async kind => {
    if (kind === "pins") mocks.pins = { version: 1, chainId: "1", registryAddress: registry, circuits: {} };
    if (kind === "registry") mocks.registry = "0x0000000000000000000000000000000000000008";
    if (kind === "token") mocks.token = "0x0000000000000000000000000000000000000008";
    render(<InheritancePage />); expect((await screen.findByRole("alert")).textContent).toBe("shielded.configurationMismatch");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("requires trusted proof configuration", async () => {
    mocks.pins = undefined; render(<InheritancePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("shielded.configurationMissing"); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("requires a verified pool for the selected asset", async () => {
    mocks.resolve.mockResolvedValue(null); render(<InheritancePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("shielded.assets.noPool"); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("disables transactions from a wallet on another network", async () => {
    mocks.wallet.chainId = 1; render(<InheritancePage />); await screen.findByTestId("workspace");
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ signer: null }));
  });
  it("disposes the private workspace when the RPC scope changes", async () => {
    const view = render(<InheritancePage />); await screen.findByTestId("workspace");
    mocks.config.rpcUrl = "http://localhost:9545"; view.rerender(<InheritancePage />);
    await waitFor(() => expect(mocks.unmount).toHaveBeenCalledOnce()); await screen.findByTestId("workspace");
  });
});
