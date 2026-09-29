import { describe, expect, it } from "vitest";
import {
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationSalt,
  computeShieldedRegistrationTag,
  computeShieldedSpendNullifier,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getBigInt, getBytes } from "ethers";
import type { KeyRegistrySnapshot, PublicHeirKey } from "./shieldedKeyRegistryChain";
import { prepareShieldedShield } from "./shieldedNotePreparation";
import {
  prepareShieldedPrivateTransfer,
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
const registryAddress = "0x3333333333333333333333333333333333333333";
const recipientIdentityCommitment = 12345n;
const recipientRegistrationSalt = computeShieldedRegistrationSalt({
  derivedSecretField: recipientSecret,
  identityCommitment: recipientIdentityCommitment,
  chainId,
  registryAddress,
});
const recipientRegistrationTag = computeShieldedRegistrationTag({
  derivedSecretField: recipientSecret,
  identityCommitment: recipientIdentityCommitment,
  chainId,
  registryAddress,
});
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
    ? await prepareShieldedShield({ chainId, poolAddress, derivedSecretField: secondSecret, amount: 20n })
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
    ownedNotes: new Map(ownedIndices.map((index) => {
      const output = publicOutputs[index];
      return [output.commitment, {
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
      }];
    })),
  });
  const senderWallet = wallet(senderSecret, [0, 1]);
  const otherWallet = other ? wallet(secondSecret, [2, 3]) : undefined;
  const input0: ShieldedValueInput = {
    wallet: senderWallet,
    derivedSecretField: senderSecret,
    commitment: sender.outputs[0].commitment,
  };
  const input1: ShieldedValueInput = other && otherWallet
    ? { wallet: otherWallet, derivedSecretField: secondSecret, commitment: other.outputs[0].commitment }
    : { wallet: senderWallet, derivedSecretField: senderSecret, commitment: sender.outputs[1].commitment };
  return { senderWallet, otherWallet, input0, input1 };
}

async function registryFixture(): Promise<KeyRegistrySnapshot> {
  const makeKey = async (identityCommitment: bigint, secret: bigint): Promise<PublicHeirKey> => {
    const keys = deriveShieldedHeirKeyMaterial(secret);
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(viewingKey);
    const registrationInputs = { derivedSecretField: secret, identityCommitment, chainId, registryAddress };
    return {
      registrationTag: computeShieldedRegistrationTag(registrationInputs),
      ownerCommitment: keys.ownerCommitment,
      viewingKey: `0x${Buffer.from(viewingKey).toString("hex")}`,
      shardId: 0n,
      leafIndex: identityCommitment === recipientIdentityCommitment ? 0n : 1n,
      leaf: computeShieldedRegistrationLeaf({
        identityCommitment,
        ownerCommitment: keys.ownerCommitment,
        viewKeyHi,
        viewKeyLo,
        salt: computeShieldedRegistrationSalt(registrationInputs),
      }),
    };
  };
  const keys = [
    await makeKey(recipientIdentityCommitment, recipientSecret),
    await makeKey(54321n, secondSecret),
  ];
  return {
    chainId,
    registryAddress,
    ...checkpoint,
    shards: new Map([[0n, createLineageTree(keys.map((key) => key.leaf))]]),
    keys: new Map(keys.map((key) => [key.registrationTag, key])),
  };
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
    return verifyShieldedNotePayload({ payload, ciphertext, noteCommitment: commitment }).note;
  } finally {
    payload.fill(0);
  }
}

