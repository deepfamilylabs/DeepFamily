import { describe, expect, it } from "vitest";
import { AbiCoder, Interface, type ContractRunner } from "ethers";
import PoolArtifact from "../../abi/ShieldedNativePool.json";
import RegistryArtifact from "../../abi/ReceiveRegistry.json";
import SourceArtifact from "../../abi/EligibilitySource.json";
import LetterArtifact from "../../abi/LetterArchive.json";
import {
  POOL_ABI,
  RECEIVE_REGISTRY_ABI,
  ELIGIBILITY_SOURCE_ABI,
  LETTER_ABI,
  ReceiveChain,
  buildActionData,
  encodeProtocolProof,
} from "./receiveChain";
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};
describe("receiving chain transport", () => {
  it("matches the canonical receiving-only operation ABI", () => {
    for (const [declared, compiled, methods] of [
      [
        POOL_ABI,
        PoolArtifact.abi,
        [
          "depositBudget",
          "claimBudget",
          "transfer",
          "shield",
          "unshield",
          "budgetRecords",
          "RECEIVE_REGISTRY",
        ],
      ],
      [
        RECEIVE_REGISTRY_ABI,
        RegistryArtifact.abi,
        ["verifyReceive", "verifyBudgetCapability", "validateBudgetRoleStatus"],
      ],
      [ELIGIBILITY_SOURCE_ABI, SourceArtifact.abi, ["isRoleRevoked", "getSourceProof"]],
      [LETTER_ABI, LetterArtifact.abi, ["registerLetter", "RECEIVE_REGISTRY"]],
    ] as const) {
      const actual = new Interface(declared),
        expected = new Interface(compiled);
      for (const name of methods)
        expect(actual.getFunction(name)?.format("sighash")).toBe(
          expected.getFunction(name)?.format("sighash"),
        );
    }
  });
  it("encodes exactly256bytes with Solidity Fp2 order and rejects rounded/infinite points", () => {
    const encoded = encodeProtocolProof(proof);
    expect((encoded.length - 2) / 2).toBe(256);
    const values = AbiCoder.defaultAbiCoder().decode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      encoded,
    );
    expect(Array.from(values[1][0])).toEqual([4n, 3n]);
    expect(Array.from(values[1][1])).toEqual([6n, 5n]);
    expect(() => encodeProtocolProof({ ...proof, pi_a: [0n, 0n] })).toThrow(/infinity/);
    expect(() =>
      encodeProtocolProof({ ...proof, pi_a: [Number.MAX_SAFE_INTEGER + 1, 2n] }),
    ).toThrow();
    expect(() => encodeProtocolProof({ ...proof, pi_a: [1n, 2n, 0n] })).toThrow(/affine/);
  });
  it("builds a single-donor canonical action with the canonical public fields", () => {
    const action = buildActionData({
      inputShardId: 3n,
      inputRoot: 11n,
      inputNullifier: 13n,
      outputCommitments: [17n, 19n],
      outputCiphertexts: [new Uint8Array(512), new Uint8Array(512)],
    });
    expect(action.inputShardIds).toEqual([3n]);
    expect(action.inputRoots).toEqual([11n]);
    expect(action.inputNullifiers).toEqual([13n]);
    expect(Object.keys(action).sort()).toEqual([
      "inputNullifiers",
      "inputRoots",
      "inputShardIds",
      "outputCiphertexts",
      "outputCommitments",
    ]);
    expect(() =>
      buildActionData({
        inputShardId: 1n << 128n,
        inputRoot: 1n,
        inputNullifier: 2n,
        outputCommitments: [3n, 4n],
        outputCiphertexts: [new Uint8Array(512), new Uint8Array(512)],
      }),
    ).toThrow();
  });
  it("treats only registered qualification-status reverts as unavailable and preserves RPC failures", async () => {
    const deployment = {
      chainId: 31337n,
      registryAddress: "0x0000000000000000000000000000000000001234",
      poolAddress: "0x0000000000000000000000000000000000004321",
    };
    const registry = new Interface(RECEIVE_REGISTRY_ABI),
      pool = new Interface(POOL_ABI);
    let failure: unknown;
    const runner = {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      call: async (transaction: { to: string; data: string }) => {
        if (transaction.to.toLowerCase() === deployment.poolAddress.toLowerCase()) {
          const method = pool.parseTransaction({ data: transaction.data })!.name;
          return pool.encodeFunctionResult(method, [
            method === "protocolVersion" ? 1n : deployment.registryAddress,
          ]);
        }
        if (failure) throw failure;
        return registry.encodeFunctionResult("validateBudgetRoleStatus", [true]);
      },
    } as unknown as ContractRunner;
    const chain = new ReceiveChain(deployment, runner);
    const status = {
      issuanceRoot: 11n,
      childRoleIndex: 17n,
      endorsementRoleIndex: 19n,
      trustedRoleIndex: 23n,
    };
    expect(await chain.checkClaimQualification(status)).toBe(true);
    for (const [name, args] of [
      ["UnknownIssuanceRoot", []],
      ["QualificationRevoked", [0]],
      ["QualificationRevoked", [2]],
    ] as const) {
      failure = { code: "CALL_EXCEPTION", data: registry.encodeErrorResult(name, args) };
      expect(await chain.checkClaimQualification(status)).toBe(false);
    }
    const unknownError = new Interface(["error InvalidField()"]);
    failure = { code: "CALL_EXCEPTION", data: unknownError.encodeErrorResult("InvalidField") };
    await expect(chain.checkClaimQualification(status)).rejects.toMatchObject({
      code: "CALL_EXCEPTION",
      data: unknownError.encodeErrorResult("InvalidField"),
    });
    failure = { code: "CALL_EXCEPTION", data: registry.getError("QualificationRevoked")!.selector };
    await expect(chain.checkClaimQualification(status)).rejects.toBeTruthy();
    failure = {
      code: "CALL_EXCEPTION",
      data: registry.encodeErrorResult("QualificationRevoked", [255]),
    };
    await expect(chain.checkClaimQualification(status)).rejects.toMatchObject({
      code: "CALL_EXCEPTION",
    });
    const networkFailure = Object.assign(new Error("RPC unavailable"), {
      code: "NETWORK_ERROR",
      data: registry.encodeErrorResult("QualificationRevoked", [1]),
    });
    failure = networkFailure;
    await expect(chain.checkClaimQualification(status)).rejects.toBe(networkFailure);
  });
});
