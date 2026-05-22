// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TreePage from "./TreePage";

const mocks = vi.hoisted(() => ({
  treeGraphData: {
    rootId: "root-1",
    rootExists: true,
    nodesData: {},
  },
  treeStatus: {
    loading: false,
    progress: { created: 12, depth: 4 },
    contractMessage: "ready",
    refresh: vi.fn(),
    clearAllCaches: vi.fn(),
  },
  config: {
    rpcUrl: "https://rpc.current",
    chainId: 1,
    contractAddress: "0x0000000000000000000000000000000000000001",
    readerAddress: "0x0000000000000000000000000000000000000002",
    attestationRegistryAddress: "0x0000000000000000000000000000000000000003",
    tokenAddress: "0x0000000000000000000000000000000000000004",
    rootHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    rootVersionIndex: 1,
    defaults: {
      rpcUrl: "",
      chainId: 1,
      contractAddress: "",
      readerAddress: "",
      attestationRegistryAddress: "",
      tokenAddress: "",
      rootHash: "",
      rootVersionIndex: 1,
    },
    update: vi.fn(),
  },
  env: {
    isForceEnvConfigSyncEnabled: vi.fn(() => false),
    isTreeDebugEnabled: vi.fn(() => false),
    shouldPreferFlatTree: vi.fn(() => false),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../domains/tree", () => ({
  useTreeGraphData: () => mocks.treeGraphData,
  useTreeMutations: () => ({
    bumpEndorsementCount: vi.fn(),
    invalidateByTx: vi.fn(),
    mergeNodeDetail: vi.fn(),
  }),
  useTreeNodeAccess: () => ({
    getOwnerOf: vi.fn(),
  }),
  useTreeStatus: () => mocks.treeStatus,
  ColorThemeProvider: ({ children }: any) => (
    <div data-testid="color-theme-provider">{children}</div>
  ),
  TreeInteractionProvider: ({ children }: any) => (
    <div data-testid="tree-interaction-provider">{children}</div>
  ),
  ViewModeSwitch: ({ value, onChange }: any) => (
    <button data-testid="view-mode-switch" onClick={() => onChange("force")}>
      switch:{value}
    </button>
  ),
  ViewContainer: ({ viewMode, hasRoot, contractMessage, loading }: any) => (
    <div data-testid="view-container">
      {JSON.stringify({ viewMode, hasRoot, contractMessage, loading })}
    </div>
  ),
  TreeDebugPanel: () => <div data-testid="tree-debug-panel">debug</div>,
}));

vi.mock("../domains/person", () => ({
  EndorseModalProvider: ({ children }: any) => <div data-testid="endorse-provider">{children}</div>,
  NodeDetailProvider: ({ children }: any) => (
    <div data-testid="node-detail-provider">{children}</div>
  ),
  useEndorseModal: () => ({ openEndorse: vi.fn() }),
  useNodeDetail: () => ({ openNode: vi.fn(), selected: null }),
}));

vi.mock("../domains/config", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("../shared/config/env", () => ({
  isForceEnvConfigSyncEnabled: mocks.env.isForceEnvConfigSyncEnabled,
  isTreeDebugEnabled: mocks.env.isTreeDebugEnabled,
  shouldPreferFlatTree: mocks.env.shouldPreferFlatTree,
}));

describe("TreePage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.treeGraphData.rootId = "root-1";
    mocks.treeGraphData.rootExists = true;
    mocks.treeGraphData.nodesData = {};
    mocks.treeStatus.loading = false;
    mocks.treeStatus.progress = { created: 12, depth: 4 };
    mocks.treeStatus.contractMessage = "ready";
    mocks.treeStatus.refresh.mockReset();
    mocks.treeStatus.clearAllCaches.mockReset();
    mocks.config.rpcUrl = "https://rpc.current";
    mocks.config.chainId = 1;
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000001";
    mocks.config.readerAddress = "0x0000000000000000000000000000000000000002";
    mocks.config.attestationRegistryAddress = "0x0000000000000000000000000000000000000003";
    mocks.config.tokenAddress = "0x0000000000000000000000000000000000000004";
    mocks.config.rootHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    mocks.config.rootVersionIndex = 1;
    mocks.config.defaults = {
      rpcUrl: "",
      chainId: 1,
      contractAddress: "",
      readerAddress: "",
      attestationRegistryAddress: "",
      tokenAddress: "",
      rootHash: "",
      rootVersionIndex: 1,
    };
    mocks.config.update.mockReset();
    mocks.env.isForceEnvConfigSyncEnabled.mockReset();
    mocks.env.isForceEnvConfigSyncEnabled.mockReturnValue(false);
    mocks.env.isTreeDebugEnabled.mockReset();
    mocks.env.isTreeDebugEnabled.mockReturnValue(false);
    mocks.env.shouldPreferFlatTree.mockReset();
    mocks.env.shouldPreferFlatTree.mockReturnValue(false);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders toolbar stats, wires refresh/clear actions, and persists the selected view mode", async () => {
    localStorage.setItem("df:viewMode", "tree");

    render(<TreePage />);

    expect(screen.getByText("Family Tree")).toBeTruthy();
    expect(screen.getAllByText(/familyTree\.ui\.nodesLabelFull/)[0].textContent).toContain("12");
    expect(screen.getAllByText(/familyTree\.ui\.depthLabelFull/)[0].textContent).toContain("4");
    expect(screen.getByTestId("view-container").textContent).toContain('"hasRoot":true');
    expect(screen.getByTestId("view-container").textContent).toContain('"viewMode":"tree"');

    fireEvent.click(screen.getByTestId("view-mode-switch"));

    await waitFor(() =>
      expect(screen.getByTestId("view-container").textContent).toContain('"viewMode":"force"'),
    );
    expect(localStorage.getItem("df:viewMode")).toBe("force");

    fireEvent.click(screen.getAllByTitle("familyTree.actions.refresh")[0]);
    fireEvent.click(screen.getAllByTitle("Clear")[0]);

    expect(mocks.treeStatus.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.treeStatus.clearAllCaches).toHaveBeenCalledTimes(1);
  });

  it("syncs config from env defaults when forced env sync is enabled", async () => {
    mocks.env.isForceEnvConfigSyncEnabled.mockReturnValue(true);

    mocks.config.defaults = {
      rpcUrl: "https://rpc.env",
      chainId: 10,
      contractAddress: "",
      readerAddress: "0x00000000000000000000000000000000000000aa",
      attestationRegistryAddress: "",
      tokenAddress: "",
      rootHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rootVersionIndex: 2,
    };

    render(<TreePage />);

    await waitFor(() =>
      expect(mocks.config.update).toHaveBeenCalledWith({
        rpcUrl: "https://rpc.env",
        chainId: 10,
        readerAddress: "0x00000000000000000000000000000000000000aa",
        contractAddress: "",
        attestationRegistryAddress: "",
        tokenAddress: "",
        rootHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        rootVersionIndex: 2,
      }),
    );
    expect(mocks.treeStatus.clearAllCaches).toHaveBeenCalledTimes(1);
    expect(mocks.treeStatus.refresh).toHaveBeenCalledTimes(1);
  });
});
