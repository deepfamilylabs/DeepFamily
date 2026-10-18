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

/** Validate explicit spending and viewing keys; preparation never derives missing funds keys. */
export function validateShieldedKeyMaterial(material: ShieldedKeyMaterial) {
  if (!material) throw new Error("The original spending and viewing key material is required");
  const ownerSecret = getBigInt(material.ownerSecret);
  const ownerCommitment = getBigInt(material.ownerCommitment);
  if (
    computeShieldedOwnerCommitment(ownerSecret) !== ownerCommitment ||
    getBytes(material.hpkeIkm).length !== 32
  )
    throw new Error("Funding key material is inconsistent");
  return { ownerSecret, ownerCommitment, hpkeIkm: material.hpkeIkm };
}

/** Mode 0 is bound by the circuit to the heir's canonical identity-derived funds keys. */
export function validateShieldedClaimKeyMaterial(
  material: ShieldedKeyMaterial,
  keyMode: bigint,
  identityDerivedSecretField: BigNumberish,
) {
  const keys = validateShieldedKeyMaterial(material);
  if (keyMode === 0n) {
    const canonical = deriveShieldedHeirKeyMaterial(identityDerivedSecretField);
    if (
      keys.ownerSecret !== canonical.ownerSecret ||
      keys.ownerCommitment !== canonical.ownerCommitment ||
      keys.hpkeIkm.toLowerCase() !== canonical.hpkeIkm.toLowerCase()
    )
      throw new Error("Identity-derived authorization requires the canonical identity keys");
  } else if (keyMode !== 1n) {
    throw new Error("Claim key mode must be identity-derived or independent");
  }
  return keys;
}
