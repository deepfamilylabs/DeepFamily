import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeEndorseFlow } from "./endorseService";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";

const { createDeepTokenContractMock } = vi.hoisted(() => ({
  createDeepTokenContractMock: vi.fn(),
}));

vi.mock("../../../shared/clients/contractFactory", async () => {
  const actual = await vi.importActual<typeof import("../../../shared/clients/contractFactory")>(
    "../../../shared/clients/contractFactory",
  );
  return {
    ...actual,
    createDeepTokenContract: createDeepTokenContractMock,
  };
});

describe("endorseService executeEndorseFlow", () => {
  beforeEach(() => {
    createDeepTokenContractMock.mockReset();
  });

  it("short-circuits when the version was already endorsed", async () => {
    const contract = {
      endorsedVersionIndex: vi.fn(async () => 3),
      DEEP_FAMILY_TOKEN_CONTRACT: vi.fn(),
    } as any;

    const result = await executeEndorseFlow({
      contract,
      signer: {} as any,
      address: "0x00000000000000000000000000000000000000aa",
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
      versionIndex: 3,
      endorseVersion: vi.fn(),
    });

    expect(result).toEqual({ alreadyEndorsed: true });
    expect(contract.DEEP_FAMILY_TOKEN_CONTRACT).not.toHaveBeenCalled();
  });

  it("ensures allowance, submits endorsement, and parses the receipt event", async () => {
    const tokenContract = {
      recentReward: vi.fn(async () => 10n),
      balanceOf: vi.fn(async () => 100n),
      allowance: vi.fn(async () => 0n),
      approve: vi.fn(async () => ({ hash: "0xapprove", wait: vi.fn(async () => ({})) })),
      increaseAllowance: vi.fn(),
      decimals: vi.fn(async () => 18),
      symbol: vi.fn(async () => "DEEP"),
    };
    createDeepTokenContractMock.mockReturnValue(tokenContract);

    const endorseMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => 100n),
      staticCall: vi.fn(async () => undefined),
    });
    const contractAddress = "0x0000000000000000000000000000000000000abc";
    const contract = {
      endorsedVersionIndex: vi.fn(async () => 0),
      DEEP_FAMILY_TOKEN_CONTRACT: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      getAddress: vi.fn(async () => contractAddress),
      endorseVersion: endorseMethod,
      runner: {
        provider: {
          getNetwork: vi.fn(async () => ({ chainId: 31337n })),
        },
      },
    } as any;

    const eventInterface = createDeepFamilyInterface();
    const endorseEvent = eventInterface.getEvent("PersonVersionEndorsed");
    if (!endorseEvent) {
      throw new Error("PersonVersionEndorsed event ABI missing");
    }
    const encodedLog = eventInterface.encodeEventLog(endorseEvent, [
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      "0x00000000000000000000000000000000000000bb",
      2n,
      "0x00000000000000000000000000000000000000cc",
      7n,
      "0x00000000000000000000000000000000000000dd",
      3n,
      10n,
      123n,
    ]);

    const endorseVersion = vi.fn(async () => ({
      hash: "0xtxhash",
      blockNumber: 55,
      logs: [
        {
          address: contractAddress,
          topics: encodedLog.topics,
          data: encodedLog.data,
        },
      ],
    }));

    const result = await executeEndorseFlow({
      contract,
      signer: {} as any,
      address: "0x00000000000000000000000000000000000000bb",
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
      versionIndex: 2,
      endorseVersion,
      suppressToasts: true,
    });

    expect(result.alreadyEndorsed).toBe(false);
    if (result.alreadyEndorsed) {
      throw new Error("Expected a mined endorsement result");
    }
    expect(tokenContract.approve).toHaveBeenCalledWith(contractAddress, 10n);
    expect(endorseVersion).toHaveBeenCalledWith(
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      2,
      expect.objectContaining({
        actionType: 2,
        subjectType: 2,
        uri: expect.stringMatching(/^ipfs:\/\//),
      }),
      { gasLimit: 120n },
      { suppressToasts: true },
    );
    expect(result.approvalTxHash).toBe("0xapprove");
    expect(result.event?.endorsementFee).toBe("10");
    expect(result.event?.recipient).toBe("0x00000000000000000000000000000000000000cc");
    expect(result.transactionHash).toBe("0xtxhash");
  });
});
