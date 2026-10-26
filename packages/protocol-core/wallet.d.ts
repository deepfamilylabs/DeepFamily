import type { ProtocolBytes, ProtocolInteger, ReceiveKeyMaterial } from "./receive-code.js";
import type { BudgetNote, PoolScope } from "./budget.js";
import type { IdentityFields, CanonicalIdentityFields } from "./index.js";
import type { WalletQualificationState } from "./qualification.js";
export interface WalletCredential {
  issueNonce: bigint; familyRoot: bigint; endorser: bigint; parentVersion: bigint;
  xChild: bigint; xEndorse: bigint; xTrust: bigint; credentialSalt: bigint;
  credentialIndex: bigint; credentialCommitment: bigint;
}
export interface WalletState {
  version: 1; chainId: bigint; authorizerScope: bigint; masterKey: Uint8Array;
  codeRootSecret: bigint; nextCodeIndex: bigint; credentials: WalletCredential[];
  revocationRoles: Array<{role: number; secret: bigint}>;
  identity: { fields: CanonicalIdentityFields; identitySuiteId: number } | null;
  qualification: WalletQualificationState;
}
export function normalizeWalletState(input: Omit<WalletState, "identity" | "qualification"> & {
  identity?: {fields:IdentityFields;identitySuiteId:number} | null; qualification?: Partial<WalletQualificationState>;
}): WalletState;
export function createWalletState(input: {
  chainId: ProtocolInteger; authorizerScope: ProtocolInteger; masterKey?: ProtocolBytes;
  codeRootSecret?: ProtocolInteger; nextCodeIndex?: ProtocolInteger;
  credentials?: WalletCredential[]; revocationRoles?: Array<{role:number;secret:ProtocolInteger}>;
  identity?: { fields: IdentityFields; identitySuiteId: number } | null;
  qualification?: Partial<WalletQualificationState>;
}): Promise<WalletState>;
export function allocateWalletCode(wallet: WalletState): {codeIndex:bigint;state:WalletState};
export function encryptWalletBackup(input: {wallet:WalletState;rawPassphrase:string}): Promise<Uint8Array>;
export function decryptWalletBackup(input: {
  backup:ProtocolBytes;rawPassphrase:string;chainId?:ProtocolInteger;authorizerScope?:ProtocolInteger;
}): Promise<WalletState>;
export type RecoveredWalletNote = {
  kind:"value";note:{kind?:"value";ownerCommitment:bigint;amount:bigint;nonce:bigint};
  codeIndex:bigint;keyMaterial:ReceiveKeyMaterial;commitment:bigint;
  shardId:bigint;leafIndex:bigint;ciphertext:Uint8Array;nullifier:bigint;
} | {
  kind:"budget";note:BudgetNote;codeIndex:bigint;keyMaterial:ReceiveKeyMaterial;
  commitment:bigint;shardId:bigint;leafIndex:bigint;ciphertext:Uint8Array;nullifier:bigint;
};
export function recoverWalletNotes(input: {
  wallet:WalletState;
  events:readonly {commitment:ProtocolInteger;shardId:ProtocolInteger;leafIndex:ProtocolInteger;ciphertext:ProtocolBytes}[];
  spentNullifiers?:Iterable<ProtocolInteger>;firstCodeIndex?:ProtocolInteger;lastCodeIndex?:ProtocolInteger;
},scope:PoolScope):Promise<RecoveredWalletNote[]>;