describe("local private transfer and unshield preparation", () => {
  it("makes two private outputs with exact conservation and a registered recipient key", async () => {
    const { input0, input1 } = await walletFixture();
    const keyRegistry = await registryFixture();
    expect(keyRegistry.keys.get(recipientRegistrationTag)).not.toHaveProperty("personHash");
    expect(keyRegistry.keys.get(recipientRegistrationTag)).not.toHaveProperty("identityCommitment");
    const recipientHash = wrapIdentityCommitmentAsPersonHash(recipientIdentityCommitment);
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0, input1],
      destinations: [
        {
          kind: "registered",
          identityCommitment: recipientIdentityCommitment,
          registrationSalt: recipientRegistrationSalt,
          amount: 60n,
        },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ],
      keyRegistry,
    });
    const signals = prepared.witness.publicSignals as string[];
    expect(signals).toHaveLength(32);
    expect(signals[0]).toBe("6");
    expect(signals.slice(9, 21)).toEqual(Array(12).fill("0"));
    expect(signals.slice(25)).toEqual(Array(7).fill("0"));
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
    expect(await openedValue(prepared.outputs[0].ciphertext, recipientSecret, prepared.outputs[0].commitment))
      .toMatchObject({ kind: "value", amount: 60n });
    expect(await openedValue(prepared.outputs[1].ciphertext, senderSecret, prepared.outputs[1].commitment))
      .toMatchObject({ kind: "value", amount: 40n });
    await expect(openedValue(prepared.outputs[0].ciphertext, senderSecret, prepared.outputs[0].commitment))
      .rejects.toThrow();
    expect(JSON.stringify(prepared.data, (_, value) => typeof value === "bigint" ? value.toString() : value))
      .not.toContain(recipientHash);
  });

  it("can send privately to the first anonymous key before a second key registers", async () => {
    const { input0, input1 } = await walletFixture();
    const keyRegistry = await registryFixture();
    const key = keyRegistry.keys.get(recipientRegistrationTag)!;
    keyRegistry.keys = new Map([[recipientRegistrationTag, key]]);
    keyRegistry.shards = new Map([[0n, createLineageTree([key.leaf])]]);
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0, input1],
      destinations: [
        {
          kind: "registered",
          identityCommitment: recipientIdentityCommitment,
          registrationSalt: recipientRegistrationSalt,
          amount: 60n,
        },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ],
      keyRegistry,
    });
    expect(prepared.outputs[0].note.ownerCommitment).toBe(key.ownerCommitment);
  });

  it("transfers from the only recovered value note with a bound dummy second input", async () => {
    const { input0 } = await walletFixture();
    const commitment = BigInt(input0.commitment);
    input0.wallet.ownedNotes = new Map([[commitment, input0.wallet.ownedNotes.get(commitment)!]]);
    const keyRegistry = await registryFixture();
    const prepared = await prepareShieldedPrivateTransfer({
      chainId,
      poolAddress,
      inputs: [input0],
      destinations: [
        {
          kind: "registered",
          identityCommitment: recipientIdentityCommitment,
          registrationSalt: recipientRegistrationSalt,
          amount: 60n,
        },
        { kind: "inputOwner", inputIndex: 0, amount: 10n },
      ],
      keyRegistry,
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
      computeShieldedSpendNullifier({ ownerSecret, noteCommitment: commitment }),
      computeShieldedDummyInputNullifier({ ownerSecret, noteCommitment: commitment }),
    ]);
    expect(await openedValue(prepared.outputs[0].ciphertext, recipientSecret, prepared.outputs[0].commitment))
      .toMatchObject({ kind: "value", amount: 60n });
    await expect(prepareShieldedPrivateTransfer({
      chainId, poolAddress, inputs: [input0],
      destinations: [
        { kind: "inputOwner", inputIndex: 1, amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 10n },
      ],
    })).rejects.toThrow("Invalid private transfer input owner index");
    input0.wallet.spentNullifiers.add(BigInt(prepared.data.inputNullifiers[1]));
    await expect(prepareShieldedPrivateTransfer({
      chainId, poolAddress, inputs: [input0],
      destinations: [
        { kind: "inputOwner", inputIndex: 0, amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 10n },
      ],
    })).rejects.toThrow("already been spent");
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
    expect(await openedValue(prepared.outputs[1].ciphertext, secondSecret, prepared.outputs[1].commitment))
      .toMatchObject({ kind: "value", amount: 15n });
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
    const signals = prepared.witness.publicSignals as string[];
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    expect(signals).toHaveLength(32);
    expect(signals[0]).toBe("7");
    expect(signals[25]).toBe("30");
    expect(signals[26]).toBe(String(BigInt(recipient)));
    expect(prepared.data.inputRoots[0]).toBe(prepared.data.inputRoots[1]);
    expect(prepared.data.inputNullifiers).toEqual([
      computeShieldedSpendNullifier({ ownerSecret, noteCommitment: input0.commitment }),
      computeShieldedDummyInputNullifier({ ownerSecret, noteCommitment: input0.commitment }),
    ]);
    expect(prepared.witness.changeAmount).toBe("40");
    expect(await openedValue(prepared.outputs[0].ciphertext, senderSecret, prepared.outputs[0].commitment))
      .toMatchObject({ kind: "value", amount: 40n });
    expect(await openedValue(prepared.outputs[1].ciphertext, senderSecret, prepared.outputs[1].commitment))
      .toMatchObject({ kind: "value", amount: 0n });
  });

  it("rejects spent, duplicate, mismatched and altered private transfer inputs", async () => {
    const { input0, input1 } = await walletFixture();
    const base = {
      chainId, poolAddress, inputs: [input0, input1] as const,
      destinations: [
        { kind: "inputOwner", inputIndex: 0, amount: 60n },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ] as const,
    };
    await expect(prepareShieldedPrivateTransfer({ ...base, inputs: [input0, input0] }))
      .rejects.toThrow("two distinct input notes");
    await expect(prepareShieldedPrivateTransfer({ ...base, destinations: [
      { kind: "inputOwner", inputIndex: 0, amount: 60n },
      { kind: "inputOwner", inputIndex: 0, amount: 39n },
    ] })).rejects.toThrow("must equal");
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    input0.wallet.spentNullifiers.add(computeShieldedSpendNullifier({
      ownerSecret,
      noteCommitment: input0.commitment,
    }));
    await expect(prepareShieldedPrivateTransfer(base)).rejects.toThrow("already been spent");
    input0.wallet.spentNullifiers.clear();
    await expect(prepareShieldedPrivateTransfer({ ...base, inputs: [
      { ...input0, derivedSecretField: 999n }, input1,
    ] })).rejects.toThrow("does not match");
    input0.wallet.ownedNotes.get(BigInt(input0.commitment))!.ciphertextHashField = 1n;
    await expect(prepareShieldedPrivateTransfer(base)).rejects.toThrow("public ciphertext");
  });

  it("rejects missing recipient registration and tampered key binding", async () => {
    const { input0, input1 } = await walletFixture();
    const keyRegistry = await registryFixture();
    const base = {
      chainId, poolAddress, inputs: [input0, input1] as const,
      destinations: [
        {
          kind: "registered",
          identityCommitment: recipientIdentityCommitment,
          registrationSalt: recipientRegistrationSalt,
          amount: 60n,
        },
        { kind: "inputOwner", inputIndex: 0, amount: 40n },
      ] as const,
    };
    await expect(prepareShieldedPrivateTransfer(base)).rejects.toThrow("key registry snapshot");
    const key = keyRegistry.keys.get(recipientRegistrationTag)!;
    const originalViewingKey = key.viewingKey;
    key.viewingKey = `0x${"ff".repeat(32)}`;
    await expect(prepareShieldedPrivateTransfer({ ...base, keyRegistry }))
      .rejects.toThrow("Heir has no registered viewing key");
    key.viewingKey = originalViewingKey;
    await expect(prepareShieldedPrivateTransfer({
      ...base,
      keyRegistry,
      destinations: [
        { ...base.destinations[0], registrationSalt: recipientRegistrationSalt + 1n },
        base.destinations[1],
      ],
    })).rejects.toThrow("Heir has no registered viewing key");
  });

  it("rejects an invalid withdrawal amount, recipient, dummy spend and exposing root", async () => {
    const { input0 } = await walletFixture();
    const base = { chainId, poolAddress, input: input0, recipient };
    await expect(prepareShieldedUnshield({ ...base, amount: 0n })).rejects.toThrow("must be positive");
    await expect(prepareShieldedUnshield({ ...base, amount: 71n })).rejects.toThrow("exceeds the input note");
    await expect(prepareShieldedUnshield({
      ...base, amount: 30n, recipient: "0x0000000000000000000000000000000000000000",
    })).rejects.toThrow("must be nonzero");
    const ownerSecret = deriveShieldedHeirKeyMaterial(senderSecret).ownerSecret;
    input0.wallet.spentNullifiers.add(computeShieldedDummyInputNullifier({
      ownerSecret,
      noteCommitment: input0.commitment,
    }));
    await expect(prepareShieldedUnshield({ ...base, amount: 30n }))
      .rejects.toThrow("already been spent");
    input0.wallet.spentNullifiers.clear();
    input0.wallet.shards.set(0n, createLineageTree([BigInt(input0.commitment)]));
    await expect(prepareShieldedUnshield({ ...base, amount: 30n }))
      .rejects.toThrow("Single-leaf note roots cannot be spent privately");
  });
});
