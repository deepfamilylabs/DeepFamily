import { describe, expect, it } from "vitest";
import {
  computeShieldedCiphertextHashField,
  computeShieldedSpendNullifier,
  createLineageTree,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { getBytes } from "ethers";
import { prepareShieldedCreatePolicy, prepareShieldedShield } from "./shieldedNotePreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const derivedSecretField = 7654321n;
const identity = { chainId, poolAddress, derivedSecretField };

async function open(ciphertext: Uint8Array, secret = derivedSecretField) {
  const keys = deriveShieldedHeirKeyMaterial(secret);
  const payload = await decryptShieldedNote({
    hpkeIkm: getBytes(keys.hpkeIkm),
    ciphertext,
    chainId,
    poolAddress,
  });
  try {
    return decodeShieldedNotePayload(payload);
  } finally {
    payload.fill(0);
  }
}

async function localWallet(): Promise<{
  wallet: LocalShieldedWalletSnapshot;
  inputCommitment: bigint;
}> {
  const shield = await prepareShieldedShield({ ...identity, amount: 100n });
  const tree = createLineageTree(shield.outputs.map((output) => output.commitment));
  const ownerCommitment = deriveShieldedHeirKeyMaterial(derivedSecretField).ownerCommitment;
  const ownedNotes: LocalShieldedWalletSnapshot["ownedNotes"] = new Map();
  for (const [index, output] of shield.outputs.entries()) {
    ownedNotes.set(output.commitment, {
      shardId: 0n,
      leafIndex: BigInt(index),
      commitment: output.commitment,
      root: tree.root,
      ciphertext: output.ciphertext,
      ciphertextHashField: output.ciphertextHashField,
      blockNumber: 1,
      logIndex: index,
      note: await open(output.ciphertext),
    });
  }
  return {
    wallet: {
      poolAddress: poolAddress.toLowerCase(),
      chainId,
      toBlock: 1,
      blockHash: `0x${"12".repeat(32)}`,
      shards: new Map([[0n, tree]]),
      ownedNotes,
      spentNullifiers: new Set(),
      walletOwnerCommitment: ownerCommitment,
    },
    inputCommitment: shield.outputs[0].commitment,
  };
}

describe("local shield and policy note preparation", () => {
  it("encrypts both shield outputs, including the zero-value dummy, under the one identity key", async () => {
    const prepared = await prepareShieldedShield({ ...identity, amount: 100n });
    const publicSignals = prepared.witness.publicSignals as string[];
    expect(publicSignals).toHaveLength(32);
    expect(publicSignals[0]).toBe("0");
    expect(publicSignals[25]).toBe("100");
    expect(prepared.witness.outputAmounts).toEqual(["100", "0"]);
    expect(prepared.data.inputRoots).toEqual([0n, 0n]);
    expect(prepared.outputs[0].note.nonce).not.toBe(prepared.outputs[1].note.nonce);
    expect(prepared.outputs[0].commitment).not.toBe(prepared.outputs[1].commitment);
    for (const output of prepared.outputs) {
      expect(output.ciphertext).toHaveLength(512);
      expect(output.ciphertextHashField).toBe(computeShieldedCiphertextHashField(output.ciphertext));
      const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
      const payload = await decryptShieldedNote({
        hpkeIkm: getBytes(keys.hpkeIkm),
        ciphertext: output.ciphertext,
        chainId,
        poolAddress,
      });
      try {
        expect(verifyShieldedNotePayload({
          payload,
          ciphertext: output.ciphertext,
          noteCommitment: output.commitment,
        }).note.kind).toBe("value");
      } finally {
        payload.fill(0);
      }
    }
  });

  it("builds policy and full-value change from a local Merkle proof without querying a leaf", async () => {
    const { wallet, inputCommitment } = await localWallet();
    const prepared = await prepareShieldedCreatePolicy({
      ...identity,
      wallet,
      inputCommitment,
      rootIdentityCommitment: 12345n,
      rootVersionIndex: 3n,
      amountPerPeriod: 10n,
    });
    const publicSignals = prepared.witness.publicSignals as string[];
    expect(publicSignals).toHaveLength(32);
    expect(publicSignals[0]).toBe("1");
    expect(prepared.data.inputShardIds).toEqual([0n, 0n]);
    expect(prepared.data.inputRoots).toEqual([wallet.shards.get(0n)?.root, wallet.shards.get(0n)?.root]);
    expect(prepared.data.inputNullifiers[0]).not.toBe(prepared.data.inputNullifiers[1]);
    expect(prepared.witness.noteDepth).toBe(1);
    expect(prepared.witness.noteSiblings).toHaveLength(32);
    expect(prepared.witness.inputAmount).toBe("100");
    expect(prepared.outputs[0].ciphertext).toHaveLength(512);
    expect(prepared.outputs[1].ciphertext).toHaveLength(512);
    const policyNote = await open(prepared.outputs[0].ciphertext);
    const changeNote = await open(prepared.outputs[1].ciphertext);
    expect(policyNote).toMatchObject({
      kind: "policy",
      rootIdentityCommitment: 12345n,
      rootVersionIndex: 3n,
      amountPerPeriod: 10n,
    });
    expect(changeNote).toMatchObject({ kind: "value", amount: 100n });
    expect(prepared.policyCommitment).toBeGreaterThan(0n);
  });

  it("rejects a spent or mismatched input before producing a policy witness", async () => {
    const { wallet, inputCommitment } = await localWallet();
    const args = {
      ...identity,
      wallet,
      inputCommitment,
      rootIdentityCommitment: 12345n,
      rootVersionIndex: 3n,
      amountPerPeriod: 10n,
    };
    const ownerSecret = deriveShieldedHeirKeyMaterial(derivedSecretField).ownerSecret;
    wallet.spentNullifiers.add(computeShieldedSpendNullifier({ ownerSecret, noteCommitment: inputCommitment }));
    await expect(prepareShieldedCreatePolicy(args)).rejects.toThrow("already been spent");
    wallet.spentNullifiers.clear();
    await expect(prepareShieldedCreatePolicy({ ...args, derivedSecretField: 999n })).rejects.toThrow("does not match");
    wallet.ownedNotes.get(inputCommitment)!.ciphertextHashField = 1n;
    await expect(prepareShieldedCreatePolicy(args)).rejects.toThrow("does not match its public ciphertext");
  });

  it("rejects an invalid shield split and zero policy rate", async () => {
    await expect(prepareShieldedShield({ ...identity, amount: 100n, outputAmounts: [80n, 19n] }))
      .rejects.toThrow("sum to the public deposit");
    const { wallet, inputCommitment } = await localWallet();
    await expect(prepareShieldedCreatePolicy({
      ...identity,
      wallet,
      inputCommitment,
      rootIdentityCommitment: 12345n,
      rootVersionIndex: 3n,
      amountPerPeriod: 0n,
    })).rejects.toThrow();
  });

  it("refuses a single-leaf root that would identify the spent note", async () => {
    const { wallet, inputCommitment } = await localWallet();
    wallet.shards.set(0n, createLineageTree([inputCommitment]));
    await expect(prepareShieldedCreatePolicy({
      ...identity,
      wallet,
      inputCommitment,
      rootIdentityCommitment: 12345n,
      rootVersionIndex: 3n,
      amountPerPeriod: 10n,
    })).rejects.toThrow("Single-leaf note roots cannot be spent privately");
  });
});
