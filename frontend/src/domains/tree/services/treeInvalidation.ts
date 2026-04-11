import { ethers } from "ethers";
import { makeNodeId } from "../../../types/graph";
import { unionParentKey } from "../../../types/treeStore";
import { nftKey, tvKey, vdKey } from "../../../shared/cache/queryKeys";

export interface PersonVersionAddedEvent {
  personHash: string;
  versionIndex: number;
  fatherHash?: string;
  fatherVersionIndex?: number;
  motherHash?: string;
  motherVersionIndex?: number;
}

export interface PersonVersionEndorsedEvent {
  personHash: string;
  versionIndex: number;
}

export interface PersonNFTMintedEvent {
  tokenId?: string | number;
  versionIndex?: number;
  personHash?: string;
}

export interface ParsedTreeTxEvents {
  PersonVersionAdded: PersonVersionAddedEvent[];
  PersonVersionEndorsed: PersonVersionEndorsedEvent[];
  PersonNFTMinted: PersonNFTMintedEvent[];
}

export interface TreeTxInvalidationInput {
  receipt?: { logs?: any[] } | null;
  events?: {
    PersonVersionAdded?: PersonVersionAddedEvent | null;
    PersonVersionEndorsed?: PersonVersionEndorsedEvent | null;
    PersonNFTMinted?: PersonNFTMintedEvent | null;
  };
  hints?: {
    personHash?: string;
    versionIndex?: number;
    tokenId?: string | number;
  };
}

export interface TreeTxInvalidationResult {
  parsedEvents: ParsedTreeTxEvents;
  totalVersionsKeys: string[];
  unionKeys: string[];
  strictKeys: string[];
  strictPrefixes: string[];
  versionDetailKeys: string[];
  nftKeys: string[];
}

export function createEmptyParsedTreeTxEvents(): ParsedTreeTxEvents {
  return {
    PersonVersionAdded: [],
    PersonVersionEndorsed: [],
    PersonNFTMinted: [],
  };
}

const isZeroHash = (hash?: string) => {
  if (!hash) return true;
  if (hash === "0x") return true;
  return /^0x0{64}$/i.test(hash);
};

export function getInvalidateKeysAfterPersonVersionAdded(ev: PersonVersionAddedEvent) {
  const totalVersionsKeys = new Set<string>();
  const unionKeys = new Set<string>();
  const strictKeys = new Set<string>();
  const strictPrefixes = new Set<string>();

  const parents: Array<{ h?: string; v?: number }> = [
    { h: ev.fatherHash, v: ev.fatherVersionIndex },
    { h: ev.motherHash, v: ev.motherVersionIndex },
  ];
  const allHashes = [ev.personHash, ...parents.map((parent) => parent.h)];
  for (const hash of allHashes) {
    if (hash && !isZeroHash(hash)) totalVersionsKeys.add(tvKey(hash));
  }

  for (const parent of parents) {
    if (parent.h && !isZeroHash(parent.h)) {
      unionKeys.add(unionParentKey(parent.h));
    }
    if (parent.h && !isZeroHash(parent.h)) {
      const version = Number(parent.v ?? NaN);
      if (!Number.isFinite(version) || version <= 0) {
        strictPrefixes.add(`${parent.h.toLowerCase()}-v-`);
      } else {
        strictKeys.add(makeNodeId(parent.h, version));
      }
    }
  }

  return {
    totalVersionsKeys: Array.from(totalVersionsKeys),
    unionKeys: Array.from(unionKeys),
    strictKeys: Array.from(strictKeys),
    strictPrefixes: Array.from(strictPrefixes),
  };
}

