// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShieldedPublicIdentity } from "../shared/workers/shieldedAssetWorkerTypes";
import {
  useShieldedPageIdentitySession,
  type ShieldedPanelNavigation,
} from "../domains/inheritance";
import InheritancePage from "./InheritancePage";

const identity: ShieldedPublicIdentity = {
  handle: "identity:1",
  identitySuiteId: 1,
  identity: { fullName: "Test Person" },
  identityCommitment: "777",
  personHash: "0x" + "00".repeat(32),
};
const otherIdentity: ShieldedPublicIdentity = {
  ...identity,
  identity: { fullName: "Other Person" },
  identityCommitment: "888",
  personHash: "0x" + "01".repeat(32),
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
  assetPrecision: 18 as number | null,
  readShieldedAsset: vi.fn(),
  resolveShieldedAssetPool: vi.fn(),
  createPool: vi.fn(),
  familyIndex: "0x0000000000000000000000000000000000000006",
  poolIndex: "0x0000000000000000000000000000000000000006",
  poolToken: "0x0000000000000000000000000000000000000003",
  panelMounted: vi.fn(),
  panelUnmounted: vi.fn(),
  language: "",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (mocks.language ? `${key}:${mocks.language}` : key),
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
  getPrivateLetterArchiveAddress: () => "",
  getPrivateLetterArchiveDeploymentBlock: () => 0,
}));
vi.mock("../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => ({
    getNetwork: async () => ({ chainId: BigInt(mocks.config.chainId) }),
    getBlockNumber: async () => 20,
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
    head,
    assetControls,
    navigation,
    onNavigationChange,
  }: {
    account: string;
    signer: unknown;
    head?: React.ReactNode;
    assetControls?: React.ReactNode;
    navigation?: ShieldedPanelNavigation;
    onNavigationChange?: (navigation: ShieldedPanelNavigation) => void;
    modules: {
      assetKind: string;
      assetSymbol: string;
      poolAddress: string;
      tokenDecimals: number | null;
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
        {head}
        {assetControls}
        <span data-testid="shielded-session-state">{session.identity ? "unlocked" : "locked"}</span>
        <span data-testid="shielded-identity">{session.identity?.identityCommitment ?? ""}</span>
        <span data-testid="shielded-independent-key">{session.independentKey?.keyFingerprint ?? ""}</span>
        <span data-testid="shielded-navigation">
          {navigation ? `${navigation.slot}:${navigation.action}` : ""}
        </span>
        <button type="button" onClick={() => onNavigationChange?.({
          slot: "independent",
          action: "claim",
        })}>
          select-independent-claim
        </button>
        <span data-testid="shielded-signer-state">{signer ? "ready" : "reconnecting"}</span>
        <span data-testid="shielded-account">{account}</span>
        <span data-testid="shielded-asset">
          {modules.assetKind}:{modules.assetSymbol}:{modules.tokenDecimals ?? "raw"}
        </span>
        <span data-testid="shielded-pool">{modules.poolAddress}</span>
        <span data-testid="shielded-deployment-block">{modules.poolDeploymentBlock}</span>
        <span data-testid="shielded-token">{modules.token ? "erc20" : "native"}</span>
        <button type="button" onClick={() => session.unlock(identity)}>
          unlock-test-session
        </button>
        <button type="button" onClick={() => session.unlock(otherIdentity)}>
          unlock-other-test-session
        </button>
        <button type="button" onClick={session.lock}>
          lock-test-session
        </button>
        <button type="button" onClick={() => session.setBusy(true)}>
          start-busy-test
        </button>
        <button type="button" onClick={() => session.setBusy(false)}>
          stop-busy-test
        </button>
        <button
          type="button"
          onClick={() =>
            session.update({
              credentials: { handle: "credentials:test" },
              identity: null,
              independentKey: {
                ownerCommitment: "123",
                viewingKey: `0x${"12".repeat(32)}`,
                keyFingerprint: `0x${"34".repeat(32)}`,
                rootSource: "random",
                recoveryVerified: true,
                recoveryPath: "shieldedKey",
              },
            })
          }
        >
          unlock-independent-key-without-identity-proof
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

function assetSelector(label = "shielded.assets.label") {
  return screen.getByLabelText(label, { selector: "button" }) as HTMLButtonElement;
}

function chooseAsset(name: string) {
  fireEvent.click(assetSelector());
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("InheritancePage private pool entry", () => {
  beforeEach(() => {
    mocks.language = "";
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.wallet.chainId = 31337;
    mocks.config.chainId = 31337;
    mocks.config.rpcUrl = "http://127.0.0.1:8545";
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
    const panel = await screen.findByTestId("shielded-panel");
    expect(screen.getByTestId("shielded-deployment-block").textContent).toBe("12");
    // The panel places the page heading in whichever column it uses.
    expect(within(panel).getByRole("heading", { name: "shielded.title" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "shielded.title" })).toHaveLength(1);
  });

  it("disables asset changes while a secret operation runs", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    const selector = () => assetSelector();
    expect(selector().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "start-busy-test" }));
    expect(selector().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "shielded.assets.add" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "stop-busy-test" }));
    expect(selector().disabled).toBe(false);
  });

  it("retains the current pool and draft when an import finishes during a secret operation", async () => {
    const address = "0x0000000000000000000000000000000000000030";
    const pendingImport = deferred<unknown>();
    const readAsset = mocks.readShieldedAsset.getMockImplementation()!;
    mocks.readShieldedAsset.mockImplementation((assetAddress, ...args) =>
      assetAddress === address ? pendingImport.promise : readAsset(assetAddress, ...args),
    );
    render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "fund a child" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" }), {
      target: { value: address },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.import" }));
    await waitFor(() => expect(mocks.readShieldedAsset).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "start-busy-test" }));
    await act(async () => {
      pendingImport.resolve(await readAsset(address, null, "Native"));
    });

    const selector = assetSelector();
    expect(selector.disabled).toBe(true);
    expect(selector.textContent).toBe("DEEP");
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(mocks.panelUnmounted).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value,
    ).toBe("fund a child");
    expect(mocks.resolveShieldedAssetPool).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "stop-busy-test" }));
    expect(selector.textContent).toBe("DEEP");
    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    // The import that finished during the operation is offered, but was never selected.
    chooseAsset("TEST · 0x0000…0030");
    await waitFor(() => expect(assetSelector().textContent).toBe("TEST · 0x0000…0030"));
    await screen.findByTestId("shielded-panel");
    expect(screen.getByTestId("shielded-asset").textContent).toBe("erc20:TEST:18");
  });

  it("keeps a busy workflow and draft mounted when the language changes", async () => {
    const { rerender } = render(<InheritancePage />);
    const panel = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "fund a child" },
    });
    fireEvent.click(screen.getByRole("button", { name: "start-busy-test" }));

    mocks.language = "zh";
    rerender(<InheritancePage />);
    await act(async () => {});

    expect(screen.getByTestId("shielded-panel")).toBe(panel);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect(
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value,
    ).toBe("fund a child");
    expect(assetSelector("shielded.assets.label:zh").disabled).toBe(true);
    expect(mocks.panelMounted).toHaveBeenCalledOnce();
    expect(mocks.panelUnmounted).not.toHaveBeenCalled();
    expect(mocks.readShieldedAsset).toHaveBeenCalledOnce();
    expect(mocks.resolveShieldedAssetPool).toHaveBeenCalledOnce();
  });

  it.each(["configurationMissing", "configurationMismatch", "unreachable"])(
    "translates %s in the current language without reloading protocol modules",
    async (error) => {
      if (error === "configurationMissing") mocks.factoryAddress = "";
      else if (error === "configurationMismatch")
        mocks.factoryToken = "0x0000000000000000000000000000000000000030";
      else mocks.readShieldedAsset.mockRejectedValueOnce(null);
      const { rerender } = render(<InheritancePage />);
      await screen.findByText(`shielded.${error}`);
      const readsBefore = mocks.readShieldedAsset.mock.calls.length;

      mocks.language = "zh";
      rerender(<InheritancePage />);
      await screen.findByText(`shielded.${error}:zh`);
      expect(mocks.readShieldedAsset).toHaveBeenCalledTimes(readsBefore);
    },
  );

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

  it("keeps both secrets but clears pool-local drafts when changing pools, preserving task navigation", async () => {
    render(<InheritancePage />);
    const original = await screen.findByTestId("shielded-panel");
    expect(screen.getByTestId("shielded-navigation").textContent).toBe("identity:shield");
    fireEvent.click(screen.getByRole("button", { name: "unlock-independent-key-without-identity-proof" }));
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
    expect(screen.getByTestId("shielded-independent-key").textContent).toBe(`0x${"34".repeat(32)}`);
    fireEvent.click(screen.getByRole("button", { name: "select-independent-claim" }));
    expect(screen.getByTestId("shielded-navigation").textContent).toBe("independent:claim");
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "old DEEP budget" },
    });
    chooseAsset("ETH");
    await waitFor(() =>
      expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.nativePoolAddress),
    );
    expect(screen.getByTestId("shielded-panel")).not.toBe(original);
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
    expect(screen.getByTestId("shielded-independent-key").textContent).toBe(`0x${"34".repeat(32)}`);
    expect(screen.getByTestId("shielded-navigation").textContent).toBe("independent:claim");
    expect(screen.getByTestId("shielded-token").textContent).toBe("native");
    expect(screen.getByTestId("shielded-deployment-block").textContent).toBe("5");
    expect(
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value,
    ).toBe("");
    expect(mocks.panelUnmounted).toHaveBeenCalledOnce();
  });

  it("starts another person from a fresh panel and task, keeping drafts for the same person", async () => {
    render(<InheritancePage />);
    const original = await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    fireEvent.click(screen.getByRole("button", { name: "select-independent-claim" }));
    fireEvent.change(screen.getByRole("textbox", { name: "private-workflow-draft" }), {
      target: { value: "first person's budget" },
    });
    const draft = () =>
      (screen.getByRole("textbox", { name: "private-workflow-draft" }) as HTMLInputElement).value;
    // Re-unlocking the same person after a lock continues where it stopped.
    fireEvent.click(screen.getByRole("button", { name: "lock-test-session" }));
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    expect(screen.getByTestId("shielded-panel")).toBe(original);
    expect(draft()).toBe("first person's budget");
    expect(screen.getByTestId("shielded-navigation").textContent).toBe("independent:claim");
    // Another person shows nothing of the first one.
    fireEvent.click(screen.getByRole("button", { name: "lock-test-session" }));
    fireEvent.click(screen.getByRole("button", { name: "unlock-other-test-session" }));
    expect(screen.getByTestId("shielded-identity").textContent).toBe(
      otherIdentity.identityCommitment,
    );
    expect(screen.getByTestId("shielded-panel")).not.toBe(original);
    expect(mocks.panelUnmounted).toHaveBeenCalledOnce();
    expect(draft()).toBe("");
    expect(screen.getByTestId("shielded-navigation").textContent).toBe("identity:shield");
  });

  it("locks during pool loading and ignores late responses after a protocol scope change", async () => {
    const { rerender } = render(<InheritancePage />);
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
    chooseAsset("ETH");
    await screen.findByText("shielded.loading");
    expect(screen.queryByTestId("shielded-panel")).toBeNull();
    expect(assetSelector()).toBeTruthy();
    mocks.factoryAddress = "0x0000000000000000000000000000000000000009";
    rerender(<InheritancePage />);
    const restoredPanel = await screen.findByTestId("shielded-panel");
    expect(screen.getByTestId("shielded-identity").textContent).toBe("");
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("locked");
    await act(async () => {
      pendingNative.resolve({
        pool: {},
        poolAddress: mocks.nativePoolAddress,
        poolDeploymentBlock: 5,
      });
    });
    expect(screen.getByTestId("shielded-panel")).toBe(restoredPanel);
    expect(screen.getByTestId("shielded-pool").textContent).toBe(mocks.poolAddress);
    expect(screen.getByTestId("shielded-identity").textContent).toBe("");
  });

  it.each(["missing", "failed"])(
    "returns from a %s asset pool through asset selection without unlocking again",
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
      chooseAsset("ETH");
      if (result === "missing") await screen.findByText("shielded.assets.noPool");
      else await screen.findByText("Pool temporarily unreachable");
      expect(screen.queryByTestId("shielded-panel")).toBeNull();
      expect(screen.queryByRole("button", { name: "unlock-test-session" })).toBeNull();
      chooseAsset("DEEP");
      await screen.findByTestId("shielded-panel");
      expect(screen.getByTestId("shielded-identity").textContent).toBe(identity.identityCommitment);
      expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    },
  );

  it.each(["chain", "factory", "family", "rpc"])(
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
      } else if (changed === "family") {
        mocks.config.contractAddress = "0x0000000000000000000000000000000000000020";
      } else {
        mocks.config.rpcUrl = "http://127.0.0.1:9545";
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
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect(assetSelector().textContent).toBe("TEST · 0x0000…0030");
    expect(mocks.config.tokenAddress).toBe("0x0000000000000000000000000000000000000003");
  });

  it("keeps an imported pool selectable with unknown precision using raw integer units", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-test-session" }));
    mocks.assetPrecision = null;
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    fireEvent.change(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" }), {
      target: { value: "0x0000000000000000000000000000000000000030" },
    });
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.import" }));
    await waitFor(() =>
      expect(screen.getByTestId("shielded-asset").textContent).toBe("erc20:TEST:raw"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("shielded-session-state").textContent).toBe("unlocked");
    expect(assetSelector().textContent).toBe("TEST · 0x0000…0030");
  });

  it("keeps independent-key credentials without identity proof capability when another pool is selected", async () => {
    render(<InheritancePage />);
    await screen.findByTestId("shielded-panel");
    fireEvent.click(screen.getByRole("button", { name: "unlock-independent-key-without-identity-proof" }));
    expect(screen.getByTestId("shielded-identity").textContent).toBe("");
    expect(screen.getByTestId("shielded-independent-key").textContent).toBe(`0x${"34".repeat(32)}`);
    chooseAsset("ETH");
    await waitFor(() =>
      expect(screen.getByTestId("shielded-asset").textContent).toContain("native:"),
    );
    expect(screen.getByTestId("shielded-independent-key").textContent).toBe(`0x${"34".repeat(32)}`);
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
