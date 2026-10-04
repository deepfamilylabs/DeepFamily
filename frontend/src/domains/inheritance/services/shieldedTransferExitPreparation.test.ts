import { describe, expect, it } from "vitest";
import {
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedSpendNullifier,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getBigInt, getBytes, hexlify } from "ethers";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import { prepareShieldedShield } from "./shieldedNotePreparation";
import {
  prepareShieldedPrivateTransfer,
  prepareShieldedValueConsolidation,
  prepareShieldedUnshield,
  type ShieldedValueInput,
} from "./shieldedTransferExitPreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const senderSecret = 7654321n;
const secondSecret = 8765432n;
const recipientSecret = 9876543n;
const recipientIdentityCommitment = 12345n;
const checkpoint = { toBlock: 42, blockHash: `0x${"12".repeat(32)}` };

async function walletFixture(secondOwner = false) {
  const sender = await prepareShieldedShield({
    chainId,
    poolAddress,
    derivedSecretField: senderSecret,
    amount: 100n,
    outputAmounts: secondOwner ? [70n, 30n] : [70n, 30n],
  });
  const other = secondOwner
    ? await prepareShieldedShield({
        chainId,
        poolAddress,
        derivedSecretField: secondSecret,
        amount: 20n,
      })
    : undefined;
  const publicOutputs = other
    ? [sender.outputs[0], sender.outputs[1], other.outputs[0], other.outputs[1]]
    : [...sender.outputs];
  const tree = createLineageTree(publicOutputs.map((output) => output.commitment));
  const wallet = (secret: bigint, ownedIndices: number[]): LocalShieldedWalletSnapshot => ({
    chainId,
    poolAddress: poolAddress.toLowerCase(),
    ...checkpoint,
    walletOwnerCommitment: deriveShieldedHeirKeyMaterial(secret).ownerCommitment,
    shards: new Map([[0n, tree]]),
    spentNullifiers: new Set(),
    ownedNotes: new Map(
      ownedIndices.map((index) => {
        const output = publicOutputs[index];
        return [
          output.commitment,
          {
            shardId: 0n,
            leafIndex: BigInt(index),
            commitment: output.commitment,
            root: tree.root,
            ciphertext: output.ciphertext,
            ciphertextHashField: output.ciphertextHashField,
            blockNumber: 42,
            logIndex: index,
            note: {
              kind: "value" as const,
              ownerCommitment: getBigInt(output.note.ownerCommitment),
              amount: getBigInt(output.note.amount),
              nonce: getBigInt(output.note.nonce),
            },
          },
        ];
      }),
    ),
  });
  const senderWallet = wallet(senderSecret, [0, 1]);
  const otherWallet = other ? wallet(secondSecret, [2, 3]) : undefined;
  const input0: ShieldedValueInput = {
    wallet: senderWallet,
    derivedSecretField: senderSecret,
    commitment: sender.outputs[0].commitment,
  };
  const input1: ShieldedValueInput =
    other && otherWallet
      ? {
          wallet: otherWallet,
          derivedSecretField: secondSecret,
          commitment: other.outputs[0].commitment,
        }
      : {
          wallet: senderWallet,
          derivedSecretField: senderSecret,
          commitment: sender.outputs[1].commitment,
        };
  return { senderWallet, otherWallet, input0, input1 };
}

/** Keys from a receive code that the ZK worker has already verified. */
async function recipientFixture(): Promise<VerifiedShieldedRecipient> {
  const keys = deriveShieldedHeirKeyMaterial(recipientSecret);
  return {
    identityCommitment: recipientIdentityCommitment,
    ownerCommitment: keys.ownerCommitment,
    viewingKey: hexlify(await deriveShieldedViewPublicKey(keys.hpkeIkm)),
    personHash: wrapIdentityCommitmentAsPersonHash(recipientIdentityCommitment),
  } as VerifiedShieldedRecipient;
}

async function openedValue(ciphertext: Uint8Array, secret: bigint, commitment: bigint) {
  const keys = deriveShieldedHeirKeyMaterial(secret);
  const payload = await decryptShieldedNote({
    hpkeIkm: getBytes(keys.hpkeIkm),
    ciphertext,
    chainId,
    poolAddress,
  });
  try {
    return verifyShieldedNotePayload(
      { payload, ciphertext, noteCommitment: commitment },
      { chainId, poolAddress },
    ).note;
  } finally {
    payload.fill(0);
  }
}

