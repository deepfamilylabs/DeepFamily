import { describe, expect, it, vi } from "vitest";
import type { NodeData } from "../model/graph";
import { MetadataUnlockCancelledError } from "./metadataArchiveService";
import {
  MetadataUnlockCoordinator,
  type MetadataNodeUnlocker,
  type MetadataUnlockBatchProgress,
} from "./metadataUnlockCoordinator";

const node = (index: number): NodeData => ({
  id: `node-${index}`,
  personHash: `0x${index.toString(16).padStart(64, "0")}`,
  versionIndex: 1,
  versionCommitment: String(index),
  metadataPointer: `0x${index.toString(16).padStart(40, "0")}`,
  metadataPayloadHash: `0x${index.toString(16).padStart(64, "0")}`,
  metadataPayloadLength: 112 + index,
});

const validated = (current: NodeData): NodeData => ({
  ...current,
  fullName: `Person ${current.id}`,
  tag: `tag-${current.id}`,
  biography: `bio-${current.id}`,
  metadataPerson: {
    fullName: `Person ${current.id}`,
    gender: 0,
    birthYear: 0,
    birthMonth: 0,
    birthDay: 0,
    isBirthBC: false,
    personHash: current.personHash,
  },
  metadataParents: { father: null, mother: null },
  metadataFormatVersion: 1,
  identitySuiteId: 1,
  metadataProtocolGeneration: "df-onchain-biography-v1",
  metadataUnlockValidated: true,
});

describe("MetadataUnlockCoordinator", () => {
  it("runs strictly serially, skips cached nodes, persists each success, and isolates failures", async () => {
    const nodes = [node(1), node(2), node(3), node(4)];
    let inFlight = 0;
    let maximumInFlight = 0;
    const rawPassphrase = "batch-secret-sentinel";
    const unlockNode: MetadataNodeUnlocker = vi.fn(async ({ node: current }) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (current.id === "node-3") throw new Error(`wrong ${rawPassphrase}`);
      return validated(current);
    });
    const unlocked: string[] = [];
    const persisted: string[] = [];
    const progress: MetadataUnlockBatchProgress[] = [];
    const coordinator = new MetadataUnlockCoordinator();

    const report = await coordinator.run({
      nodes,
      chainId: 71,
      deepFamilyProxy: `0x${"11".repeat(20)}`,
      getCode: async () => "0x",
      rawPassphrase,
      isAlreadyUnlocked: (current) => current.id === "node-1",
      unlockNode,
      cacheValidatedPersonVersion: (current) => unlocked.push(current.id),
      persistUnlocked: async (current) => {
        persisted.push(current.id);
        if (current.id === "node-4") throw new Error("IndexedDB quota exceeded");
      },
      onProgress: (value) => progress.push(value),
    });

    expect(maximumInFlight).toBe(1);
    expect(unlocked).toEqual(["node-2", "node-4"]);
    expect(persisted).toEqual(["node-2", "node-4"]);
    expect(report).toMatchObject({
      status: "completed",
      total: 4,
      processed: 4,
      attempted: 3,
      succeeded: 2,
      failed: 1,
      skipped: 1,
      persistenceFailed: 1,
    });
    expect(report.failures[0]).toMatchObject({ nodeId: "node-3" });
    expect(JSON.stringify(report)).not.toContain(rawPassphrase);
    expect(report.persistenceFailures[0]).toMatchObject({ nodeId: "node-4" });
    expect(progress[progress.length - 1]?.status).toBe("completed");
  });

  it("cancels the current job and preserves successes already committed", async () => {
    const first = node(1);
    const second = node(2);
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const unlockNode: MetadataNodeUnlocker = async ({ node: current, signal }) => {
      if (current.id === first.id) return validated(current);
      markSecondStarted();
      return new Promise<NodeData>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new MetadataUnlockCancelledError()), {
          once: true,
        });
      });
    };
    const unlocked: string[] = [];
    const persisted: string[] = [];
    const progress: MetadataUnlockBatchProgress[] = [];
    const coordinator = new MetadataUnlockCoordinator();
    const running = coordinator.run({
      nodes: [first, second, node(3)],
      chainId: 71,
      deepFamilyProxy: `0x${"11".repeat(20)}`,
      getCode: async () => "0x",
      rawPassphrase: "cancel-me",
      unlockNode,
      cacheValidatedPersonVersion: (current) => unlocked.push(current.id),
      persistUnlocked: async (current) => {
        persisted.push(current.id);
      },
      onProgress: (value) => progress.push(value),
    });

    await secondStarted;
    expect(coordinator.cancel()).toBe(true);
    const report = await running;

    expect(report.status).toBe("cancelled");
    expect(report.succeeded).toBe(1);
    expect(report.attempted).toBe(2);
    expect(report.failed).toBe(0);
    expect(unlocked).toEqual([first.id]);
    expect(persisted).toEqual([first.id]);
    expect(progress.some((value) => value.status === "cancelling")).toBe(true);
    expect(progress[progress.length - 1]?.status).toBe("cancelled");
    expect(coordinator.running).toBe(false);
    expect(coordinator.cancel()).toBe(false);
  });

  it("rejects plaintext when public anchors change while the Worker is unlocking", async () => {
    const original = node(1);
    const latest = {
      ...original,
      versionCommitment: "changed-while-unlocking",
      metadataPayloadHash: `0x${"ff".repeat(32)}`,
    };
    const cacheValidatedPersonVersion = vi.fn();
    const persistUnlocked = vi.fn();
    const coordinator = new MetadataUnlockCoordinator();

    const report = await coordinator.run({
      nodes: [original],
      chainId: 71,
      deepFamilyProxy: `0x${"11".repeat(20)}`,
      getCode: async () => "0x",
      rawPassphrase: "race-test",
      unlockNode: async ({ node: current }) => validated(current),
      getCurrentNode: () => latest,
      cacheValidatedPersonVersion,
      persistUnlocked,
    });

    expect(report).toMatchObject({ status: "completed", succeeded: 0, failed: 1 });
    expect(report.failures[0]?.message).toMatch(/public anchors/);
    expect(cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(persistUnlocked).not.toHaveBeenCalled();
  });
});
