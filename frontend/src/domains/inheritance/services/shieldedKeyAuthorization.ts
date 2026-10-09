import {
  computeShieldedOwnerCommitment,
  deriveShieldedHeirKeyMaterial,
} from "@deepfamily/protocol-core";
import { getBigInt, getBytes, type BigNumberish } from "ethers";

/** Only supplied within the local asset Worker; never a UI or RPC payload. */
export type ShieldedKeyMaterial = {
  ownerSecret: BigNumberish;
  ownerCommitment: BigNumberish;
  hpkeIkm: string;
};

export function resolveShieldedKeyMaterial(
  input: {
    keyMaterial?: ShieldedKeyMaterial;
    derivedSecretField?: BigNumberish;
  },
  mode?: bigint,
) {
  const legacy =
    input.derivedSecretField === undefined
      ? undefined
      : deriveShieldedHeirKeyMaterial(input.derivedSecretField);
  const supplied = input.keyMaterial;
  if (mode === 1n && !supplied)
    throw new Error("Independent funding authorization requires its original key material");
  const material = supplied ?? legacy;
  if (!material) throw new Error("The original spending and viewing material is required");
  const ownerSecret = getBigInt(material.ownerSecret);
  const ownerCommitment = getBigInt(material.ownerCommitment);
  if (
    computeShieldedOwnerCommitment(ownerSecret) !== ownerCommitment ||
    getBytes(material.hpkeIkm).length !== 32
  )
    throw new Error("Funding key material is inconsistent");
  if (
    mode === 0n &&
    (!legacy ||
      ownerSecret !== legacy.ownerSecret ||
      ownerCommitment !== legacy.ownerCommitment ||
      material.hpkeIkm.toLowerCase() !== legacy.hpkeIkm.toLowerCase())
  )
    throw new Error("Identity-derived authorization requires the canonical identity keys");
  return { ownerSecret, ownerCommitment, hpkeIkm: material.hpkeIkm };
}
