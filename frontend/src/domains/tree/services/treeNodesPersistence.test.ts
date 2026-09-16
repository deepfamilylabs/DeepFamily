import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMetadataUnlock,
  isMetadataUnlockUsable,
  mergeValidatedMetadataUnlock,
  type NodeData,
} from "../../../shared/model";
import {
  captureTreeNodesPersistenceRevision,
  clearTreeMetadataUnlocks,
  readTreeNodesSnapshot,
  updateTreeNodesSnapshot,
  writeTreeNodesSnapshot,
} from "./treeNodesPersistence";

const persistence = vi.hoisted(() => ({
  blobs: new Map<string, Record<string, NodeData>>(),
  readBlob: vi.fn(),
  writeBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock("../../../shared/cache/persistence", () => ({
  readBlob: (...args: unknown[]) => persistence.readBlob(...args),
  writeBlob: (...args: unknown[]) => persistence.writeBlob(...args),
  deleteBlob: (...args: unknown[]) => persistence.deleteBlob(...args),
}));

function unlockedNode(digit: string, mode?: "session" | "device"): NodeData {
  const personHash = `0x${digit.repeat(64)}`;
  const anchors = {
    personHash,
    versionIndex: 1,
    versionCommitment: "123",
    metadataPointer: `0x${"ab".repeat(20)}`,
    metadataPayloadHash: `0x${"cd".repeat(32)}`,
    metadataPayloadLength: 512,
    metadataSegmentCount: 1,
  };
  return {
    ...mergeValidatedMetadataUnlock({ id: `${personHash}-v-1`, ...anchors }, anchors, {
      person: {
        fullName: `Private name ${digit}`,
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      parents: { father: null, mother: null },
      tag: `Private tag ${digit}`,
      biography: `Private biography ${digit}`,
      formatVersion: 1,
      identitySuiteId: 1,
    }),
    ...(mode ? { metadataUnlockPersistence: mode } : {}),
  };
}

describe("tree metadata persistence lifetime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    persistence.blobs.clear();
    persistence.readBlob.mockImplementation(
      async (key: string) => persistence.blobs.get(key) ?? null,
    );
    persistence.writeBlob.mockImplementation(
      async (key: string, nodes: Record<string, NodeData>) => {
        persistence.blobs.set(key, structuredClone(nodes));
      },
    );
    persistence.deleteBlob.mockImplementation(async (key: string) => {
      persistence.blobs.delete(key);
    });
  });

  it("filters automatic snapshots while preserving device and legacy unlocks", async () => {
    const session = unlockedNode("1", "session");
    const device = unlockedNode("2", "device");
    const legacy = unlockedNode("3");
    const snapshot = { [session.id]: session, [device.id]: device, [legacy.id]: legacy };

    await writeTreeNodesSnapshot("automatic-lifetimes", snapshot);

    const durable = persistence.blobs.get("automatic-lifetimes")!;
    expect(durable[session.id]).toEqual(clearMetadataUnlock(session));
    expect(durable[device.id]).toEqual(device);
    expect(durable[legacy.id]).toEqual(legacy);
    expect(JSON.stringify(durable)).not.toContain(session.biography);
    expect(JSON.stringify(durable)).not.toContain(session.fullName);
    expect(isMetadataUnlockUsable(snapshot[session.id])).toBe(true);
  });

  it("never carries a session unlock into a different device version's merged write", async () => {
    const session = unlockedNode("4", "session");
    const device = unlockedNode("5", "device");
    const previouslySaved = unlockedNode("6", "device");
    persistence.blobs.set("merged-lifetimes", { [previouslySaved.id]: previouslySaved });

    await updateTreeNodesSnapshot(
      "merged-lifetimes",
      (saved) => ({ ...saved, [session.id]: session, [device.id]: device }),
      captureTreeNodesPersistenceRevision("merged-lifetimes"),
    );

    const durable = persistence.blobs.get("merged-lifetimes")!;
    expect(durable[session.id]).toEqual(clearMetadataUnlock(session));
    expect(durable[device.id]).toEqual(device);
    expect(durable[previouslySaved.id]).toEqual(previouslySaved);
    expect(JSON.stringify(durable)).not.toContain(session.biography);
  });

  it("replaces an older device unlock with public fields when the new choice is session", async () => {
    const oldDevice = unlockedNode("7", "device");
    const session: NodeData = { ...oldDevice, metadataUnlockPersistence: "session" };
    persistence.blobs.set("changed-lifetime", { [oldDevice.id]: oldDevice });

    await updateTreeNodesSnapshot(
      "changed-lifetime",
      (saved) => ({ ...saved, [session.id]: { ...saved[session.id], ...session } }),
      captureTreeNodesPersistenceRevision("changed-lifetime"),
    );

    expect(persistence.blobs.get("changed-lifetime")![session.id]).toEqual(
      clearMetadataUnlock(session),
    );
  });

  it("does not hydrate accidental session plaintext and removes it on the next merged write", async () => {
    const session = unlockedNode("8", "session");
    persistence.blobs.set("accidental-session", { [session.id]: session });

    const hydrated = await readTreeNodesSnapshot("accidental-session");
    expect(hydrated![session.id]).toEqual(clearMetadataUnlock(session));

    await updateTreeNodesSnapshot(
      "accidental-session",
      (saved) => saved,
      captureTreeNodesPersistenceRevision("accidental-session"),
    );
    expect(persistence.blobs.get("accidental-session")![session.id]).toEqual(
      clearMetadataUnlock(session),
    );
  });

  it("does not let stale snapshot or merged writes restore plaintext after clearing", async () => {
    const session = unlockedNode("9", "session");
    const device = unlockedNode("a", "device");
    const snapshot = { [session.id]: session, [device.id]: device };
    const key = "clear-lifetimes";
    const oldRevision = captureTreeNodesPersistenceRevision(key);
    await writeTreeNodesSnapshot(key, snapshot, oldRevision);

    const clearing = clearTreeMetadataUnlocks(key, snapshot);
    const staleSnapshot = writeTreeNodesSnapshot(key, snapshot, oldRevision);
    const staleMerge = updateTreeNodesSnapshot(key, () => snapshot, oldRevision);
    await Promise.all([clearing, staleSnapshot, staleMerge]);

    const expected = {
      [session.id]: clearMetadataUnlock(session),
      [device.id]: clearMetadataUnlock(device),
    };
    expect(persistence.blobs.get(key)).toEqual(expected);
    expect(await readTreeNodesSnapshot(key)).toEqual(expected);
    expect(persistence.writeBlob).toHaveBeenCalledTimes(2);
  });
});
