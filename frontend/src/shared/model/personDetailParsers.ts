export type CacheHook = () => void;

export interface DetailQueryOptions {
  ttlMs?: number;
  onCacheHit?: CacheHook;
  onCacheMiss?: CacheHook;
  onFetched?: CacheHook;
}

export interface VersionStructFields {
  fatherHash?: string;
  motherHash?: string;
  fatherVersionIndex?: number;
  motherVersionIndex?: number;
  addedBy?: string;
  timestamp?: number;
  tag?: string;
  metadataCID?: string;
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
  story?: string;
}

export interface ParsedVersionDetails {
  version: VersionStructFields;
  endorsementCount: number;
  tokenId: string;
}

export interface ParsedNftDetails {
  personHash: string;
  versionIndex: number;
  version: VersionStructFields;
  core: CoreInfoFields;
  endorsementCount?: number;
  nftTokenURI?: string;
}

export function parseVersionStruct(versionStruct: any): VersionStructFields {
  if (!versionStruct) return {};
  const fatherHash = versionStruct.fatherHash || versionStruct[1];
  const motherHash = versionStruct.motherHash || versionStruct[2];
  const fatherVersionIndex =
    versionStruct.fatherVersionIndex !== undefined
      ? Number(versionStruct.fatherVersionIndex)
      : versionStruct[4] !== undefined
        ? Number(versionStruct[4])
        : undefined;
  const motherVersionIndex =
    versionStruct.motherVersionIndex !== undefined
      ? Number(versionStruct.motherVersionIndex)
      : versionStruct[5] !== undefined
        ? Number(versionStruct[5])
        : undefined;
  const addedBy = versionStruct.addedBy || versionStruct[6];
  const timestampRaw =
    versionStruct.timestamp !== undefined ? versionStruct.timestamp : versionStruct[7];
  const timestamp =
    timestampRaw !== undefined && timestampRaw !== null ? Number(timestampRaw) : undefined;
  const tag = versionStruct.tag || versionStruct[8];
  const metadataCID = versionStruct.metadataCID || versionStruct[9];
  return {
    fatherHash,
    motherHash,
    fatherVersionIndex,
    motherVersionIndex,
    addedBy,
    timestamp,
    tag,
    metadataCID,
  };
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
  const story = coreInfo?.supplementInfo?.story;
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
    story,
  };
}

export function parseVersionDetailsResult(ret: any): ParsedVersionDetails {
  const versionStruct = ret?.[0];
  const endorsementCount = Number(ret?.[1] ?? 0);
  const tokenIdVal = ret?.[2];
  const tokenId = tokenIdVal !== undefined && tokenIdVal !== null ? tokenIdVal.toString() : "0";
  return {
    version: parseVersionStruct(versionStruct),
    endorsementCount,
    tokenId,
  };
}

export function parseNftDetailsResult(ret: any): ParsedNftDetails {
  const personHash = ret?.[0];
  const versionIndex = Number(ret?.[1] ?? 0);
  const versionStruct = ret?.[2];
  const coreInfo = ret?.[3];
  const endorsementCountRaw = ret?.[4];
  const nftTokenURI = ret?.[5];
  const endorsementCount =
    endorsementCountRaw !== undefined && endorsementCountRaw !== null
      ? Number(endorsementCountRaw)
      : undefined;
  return {
    personHash,
    versionIndex,
    version: parseVersionStruct(versionStruct),
    core: parseCoreInfo(coreInfo),
    endorsementCount,
    nftTokenURI,
  };
}
