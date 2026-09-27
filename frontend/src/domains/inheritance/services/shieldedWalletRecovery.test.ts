import { describe, expect, it } from "vitest";
import { Interface, type Contract } from "ethers";
import {
  computeShieldedCiphertextHashField,
  computeShieldedAllocationKeyCommitment,
  computeShieldedNoteCommitmentFromPayload,
  computeShieldedSpendNullifier,
  createLineageTree,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
} from "@deepfamily/protocol-core";
import {
  assessShieldedGasWallet,
  getRecoveredTopUpTemplate,
  getRecoveredShieldedNoteProof,
  listRecoveredTopUpTemplates,
  listUnspentRecoveredShieldedNotes,
  recoverLocalShieldedWallet,
} from "./shieldedWalletRecovery";

const ABI = [
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
  "event NullifierSpent(uint256 nullifier)",
];
const context = {
  chainId: 1030n,
  poolAddress: "0x1111111111111111111111111111111111111111",
};
const identity = { derivedSecretField: 13n, identityCommitment: 19n };

async function fixture() {
  const keys = deriveShieldedHeirKeyMaterial(identity.derivedSecretField);
  const ownViewKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const otherKeys = deriveShieldedHeirKeyMaterial(14n);
  const otherViewKey = await deriveShieldedViewPublicKey(otherKeys.hpkeIkm);
  const valuePayload = encodeShieldedValueNotePayload({
    ownerCommitment: keys.ownerCommitment,
    amount: 300n,
    nonce: 29n,
  });
  const budgetPayload = encodeShieldedBudgetNotePayload({
    rootIdentityCommitment: 11n,
    rootVersionIndex: 2n,
    policySalt: 17n,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n),
    heirIdentityCommitment: identity.identityCommitment,
    eligibleFrom: 2_592_001n,
    enrollmentSalt: 23n,
    heirOwnerCommitment: keys.ownerCommitment,
    amountPerPeriod: 100n,
    remaining: 1_200n,
    nonce: 31n,
  });
  const notes = [
    { payload: valuePayload, recipientPublicKey: ownViewKey },
    { payload: budgetPayload, recipientPublicKey: ownViewKey },
    { payload: valuePayload, recipientPublicKey: otherViewKey },
    {
      payload: encodeShieldedValueNotePayload({
        ownerCommitment: otherKeys.ownerCommitment,
        amount: 17n,
        nonce: 37n,
      }),
      recipientPublicKey: ownViewKey,
    },
    { payload: Uint8Array.of(1, 2, 3), recipientPublicKey: ownViewKey },
  ];
  const iface = new Interface(ABI);
  const tree = createLineageTree();
  const logs: Array<{
    data: string;
    topics: string[];
    address: string;
    blockNumber: number;
    index: number;
  }> = [];
  const commitments: bigint[] = [];
  for (const [index, note] of notes.entries()) {
    const ciphertext = await encryptShieldedNote({ ...note, ...context });
    const commitment =
      index === 4
        ? 999n
        : computeShieldedNoteCommitmentFromPayload({
            payload: note.payload,
            ciphertextHashField: computeShieldedCiphertextHashField(ciphertext),
          }).noteCommitment;
    commitments.push(commitment);
    tree.insert(commitment);
    const event = iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
      0n,
      BigInt(index),
      commitment,
      tree.root,
      ciphertext,
    ]);
    logs.push({ ...event, address: context.poolAddress, blockNumber: 1, index });
  }
  const spent = computeShieldedSpendNullifier({
    ownerSecret: keys.ownerSecret,
    noteCommitment: commitments[0],
  });
  const spentEvent = iface.encodeEventLog(iface.getEvent("NullifierSpent")!, [spent]);
  logs.push({ ...spentEvent, address: context.poolAddress, blockNumber: 1, index: notes.length });
  const logFilters: Array<Record<string, unknown>> = [];
  const provider = {
    getNetwork: async () => ({ chainId: context.chainId }),
    getBlockNumber: async () => 1,
    getBlock: async () => ({ hash: `0x${"a".repeat(64)}` }),
    getLogs: async (filter: Record<string, unknown>) => {
      logFilters.push(filter);
      return logs;
    },
  };
  const pool = {
    interface: iface,
    runner: { provider },
    getAddress: async () => context.poolAddress,
    currentShardId: async () => 0n,
    noteShard: async () => ({ size: BigInt(notes.length), root: tree.root }),
  } as unknown as Contract;
  return { pool, commitments, root: tree.root, logFilters };
}