describe("local private transfer and unshield preparation", () => {
  it("automatically joins owned values without asking for a receive code", async () => {
    const { senderWallet } = await walletFixture();
    const prepared = await prepareShieldedValueConsolidation({
      chainId,
      poolAddress,
      wallet: senderWallet,
      derivedSecretField: senderSecret,
      amount: 90n,
    });
    expect(prepared?.witness.hasSecondInput).toBe("1");
    expect(prepared?.outputs[0].note.amount).toBe(100n);
    expect(prepared?.outputs[1].note.amount).toBe(0n);
    expect(prepared?.outputs[0].note.ownerCommitment).toBe(senderWallet.walletOwnerCommitment);
    await expect(
      prepareShieldedValueConsolidation({
        chainId,
        poolAddress,
        wallet: senderWallet,
        derivedSecretField: senderSecret,
        amount: 70n,
      }),
    ).resolves.toBeUndefined();
    await expect(
      prepareShieldedValueConsolidation({
        chainId,
        poolAddress,
        wallet: senderWallet,
        derivedSecretField: senderSecret,
        amount: 101n,
      }),
    ).rejects.toThrow("balance");
  });

  it("consolidates three value fragments through repeated self-transfers", async () => {
    const { senderWallet } = await walletFixture();
    const append = async (
      outputs: readonly {
        commitment: bigint;
        ciphertext: Uint8Array;
        ciphertextHashField: bigint;
      }[],
    ) => {
      const tree = senderWallet.shards.get(0n)!;
      for (const output of outputs) {
        const leafIndex = tree.sizeBigInt;
        tree.insert(output.commitment);
        senderWallet.ownedNotes.set(output.commitment, {
          shardId: 0n,
          leafIndex,
          commitment: output.commitment,
          root: tree.root,
          ciphertext: output.ciphertext,
          ciphertextHashField: output.ciphertextHashField,
          blockNumber: 42,
          logIndex: Number(leafIndex),
          note: await openedValue(output.ciphertext, senderSecret, output.commitment),
        });
      }
    };
    const extra = await prepareShieldedShield({
      chainId,
      poolAddress,
      derivedSecretField: senderSecret,
      amount: 25n,
    });
    await append(extra.outputs);
    const first = await prepareShieldedValueConsolidation({
      chainId,
      poolAddress,
      wallet: senderWallet,
      derivedSecretField: senderSecret,
      amount: 110n,
    });
    expect(first?.outputs[0].note.amount).toBe(100n);
    for (const nullifier of first!.data.inputNullifiers)
      senderWallet.spentNullifiers.add(getBigInt(nullifier));
    await append(first!.outputs);
    const second = await prepareShieldedValueConsolidation({
      chainId,
      poolAddress,
      wallet: senderWallet,
      derivedSecretField: senderSecret,
      amount: 110n,
    });
    expect(second?.outputs[0].note.amount).toBe(125n);
    for (const nullifier of second!.data.inputNullifiers)
      senderWallet.spentNullifiers.add(getBigInt(nullifier));
    await append(second!.outputs);
    await expect(
      prepareShieldedValueConsolidation({
        chainId,
        poolAddress,
        wallet: senderWallet,
        derivedSecretField: senderSecret,
        amount: 110n,
      }),
    ).resolves.toBeUndefined();
  });

  it("makes two private outputs with exact conservation and a verified recipient key", async () => {
    const { input0, input1 } = await walletFixture();
    const receiver = await recipientFixture();
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0, input1],
      destinations: [
        { kind: "recipient", recipient: receiver, amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ],
    });
    expect(Object.keys(prepared.witness).slice(0, 7)).toEqual([
      "chainId",
      "pool",
      "inputShardIds",
      "inputRoots",
      "inputNullifiers",
      "outputCommitments",
      "ciphertextHashes",
    ]);
    expect(prepared.witness).not.toHaveProperty("periodNullifiers");
    expect(prepared.witness).not.toHaveProperty("recipient");
    expect(prepared.data.inputNullifiers[0]).not.toBe(prepared.data.inputNullifiers[1]);
    expect(prepared.witness.inputAmounts).toEqual(["70", "30"]);
    expect(prepared.witness.hasSecondInput).toBe("1");
    expect(prepared.witness.outputAmounts).toEqual(["60", "40"]);
    expect(prepared.outputs[0].note.ownerCommitment).toBe(
      deriveShieldedHeirKeyMaterial(recipientSecret).ownerCommitment,
    );
    expect(prepared.outputs[0].ciphertext).toHaveLength(512);
    expect(prepared.outputs[1].ciphertext).toHaveLength(512);
    expect(prepared.outputs[0].ciphertextHashField).toBe(
      computeShieldedCiphertextHashField(prepared.outputs[0].ciphertext),
    );
    expect(
      await openedValue(
        prepared.outputs[0].ciphertext,
        recipientSecret,
        prepared.outputs[0].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 60n });
    expect(
      await openedValue(
        prepared.outputs[1].ciphertext,
        senderSecret,
        prepared.outputs[1].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 40n });
    await expect(
      openedValue(prepared.outputs[0].ciphertext, senderSecret, prepared.outputs[0].commitment),
    ).rejects.toThrow();
    expect(
      JSON.stringify(prepared.data, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(receiver.personHash);
  });

  it("transfers from the only recovered value note with a bound dummy second input", async () => {
    const { input0 } = await walletFixture();
    const commitment = BigInt(input0.commitment);
    input0.wallet.ownedNotes = new Map([[commitment, input0.wallet.ownedNotes.get(commitment)!]]);
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0],
      destinations: [
        { kind: "recipient", recipient: await recipientFixture(), amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 10n },
      ],
    });
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    expect(prepared.witness.hasSecondInput).toBe("0");
    expect(prepared.witness.inputAmounts).toEqual(["70", "0"]);
    expect(prepared.witness.inputOwnerSecrets).toEqual([String(ownerSecret), "0"]);
    expect((prepared.witness.inputNonces as string[])[1]).toBe("0");
    expect((prepared.witness.inputDepths as string[])[1]).toBe("0");
    expect((prepared.witness.inputSiblings as string[][])[1]).toEqual(Array(32).fill("0"));
    expect(prepared.data.inputShardIds[1]).toBe(prepared.data.inputShardIds[0]);
    expect(prepared.data.inputRoots[1]).toBe(prepared.data.inputRoots[0]);
    expect(prepared.data.inputNullifiers).toEqual([
      computeShieldedSpendNullifier(
        { ownerSecret, noteCommitment: commitment },
        { chainId, poolAddress },
      ),
      computeShieldedDummyInputNullifier(
        { ownerSecret, noteCommitment: commitment },
        { chainId, poolAddress },
      ),
    ]);
    expect(
      await openedValue(
        prepared.outputs[0].ciphertext,
        recipientSecret,
        prepared.outputs[0].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 60n });
    await expect(
      prepareShieldedPrivateTransfer({
        chainId,
        poolAddress,
        inputs: [input0],
        destinations: [
          { kind: "inputOwner", inputIndex: 1, amount: 60n },
          { kind: "inputOwner", inputIndex: 0, amount: 10n },
        ],
      }),
    ).rejects.toThrow("Invalid private transfer input owner index");
    input0.wallet.spentNullifiers.add(BigInt(prepared.data.inputNullifiers[1]));
    await expect(
      prepareShieldedPrivateTransfer({
        chainId,
        poolAddress,
        inputs: [input0],
        destinations: [
          { kind: "inputOwner", inputIndex: 0, amount: 60n },
          { kind: "inputOwner", inputIndex: 0, amount: 10n },
        ],
      }),
    ).rejects.toThrow("already been spent");
  });

  it("accepts two inputs owned by different identities at the same snapshot", async () => {
    const { input0, input1 } = await walletFixture(true);
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0, input1],
      destinations: [
        { kind: "inputOwner", inputIndex: 0, amount: 75n },
        { kind: "inputOwner", inputIndex: 1, amount: 15n },
      ],
    });
    expect(prepared.witness.inputOwnerSecrets).toEqual([
      String(deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret),
      String(deriveShieldedHeirKeyMaterial(secondSecret).ownerSecret),
    ]);
    expect(prepared.witness.outputAmounts).toEqual(["75", "15"]);
    expect(
      await openedValue(
        prepared.outputs[1].ciphertext,
        secondSecret,
        prepared.outputs[1].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 15n });
  });

  it("builds a public withdrawal with private change and zero-value dummy", async () => {
    const { input0 } = await walletFixture();
    const prepared = await prepareShieldedUnshield({
      chainId,
      poolAddress,
      input: input0,
      amount: 30n,
      recipient,
    });
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    expect(prepared.witness.amount).toBe("30");
    expect(prepared.witness.recipient).toBe(String(BigInt(recipient)));
    expect(prepared.witness.inputRoot).toBe(String(prepared.data.inputRoots[0]));
    expect(prepared.data.inputRoots[0]).toBe(prepared.data.inputRoots[1]);
    expect(prepared.data.inputNullifiers).toEqual([
      computeShieldedSpendNullifier(
        { ownerSecret, noteCommitment: input0.commitment },
        { chainId, poolAddress },
      ),
      computeShieldedDummyInputNullifier(
        { ownerSecret, noteCommitment: input0.commitment },
        { chainId, poolAddress },
      ),
    ]);
    expect(prepared.witness.changeAmount).toBe("40");
    expect(
      await openedValue(
        prepared.outputs[0].ciphertext,
        senderSecret,
        prepared.outputs[0].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 40n });
    expect(
      await openedValue(
        prepared.outputs[1].ciphertext,
        senderSecret,
        prepared.outputs[1].commitment,
      ),
    ).toMatchObject({ kind: "value", amount: 0n });
  });

  it("rejects spent, duplicate, mismatched and altered private transfer inputs", async () => {
    const { input0, input1 } = await walletFixture();
    const base = {
      chainId,
      poolAddress,
      inputs: [input0, input1] as const,
      destinations: [
        { kind: "inputOwner", inputIndex: 0, amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ] as const,
    };
    await expect(
      prepareShieldedPrivateTransfer({ ...base, inputs: [input0, input0] }),
    ).rejects.toThrow("two distinct input notes");
    await expect(
      prepareShieldedPrivateTransfer({
        ...base,
        destinations: [
          { kind: "inputOwner", inputIndex: 0, amount: 60n },
          { kind: "inputOwner", inputIndex: 0, amount: 39n },
        ],
      }),
    ).rejects.toThrow("must equal");
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    input0.wallet.spentNullifiers.add(
      computeShieldedSpendNullifier(
        {
          ownerSecret,
          noteCommitment: input0.commitment,
        },
        { chainId, poolAddress },
      ),
    );
    await expect(prepareShieldedPrivateTransfer(base)).rejects.toThrow("already been spent");
    input0.wallet.spentNullifiers.clear();
    await expect(
      prepareShieldedPrivateTransfer({
        ...base,
        inputs: [{ ...input0, derivedSecretField: 999n }, input1],
      }),
    ).rejects.toThrow("does not match");
    input0.wallet.ownedNotes.get(BigInt(input0.commitment))!.ciphertextHashField = 1n;
    await expect(prepareShieldedPrivateTransfer(base)).rejects.toThrow("public ciphertext");
  });

  it("encrypts to the verified viewing key, so another key cannot read the note", async () => {
    const { input0, input1 } = await walletFixture();
    const receiver = await recipientFixture();
    const otherKey = hexlify(
      await deriveShieldedViewPublicKey(deriveShieldedHeirKeyMaterial(secondSecret).hpkeIkm),
    );
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0, input1],
      destinations: [
        {
          kind: "recipient",
          recipient: { ...receiver, viewingKey: otherKey } as VerifiedShieldedRecipient,
          amount: 60n,
        },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ],
    });
    await expect(
      openedValue(prepared.outputs[0].ciphertext, recipientSecret, prepared.outputs[0].commitment),
    ).rejects.toThrow();
    expect(
      await openedValue(
        prepared.outputs[0].ciphertext,
        secondSecret,
        prepared.outputs[0].commitment,
      ),
    ).toMatchObject({ ownerCommitment: receiver.ownerCommitment, amount: 60n });
  });

  it("rejects an invalid withdrawal amount, recipient, dummy spend and exposing root", async () => {
    const { input0 } = await walletFixture();
    const base = { chainId, poolAddress, input: input0, recipient };
    await expect(prepareShieldedUnshield({ ...base, amount: 0n })).rejects.toThrow(
      "must be positive",
    );
    await expect(prepareShieldedUnshield({ ...base, amount: 71n })).rejects.toThrow(
      "exceeds the input note",
    );
    await expect(
      prepareShieldedUnshield({
        ...base,
        amount: 30n,
        recipient: "0x0000000000000000000000000000000000000000",
      }),
    ).rejects.toThrow("must be nonzero");
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    input0.wallet.spentNullifiers.add(
      computeShieldedDummyInputNullifier(
        {
          ownerSecret,
          noteCommitment: input0.commitment,
        },
        { chainId, poolAddress },
      ),
    );
    await expect(prepareShieldedUnshield({ ...base, amount: 30n })).rejects.toThrow(
      "already been spent",
    );
    input0.wallet.spentNullifiers.clear();
    input0.wallet.shards.set(0n, createLineageTree([BigInt(input0.commitment)]));
    await expect(prepareShieldedUnshield({ ...base, amount: 30n })).rejects.toThrow(
      "Single-leaf note roots cannot be spent privately",
    );
  });
});
