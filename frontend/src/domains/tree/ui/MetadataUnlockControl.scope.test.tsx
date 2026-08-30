// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataUnlockControl } from "./MetadataUnlockControl";

const PERSON_HASH = `0x${"11".repeat(32)}`;
const PAYLOAD_HASH = `0x${"22".repeat(32)}`;
const POINTER = "0x00000000000000000000000000000000000000aa";
const PROXY_A = "0x00000000000000000000000000000000000000a1";
const PROXY_B = "0x00000000000000000000000000000000000000b1";

const lockedNode = {
  id: `${PERSON_HASH}:1`,
  personHash: PERSON_HASH,
  versionIndex: 1,
  versionCommitment: "123",
  metadataPointer: POINTER,
  metadataPayloadHash: PAYLOAD_HASH,
  metadataPayloadLength: 128,
};

const mocks = vi.hoisted(() => ({
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
}));

// Mirrors i18next's t(key, defaultValue, options) closely enough to keep the
// interpolated progress and summary lines assertable.
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

vi.mock("../../config", () => ({
  useConfig: () => mocks.config,
}));

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
  isMetadataUnlockUsable: () => false,
}));

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function openUnlockControl() {
  fireEvent.click(screen.getByRole("button", { name: /Unlock versions/i }));
}

function switchScope(rerender: (ui: React.ReactNode) => void) {
  mocks.config.chainId = 1;
  mocks.config.contractAddress = PROXY_B;
  mocks.config.rpcUrl = "https://rpc-b.example";
  rerender(<MetadataUnlockControl />);
}

describe("MetadataUnlockControl cache scope", () => {
  beforeEach(() => {
    mocks.config.rpcUrl = "https://rpc-a.example";
    mocks.config.chainId = 71;
    mocks.config.contractAddress = PROXY_A;
    mocks.nodesData = { [lockedNode.id]: { ...lockedNode } };
    mocks.provider.getCode.mockReset();
    mocks.getReadonlyProvider.mockReset();
    mocks.getReadonlyProvider.mockReturnValue(mocks.provider);
    mocks.readPersonVersionEnvelope.mockReset();
    mocks.coordinatorRun.mockReset();
    mocks.coordinatorCancel.mockReset();
    mocks.lastBatchOptions = null;
    mocks.cacheValidatedPersonVersion.mockReset();
    mocks.persistValidatedPersonVersion.mockReset();
    mocks.persistValidatedPersonVersion.mockResolvedValue(undefined);
    mocks.captureMetadataCacheRevision.mockReset();
    mocks.captureMetadataCacheRevision.mockReturnValue(7);
    mocks.clearMetadataUnlockCache.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens through ModalShell, so it portals out and closes on Escape", async () => {
    const { container } = render(<MetadataUnlockControl />);

    openUnlockControl();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Labelled by the visible heading rather than a duplicated aria-label.
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId as string)?.textContent).toContain(
      "Unlock encrypted version metadata",
    );
    // Portalled to the body, so tree-view stacking contexts cannot clip it.
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    // The shell owns the scrim; the dialog no longer paints one of its own.
    expect(document.body.querySelectorAll("[aria-hidden][data-modal-scrim]")).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("invalidates an in-flight Archive preflight when chain or proxy scope changes", async () => {
    const preflight = deferred<Record<string, never>>();
    mocks.readPersonVersionEnvelope.mockReturnValueOnce(preflight.promise);
    const { rerender } = render(<MetadataUnlockControl />);

    openUnlockControl();
    fireEvent.click(screen.getByRole("button", { name: /Preflight loaded versions/i }));
    expect(await screen.findByText(/Checking Archive bytes/i)).toBeTruthy();

    switchScope(rerender);

    await waitFor(() => expect(mocks.coordinatorCancel).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /Preflight loaded versions/i })).toBeTruthy();
    expect(screen.queryByLabelText(/Identity passphrase/i)).toBeNull();

    await act(async () => {
      preflight.resolve({});
      await preflight.promise;
    });

    expect(screen.queryByLabelText(/Identity passphrase/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Preflight loaded versions/i })).toBeTruthy();
  });

  it("terminates a running batch and rejects stale memory or IndexedDB commits after a scope change", async () => {
    mocks.readPersonVersionEnvelope.mockResolvedValue({});
    const batch = deferred<any>();
    mocks.coordinatorRun.mockImplementationOnce((options) => {
      options.onProgress({
        status: "running",
        total: 1,
        processed: 0,
        attempted: 1,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        persistenceFailed: 0,
      });
      return batch.promise;
    });
    const { rerender } = render(<MetadataUnlockControl />);

    openUnlockControl();
    fireEvent.click(screen.getByRole("button", { name: /Preflight loaded versions/i }));
    const passphrase = await screen.findByLabelText(/Identity passphrase/i);
    fireEvent.change(passphrase, { target: { value: "strong passphrase" } });
    fireEvent.click(screen.getByText(/permanent on-chain ciphertext permits/i));
    fireEvent.click(screen.getByRole("button", { name: /Unlock sequentially/i }));

    await waitFor(() => expect(mocks.coordinatorRun).toHaveBeenCalledTimes(1));
    expect(mocks.lastBatchOptions).toBeTruthy();
    mocks.lastBatchOptions.cacheValidatedPersonVersion(lockedNode);
    await mocks.lastBatchOptions.persistUnlocked(lockedNode);
    expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledWith(lockedNode, 7);
    expect(mocks.persistValidatedPersonVersion).toHaveBeenCalledWith(lockedNode, 7);
    mocks.cacheValidatedPersonVersion.mockClear();
    mocks.persistValidatedPersonVersion.mockClear();
    expect(screen.getByRole("button", { name: /Cancel active Worker/i })).toBeTruthy();
    expect(screen.getByText(/running: 0\/1/i)).toBeTruthy();
    switchScope(rerender);

    await waitFor(() => expect(mocks.coordinatorCancel).toHaveBeenCalledTimes(1));
    expect((passphrase as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/running: 0\/1/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Preflight loaded versions/i })).toBeTruthy();

    expect(() => mocks.lastBatchOptions.getCurrentNode(lockedNode.id)).toThrow(
      "Metadata unlock scope changed",
    );
    expect(() => mocks.lastBatchOptions.cacheValidatedPersonVersion(lockedNode)).toThrow(
      "Metadata unlock scope changed",
    );
    await expect(mocks.lastBatchOptions.persistUnlocked(lockedNode)).rejects.toThrow(
      "Metadata unlock scope changed",
    );
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.persistValidatedPersonVersion).not.toHaveBeenCalled();

    // Late progress/completion from the old run must not repopulate cleared UI.
    act(() => {
      mocks.lastBatchOptions.onProgress({
        status: "running",
        total: 1,
        processed: 1,
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        persistenceFailed: 0,
      });
      batch.resolve({
        status: "cancelled",
        total: 1,
        processed: 0,
        attempted: 1,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        persistenceFailed: 0,
        failures: [],
        persistenceFailures: [],
      });
    });
    await act(async () => {
      await batch.promise;
    });

    expect(screen.queryByText(/running: 1\/1/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Preflight loaded versions/i })).toBeTruthy();
  });
});
