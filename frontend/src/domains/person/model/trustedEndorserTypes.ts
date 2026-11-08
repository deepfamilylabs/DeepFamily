export interface TrustedEndorserAccess {
  connectedAddress?: string | null;
  loadTrustedEndorsers: (personHash: string, versionIndex: number) => Promise<string[]>;
  addTrustedEndorser: (personHash: string, versionIndex: number, account: string) => Promise<void>;
  removeTrustedEndorser: (personHash: string, versionIndex: number, account: string) => Promise<void>;
}
