import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { computeSuiteCommitment } from "@deepfamily/protocol-core";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { executeMintFlow, readMintTargetEnvelopeHeader } from "./mintNftService";

describe("mintService executeMintFlow", () => {
  const identityCommitmentHex = `0x${"01".padStart(64, "0")}`;
  const suiteCommitment = computeSuiteCommitment(1);

  it("reads selfSuiteId only from the hash/length-authenticated target envelope header", async () => {
    const envelope = `0x44464d3101${"00".repeat(11)}00000001`;
    const pointer = "0x0000000000000000000000000000000000000fed";
    const versionDetails = {
      metadata: {
        pointer,
        payloadHash: ethers.keccak256(envelope),
        payloadLength: ethers.getBytes(envelope).length,
      },
    };
    const getVersionDetails = vi.fn(async () => versionDetails);
    const getCode = vi.fn(async () => `0x00${envelope.slice(2)}`);

    await expect(
      readMintTargetEnvelopeHeader({
        personHash: `0x${"12".repeat(32)}`,
        versionIndex: 2,
        getVersionDetails,
        getCode,
      }),
    ).resolves.toEqual({ formatVersion: 1, selfSuiteId: 1, versionDetails });
    expect(getCode).toHaveBeenCalledWith(ethers.getAddress(pointer), "latest");

    versionDetails.metadata.payloadHash = `0x${"ff".repeat(32)}`;
    await expect(
      readMintTargetEnvelopeHeader({
        personHash: `0x${"12".repeat(32)}`,
        versionIndex: 2,
        getVersionDetails,
        getCode,
      }),
    ).rejects.toThrow(/keccak256/i);
  });

  it("returns requiresEndorsement when the wallet has not endorsed the target version", async () => {
    const contract = {
      endorsedVersionIndex: vi.fn(async () => 1),
    };

    const result = await executeMintFlow({
      contract,
      address: "0x00000000000000000000000000000000000000aa",
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
      versionIndex: 2,
      selfSuiteId: 1,
      proofEnvelope: {},
      publicSignals: {
        identityCommitment: 1n,
        disclosureBinding: 2n,
        minter: 3n,
        suiteCommitment,
      },
      tokenURI: "",
      coreInfo: {
        basicInfo: {
          identityCommitment: identityCommitmentHex,
          isBirthBC: false,
          birthYear: 2000,
          birthMonth: 1,
          birthDay: 1,
          gender: 1,
        },
        supplementInfo: {
          fullName: "Test",
          birthPlace: "",
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: "",
          story: "",
        },
      },
      mintPersonVersionNFT: vi.fn(),
    });

    expect(result).toEqual({ requiresEndorsement: true });
  });

  it("rejects a disclosure proof whose suite commitment differs from the routed target header", async () => {
    const contract = { endorsedVersionIndex: vi.fn() };
    await expect(
      executeMintFlow({
        contract,
        address: "0x00000000000000000000000000000000000000aa",
        personHash: `0x${"bb".repeat(32)}`,
        versionIndex: 2,
        selfSuiteId: 1,
        proofEnvelope: {},
        publicSignals: {
          identityCommitment: 1n,
          disclosureBinding: 2n,
          minter: 3n,
          suiteCommitment: 4n,
        },
        tokenURI: "",
        coreInfo: {
          basicInfo: {
            identityCommitment: identityCommitmentHex,
            isBirthBC: false,
            birthYear: 2000,
            birthMonth: 1,
            birthDay: 1,
            gender: 1,
          },
          supplementInfo: {
            fullName: "Test",
            birthPlace: "",
            isDeathBC: false,
            deathYear: 0,
            deathMonth: 0,
            deathDay: 0,
            deathPlace: "",
            story: "",
          },
        },
        mintPersonVersionNFT: vi.fn(),
      }),
    ).rejects.toThrow(/target envelope header/i);
    expect(contract.endorsedVersionIndex).not.toHaveBeenCalled();
  });

  it("submits mint, parses receipt event, and falls back to version details for tokenId", async () => {
    const eventInterface = createDeepFamilyInterface();
    const mintEvent = eventInterface.getEvent("PersonNFTMinted");
    if (!mintEvent) {
      throw new Error("PersonNFTMinted event ABI missing");
    }
    const contractAddress = "0x0000000000000000000000000000000000000abc";
    const encodedLog = eventInterface.encodeEventLog(mintEvent, [
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      17n,
      "0x00000000000000000000000000000000000000bb",
      2n,
      "ipfs://token",
      123n,
    ]);

    const contract = {
      endorsedVersionIndex: vi.fn(async () => 2),
      getAddress: vi.fn(async () => contractAddress),
      runner: {
        provider: {
          getNetwork: vi.fn(async () => ({ chainId: 31337n })),
        },
      },
    };
    const mintPersonVersionNFT = vi.fn(async () => ({
      transactionHash: "0xtxhash",
      blockNumber: 77,
      logs: [
        {
          address: contractAddress,
          topics: encodedLog.topics,
          data: encodedLog.data,
        },
      ],
    }));
    const getVersionDetails = vi.fn(async () => ({ tokenId: 17 }));

    const result = await executeMintFlow({
      contract,
      address: "0x00000000000000000000000000000000000000bb",
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
      versionIndex: 2,
      selfSuiteId: 1,
      proofEnvelope: { proof: "ok" },
      publicSignals: {
        identityCommitment: 1n,
        disclosureBinding: 2n,
        minter: 3n,
        suiteCommitment,
      },
      tokenURI: "ipfs://token",
      coreInfo: {
        basicInfo: {
          identityCommitment: identityCommitmentHex,
          isBirthBC: false,
          birthYear: 2000,
          birthMonth: 1,
          birthDay: 1,
          gender: 1,
        },
        supplementInfo: {
          fullName: "Test",
          birthPlace: "",
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: "",
          story: "",
        },
      },
      mintPersonVersionNFT,
      getVersionDetails,
    });

    expect(result.requiresEndorsement).toBe(false);
    if (result.requiresEndorsement) {
      throw new Error("Expected a minted result");
    }
    expect(mintPersonVersionNFT).toHaveBeenCalledTimes(1);
    expect(mintPersonVersionNFT).toHaveBeenCalledWith(
      { proof: "ok" },
      {
        identityCommitment: 1n,
        disclosureBinding: 2n,
        minter: 3n,
        suiteCommitment,
      },
      2,
      "ipfs://token",
      expect.objectContaining({
        basicInfo: expect.objectContaining({ identityCommitment: identityCommitmentHex }),
      }),
    );
    expect(getVersionDetails).toHaveBeenCalledWith(
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
      2,
    );
    expect(result.tokenId).toBe(17);
    expect(result.event?.tokenURI).toBe("ipfs://token");
    expect(result.event?.owner).toBe("0x00000000000000000000000000000000000000bb");
    expect(result.transactionHash).toBe("0xtxhash");
  });
});
