import { describe, expect, it } from "vitest";
import { Interface, keccak256, toBeHex, zeroPadValue, type Contract } from "ethers";
import { computeShieldedRegistrationLeaf, createLineageTree } from "@deepfamily/protocol-core";
import { getLocalHeirKeyProof, loadKeyRegistrySnapshot } from "./shieldedKeyRegistryChain";

const ABI = [
  "event ViewingKeyRegistered(bytes32 indexed personHash,uint256 identityCommitment,bytes32 viewingKey,uint256 ownerCommitment)",
  "event KeyLeafAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
];
const ADDRESS = "0x1111111111111111111111111111111111111111";
const TX_HASH = `0x${"aa".repeat(32)}`;
const VIEWING_KEY = `0x${"42".repeat(32)}`;

function fixture(forgeRoot = false, singleLeaf = false) {
  const iface = new Interface(ABI);
  const identityCommitment = 123456n;
  const ownerCommitment = 789n;
  const personHash = keccak256(zeroPadValue(toBeHex(identityCommitment), 32));
  const limb = BigInt(`0x${"42".repeat(16)}`);
  const leaf = computeShieldedRegistrationLeaf({
    identityCommitment,
    ownerCommitment,
    viewKeyHi: limb,
    viewKeyLo: limb,
  });
  const secondIdentityCommitment = identityCommitment + 1n;
  const secondOwnerCommitment = ownerCommitment + 1n;
  const secondPersonHash = keccak256(zeroPadValue(toBeHex(secondIdentityCommitment), 32));
  const secondLeaf = computeShieldedRegistrationLeaf({
    identityCommitment: secondIdentityCommitment,
    ownerCommitment: secondOwnerCommitment,
    viewKeyHi: limb,
    viewKeyLo: limb,
  });
  const root = singleLeaf ? leaf : createLineageTree([leaf, secondLeaf]).root;
  const registered = iface.encodeEventLog(iface.getEvent("ViewingKeyRegistered")!, [
    personHash,
    identityCommitment,
    VIEWING_KEY,
    ownerCommitment,
  ]);
  const appended = iface.encodeEventLog(iface.getEvent("KeyLeafAppended")!, [
    0n,
    0n,
    leaf,
    forgeRoot ? leaf + 1n : leaf,
  ]);
  const logs = [
    { ...registered, address: ADDRESS, blockNumber: 1, index: 0, transactionHash: TX_HASH },
    { ...appended, address: ADDRESS, blockNumber: 1, index: 1, transactionHash: TX_HASH },
  ];
  if (!singleLeaf) {
    const secondTxHash = `0x${"cc".repeat(32)}`;
    const secondRegistered = iface.encodeEventLog(iface.getEvent("ViewingKeyRegistered")!, [
      secondPersonHash,
      secondIdentityCommitment,
      VIEWING_KEY,
      secondOwnerCommitment,
    ]);
    const secondAppended = iface.encodeEventLog(iface.getEvent("KeyLeafAppended")!, [
      0n,
      1n,
      secondLeaf,
      root,
    ]);
    logs.push(
      {
        ...secondRegistered,
        address: ADDRESS,
        blockNumber: 1,
        index: 2,
        transactionHash: secondTxHash,
      },
      {
        ...secondAppended,
        address: ADDRESS,
        blockNumber: 1,
        index: 3,
        transactionHash: secondTxHash,
      },
    );
  }
  const calls: unknown[] = [];
  const provider = {
    getNetwork: async () => ({ chainId: 71n }),
    getBlockNumber: async () => 1,
    getBlock: async () => ({ hash: `0x${"bb".repeat(32)}` }),
    getLogs: async (filter: unknown) => {
      calls.push(filter);
      return logs;
    },
  };
  const registry = {
    interface: iface,
    runner: { provider },
    getAddress: async () => ADDRESS,
    currentShardId: async () => 0n,
    keyShard: async () => ({ size: singleLeaf ? 1n : 2n, root }),
  } as unknown as Contract;
  return { registry, calls, personHash, leaf, root };
}

describe("shielded key registry public scan", () => {
  it("matches each public key with its Merkle leaf and builds a local witness", async () => {
    const { registry, calls, personHash, leaf, root } = fixture();
    const snapshot = await loadKeyRegistrySnapshot(registry, { fromBlock: 1 });
    expect(snapshot.keys.get(personHash.toLowerCase())?.leaf).toBe(leaf);
    const proof = getLocalHeirKeyProof(snapshot, personHash);
    expect(proof.root).toBe(root);
    expect(proof.proofDepth).toBe(1);
    expect(proof.siblings).toHaveLength(32);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { topics: unknown[][] }).topics).toHaveLength(1);
  });

  it("invalidates the previous snapshot when its mutable trees are transferred", async () => {
    const { registry, personHash } = fixture();
    const first = await loadKeyRegistrySnapshot(registry, { fromBlock: 1 });
    const second = await loadKeyRegistrySnapshot(registry, { previous: first });
    expect(first.invalidated).toBe(true);
    expect(() => getLocalHeirKeyProof(first, personHash)).toThrow("snapshot is invalid");
    expect(getLocalHeirKeyProof(second, personHash).proofDepth).toBe(1);
    await expect(loadKeyRegistrySnapshot(registry, { previous: first })).rejects.toThrow(
      "snapshot is invalid",
    );
  });

  it("rejects the exposed root of a one-key registry shard", async () => {
    const { registry, personHash } = fixture(false, true);
    const snapshot = await loadKeyRegistrySnapshot(registry, { fromBlock: 1 });
    expect(() => getLocalHeirKeyProof(snapshot, personHash)).toThrow("needs at least two keys");
  });

  it("rejects an event root that cannot be replayed", async () => {
    const { registry } = fixture(true);
    await expect(loadKeyRegistrySnapshot(registry, { fromBlock: 1 })).rejects.toThrow(
      "root does not match replay",
    );
  });
});
