import { ethers } from "ethers";
import { readConfirmedDetails } from "@deepfamily/chain-client";
import { createDeepFamilyContract, createDeepFamilyReaderContract } from "../../../shared/clients/contractFactory";
import { parseVersionDetailsResult } from "../../../shared/model";
import type { AddVersionResult } from "./addVersionService";

function sameHex(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export async function assertNewPersonVersion(input: {
  contractAddress: string;
  runner: ethers.ContractRunner;
  personHash: string;
  versionHash: string;
}): Promise<void> {
  const contract = createDeepFamilyContract(input.contractAddress, input.runner);
  if (await contract.versionExists(input.personHash, input.versionHash)) throw duplicateVersionError();
}

function duplicateVersionError(): Error {
  return Object.assign(new Error("DuplicateVersionCommitment"), {
    reason: "DuplicateVersionCommitment",
    __dfDecodedReason: "DuplicateVersionCommitment",
  });
}

export async function verifyConfirmedVersion(input: {
  runner: ethers.ContractRunner;
  contractAddress: string;
  readerAddress: string;
  result: AddVersionResult;
  expectedPersonHash: string;
  expectedFatherHash: string;
  expectedMotherHash: string;
  expectedFatherVersionIndex: number;
  expectedMotherVersionIndex: number;
  expectedSubmitter: string;
  expectedVersionCommitment: bigint;
  expectedMetadataPointer: string;
  expectedPayloadHash: string;
  expectedPayloadLength: number;
}) {
  const deepFamily = createDeepFamilyContract(input.contractAddress, input.runner);
  const reader = createDeepFamilyReaderContract(input.readerAddress, input.runner);
  const [configuredArchive, readerDeepFamily, readerArchive, rawDetails] = await readConfirmedDetails(
    input.result.transactionHash,
    () => Promise.all([
      deepFamily.archive(),
      reader.DEEP_FAMILY(),
      reader.ARCHIVE(),
      reader.getVersionDetails(input.result.hash, input.result.index),
    ]),
  );
  if (
    !sameHex(configuredArchive, readerArchive) ||
    !sameHex(readerDeepFamily, input.contractAddress)
  ) {
    throw new Error("Reader and DeepFamily metadata archive binding mismatch after confirmation");
  }
  const details = parseVersionDetailsResult(rawDetails);
  const version = details.version;
  const metadata = details.metadata;
  const sameUnsignedInteger = (
    actual: string | number | undefined,
    expected: string | number | bigint,
  ): boolean => {
    try {
      return actual !== undefined && BigInt(actual) === BigInt(expected);
    } catch {
      return false;
    }
  };
  const pointerIsValid =
    typeof metadata.pointer === "string" &&
    ethers.isAddress(metadata.pointer) &&
    !sameHex(metadata.pointer, ethers.ZeroAddress);
  const versionMatches =
    sameHex(version.personHash, input.expectedPersonHash) &&
    sameUnsignedInteger(version.versionIndex, input.result.index) &&
    sameHex(version.fatherHash, input.expectedFatherHash) &&
    sameHex(version.motherHash, input.expectedMotherHash) &&
    sameUnsignedInteger(version.fatherVersionIndex, input.expectedFatherVersionIndex) &&
    sameUnsignedInteger(version.motherVersionIndex, input.expectedMotherVersionIndex) &&
    sameHex(version.addedBy, input.expectedSubmitter) &&
    sameUnsignedInteger(version.versionCommitment, input.expectedVersionCommitment);
  const metadataMatches =
    pointerIsValid &&
    sameHex(metadata.pointer, input.expectedMetadataPointer) &&
    sameHex(metadata.payloadHash, input.expectedPayloadHash) &&
    metadata.payloadLength === input.expectedPayloadLength &&
    metadata.segmentCount === Math.ceil(input.expectedPayloadLength / 16_384);
  if (!versionMatches || !metadataMatches) {
    throw new Error(
      "Confirmed Reader version or Archive reference does not match the prepared submission",
    );
  }
  return details;
}