export function parseTreeTxEvents(
  receipt: { logs?: any[] } | null | undefined,
  eventInterface: ethers.Interface,
  contractAddress?: string | null,
): ParsedTreeTxEvents {
  const parsed = createEmptyParsedTreeTxEvents();
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const normalizedContractAddress = contractAddress?.toLowerCase();

  for (const log of logs) {
    const logAddr = String((log as any)?.address || "").toLowerCase();
    if (normalizedContractAddress && logAddr && logAddr !== normalizedContractAddress) {
      continue;
    }

    try {
      const event = eventInterface.parseLog(log);
      if (!event) continue;
      switch (event.name) {
        case "PersonVersionAdded":
          parsed.PersonVersionAdded.push({
            personHash: String(event.args.personHash),
            versionIndex: Number(event.args.versionIndex),
            fatherHash: String(event.args.fatherHash),
            fatherVersionIndex: Number(event.args.fatherVersionIndex),
            motherHash: String(event.args.motherHash),
            motherVersionIndex: Number(event.args.motherVersionIndex),
          });
          break;
        case "PersonVersionEndorsed":
          parsed.PersonVersionEndorsed.push({
            personHash: String(event.args.personHash),
            versionIndex: Number(event.args.versionIndex),
          });
          break;
        case "PersonNFTMinted":
          parsed.PersonNFTMinted.push({
            tokenId: event.args.tokenId?.toString?.() ?? event.args.tokenId,
            versionIndex: Number(event.args.versionIndex),
            personHash: event.args.personHash ? String(event.args.personHash) : undefined,
          });
          break;
      }
    } catch {
      // ignore non-DeepFamily logs
    }
  }

  return parsed;
}

export function buildTreeTxInvalidation(
  input?: TreeTxInvalidationInput | null,
  options?: {
    eventInterface?: ethers.Interface | null;
    contractAddress?: string | null;
  },
): TreeTxInvalidationResult {
  const parsedEvents =
    input?.receipt && options?.eventInterface
      ? parseTreeTxEvents(input.receipt, options.eventInterface, options.contractAddress)
      : createEmptyParsedTreeTxEvents();

  if (input?.events?.PersonVersionAdded) {
    parsedEvents.PersonVersionAdded.push(input.events.PersonVersionAdded);
  }
  if (input?.events?.PersonVersionEndorsed) {
    parsedEvents.PersonVersionEndorsed.push(input.events.PersonVersionEndorsed);
  }
  if (input?.events?.PersonNFTMinted) {
    parsedEvents.PersonNFTMinted.push(input.events.PersonNFTMinted);
  }

  const totalVersionsKeys = new Set<string>();
  const unionKeys = new Set<string>();
  const strictKeys = new Set<string>();
  const strictPrefixes = new Set<string>();
  const versionDetailKeys = new Set<string>();
  const nftKeys = new Set<string>();

  for (const event of parsedEvents.PersonVersionAdded) {
    const invalidation = getInvalidateKeysAfterPersonVersionAdded(event);
    for (const key of invalidation.totalVersionsKeys) totalVersionsKeys.add(key);
    for (const key of invalidation.unionKeys) unionKeys.add(key);
    for (const key of invalidation.strictKeys) strictKeys.add(key);
    for (const key of invalidation.strictPrefixes) strictPrefixes.add(key);
  }

  for (const event of parsedEvents.PersonVersionEndorsed) {
    if (!event.personHash || !Number.isFinite(Number(event.versionIndex))) continue;
    versionDetailKeys.add(vdKey(event.personHash, event.versionIndex));
  }

  for (const event of parsedEvents.PersonNFTMinted) {
    if (event.tokenId !== undefined && event.tokenId !== null && String(event.tokenId) !== "") {
      nftKeys.add(nftKey(event.tokenId));
    }
    if (
      event.personHash &&
      typeof event.versionIndex === "number" &&
      Number.isFinite(event.versionIndex) &&
      event.versionIndex > 0
    ) {
      versionDetailKeys.add(vdKey(event.personHash, event.versionIndex));
    }
  }

  const hintHash = input?.hints?.personHash;
  const hintVersion = input?.hints?.versionIndex;
  const hintTokenId = input?.hints?.tokenId;
  if (hintTokenId !== undefined && hintTokenId !== null && String(hintTokenId) !== "") {
    nftKeys.add(nftKey(hintTokenId));
  }
  if (
    hintHash &&
    typeof hintVersion === "number" &&
    Number.isFinite(hintVersion) &&
    hintVersion > 0
  ) {
    versionDetailKeys.add(vdKey(hintHash, hintVersion));
  }

  return {
    parsedEvents,
    totalVersionsKeys: Array.from(totalVersionsKeys),
    unionKeys: Array.from(unionKeys),
    strictKeys: Array.from(strictKeys),
    strictPrefixes: Array.from(strictPrefixes),
    versionDetailKeys: Array.from(versionDetailKeys),
    nftKeys: Array.from(nftKeys),
  };
}
