import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import {
  buildShieldedKeyRegistrationPublicSignals,
  computeIdentityFromDerivedSecret,
  computeShieldedRegistrationSalt,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
} from "@deepfamily/protocol-core";
import {
  hexlify,
  type Contract,
  type ContractTransactionResponse,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";

export type ShieldedKeyRegistrationStage =
  | "derivingKey"
  | "proving"
  | "checkingGas"
  | "submitting"
  | "confirming";

export type RegisterShieldedHeirKeyInput = {
  registry: Contract;
  signer: Signer;
  expectedChainId: bigint;
  /** The existing identity passphrase has already been derived locally. */
  identity: IdentityMaterialV1Result;
  onStage?: (stage: ShieldedKeyRegistrationStage) => void;
  proofTimeoutMs?: number;
};

export type ShieldedKeyRegistrationResult = {
  transactionHash: string;
  receipt: TransactionReceipt;
  ownerCommitment: bigint;
  viewingKey: string;
  registrationTag: bigint;
  registrationLeaf: bigint;
  /** Share only with a payer through the private payment code. */
  registrationSalt: bigint;
  gasEstimate: bigint;
  gasLimit: bigint;
};

type RegisterMethod = ((...args: unknown[]) => Promise<ContractTransactionResponse>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};

async function assertSignerNetwork(signer: Signer, expectedChainId: bigint): Promise<void> {
  const network = await signer.provider?.getNetwork();
  if (!network || network.chainId !== expectedChainId) {
    throw new Error("CFX transaction wallet is connected to the wrong network");
  }
}

function assertExpectedSignals(actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== 7 || expected.length !== 7) {
    throw new Error("Shielded key registration proof must have 7 public signals");
  }
  for (let index = 0; index < 7; index += 1) {
    if (BigInt(actual[index]) !== BigInt(expected[index])) {
      throw new Error(
        `Shielded key registration public signal ${index} does not match transaction`,
      );
    }
  }
}

/**
 * Authorize one HPKE viewing key with the existing identity secret. The witness
 * goes only to the local ZK worker; the RPC sees only proof and public inputs.
 */
export async function registerShieldedHeirKey(
  input: RegisterShieldedHeirKeyInput,
): Promise<ShieldedKeyRegistrationResult> {
  const { registry, signer, expectedChainId, identity, onStage } = input;
  await assertSignerNetwork(signer, expectedChainId);
  const provider = signer.provider;
  if (!provider) throw new Error("CFX transaction wallet has no provider");
  const signerAddress = await signer.getAddress();
  if ((await provider.getBalance(signerAddress)) === 0n) {
    throw new Error("CFX transaction wallet has no gas balance");
  }

  const material = computeIdentityFromDerivedSecret({
    identity: identity.identity,
    identitySuiteId: identity.identitySuiteId,
    derivedSecretField: identity.derivedSecretField,
  });
  if (
    material.identityCommitment !== BigInt(identity.identityCommitment) ||
    material.nameField !== BigInt(identity.nameField) ||
    material.packedBirthGenderField !== BigInt(identity.packedBirthGenderField) ||
    material.suiteCommitment !== BigInt(identity.suiteCommitment) ||
    material.personHash.toLowerCase() !== identity.personHash.toLowerCase()
  ) {
    throw new Error("Identity material does not match the existing passphrase-derived secret");
  }

  onStage?.("derivingKey");
  const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
  const viewingKey = hexlify(await deriveShieldedViewPublicKey(keys.hpkeIkm));
  const registryAddress = await registry.getAddress();
  const signals = buildShieldedKeyRegistrationPublicSignals({
    derivedSecretField: material.derivedSecretField,
    identityCommitment: material.identityCommitment,
    ownerCommitment: keys.ownerCommitment,
    viewingKey,
    chainId: expectedChainId,
    registryAddress,
  });
  const registrationSalt = computeShieldedRegistrationSalt({
    derivedSecretField: material.derivedSecretField,
    identityCommitment: material.identityCommitment,
    chainId: expectedChainId,
    registryAddress,
  });
  const witness: ShieldedWitness = {
    ownerCommitment: signals[0].toString(),
    viewKeyLo: signals[1].toString(),
    viewKeyHi: signals[2].toString(),
    chainId: signals[3].toString(),
    registryAddress: signals[4].toString(),
    registrationTag: signals[5].toString(),
    registrationLeaf: signals[6].toString(),
    identityCommitment: material.identityCommitment.toString(),
    nameField: material.nameField.toString(),
    derivedSecretField: material.derivedSecretField.toString(),
    isBirthBC: Number(material.identity.isBirthBC),
    birthYear: material.identity.birthYear,
    birthMonth: material.identity.birthMonth,
    birthDay: material.identity.birthDay,
    gender: material.identity.gender,
    suiteId: material.identitySuiteId,
  };
  const expectedSignals = signals.map(String);
  onStage?.("proving");
  const generated = await zkWorkerCall(
    "generateShieldedProof",
    { circuit: "keyRegistration", witness, expectedPublicSignals: expectedSignals },
    { timeoutMs: input.proofTimeoutMs ?? 1_200_000 },
  );
  assertExpectedSignals(generated.publicSignals, expectedSignals);
  const proofData = encodeGroth16AbcProofData(normalizeGroth16Proof(generated.proof));

  await assertSignerNetwork(signer, expectedChainId);
  const connected = registry.connect(signer) as unknown as { register: RegisterMethod };
  const register = connected.register;
  if (typeof register !== "function" || typeof register.estimateGas !== "function") {
    throw new Error("Shielded key registry ABI is missing register");
  }
  const args: unknown[] = [
    keys.ownerCommitment,
    viewingKey,
    signals[5],
    signals[6],
    proofData,
  ];
  onStage?.("checkingGas");
  const gasEstimate = await register.estimateGas(...args);
  const fee = await provider.getFeeData();
  const maximumGasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (maximumGasPrice === null || maximumGasPrice <= 0n) {
    throw new Error("Unable to determine the eSpace gas price");
  }
  const gasLimit = (gasEstimate * 120n + 99n) / 100n;
  const required = gasLimit * maximumGasPrice;
  if ((await provider.getBalance(signerAddress)) < required) {
    throw new Error(`CFX transaction wallet needs at least ${required} wei for gas`);
  }
  await assertSignerNetwork(signer, expectedChainId);
  onStage?.("submitting");
  const tx = await register(...args, { gasLimit });
  onStage?.("confirming");
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Shielded key registration transaction has no receipt");
  return {
    transactionHash: tx.hash,
    receipt,
    ownerCommitment: keys.ownerCommitment,
    viewingKey,
    registrationTag: signals[5],
    registrationLeaf: signals[6],
    registrationSalt,
    gasEstimate,
    gasLimit,
  };
}
