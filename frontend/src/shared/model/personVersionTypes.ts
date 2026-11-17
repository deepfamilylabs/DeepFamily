export type PersonVersionLookupStatus = "idle" | "loading" | "ready" | "error";

export interface PersonVersionOption {
  versionIndex: number;
  endorsementCount: number;
  tokenId: number;
  addedBy: string;
  /** Unix seconds the version was recorded; 0 when unknown. */
  timestamp: number;
}

export interface PersonVersionLookup {
  /** The hash this lookup describes, whatever its status; null when no identity is entered. */
  personHash: string | null;
  status: PersonVersionLookupStatus;
  versions: PersonVersionOption[];
  totalVersions: number;
}
