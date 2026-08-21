export type CacheHook = () => void;

export interface DetailQueryOptions {
  ttlMs?: number;
  onCacheHit?: CacheHook;
  onCacheMiss?: CacheHook;
  onFetched?: CacheHook;
}

export interface VersionStructFields {
  personHash?: string;
  versionIndex?: string;
  fatherHash?: string;
  motherHash?: string;
  fatherVersionIndex?: string;
  motherVersionIndex?: string;
  versionCommitment?: string;
  addedBy?: string;
  timestamp?: number;
}

export interface MetadataRefFields {
  pointer?: string;
  payloadHash?: string;
  payloadLength?: number;
}

export interface CoreInfoFields {
  fullName?: string;
  gender?: number;
  birthYear?: number;
  birthMonth?: number;
  birthDay?: number;
  birthPlace?: string;
  isBirthBC?: boolean;
  deathYear?: number;
  deathMonth?: number;
  deathDay?: number;
  deathPlace?: string;
  isDeathBC?: boolean;
  nftPublicStory?: string;
}

export interface ParsedVersionDetails {
  version: VersionStructFields;
  metadata: MetadataRefFields;
  endorsementCount: number;
  tokenId: string;
}

export interface ParsedNftDetails {
  personHash: string;
  versionIndex: number;
  version: VersionStructFields;
  metadata: MetadataRefFields;
  core: CoreInfoFields;
  endorsementCount?: number;
  nftTokenURI?: string;
}

export function parseVersionStruct(versionStruct: any): VersionStructFields {
  if (!versionStruct) return {};
  const personHash = versionStruct.personHash || versionStruct[0];
  const versionIndexRaw =
    versionStruct.versionIndex !== undefined ? versionStruct.versionIndex : versionStruct[3];
  const fatherHash = versionStruct.fatherHash || versionStruct[1];
  const motherHash = versionStruct.motherHash || versionStruct[2];
  const fatherVersionIndex =
    versionStruct.fatherVersionIndex !== undefined
      ? versionStruct.fatherVersionIndex.toString()
      : versionStruct[4] !== undefined
        ? versionStruct[4].toString()
        : undefined;
  const motherVersionIndex =
    versionStruct.motherVersionIndex !== undefined
      ? versionStruct.motherVersionIndex.toString()
      : versionStruct[5] !== undefined
        ? versionStruct[5].toString()
        : undefined;
  const versionCommitmentRaw =
    versionStruct.versionCommitment !== undefined
      ? versionStruct.versionCommitment
      : versionStruct[6];
  const addedBy = versionStruct.addedBy || versionStruct[7];
  const timestampRaw =
    versionStruct.timestamp !== undefined ? versionStruct.timestamp : versionStruct[8];
  const timestamp =
    timestampRaw !== undefined && timestampRaw !== null ? Number(timestampRaw) : undefined;
  return {
    personHash,
    versionIndex:
      versionIndexRaw !== undefined && versionIndexRaw !== null
        ? versionIndexRaw.toString()
        : undefined,
    fatherHash,
    motherHash,
    fatherVersionIndex,
    motherVersionIndex,
    versionCommitment:
      versionCommitmentRaw !== undefined && versionCommitmentRaw !== null
        ? versionCommitmentRaw.toString()
        : undefined,
    addedBy,
    timestamp,
  };
}

export function parseMetadataRef(metadataRef: any): MetadataRefFields {
  if (!metadataRef) return {};
  const pointer = metadataRef.pointer || metadataRef[0];
  const payloadHash = metadataRef.payloadHash || metadataRef[1];
  const payloadLengthRaw =
    metadataRef.payloadLength !== undefined ? metadataRef.payloadLength : metadataRef[2];
  const payloadLength =
    payloadLengthRaw !== undefined && payloadLengthRaw !== null
      ? Number(payloadLengthRaw)
      : undefined;
  return { pointer, payloadHash, payloadLength };
}

export function parseCoreInfo(coreInfo: any): CoreInfoFields {
  if (!coreInfo) return {};
  const fullName = coreInfo?.supplementInfo?.fullName;
  const gender =
    coreInfo?.basicInfo?.gender !== undefined ? Number(coreInfo.basicInfo.gender) : undefined;
  const birthYear =
    coreInfo?.basicInfo?.birthYear !== undefined ? Number(coreInfo.basicInfo.birthYear) : undefined;
  const birthMonth =
    coreInfo?.basicInfo?.birthMonth !== undefined
      ? Number(coreInfo.basicInfo.birthMonth)
      : undefined;
  const birthDay =
    coreInfo?.basicInfo?.birthDay !== undefined ? Number(coreInfo.basicInfo.birthDay) : undefined;
  const birthPlace = coreInfo?.supplementInfo?.birthPlace;
  const isBirthBC =
    coreInfo?.basicInfo?.isBirthBC !== undefined
      ? Boolean(coreInfo.basicInfo.isBirthBC)
      : undefined;
  const deathYear =
    coreInfo?.supplementInfo?.deathYear !== undefined
      ? Number(coreInfo.supplementInfo.deathYear)
      : undefined;
  const deathMonth =
    coreInfo?.supplementInfo?.deathMonth !== undefined
      ? Number(coreInfo.supplementInfo.deathMonth)
      : undefined;
  const deathDay =
    coreInfo?.supplementInfo?.deathDay !== undefined
      ? Number(coreInfo.supplementInfo.deathDay)
      : undefined;
  const deathPlace = coreInfo?.supplementInfo?.deathPlace;
  const isDeathBC =
    coreInfo?.supplementInfo?.isDeathBC !== undefined
      ? Boolean(coreInfo.supplementInfo.isDeathBC)
      : undefined;
  const nftPublicStory = coreInfo?.supplementInfo?.story;
  return {
    fullName,
    gender,
    birthYear,
    birthMonth,
    birthDay,
    birthPlace,
    isBirthBC,
    deathYear,
    deathMonth,
    deathDay,
    deathPlace,
    isDeathBC,
    nftPublicStory,
  };
}

export function parseVersionDetailsResult(ret: any): ParsedVersionDetails {
  const versionStruct = ret?.[0];
  const metadataRef = ret?.[1];
  const endorsementCount = Number(ret?.[2] ?? 0);
  const tokenIdVal = ret?.[3];
  const tokenId = tokenIdVal !== undefined && tokenIdVal !== null ? tokenIdVal.toString() : "0";
  return {
    version: parseVersionStruct(versionStruct),
    metadata: parseMetadataRef(metadataRef),
    endorsementCount,
    tokenId,
  };
}

export function parseNftDetailsResult(ret: any): ParsedNftDetails {
  const personHash = ret?.[0];
  const versionIndex = Number(ret?.[1] ?? 0);
  const versionStruct = ret?.[2];
  const metadataRef = ret?.[3];
  const coreInfo = ret?.[4];
  const endorsementCountRaw = ret?.[5];
  const nftTokenURI = ret?.[6];
  const endorsementCount =
    endorsementCountRaw !== undefined && endorsementCountRaw !== null
      ? Number(endorsementCountRaw)
      : undefined;
  return {
    personHash,
    versionIndex,
    version: parseVersionStruct(versionStruct),
    metadata: parseMetadataRef(metadataRef),
    core: parseCoreInfo(coreInfo),
    endorsementCount,
    nftTokenURI,
  };
}
