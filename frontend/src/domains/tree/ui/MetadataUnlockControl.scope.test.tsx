// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataUnlockControl } from "./MetadataUnlockControl";

const PERSON_A = `0x${"11".repeat(32)}`;
const PERSON_B = `0x${"22".repeat(32)}`;
const PROXY_A = "0x00000000000000000000000000000000000000a1";
const PROXY_B = "0x00000000000000000000000000000000000000b1";
const makeNode = (personHash: string, versionIndex: number, fullName: string) => ({
  id: `${personHash}-${versionIndex}`,
  personHash,
  versionIndex,
  fullName,
  versionCommitment: "123",
  metadataPointer: "0x00000000000000000000000000000000000000aa",
  metadataPayloadHash: `0x${"33".repeat(32)}`,
  metadataSegmentCount: 1,
  metadataPayloadLength: 128,
});
const nodeA1 = makeNode(PERSON_A, 1, "Ada");
const nodeA2 = makeNode(PERSON_A, 2, "Ada");
const nodeB1 = makeNode(PERSON_B, 1, "Bo");
const target = { personHash: PERSON_A, versionIndex: 1 };
const report = (overrides: Record<string, unknown> = {}) => ({
  status: "completed",
  total: 1,
  processed: 1,
  attempted: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  persistenceFailed: 0,
  failures: [],
  persistenceFailures: [],
  ...overrides,
});

const mocks = vi.hoisted(() => ({
  viewRoot: "root-a",
  visibleIds: null as string[] | null,
  config: {
    rpcUrl: "https://rpc-a.example",
    chainId: 71,
    contractAddress: "0x00000000000000000000000000000000000000a1",
  },
  nodesData: {} as Record<string, any>,
  provider: { getCode: vi.fn() },
  getReadonlyProvider: vi.fn(),
  readPersonVersionEnvelope: vi.fn(),
  coordinatorRun: vi.fn(),
  coordinatorCancel: vi.fn(),
  lastBatchOptions: null as any,
  cacheValidatedPersonVersion: vi.fn(),
  persistValidatedPersonVersion: vi.fn(),
  captureMetadataCacheRevision: vi.fn(),
  clearMetadataUnlockCache: vi.fn(),
  automatic: vi.fn(),
}));

