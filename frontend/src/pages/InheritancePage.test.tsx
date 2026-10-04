// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityMaterialV1Result } from "../shared/workers/cryptoWorkerClient";
import { useShieldedPageIdentitySession } from "../domains/inheritance";
import InheritancePage from "./InheritancePage";

const identity: IdentityMaterialV1Result = {
  identitySuiteId: 1,
  identity: {
    fullName: "Parent",
    gender: 1,
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 1,
    isBirthBC: false,
  },
  derivedSecretField: "123",
  nameField: "456",
  packedBirthGenderField: "789",
  suiteCommitment: "12",
  nameSecretCommitment: "34",
  identityCommitment: "777",
  personHash: "0x" + "00".repeat(32),
};

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
  factoryAddress: "0x0000000000000000000000000000000000000007",
  poolAddress: "0x0000000000000000000000000000000000000004",
  nativePoolAddress: "0x0000000000000000000000000000000000000008",
  factoryToken: "0x0000000000000000000000000000000000000003",
  assetPrecision: 18,
  readShieldedAsset: vi.fn(),
  resolveShieldedAssetPool: vi.fn(),
  createPool: vi.fn(),
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
  getShieldedPoolFactoryAddress: () => mocks.factoryAddress,
  getShieldedPoolFactoryDeploymentBlock: () => 10,
}));
vi.mock("../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => ({
    getNetwork: async () => ({ chainId: BigInt(mocks.config.chainId) }),
  }),
}));
vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => ({ lineageIndex: async () => mocks.familyIndex }),
  createShieldedPoolFactoryContract: () => ({
    DEEP_TOKEN: async () => mocks.factoryToken,
    createPool: mocks.createPool,
  }),
  createLineageIndexContract: () => ({}),
}));
vi.mock("../domains/inheritance/services/shieldedAssetRegistry", () => ({
  readShieldedAsset: mocks.readShieldedAsset,
  resolveShieldedAssetPool: mocks.resolveShieldedAssetPool,
}));
vi.mock("../domains/inheritance/ui/ShieldedInheritancePanel", () => ({
  ShieldedInheritancePanel: ({
    account,
    signer,
    modules,
    assetControls,
  }: {
    account: string;
    signer: unknown;
    assetControls?: React.ReactNode;
    modules: {
      assetKind: string;
      assetSymbol: string;
      poolAddress: string;
      tokenDecimals: number;
      poolDeploymentBlock: number;
      token: unknown;
    };
  }) => {
    const session = useShieldedPageIdentitySession();
    const [draft, setDraft] = React.useState("");
    React.useEffect(() => {
      mocks.panelMounted();
      return () => mocks.panelUnmounted();
    }, []);
    return (
      <div data-testid="shielded-panel">
        {assetControls}
        <span data-testid="shielded-session-state">{session.identity ? "unlocked" : "locked"}</span>
        <span data-testid="shielded-identity">{session.identity?.identityCommitment ?? ""}</span>
        <span data-testid="shielded-signer-state">{signer ? "ready" : "reconnecting"}</span>
        <span data-testid="shielded-account">{account}</span>
        <span data-testid="shielded-asset">
          {modules.assetKind}:{modules.assetSymbol}:{modules.tokenDecimals}
        </span>
        <span data-testid="shielded-pool">{modules.poolAddress}</span>
        <span data-testid="shielded-deployment-block">{modules.poolDeploymentBlock}</span>
        <span data-testid="shielded-token">{modules.token ? "erc20" : "native"}</span>
        <button type="button" onClick={() => session.unlock(identity)}>
          unlock-test-session
        </button>
        <input
          aria-label="private-workflow-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("InheritancePage private pool entry", () => {
  beforeEach(() => {
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.chainId = 31337;
    mocks.config.chainId = 31337;
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000002";
    mocks.wallet.signer = {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      getAddress: async () => mocks.wallet.address,
    };
    mocks.factoryAddress = "0x0000000000000000000000000000000000000007";
    mocks.factoryToken = mocks.config.tokenAddress;
    mocks.assetPrecision = 18;
    mocks.readShieldedAsset
      .mockReset()
      .mockImplementation(async (address: string, _provider: unknown, nativeSymbol: string) => ({
        address,
        kind: address === "0x0000000000000000000000000000000000000000" ? "native" : "erc20",
        symbol:
          address === mocks.config.tokenAddress
            ? "DEEP"
            : address === "0x0000000000000000000000000000000000000000"
              ? nativeSymbol
              : "TEST",
        decimals:
          address === mocks.config.tokenAddress ||
          address === "0x0000000000000000000000000000000000000000"
            ? 18
            : mocks.assetPrecision,
        token: address === "0x0000000000000000000000000000000000000000" ? null : {},
      }));
    mocks.resolveShieldedAssetPool
      .mockReset()
      .mockImplementation(async (_factory: unknown, asset: { kind: string }) => {
        if (mocks.poolIndex !== mocks.familyIndex)
          throw new Error("shielded.configurationMismatch");
        const poolAddress = asset.kind === "native" ? mocks.nativePoolAddress : mocks.poolAddress;
        return poolAddress
          ? { pool: {}, poolAddress, poolDeploymentBlock: asset.kind === "native" ? 5 : 12 }
          : null;
      });
    mocks.createPool
      .mockReset()
      .mockResolvedValue({ hash: "0x1234", wait: async () => ({ status: 1 }) });
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
    expect(screen.getByTestId("shielded-deployment-block").textContent).toBe("12");
  });

  it("does not show actions when the factory is missing", () => {
    mocks.factoryAddress = "";
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

  it("rejects a factory whose DEEP address differs from the family configuration", async () => {
    mocks.factoryToken = "0x0000000000000000000000000000000000000009";
    render(<InheritancePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("shielded.configurationMismatch"),
    );
    expect(mocks.resolveShieldedAssetPool).not.toHaveBeenCalled();
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
  });

  it("remounts pool-local drafts and preserves the unlocked identity when switching assets", async () => {
    render(<InheritancePage />);
    const original = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "old DEEP budget" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.assets.label" }), {
      target: { value: "0x0000000000000000000000000000000000000000" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.nativePoolAddress),
    );
    expect(screen.getByTestId("shielded-panel")).not.toBe(original);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
    expect(screen.getByTestId("shielded-token").textContent).toBe("native");
    expect(screen.getByTestId("shielded-deployment-block").textContent).toBe("5");
    expect(
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value,
    ).toBe("");
    expect(mocks.panelUnmounted).toHaveBeenCalledOnce();
  });

  it("keeps identity available while loading another pool and ignores that pool's late response after switching back", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    const pendingNative = deferred<{
      pool: unknown;
      poolAddress: string;
      poolDeploymentBlock: number;
    }>();
    const resolvePool = mocks.resolveShieldedAssetPool.getMockImplementation();
    mocks.resolveShieldedAssetPool.mockImplementation((factory, asset, ...rest) =>
      asset.kind === "native" ? pendingNative.promise : resolvePool!(factory, asset, ...rest),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.assets.label" }), {
      target: { value: "0x0000000000000000000000000000000000000000" },
    });
    await screen.findByText("shielded.loading");
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "shielded.assets.label" }), {
      target: { value: mocks.config.tokenAddress },
    });
    const restoredPanel = await screen.findByTestId("shielded-panel");
    expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    await act(async () => {
      pendingNative.resolve({
        pool: {},
        poolAddress: mocks.nativePoolAddress,
        poolDeploymentBlock: 5,
      });
    });
    expect(screen.getByTestId("shielded-panel")).toBe(restoredPanel);
    expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.poolAddress);
    expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
  });

  it.each(["missing", "failed"])(
    "retains identity when visiting a %s pool and then returning",
    async (result) => {
      render(<InheritancePage />);
      await screen.findByTestId("shielded-panel");
      fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
      const resolvePool = mocks.resolveShieldedAssetPool.getMockImplementation();
      mocks.resolveShieldedAssetPool.mockImplementation((factory, asset, ...rest) => {
        if (asset.kind === "native")
          return result === "missing"
            ? Promise.resolve(null)
            : Promise.reject(new Error("Pool temporarily unreachable"));
        return resolvePool!(factory, asset, ...rest);
      });
      fireEvent.change(screen.getByRole("combobox", { name: "shielded.assets.label" }), {
        target: { value: "0x0000000000000000000000000000000000000000" },
      });
      if (result === "missing") await screen.findByText("shielded.assets.noPool");
      else await screen.findByText("Pool temporarily unreachable");
      expect(screen.queryByTestId("shielded-panel")).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: "shielded.assets.label" }), {
        target: { value: mocks.config.tokenAddress },
      });
      await screen.findByTestId("shielded-panel");
      expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
      expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    },
  );

  it.each(["chain", "factory", "family"])(
    "locks identity when the protocol %s scope changes",
    async (changed) => {
      const { rerender } = render(<InheritancePage />);
      await screen.findByTestId("shielded-panel");
      fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
      if (changed === "chain") {
        mocks.config.chainId = 1;
        mocks.wallet.chainId = 1;
      } else if (changed === "factory") {
        mocks.factoryAddress = "0x0000000000000000000000000000000000000009";
      } else {
        mocks.config.contractAddress = "0x0000000000000000000000000000000000000020";
      }
      rerender(<InheritancePage />);
      await screen.findByTestId("shielded-panel");
      expect(screen.getByTestId("shielded-session-state").textContent).toBe("locked");
      expect(screen.getByTestId("shielded-identity").textContent).toBe("");
    },
  );

  it("keeps token-address entry collapsed until explicitly adding an asset", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    expect(screen.queryByRole("textbox", { name: "shielded.assets.tokenAddress" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    expect(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "shielded.assets.import" })).toBeTruthy();
  });

  it("creates a missing ERC-20 pool and reloads its canonical factory registration after confirmation", async () => {
    mocks.poolAddress = "";
    mocks.createPool.mockResolvedValue({
      hash: "0x1234",
      wait: async () => {
        mocks.poolAddress = "0x0000000000000000000000000000000000000020";
        return { status: 1 };
      },
    });
    render(<InheritancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "shielded.assets.create" }));
    await screen.findByTestId("shielded-panel");
    expect(mocks.createPool).toHaveBeenCalledWith(mocks.config.tokenAddress);
    expect(mocks.resolveShieldedAssetPool).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.poolAddress);
  });

  it("preserves the missing-pool state when wallet creation is refused", async () => {
    mocks.poolAddress = "";
    mocks.createPool.mockRejectedValue(new Error("User rejected pool creation"));
    render(<InheritancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "shielded.assets.create" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("User rejected pool creation"),
    );
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    expect(mocks.resolveShieldedAssetPool).toHaveBeenCalledOnce();
  });

  it.each(["wallet", "chain", "factory", "family", "page"])(
    "cancels pool creation if the %s changes during its network check",
    async (changed) => {
      mocks.poolAddress = "";
      const network = deferred<{ chainId: bigint }>();
      const getNetwork = vi.fn(() => network.promise);
      mocks.wallet.signer = {
        provider: { getNetwork },
        getAddress: async () => mocks.wallet.address,
      };
      const { rerender, unmount } = render(<InheritancePage />);
      fireEvent.click(await screen.findByRole("button", { name: "shielded.assets.create" }));
      await waitFor(() => expect(getNetwork).toHaveBeenCalledOnce());
      if (changed === "wallet") {
        mocks.wallet.address = "0x00000000000000000000000000000000000000bb";
      } else if (changed === "chain") {
        mocks.wallet.chainId = 1;
        mocks.config.chainId = 1;
      } else if (changed === "factory") {
        mocks.factoryAddress = "0x0000000000000000000000000000000000000009";
      } else if (changed === "family") {
        mocks.config.contractAddress = "0x0000000000000000000000000000000000000009";
      }
      if (changed === "page") unmount();
      else rerender(<InheritancePage />);
      await act(async () => {
        network.resolve({ chainId: 31337n });
      });
      expect(mocks.createPool).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      if (changed === "page") return;
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "shielded.assets.create" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
    },
  );

  it.each([1, 0])(
    "ignores an old pool creation receipt with status %s after changing the factory context",
    async (status) => {
      mocks.poolAddress = "";
      const confirmation = deferred<{ status: number }>();
      mocks.createPool.mockResolvedValue({ hash: "0x1234", wait: () => confirmation.promise });
      const { rerender } = render(<InheritancePage />);
      fireEvent.click(await screen.findByRole("button", { name: "shielded.assets.create" }));
      await waitFor(() => expect(mocks.createPool).toHaveBeenCalledOnce());
      mocks.factoryAddress = "0x0000000000000000000000000000000000000009";
      mocks.poolAddress = "0x0000000000000000000000000000000000000020";
      rerender(<InheritancePage />);
      const newPanel = await screen.findByTestId("shielded-panel");
      expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.poolAddress);
      const readsBefore = mocks.resolveShieldedAssetPool.mock.calls.length;
      await act(async () => {
        confirmation.resolve({ status });
      });
      expect(mocks.resolveShieldedAssetPool).toHaveBeenCalledTimes(readsBefore);
      expect(screen.getByTestId("shielded-panel")).toBe(newPanel);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("imports token metadata and passes its actual precision to the selected asset pool", async () => {
    mocks.assetPrecision = 6;
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    const address = "0x0000000000000000000000000000000000000030";
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" }), {
      target: { value: address },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.import" }));
    await waitFor(() =>
      expect(screen.getByTestId("shielded-asset").textContent).toBe("erc20:TEST:6"),
    );
    expect(
      (screen.getByRole("combobox", { name: "shielded.assets.label" }) as HTMLSelectElement).value,
    ).toBe(address);
    expect(mocks.config.tokenAddress).toBe("0x0000000000000000000000000000000000000003");
  });

  it("reports unusable imported precision without replacing the existing private workflow", async () => {
    render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    mocks.readShieldedAsset.mockRejectedValueOnce(
      new Error("Token decimals must be an integer between 0 and 36"),
    );
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" }), {
      target: { value: "0x0000000000000000000000000000000000000030" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.import" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Token decimals must be an integer between 0 and 36",
      ),
    );
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(
      (screen.getByRole("combobox", { name: "shielded.assets.label" }) as HTMLSelectElement).value,
    ).toBe(mocks.config.tokenAddress);
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
    expect(
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value,
    ).toBe("fund a child");
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
