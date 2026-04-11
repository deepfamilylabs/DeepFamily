import { describe, expect, it, vi } from "vitest";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { executeMintFlow } from "./mintNftService";

describe("mintService executeMintFlow", () => {
  it("returns requiresEndorsement when the wallet has not endorsed the target version", async () => {
    const contract = {
      endorsedVersionIndex: vi.fn(async () => 1),
    };

    const result = await executeMintFlow({
      contract,
      address: "0x00000000000000000000000000000000000000aa",
      personHash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
      versionIndex: 2,
      proofEnvelope: {},
      publicSignals: {
        identityCommitment: 1n,
        disclosureBinding: 2n,
        minter: 3n,
        schemaVersion: 1,
        cryptoSuiteVersion: 1,
        hashAlgoId: 1,
      },
      tokenURI: "",
      coreInfo: {
        basicInfo: {
          identityCommitment: "1",
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
      proofEnvelope: { proof: "ok" },
      publicSignals: {
        identityCommitment: 1n,
        disclosureBinding: 2n,
        minter: 3n,
        schemaVersion: 1,
        cryptoSuiteVersion: 1,
        hashAlgoId: 1,
      },
      tokenURI: "ipfs://token",
      coreInfo: {
        basicInfo: {
          identityCommitment: "1",
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
