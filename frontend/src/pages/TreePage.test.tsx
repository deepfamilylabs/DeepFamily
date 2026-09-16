// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TreePage from "./TreePage";
import { makeNodeId } from "../shared/model";

const mocks = vi.hoisted(() => ({
  unlockedCount: 0,
  selectedDetail: null as { personHash: string; versionIndex: number } | null,
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
    tokenAddress: "0x0000000000000000000000000000000000000004",
    rootHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    rootVersionIndex: 1,
    defaults: {
      rpcUrl: "",
      chainId: 1,
      contractAddress: "",
      readerAddress: "",
      tokenAddress: "",
      rootHash: "",
      rootVersionIndex: 1,
    },
    update: vi.fn(),
  },
  env: {
    isTreeDebugEnabled: vi.fn(() => false),
    shouldPreferFlatTree: vi.fn(() => false),
  },
  wallet: {
    address: null as string | null,
    signer: null as any,
  },
  readonlyProvider: {},
  readerContract: {
    listTrustedEndorsers: vi.fn(),
  },
  writeContract: {
    addTrustedEndorser: vi.fn(),
    removeTrustedEndorser: vi.fn(),
  },
  getReadonlyProvider: vi.fn(),
  createDeepFamilyReaderContract: vi.fn(),
  createDeepFamilyContract: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../domains/tree", () => ({
  useMetadataUnlockScope: () => ({ unlockedCount: mocks.unlockedCount }),
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
  ViewContainer: ({ viewMode, hasRoot, contractMessage, loading, onViewModeChange }: any) => (
    <div data-testid="view-container">
      {JSON.stringify({ viewMode, hasRoot, contractMessage, loading })}
      <button data-testid="view-mode-switch" onClick={() => onViewModeChange("dag")}>
        switch:{viewMode}
      </button>
    </div>
  ),
  TreeDebugPanel: () => <div data-testid="tree-debug-panel">debug</div>,
  MetadataUnlockControl: ({ open, target, priorityNodeId }: any) => (
    <div data-testid="metadata-unlock-control">
      {JSON.stringify({ open, target, priorityNodeId })}
    </div>
  ),
}));

vi.mock("../domains/person", () => ({
  EndorseModalProvider: ({ children }: any) => <div data-testid="endorse-provider">{children}</div>,
  NodeDetailProvider: ({ children, onRequestMetadataUnlock }: any) => (
    <div data-testid="node-detail-provider">
      {children}
      <button
        type="button"
        onClick={() => onRequestMetadataUnlock({ personHash: "0xperson", versionIndex: 2 })}
      >
        Unlock person
      </button>
    </div>
  ),
  useEndorseModal: () => ({ openEndorse: vi.fn() }),
  useNodeDetail: () => ({ openNode: vi.fn(), selected: mocks.selectedDetail }),
}));

vi.mock("../domains/config", () => ({
  useConfig: () => mocks.config,
  FamilyTreeConfigForm: () => <div data-testid="family-tree-config-form">config-form</div>,
}));

vi.mock("../domains/wallet", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: (...args: any[]) => mocks.getReadonlyProvider(...args),
}));

vi.mock("../shared/clients/contractFactory", () => ({
  createDeepFamilyReaderContract: (...args: any[]) => mocks.createDeepFamilyReaderContract(...args),
  createDeepFamilyContract: (...args: any[]) => mocks.createDeepFamilyContract(...args),
}));

vi.mock("../shared/config/env", () => ({
  isTreeDebugEnabled: mocks.env.isTreeDebugEnabled,
  shouldPreferFlatTree: mocks.env.shouldPreferFlatTree,
}));

function renderTreePage() {
  return render(
    <MemoryRouter>
      <TreePage />
    </MemoryRouter>,
  );
}

