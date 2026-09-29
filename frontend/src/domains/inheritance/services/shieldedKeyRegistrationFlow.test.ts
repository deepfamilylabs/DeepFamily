import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbiCoder, type Contract, type Signer } from "ethers";
import {
  computeIdentityFromDerivedSecret,
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationSalt,
  deriveShieldedHeirKeyMaterial,
} from "@deepfamily/protocol-core";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import { registerShieldedHeirKey } from "./shieldedKeyRegistrationFlow";

const mocks = vi.hoisted(() => ({ zkWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: mocks.zkWorkerCall,
}));

const REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x2222222222222222222222222222222222222222";
const PROOF = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};

function identityMaterial(): IdentityMaterialV1Result {
  const identity = {
    fullName: "Test Person",
    gender: 1,
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
  };
  const material = computeIdentityFromDerivedSecret({
    identity,
    identitySuiteId: 1,
    derivedSecretField: 13n,
  });
  return {
    identitySuiteId: material.identitySuiteId,
    identity: material.identity,
    derivedSecretField: material.derivedSecretField.toString(),
    nameField: material.nameField.toString(),
    packedBirthGenderField: material.packedBirthGenderField.toString(),
    suiteCommitment: material.suiteCommitment.toString(),
    nameSecretCommitment: material.nameSecretCommitment.toString(),
    identityCommitment: material.identityCommitment.toString(),
    personHash: material.personHash,
  };
}

function fixture() {
  let chainId = 1030n;
  let gasBalance = 10n ** 18n;
  const receipt = { status: 1 };
  const estimateGas = vi.fn(async () => 200_000n);
  const register = Object.assign(
    vi.fn(async () => ({ hash: "0xregister", wait: async () => receipt })),
    { estimateGas },
  );
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId })),
    getBalance: vi.fn(async () => gasBalance),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 1_000_000_000n, gasPrice: null })),
  };
  const signer = {
    provider,
    getAddress: vi.fn(async () => WALLET_ADDRESS),
  } as unknown as Signer;
  const registry = {
    getAddress: vi.fn(async () => REGISTRY_ADDRESS),
    connect: vi.fn(() => ({ register })),
  } as unknown as Contract;
  const input = {
    registry,
    signer,
    expectedChainId: 1030n,
    identity: identityMaterial(),
  };
  return {
    input,
    register,
    estimateGas,
    setChainId: (value: bigint) => {
      chainId = value;
    },
    setBalance: (value: bigint) => {
      gasBalance = value;
    },
  };
}

beforeEach(() => {
  mocks.zkWorkerCall.mockReset();
  mocks.zkWorkerCall.mockImplementation(async (_name, params) => ({
    proof: PROOF,
    publicSignals: params.expectedPublicSignals,
  }));
});

describe("shielded heir key self-registration", () => {
  it("derives the HPKE key, proves seven bound signals locally, and signs the shared ABC proof envelope", async () => {
    const f = fixture();
    const stages: string[] = [];
    const result = await registerShieldedHeirKey({
      ...f.input,
      onStage: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(["derivingKey", "proving", "checkingGas", "submitting", "confirming"]);
    expect(result).toMatchObject({
      transactionHash: "0xregister",
      ownerCommitment: deriveShieldedHeirKeyMaterial(13n).ownerCommitment,
      gasEstimate: 200_000n,
      gasLimit: 240_000n,
    });
    expect(result.viewingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mocks.zkWorkerCall).toHaveBeenCalledWith(
      "generateShieldedProof",
      expect.objectContaining({ circuit: "keyRegistration" }),
      { timeoutMs: 1_200_000 },
    );
    const params = mocks.zkWorkerCall.mock.calls[0][1];
    const signals = params.expectedPublicSignals;
    const publicKey = BigInt(result.viewingKey);
    expect(signals).toHaveLength(7);
    expect(signals[0]).toBe(result.ownerCommitment.toString());
    expect(signals[1]).toBe((publicKey & ((1n << 128n) - 1n)).toString());
    expect(signals[2]).toBe((publicKey >> 128n).toString());
    expect(signals[3]).toBe("1030");
    expect(signals[4]).toBe(BigInt(REGISTRY_ADDRESS).toString());
    expect(signals[5]).toBe(result.registrationTag.toString());
    expect(signals[6]).toBe(result.registrationLeaf.toString());
    expect(signals).not.toContain(f.input.identity.identityCommitment);
    expect(result.registrationSalt).toBe(
      computeShieldedRegistrationSalt({
        derivedSecretField: 13n,
        identityCommitment: BigInt(f.input.identity.identityCommitment),
        chainId: 1030n,
        registryAddress: REGISTRY_ADDRESS,
      }),
    );
    expect(result.registrationLeaf).toBe(
      computeShieldedRegistrationLeaf({
        identityCommitment: BigInt(f.input.identity.identityCommitment),
        ownerCommitment: result.ownerCommitment,
        viewKeyLo: publicKey & ((1n << 128n) - 1n),
        viewKeyHi: publicKey >> 128n,
        salt: result.registrationSalt,
      }),
    );
    expect(signals).not.toContain(result.registrationSalt.toString());
    expect(params.witness.derivedSecretField).toBe("13");
    expect(params.witness.identityCommitment).toBe(f.input.identity.identityCommitment);
    expect(params.witness.registrationLeaf).toBe(result.registrationLeaf.toString());
    expect(params.witness.rawPassphrase).toBeUndefined();
    expect(f.register).toHaveBeenCalledWith(
      result.ownerCommitment,
      result.viewingKey,
      result.registrationTag,
      result.registrationLeaf,
      AbiCoder.defaultAbiCoder().encode(
        ["uint256[2]", "uint256[2][2]", "uint256[2]"],
        [
          [1n, 2n],
          [
            [4n, 3n],
            [6n, 5n],
          ],
          [7n, 8n],
        ],
      ),
      { gasLimit: 240_000n },
    );
    expect(f.input.registry.connect).toHaveBeenCalledWith(f.input.signer);
  });

  it("rejects mismatched identity material before asking the proof worker", async () => {
    const f = fixture();
    f.input.identity.identityCommitment = "123";
    await expect(registerShieldedHeirKey(f.input)).rejects.toThrow(
      "does not match the existing passphrase-derived secret",
    );
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });

  it("rejects a swapped or changed public key signal before transaction submission", async () => {
    const f = fixture();
    mocks.zkWorkerCall.mockImplementationOnce(async (_name, params) => {
      const publicSignals = [...params.expectedPublicSignals];
      [publicSignals[1], publicSignals[2]] = [publicSignals[2], publicSignals[1]];
      return { proof: PROOF, publicSignals };
    });
    await expect(registerShieldedHeirKey(f.input)).rejects.toThrow(
      "public signal 1 does not match transaction",
    );
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(f.register).not.toHaveBeenCalled();
  });

  it("refuses a wrong chain before key derivation and proving", async () => {
    const f = fixture();
    f.setChainId(1n);
    await expect(registerShieldedHeirKey(f.input)).rejects.toThrow("wrong network");
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });

  it("requires enough CFX for the estimated registration gas", async () => {
    const f = fixture();
    f.setBalance(1n);
    await expect(registerShieldedHeirKey(f.input)).rejects.toThrow(
      "CFX transaction wallet needs at least",
    );
    expect(f.register).not.toHaveBeenCalled();
  });
});
