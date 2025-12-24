import { makeNodeId } from "../types/graph";
import { unionParentKey } from "../types/treeStore";
import { tvKey } from "./queryKeys";

export interface PersonVersionAddedEvent {
  personHash: string;
  versionIndex: number;
  fatherHash?: string;
  fatherVersionIndex?: number;
  motherHash?: string;
  motherVersionIndex?: number;
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
  const allHashes = [ev.personHash, ...parents.map((p) => p.h)];
  for (const h of allHashes) {
    if (h && !isZeroHash(h)) totalVersionsKeys.add(tvKey(h));
  }

  for (const p of parents) {
    if (p.h && !isZeroHash(p.h)) {
      unionKeys.add(unionParentKey(p.h));
    }
    if (p.h && !isZeroHash(p.h)) {
      const v = Number(p.v ?? NaN);
      if (!Number.isFinite(v) || v <= 0) {
        strictPrefixes.add(`${p.h.toLowerCase()}-v-`);
      } else {
        strictKeys.add(makeNodeId(p.h, v));
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