vi.mock("./useMetadataUnlockScope", () => ({
  useMetadataUnlockScope: () => {
    const ids = mocks.visibleIds ?? Object.keys(mocks.nodesData);
    return {
      rootId: mocks.viewRoot,
      key: JSON.stringify([mocks.viewRoot, [...ids].sort()]),
      nodeIds: new Set(ids),
      unlockedCount: ids.filter((id) => mocks.nodesData[id]?.metadataUnlockValidated).length,
    };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown) => {
      const fallback = typeof fallbackOrOptions === "string" ? fallbackOrOptions : key;
      const options = (typeof fallbackOrOptions === "string" ? maybeOptions : fallbackOrOptions) as
        | Record<string, unknown>
        | undefined;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
  }),
}));
vi.mock("../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../context", () => ({
  useTreeGraphData: () => ({ nodesData: mocks.nodesData }),
  useTreeMutations: () => ({
    cacheValidatedPersonVersion: mocks.cacheValidatedPersonVersion,
    persistValidatedPersonVersion: mocks.persistValidatedPersonVersion,
    captureMetadataCacheRevision: mocks.captureMetadataCacheRevision,
    clearMetadataUnlockCache: mocks.clearMetadataUnlockCache,
  }),
}));
vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: (...args: any[]) => mocks.getReadonlyProvider(...args),
}));
vi.mock("../../../shared/model", () => ({
  isMetadataUnlockUsable: (node: any) => Boolean(node?.metadataUnlockValidated),
  makeNodeId: (hash: string, version: number) => `${hash.toLowerCase()}-${version}`,
}));
vi.mock("./useAutomaticMetadataUnlock", () => ({
  useAutomaticMetadataUnlock: (...args: any[]) => mocks.automatic(...args),
  automaticMetadataUnlockKey: (node: any) => node.id,
}));
vi.mock("./useMetadataUnlockPreferences", async () => {
  const { useState } = await import("react");
  return {
    useMetadataUnlockPreferences: () => {
      const [remember, setRemember] = useState(true);
      return { remember, setRemember };
    },
  };
});
vi.mock("../../../shared/metadata", () => ({
  readPersonVersionEnvelope: (...args: any[]) => mocks.readPersonVersionEnvelope(...args),
  MetadataUnlockCoordinator: class {
    cancel() {
      mocks.coordinatorCancel();
      return true;
    }
    run(options: any) {
      mocks.lastBatchOptions = options;
      return mocks.coordinatorRun(options);
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
async function enterPassphrase(value = "Ada passphrase") {
  const input = await screen.findByLabelText("Identity passphrase");
  fireEvent.change(input, { target: { value } });
  return input as HTMLInputElement;
}
function unlockButton() {
  return screen.getByRole("button", {
    name: /^Unlock (\d+ )?selected version/,
  }) as HTMLButtonElement;
}
/** The passphrase bar is always there; the button only arms once the selection is checked. */
async function waitForUnlockReady() {
  await waitFor(() => expect(unlockButton().disabled).toBe(false));
}
async function clickUnlock() {
  await waitForUnlockReady();
  fireEvent.click(unlockButton());
}
function version(person: string, number: number) {
  return screen.getByRole("checkbox", {
    name: `Select ${person}, version ${number}`,
  }) as HTMLInputElement;
}

describe("MetadataUnlockControl selection and scope", () => {
  beforeEach(() => {
    mocks.viewRoot = "root-a";
    mocks.visibleIds = null;
    mocks.config.rpcUrl = "https://rpc-a.example";
    mocks.config.chainId = 71;
    mocks.config.contractAddress = PROXY_A;
    mocks.nodesData = {
      [nodeA1.id]: { ...nodeA1 },
      [nodeA2.id]: { ...nodeA2 },
      [nodeB1.id]: { ...nodeB1 },
    };
    mocks.provider.getCode.mockReset();
    mocks.getReadonlyProvider.mockReset().mockReturnValue(mocks.provider);
    mocks.readPersonVersionEnvelope.mockReset().mockResolvedValue({});
    mocks.coordinatorRun.mockReset().mockResolvedValue(report());
    mocks.coordinatorCancel.mockReset();
    mocks.lastBatchOptions = null;
    mocks.cacheValidatedPersonVersion.mockReset();
    mocks.persistValidatedPersonVersion.mockReset().mockResolvedValue(undefined);
    mocks.captureMetadataCacheRevision.mockReset().mockReturnValue(7);
    mocks.clearMetadataUnlockCache.mockReset();
    mocks.automatic.mockReset().mockReturnValue({ paused: false, issues: [] });
  });
  afterEach(cleanup);

  it("keeps background work running in the open dialog until versions are selected", async () => {
    const { container } = render(<MetadataUnlockControl />);
    expect(mocks.automatic).toHaveBeenLastCalledWith({
      suspended: false,
      priorityNodeId: undefined,
      viewScope: expect.objectContaining({
        rootId: "root-a",
        nodeIds: new Set([nodeA1.id, nodeA2.id, nodeB1.id]),
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: /Unlock versions/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toContain(
      "Unlock encrypted version metadata",
    );
    expect(container.contains(dialog)).toBe(false);
    expect(mocks.automatic).toHaveBeenLastCalledWith({
      suspended: false,
      priorityNodeId: undefined,
      viewScope: expect.objectContaining({
        rootId: "root-a",
        nodeIds: new Set([nodeA1.id, nodeA2.id, nodeB1.id]),
      }),
    });
    fireEvent.click(version("Ada", 1));
    await screen.findByLabelText("Identity passphrase");
    expect(mocks.automatic).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: true }));
    expect(screen.getByText(/Automatic attempts are paused while you unlock/)).toBeTruthy();
    fireEvent.click(version("Ada", 1));
    expect(mocks.automatic).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: false }));
    expect(screen.queryByText(/Automatic attempts are paused while you unlock/)).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preselects only the detail version and adds the same person's other versions explicitly", async () => {
    render(<MetadataUnlockControl open target={target} />);
    await screen.findByLabelText("Identity passphrase");
    expect(version("Ada", 1).checked).toBe(true);
    expect(version("Ada", 2).checked).toBe(false);
    expect(version("Bo", 1).checked).toBe(false);
    expect(mocks.automatic).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: true }));
    expect(mocks.readPersonVersionEnvelope.mock.calls.map(([input]) => input.node.id)).toEqual([
      nodeA1.id,
    ]);
    const person = screen.getByRole("checkbox", {
      name: "Select all versions for Ada in this view",
    }) as HTMLInputElement;
    expect(person.checked).toBe(false);
    expect(person.indeterminate).toBe(true);
    fireEvent.click(person);
    expect(person.checked).toBe(true);
    expect(person.indeterminate).toBe(false);
    await enterPassphrase();
    await clickUnlock();
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    expect(mocks.lastBatchOptions.nodes.map((node: any) => node.id)).toEqual([
      nodeA1.id,
      nodeA2.id,
    ]);
  });

  it("lists the inspected person first and marks them as being viewed", () => {
    render(<MetadataUnlockControl open target={{ personHash: PERSON_B, versionIndex: 1 }} />);
    const [first] = screen.getAllByRole("checkbox", { name: /^Select / });
    expect(first.getAttribute("aria-label")).toBe("Select Bo, version 1");
    expect(screen.getAllByText("Viewing")).toHaveLength(1);
    expect(version("Bo", 1).closest("label")?.textContent).toContain("Viewing");
  });

  it("limits the default list and counts to exact versions in the current family view", () => {
    mocks.visibleIds = [nodeA1.id];
    mocks.nodesData[nodeB1.id].metadataUnlockValidated = true;
    render(<MetadataUnlockControl open target={target} />);
    expect(version("Ada", 1)).toBeTruthy();
    expect(screen.queryByLabelText("Select Ada, version 2")).toBeNull();
    expect(screen.queryByLabelText("Select Bo, version 1")).toBeNull();
    // A person with one version in view is a single row, without a separate select-all.
    expect(screen.queryByLabelText("Select all versions for Ada in this view")).toBeNull();
    expect(screen.getByText("Current family view · 1 version(s) to unlock")).toBeTruthy();
    expect(screen.getByText("0 version(s) in this view already unlocked locally")).toBeTruthy();
  });

  it("keeps the passphrase field disabled until something is selected", async () => {
    render(<MetadataUnlockControl open />);
    const input = screen.getByLabelText("Identity passphrase") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(unlockButton().disabled).toBe(true);
    fireEvent.click(version("Bo", 1));
    expect(input.disabled).toBe(false);
    await waitForUnlockReady();
    expect(unlockButton().textContent).toBe("Unlock 1 selected version(s)");
  });

  it("swaps in a separate cancel button, so a second click cannot stop the batch it started", async () => {
    mocks.coordinatorRun.mockImplementation((options) => {
      options.onProgress(report({ status: "running", processed: 0, succeeded: 0 }));
      return deferred<any>().promise;
    });
    render(<MetadataUnlockControl open target={target} />);
    await enterPassphrase();
    await waitForUnlockReady();
    const unlock = unlockButton();
    fireEvent.click(unlock);
    const cancel = screen.getByRole("button", { name: "Cancel unlock" });
    expect(cancel).not.toBe(unlock);
    expect(unlock.isConnected).toBe(false);
  });

  it("unlocks on Enter once the selection is checked, but not while an IME is composing", async () => {
    render(<MetadataUnlockControl open target={target} />);
    const input = await enterPassphrase();
    await waitForUnlockReady();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(mocks.coordinatorRun).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    expect(mocks.lastBatchOptions.rawPassphrase).toBe("Ada passphrase");
  });

  it("shows no passphrase bar when nothing in the view needs unlocking", () => {
    for (const node of Object.values(mocks.nodesData)) node.metadataUnlockValidated = true;
    render(<MetadataUnlockControl open />);
    expect(screen.getByText("No versions in the current family view need unlocking")).toBeTruthy();
    expect(screen.getByText("Current family view · nothing to unlock")).toBeTruthy();
    expect(screen.queryByLabelText("Identity passphrase")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Clear plaintext cache" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("drops a late manual result when the selected version leaves the family view", async () => {
    const batch = deferred<any>();
    mocks.coordinatorRun.mockImplementation((options) => {
      options.onProgress({ ...report(), status: "running", currentNodeId: nodeA1.id });
      return batch.promise;
    });
    const { rerender } = render(<MetadataUnlockControl open target={target} />);
    await enterPassphrase();
    await clickUnlock();
    const oldOptions = mocks.lastBatchOptions;
    expect(screen.getByText("Unlocking…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("1");
    mocks.visibleIds = [nodeB1.id];
    rerender(<MetadataUnlockControl open target={target} />);
    expect(() => oldOptions.cacheValidatedPersonVersion(nodeA1)).toThrow();
    await act(async () => {
      batch.resolve(report());
      await batch.promise;
    });
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.persistValidatedPersonVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel unlock" })).toBeNull();
    mocks.visibleIds = [nodeA1.id, nodeB1.id];
    rerender(<MetadataUnlockControl open target={target} />);
    expect(version("Ada", 1).checked).toBe(false);
    expect(screen.queryByText("Unlocking…")).toBeNull();
    expect(screen.queryByText("Checking…")).toBeNull();
    fireEvent.click(version("Bo", 1));
    await waitForUnlockReady();
  });

  it("cancels preflight on root change even if both roots share the selected descendant", async () => {
    const preflight = deferred<any>();
    mocks.readPersonVersionEnvelope.mockReturnValueOnce(preflight.promise);
    const { rerender } = render(<MetadataUnlockControl open target={target} />);
    expect(await screen.findByText("Checking encrypted data…")).toBeTruthy();
    mocks.viewRoot = "root-b";
    rerender(<MetadataUnlockControl open target={target} />);
    await waitForUnlockReady();
    await act(async () => {
      preflight.resolve({});
      await preflight.promise;
    });
    expect(mocks.readPersonVersionEnvelope).toHaveBeenCalledTimes(2);
  });

  it("does not preflight global versions until selected, and supports several people sharing a passphrase", async () => {
    render(<MetadataUnlockControl open />);
    expect(mocks.readPersonVersionEnvelope).not.toHaveBeenCalled();
    fireEvent.click(version("Ada", 1));
    fireEvent.click(version("Bo", 1));
    await enterPassphrase("shared passphrase");
    await clickUnlock();
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    expect(mocks.lastBatchOptions.nodes.map((node: any) => node.id)).toEqual([
      nodeA1.id,
      nodeB1.id,
    ]);
  });

  it.each([false, true])(
    "remembers device results by default and keeps opted-out results in memory (remember=%s)",
    async (remember) => {
      mocks.coordinatorRun.mockImplementation(async (options) => {
        options.cacheValidatedPersonVersion(nodeA1);
        await options.persistUnlocked?.(nodeA1);
        return report();
      });
      render(<MetadataUnlockControl open target={target} />);
      expect(
        (screen.getByLabelText(/Remember unlocked results on this device/) as HTMLInputElement)
          .checked,
      ).toBe(true);
      if (!remember)
        fireEvent.click(screen.getByLabelText(/Remember unlocked results on this device/));
      const input = await enterPassphrase();
      await clickUnlock();
      await waitFor(() => expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledTimes(1));
      const marked = { ...nodeA1, metadataUnlockPersistence: remember ? "device" : "session" };
      expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledWith(marked, 7);
      if (remember) expect(mocks.persistValidatedPersonVersion).toHaveBeenCalledWith(marked, 7);
      else {
        expect(mocks.persistValidatedPersonVersion).not.toHaveBeenCalled();
        expect(mocks.lastBatchOptions.persistUnlocked).toBeUndefined();
      }
      expect(input.value).toBe("");
    },
  );

  it("retains each failure and success while continuing with a different person's passphrase", async () => {
    mocks.coordinatorRun
      .mockImplementationOnce(async (options) => {
        options.cacheValidatedPersonVersion(nodeA1);
        return report({
          total: 2,
          processed: 2,
          failed: 1,
          failures: [{ nodeId: nodeB1.id, name: "Error", message: "wrong passphrase" }],
        });
      })
      .mockImplementationOnce(async (options) => {
        options.cacheValidatedPersonVersion(nodeB1);
        return report();
      });
    render(<MetadataUnlockControl open />);
    fireEvent.click(version("Ada", 1));
    fireEvent.click(version("Bo", 1));
    await enterPassphrase();
    await clickUnlock();
    expect(await screen.findByText("Decryption or verification failed")).toBeTruthy();
    expect(screen.getByText("Unlocked")).toBeTruthy();
    expect(screen.getByText("Completed: 1 unlocked, 1 failed.")).toBeTruthy();
    expect(
      screen.getByText("Failed versions stay selected, so you can try another passphrase."),
    ).toBeTruthy();
    await enterPassphrase("Bo passphrase");
    await clickUnlock();
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(2));
    expect(mocks.lastBatchOptions.nodes.map((node: any) => node.id)).toEqual([nodeB1.id]);
    expect(mocks.lastBatchOptions.rawPassphrase).toBe("Bo passphrase");
    await waitFor(() => expect(screen.getAllByText("Unlocked")).toHaveLength(2));
  });

  it("shows a per-version read error and supports retry without resetting successful results", async () => {
    mocks.readPersonVersionEnvelope.mockRejectedValueOnce(new Error("invalid Archive hash"));
    render(<MetadataUnlockControl open target={target} />);
    expect(await screen.findByText("Read or data check failed")).toBeTruthy();
    expect(screen.getByText("1 version(s) could not be read.")).toBeTruthy();
    expect(unlockButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry reading selected versions" }));
    await waitForUnlockReady();
    expect(screen.queryByRole("button", { name: "Retry reading selected versions" })).toBeNull();
  });

  it.each([
    ["ordinary", "Ada passphrase"],
    ["empty", ""],
    ["whitespace-only", "  "],
    ["surrounding whitespace", "  Ada passphrase  "],
  ])("submits a %s passphrase unchanged without confirmation", async (_kind, rawPassphrase) => {
    render(<MetadataUnlockControl open target={target} />);
    await enterPassphrase(rawPassphrase);
    expect(screen.queryByText(/permanent on-chain ciphertext permits/i)).toBeNull();
    expect(screen.queryByText(/I explicitly (choose|confirm)/)).toBeNull();
    await clickUnlock();
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    expect(mocks.lastBatchOptions.rawPassphrase).toBe(rawPassphrase);
  });

  it("shows background read and verification issues without treating locked versions as failures", () => {
    mocks.automatic.mockReturnValue({
      paused: false,
      issues: [
        { key: nodeA1.id, kind: "read" },
        { key: nodeB1.id, kind: "validation" },
      ],
    });
    render(<MetadataUnlockControl open />);
    expect(screen.getByText("Read or data check failed")).toBeTruthy();
    expect(screen.getByText("Encrypted data verification failed")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
  });

  it("retains background persistence failures on already unlocked versions", () => {
    mocks.nodesData[nodeA1.id].metadataUnlockValidated = true;
    mocks.automatic.mockReturnValue({
      paused: false,
      issues: [{ key: nodeA1.id, kind: "persistence" }],
    });
    render(<MetadataUnlockControl open />);
    expect(screen.getByText("Unlocked; could not remember on this device")).toBeTruthy();
    expect(version("Ada", 1).disabled).toBe(true);
  });

  it("discards old preflight results after a chain or proxy change", async () => {
    const preflight = deferred<Record<string, never>>();
    mocks.readPersonVersionEnvelope.mockReturnValueOnce(preflight.promise);
    const { rerender } = render(<MetadataUnlockControl open target={target} />);
    expect(await screen.findByText("Checking encrypted data…")).toBeTruthy();
    mocks.config.chainId = 1;
    mocks.config.contractAddress = PROXY_B;
    mocks.config.rpcUrl = "https://rpc-b.example";
    mocks.readPersonVersionEnvelope.mockRejectedValue(new Error("new scope data unavailable"));
    rerender(<MetadataUnlockControl open target={target} />);
    await screen.findByText("Read or data check failed");
    await act(async () => {
      preflight.resolve({});
      await preflight.promise;
    });
    expect(unlockButton().disabled).toBe(true);
  });

  it("discards late batch results after an external cache clear and leaves selection usable", async () => {
    const batch = deferred<any>();
    mocks.coordinatorRun.mockImplementation((options) => {
      options.onProgress(report({ status: "running", processed: 0, succeeded: 0 }));
      return batch.promise;
    });
    render(<MetadataUnlockControl open target={target} />);
    await enterPassphrase();
    await clickUnlock();
    const options = mocks.lastBatchOptions;
    expect(screen.getByRole("button", { name: "Cancel unlock" })).toBeTruthy();
    mocks.captureMetadataCacheRevision.mockReturnValue(8);
    await act(async () => {
      expect(() => options.cacheValidatedPersonVersion(nodeA1)).toThrow(
        "Metadata unlock scope changed",
      );
      await expect(options.persistUnlocked(nodeA1)).rejects.toThrow(
        "Metadata unlock scope changed",
      );
      options.onProgress(report());
      batch.resolve(report());
      await batch.promise;
    });
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.persistValidatedPersonVersion).not.toHaveBeenCalled();
    expect(screen.queryByText("Unlocked")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel unlock" })).toBeNull();
    expect(version("Bo", 1).disabled).toBe(false);
    fireEvent.click(version("Bo", 1));
    await waitForUnlockReady();
  });

  it("rejects stale cache commits and progress after changing scope while a batch runs", async () => {
    const batch = deferred<any>();
    mocks.coordinatorRun.mockImplementation((options) => {
      options.onProgress(report({ status: "running", processed: 0, succeeded: 0 }));
      return batch.promise;
    });
    const { rerender } = render(<MetadataUnlockControl open target={target} />);
    await enterPassphrase();
    await clickUnlock();
    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    const options = mocks.lastBatchOptions;
    expect(screen.getByRole("button", { name: "Cancel unlock" })).toBeTruthy();
    mocks.config.chainId = 1;
    mocks.config.contractAddress = PROXY_B;
    rerender(<MetadataUnlockControl open target={target} />);
    expect(() => options.getCurrentNode(nodeA1.id)).toThrow("Metadata unlock scope changed");
    expect(() => options.cacheValidatedPersonVersion(nodeA1)).toThrow(
      "Metadata unlock scope changed",
    );
    await expect(options.persistUnlocked(nodeA1)).rejects.toThrow("Metadata unlock scope changed");
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.persistValidatedPersonVersion).not.toHaveBeenCalled();
    await act(async () => {
      options.onProgress(report({ status: "running" }));
      batch.resolve(report({ status: "cancelled" }));
      await batch.promise;
    });
    expect(screen.queryByRole("button", { name: "Cancel unlock" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