describe("local shielded wallet recovery", () => {
  it("restores a donor's child budget template from an encrypted change memo", async () => {
    const donor = deriveShieldedHeirKeyMaterial(13n);
    const heir = deriveShieldedHeirKeyMaterial(14n);
    const budget = {
      rootIdentityCommitment: 11n,
      rootVersionIndex: 2n,
      policySalt: 17n,
      allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n),
      heirIdentityCommitment: 19n,
      eligibleFrom: 2_592_001n,
      enrollmentSalt: 23n,
      heirOwnerCommitment: heir.ownerCommitment,
      amountPerPeriod: 100n,
      remaining: 1_200n,
      nonce: 31n,
    };
    const budgetPayload = encodeShieldedBudgetNotePayload(budget);
    const budgetCiphertext = await encryptShieldedNote({
      recipientPublicKey: await deriveShieldedViewPublicKey(heir.hpkeIkm),
      payload: budgetPayload,
      ...context,
    });
    const budgetCommitment = computeShieldedNoteCommitmentFromPayload({
      payload: budgetPayload,
      ciphertextHashField: computeShieldedCiphertextHashField(budgetCiphertext),
    }).noteCommitment;
    const changePayload = encodeShieldedValueNotePayload({
      ownerCommitment: donor.ownerCommitment,
      amount: 300n,
      nonce: 37n,
      topUpMemo: { budgetCommitment, budgetNote: budget },
    });
    const changeCiphertext = await encryptShieldedNote({
      recipientPublicKey: await deriveShieldedViewPublicKey(donor.hpkeIkm),
      payload: changePayload,
      ...context,
    });
    const changeCommitment = computeShieldedNoteCommitmentFromPayload({
      payload: changePayload,
      ciphertextHashField: computeShieldedCiphertextHashField(changeCiphertext),
    }).noteCommitment;
    const iface = new Interface(ABI);
    const tree = createLineageTree();
    const logs = [budgetCiphertext, changeCiphertext].map((ciphertext, index) => {
      const commitment = index === 0 ? budgetCommitment : changeCommitment;
      tree.insert(commitment);
      return {
        ...iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
          0n,
          BigInt(index),
          commitment,
          tree.root,
          ciphertext,
        ]),
        address: context.poolAddress,
        blockNumber: 1,
        index,
      };
    });
    const provider = {
      getNetwork: async () => ({ chainId: context.chainId }),
      getBlockNumber: async () => 1,
      getBlock: async () => ({ hash: `0x${"a".repeat(64)}` }),
      getLogs: async () => logs,
    };
    const pool = {
      interface: iface,
      runner: { provider },
      getAddress: async () => context.poolAddress,
      currentShardId: async () => 0n,
      noteShard: async () => ({ size: 2n, root: tree.root }),
    } as unknown as Contract;
    const restored = await recoverLocalShieldedWallet(pool, 13n, { fromBlock: 1 });
    expect([...restored.ownedNotes.keys()]).toEqual([changeCommitment]);
    expect(listRecoveredTopUpTemplates(restored)).toHaveLength(1);
    expect(getRecoveredTopUpTemplate(restored, budgetCommitment)).toMatchObject({
      commitment: budgetCommitment,
      shardId: 0n,
      note: budget,
    });
    expect(getRecoveredTopUpTemplate(restored, budgetCommitment).ciphertext).toEqual(
      budgetCiphertext,
    );
    await expect(recoverLocalShieldedWallet(pool, 14n, { fromBlock: 1 })).resolves.toMatchObject({
      topUpTemplates: new Map(),
    });
    const forgedPayload = encodeShieldedValueNotePayload({
      ownerCommitment: donor.ownerCommitment,
      amount: 300n,
      nonce: 38n,
      topUpMemo: { budgetCommitment: budgetCommitment + 1n, budgetNote: budget },
    });
    const forgedCiphertext = await encryptShieldedNote({
      recipientPublicKey: await deriveShieldedViewPublicKey(donor.hpkeIkm),
      payload: forgedPayload,
      ...context,
    });
    const forgedCommitment = computeShieldedNoteCommitmentFromPayload({
      payload: forgedPayload,
      ciphertextHashField: computeShieldedCiphertextHashField(forgedCiphertext),
    }).noteCommitment;
    tree.update(1n, forgedCommitment);
    logs[1] = {
      ...iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
        0n,
        1n,
        forgedCommitment,
        tree.root,
        forgedCiphertext,
      ]),
      address: context.poolAddress,
      blockNumber: 1,
      index: 1,
    };
    const forgedRecovery = await recoverLocalShieldedWallet(pool, 13n, { fromBlock: 1 });
    expect([...forgedRecovery.ownedNotes.keys()]).toEqual([forgedCommitment]);
    expect(listRecoveredTopUpTemplates(forgedRecovery)).toHaveLength(0);
    expect(() => getRecoveredTopUpTemplate(forgedRecovery, budgetCommitment)).toThrow(
      "not recoverable",
    );
  });

  it("decrypts every public event locally, verifies commitments, and builds an owned path", async () => {
    const { pool, commitments, root, logFilters } = await fixture();
    const snapshot = await recoverLocalShieldedWallet(pool, identity, { fromBlock: 1 });
    expect([...snapshot.ownedNotes.keys()]).toEqual(commitments.slice(0, 2));
    expect(snapshot.ownedNotes.get(commitments[0])?.note).toMatchObject({
      kind: "value",
      amount: 300n,
    });
    expect(snapshot.ownedNotes.get(commitments[1])?.note).toMatchObject({
      kind: "budget",
      remaining: 1_200n,
    });
    expect(snapshot.shards.get(0n)?.sizeBigInt).toBe(5n);
    expect(getRecoveredShieldedNoteProof(snapshot, commitments[0])).toMatchObject({
      shardId: 0n,
      root,
      proofIndex: 0n,
    });
    expect(getRecoveredShieldedNoteProof(snapshot, commitments[0]).siblings).toHaveLength(32);
    expect(
      listUnspentRecoveredShieldedNotes(snapshot, identity.derivedSecretField).map(
        (n) => n.commitment,
      ),
    ).toEqual([commitments[1]]);
    const example = snapshot.ownedNotes.get(commitments[0])!;
    snapshot.ownedNotes.set(987n, {
      ...example,
      commitment: 987n,
      note: {
        kind: "policy",
        rootIdentityCommitment: 11n,
        rootVersionIndex: 0n,
        amountPerPeriod: 100n,
        policySalt: 2n,
        allocationKey: 3n,
        nonce: 4n,
      },
    });
    expect(
      listUnspentRecoveredShieldedNotes(snapshot, identity.derivedSecretField).map(
        (n) => n.commitment,
      ),
    ).toEqual([commitments[1]]);
    expect(logFilters).toHaveLength(1);
    expect(logFilters[0].topics).toHaveLength(1);

    // Clearing the cache still restores every note from public chain data.
    const restored = await recoverLocalShieldedWallet(pool, identity, { fromBlock: 1 });
    expect([...restored.ownedNotes.keys()]).toEqual(commitments.slice(0, 2));
  });

  it("returns no owned notes for the wrong key and refuses cross-identity cache reuse", async () => {
    const { pool } = await fixture();
    const correct = await recoverLocalShieldedWallet(pool, identity, { fromBlock: 1 });
    const wrong = await recoverLocalShieldedWallet(pool, 15n, { fromBlock: 1 });
    expect(wrong.ownedNotes.size).toBe(0);
    await expect(recoverLocalShieldedWallet(pool, 15n, { previous: correct })).rejects.toThrow(
      "another identity",
    );
    expect(() => listUnspentRecoveredShieldedNotes(correct, 15n)).toThrow("another identity");
  });

  it("reports gas and linkage risks without assuming a fixed CFX fee", () => {
    expect(
      assessShieldedGasWallet({
        gasBalanceDrip: 3n,
        estimatedMaxFeeDrip: 4n,
        directlyFundedFromPublicWallet: true,
        reusedForPublicActivity: true,
        usedForIdentityKeyRegistration: true,
        withdrawingImmediately: true,
        distinctiveWithdrawalAmount: true,
      }),
    ).toEqual({
      canSubmit: false,
      issues: [
        "insufficientGas",
        "directPublicWalletFunding",
        "reusedPublicWallet",
        "identityRegistrationWalletReused",
        "immediateWithdrawal",
        "distinctiveWithdrawalAmount",
      ],
    });
    expect(assessShieldedGasWallet({ gasBalanceDrip: 4n, estimatedMaxFeeDrip: 4n })).toEqual({
      canSubmit: true,
      issues: [],
    });
    expect(
      assessShieldedGasWallet({
        gasBalanceDrip: 4n,
        estimatedMaxFeeDrip: 4n,
        usedForIdentityKeyRegistration: true,
      }),
    ).toEqual({ canSubmit: false, issues: ["identityRegistrationWalletReused"] });
    expect(
      assessShieldedGasWallet({
        gasBalanceDrip: 4n,
        estimatedMaxFeeDrip: 4n,
        directlyFundedFromPublicWallet: true,
      }),
    ).toEqual({ canSubmit: false, issues: ["directPublicWalletFunding"] });
  });
});