describe("TreePage", () => {
  beforeEach(() => {
    mocks.unlockedCount = 0;
    mocks.selectedDetail = null;
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
    mocks.config.tokenAddress = "0x0000000000000000000000000000000000000004";
    mocks.config.rootHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    mocks.config.rootVersionIndex = 1;
    mocks.config.defaults = {
      rpcUrl: "",
      chainId: 1,
      contractAddress: "",
      readerAddress: "",
      tokenAddress: "",
      rootHash: "",
      rootVersionIndex: 1,
    };
    mocks.config.update.mockReset();
    mocks.env.isTreeDebugEnabled.mockReset();
    mocks.env.isTreeDebugEnabled.mockReturnValue(false);
    mocks.env.shouldPreferFlatTree.mockReset();
    mocks.env.shouldPreferFlatTree.mockReturnValue(false);
    mocks.wallet.address = null;
    mocks.wallet.signer = null;
    mocks.readerContract.listTrustedEndorsers.mockReset();
    mocks.writeContract.addTrustedEndorser.mockReset();
    mocks.writeContract.removeTrustedEndorser.mockReset();
    mocks.getReadonlyProvider.mockReset();
    mocks.getReadonlyProvider.mockReturnValue(mocks.readonlyProvider);
    mocks.createDeepFamilyReaderContract.mockReset();
    mocks.createDeepFamilyReaderContract.mockReturnValue(mocks.readerContract);
    mocks.createDeepFamilyContract.mockReset();
    mocks.createDeepFamilyContract.mockReturnValue(mocks.writeContract);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the current projection's unlocked count in the family bar", () => {
    mocks.unlockedCount = 2;
    renderTreePage();
    expect(screen.getByTitle("Unlock versions").textContent).toBe("2");
  });

  it("renders the page bar stats, wires refresh/clear actions, and persists the selected view mode", async () => {
    localStorage.setItem("df:viewMode", "tree");

    renderTreePage();

    expect(screen.getByText("Family")).toBeTruthy();
    expect(screen.getByTitle("Nodes").textContent).toContain("12");
    expect(screen.getByTitle("Depth").textContent).toContain("4");
    expect(screen.getByTestId("view-container").textContent).toContain('"hasRoot":true');
    expect(screen.getByTestId("view-container").textContent).toContain('"viewMode":"tree"');

    fireEvent.click(screen.getByTestId("view-mode-switch"));

    await waitFor(() =>
      expect(screen.getByTestId("view-container").textContent).toContain('"viewMode":"dag"'),
    );
    expect(localStorage.getItem("df:viewMode")).toBe("dag");

    // The unlock dialog is opened from the bar now, not from a pill floating over the canvas.
    expect(screen.getByTitle("Unlock versions")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Refresh"));

    fireEvent.click(screen.getByTitle("Clear caches"));

    expect(mocks.treeStatus.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.treeStatus.clearAllCaches).toHaveBeenCalledTimes(1);
  });

  it("prioritizes the viewed detail before its manual unlock dialog is opened", () => {
    mocks.selectedDetail = { personHash: "0xperson", versionIndex: 2 };
    renderTreePage();
    const control = JSON.parse(screen.getByTestId("metadata-unlock-control").textContent!);
    expect(control).toMatchObject({
      open: false,
      target: null,
      priorityNodeId: makeNodeId("0xperson", 2),
    });
  });

  it("opens a targeted unlock from details and clears the target for the global entry", () => {
    renderTreePage();
    fireEvent.click(screen.getByRole("button", { name: "Unlock person" }));
    expect(screen.getByTestId("metadata-unlock-control").textContent).toContain(
      '"target":{"personHash":"0xperson","versionIndex":2}',
    );
    fireEvent.click(screen.getByTitle("Unlock versions"));
    expect(screen.getByTestId("metadata-unlock-control").textContent).toContain('"target":null');
    expect(screen.getByTestId("metadata-unlock-control").textContent).toContain('"open":true');
  });

  it("links the three genealogy volumes and opens the config panel from the overflow menu", () => {
    renderTreePage();

    // The paper genealogy volume is Chinese-only; the mocked language is "en".
    expect(screen.getByRole("link", { name: "Lineage" }).getAttribute("href")).toBe("/family");
    expect(screen.getByRole("link", { name: "People" }).getAttribute("href")).toBe("/people");
    expect(screen.queryByRole("link", { name: "Genealogy" })).toBeNull();

    // The drawer mounts its form on first open and keeps it, so presence is read off the dialog.
    expect(screen.getByRole("dialog", { hidden: true }).getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByTestId("family-tree-config-form")).toBeNull();

    fireEvent.click(screen.getByTitle("Family settings"));
    expect(screen.getByRole("dialog").getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByTestId("family-tree-config-form")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Family settings"));
    expect(screen.getByRole("dialog", { hidden: true }).getAttribute("aria-hidden")).toBe("true");
  });
});
