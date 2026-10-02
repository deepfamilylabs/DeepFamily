import { describe, expect, it } from "vitest";
import {
  computeShieldedCiphertextHashField,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { getBytes } from "ethers";
import { prepareShieldedShield } from "./shieldedNotePreparation";

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

describe("local shield preparation", () => {
  it("encrypts both shield outputs, including the zero-value dummy, under the one identity key", async () => {
    const prepared = await prepareShieldedShield({ ...identity, amount: 100n });
    expect(prepared.witness.amount).toBe("100");
    expect(prepared.witness).not.toHaveProperty("inputNullifiers");
    expect(prepared.witness.outputAmounts).toEqual(["100", "0"]);
    expect(prepared.data.inputRoots).toEqual([0n, 0n]);
    expect(prepared.outputs[0].note.nonce).not.toBe(prepared.outputs[1].note.nonce);
    expect(prepared.outputs[0].commitment).not.toBe(prepared.outputs[1].commitment);
    for (const output of prepared.outputs) {
      expect(output.ciphertext).toHaveLength(512);
      expect(output.ciphertextHashField).toBe(
        computeShieldedCiphertextHashField(output.ciphertext),
      );
      const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
      const payload = await decryptShieldedNote({
        hpkeIkm: getBytes(keys.hpkeIkm),
        ciphertext: output.ciphertext,
        chainId,
        poolAddress,
      });
      try {
        expect(
          verifyShieldedNotePayload({
            payload,
            ciphertext: output.ciphertext,
            noteCommitment: output.commitment,
          }).note.kind,
        ).toBe("value");
      } finally {
        payload.fill(0);
      }
    }
  });

  it("rejects an invalid shield split", async () => {
    await expect(
      prepareShieldedShield({ ...identity, amount: 100n, outputAmounts: [80n, 19n] }),
    ).rejects.toThrow("sum to the public deposit");
  });
});
