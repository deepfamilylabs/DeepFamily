import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { parseReceiptEvents } from "../api/txGateway";
import {
  computeSuiteCommitment,
  readMetadataEnvelopeFromRef,
  type BytesLike,
} from "@deepfamily/protocol-core";

export type MintDisclosurePublicSignals = {
  identityCommitment: bigint;
  disclosureBinding: bigint;
  minter: bigint;
  suiteCommitment: bigint;
};

export type MintTargetEnvelopeHeader = {
  formatVersion: number;
  selfSuiteId: number;
};

export type MintVersionDetailsReader = (personHash: string, versionIndex: number) => Promise<any>;

export type MintMetadataCodeReader = (pointer: string, blockTag: "latest") => Promise<BytesLike>;

const readMetadataField = (metadata: any, name: string, tupleIndex: number): unknown =>
  metadata?.[name] ?? metadata?.[tupleIndex];

/**
 * Resolves the suite from the target version's hash/length-authenticated data-contract envelope.
 * Cached UI metadata is deliberately not accepted as the authority for proof routing.
 */
export async function readMintTargetEnvelopeHeader(input: {
  personHash: string;
  versionIndex: number;
  getVersionDetails: MintVersionDetailsReader;
  getCode: MintMetadataCodeReader;
}): Promise<MintTargetEnvelopeHeader & { versionDetails: any }> {
  const versionDetails = await input.getVersionDetails(input.personHash, input.versionIndex);
  const metadata = versionDetails?.metadata ?? versionDetails?.[1];
  if (!metadata) {
    throw new Error("Target version does not contain a metadata reference");
  }

  const pointer = readMetadataField(metadata, "pointer", 0);
  const payloadHash = readMetadataField(metadata, "payloadHash", 1);
  const payloadLength = readMetadataField(metadata, "payloadLength", 2);
  if (typeof pointer !== "string" || typeof payloadHash !== "string") {
    throw new Error("Target version metadata reference is incomplete");
  }

  const verified = await readMetadataEnvelopeFromRef({
    getCode: input.getCode,
    pointer,
    payloadHash,
    payloadLength: payloadLength as bigint | number | string,
  });

  return {
    formatVersion: verified.prefix.formatVersion,
    selfSuiteId: verified.prefix.identitySuiteId,
    versionDetails,
  };
}

export type MintCoreInfo = {
  basicInfo: {
    identityCommitment: string;
    isBirthBC: boolean;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    gender: number;
  };
  supplementInfo: {
    fullName: string;
    birthPlace: string;
    isDeathBC: boolean;
    deathYear: number;
    deathMonth: number;
    deathDay: number;
    deathPlace: string;
    story: string;
  };
};

export type MintPersonVersionNFTFn = (
  proof: any,
  publicSignals: MintDisclosurePublicSignals,
  versionIndex: number,
  tokenURI: string,
  coreInfo: MintCoreInfo,
) => Promise<any>;

export type MintReceiptEvent = {
  personHash: string;
  tokenId: number;
  owner: string;
  versionIndex: number;
  tokenURI: string;
  timestamp: number;
};

export type ExecuteMintFlowParams = {
  contract: any;
  address: string;
  personHash: string;
  versionIndex: number;
  proofEnvelope: any;
  publicSignals: MintDisclosurePublicSignals;
  selfSuiteId: number;
  tokenURI: string;
  coreInfo: MintCoreInfo;
  mintPersonVersionNFT: MintPersonVersionNFTFn;
  getVersionDetails?: (personHash: string, versionIndex: number) => Promise<any>;
};

export type ExecuteMintFlowResult =
  | {
      requiresEndorsement: true;
    }
  | {
      requiresEndorsement: false;
      receipt: any;
      transactionHash: string;
      blockNumber: number;
      tokenId: number;
      event: MintReceiptEvent | null;
    };

export async function executeMintFlow({
  contract,
  address,
  personHash,
  versionIndex,
  proofEnvelope,
  publicSignals,
  selfSuiteId,
  tokenURI,
  coreInfo,
  mintPersonVersionNFT,
  getVersionDetails,
}: ExecuteMintFlowParams): Promise<ExecuteMintFlowResult> {
  if (!Number.isInteger(selfSuiteId) || selfSuiteId <= 0 || selfSuiteId > 0xffff_ffff) {
    throw new Error("Target identity suite must be a nonzero uint32");
  }
  if (publicSignals.suiteCommitment !== computeSuiteCommitment(selfSuiteId)) {
    throw new Error("Disclosure suite commitment does not match the target envelope header");
  }

  const endorsedIdx = await contract.endorsedVersionIndex(personHash, address);
  if (Number(endorsedIdx) !== Number(versionIndex)) {
    return { requiresEndorsement: true };
  }

  const contractAddress = await contract.getAddress();
  const receipt = await mintPersonVersionNFT(
    proofEnvelope,
    publicSignals,
    versionIndex,
    tokenURI,
    coreInfo,
  );

  const eventInterface = createDeepFamilyInterface();
  const mintedEvent = parseReceiptEvents(receipt, eventInterface, contractAddress).find(
    (event) => event.name === "PersonNFTMinted",
  );

  let tokenId = 0;
  if (getVersionDetails) {
    try {
      const details = await getVersionDetails(personHash, versionIndex);
      tokenId = Number(details?.tokenId ?? 0);
    } catch {
      tokenId = 0;
    }
  }

  if (!tokenId && mintedEvent) {
    tokenId = Number(mintedEvent.args?.tokenId ?? 0);
  }

  return {
    requiresEndorsement: false,
    receipt,
    transactionHash: receipt?.hash || receipt?.transactionHash || "",
    blockNumber: Number(receipt?.blockNumber || 0),
    tokenId,
    event: mintedEvent
      ? {
          personHash: mintedEvent.args?.personHash || personHash,
          tokenId: Number(mintedEvent.args?.tokenId ?? tokenId),
          owner: mintedEvent.args?.owner || address,
          versionIndex: Number(mintedEvent.args?.versionIndex ?? versionIndex),
          tokenURI: mintedEvent.args?.tokenURI || tokenURI,
          timestamp: Number(mintedEvent.args?.timestamp || 0),
        }
      : null,
  };
}
