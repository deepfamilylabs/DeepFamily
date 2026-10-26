import type {
  DepositSubmission,
  ClaimSubmission,
  TransferSubmission,
} from "../clients/receiveChain";
import type { IdentityFields, ProtocolProof } from "@deepfamily/protocol-core";

export interface WalletStateView {
  unlocked: boolean;
  codeCount: string;
  credentialCount: number;
  backupChanged: boolean;
}
export interface WalletNoteView {
  handle: string;
  kind: "value" | "budget";
  amount: string;
  codeIndex: string;
  rate?: string;
  periodDays?: string;
  eligibleFrom?: string;
  claimPeriod?: string;
}
export interface WalletLetterView {
  messageId: string;
  sender: string;
  body: string;
  transactionHash: string;
}
export interface WalletQualificationView {
  index: number;
  current: boolean;
  selected: boolean;
}
export interface QualificationRequestView {
  id: string;
  request: string;
  childPersonHash: string;
  parentPersonHash: string;
  parentVersion: string;
  endorser: string;
  hasFact: boolean;
  hasTrust: boolean;
  issued: boolean;
}
export interface QualificationSourceView {
  id: string;
  kind: "fact" | "trust";
  requestId: string;
  request: string;
  childPersonHash: string;
  parentPersonHash: string;
  parentVersion: string;
  endorser: string;
  controller: string;
  published: boolean;
  revoked: boolean;
}
export interface QualificationManagementView {
  requests: QualificationRequestView[];
  sources: QualificationSourceView[];
  canRequest: boolean;
}
export interface BoundarySubmission {
  amount: string;
  recipient?: string;
  inputShardIds: bigint[];
  inputRoots: bigint[];
  inputNullifiers: bigint[];
  outputCommitments: bigint[];
  outputCiphertexts: Uint8Array[];
  ciphertextHashes: bigint[];
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export interface WalletCalls {
  walletCreate: {
    input: {
      rawPassphrase: string;
      codeRootSecret?: string;
      identity?: { fields: IdentityFields; rawPassphrase: string; identitySuiteId?: number };
    };
    result: { state: WalletStateView; backup: Uint8Array };
  };
  walletRestore: {
    input: { rawPassphrase: string; backup: Uint8Array };
    result: { state: WalletStateView };
  };
  walletBackup: {
    input: { rawPassphrase: string };
    result: { backup: Uint8Array; state: WalletStateView };
  };
  walletLock: { input: Record<string, never>; result: { state: WalletStateView } };
  walletCreateCode: {
    input: { expiresAt: string; rawPassphrase: string; credentialIndices?: number[] };
    result: { code: string; state: WalletStateView; backup: Uint8Array };
  };
  walletReadQualifications: {
    input: Record<string, never>;
    result: { qualifications: WalletQualificationView[] };
  };
  walletCreateQualificationRequest: {
    input: {
      parentPersonHash: string;
      parentVersion: string;
      endorser: string;
      rawPassphrase: string;
    };
    result: { request: string; requestId: string; state: WalletStateView; backup: Uint8Array };
  };
  walletReadQualificationManagement: {
    input: Record<string, never>;
    result: QualificationManagementView;
  };
  walletPrepareSourcePublication: {
    input: {
      kind: "fact" | "trust";
      request: string;
      controller: string;
      rawPassphrase: string;
      draftId?: string;
    };
    result: {
      draftId: string;
      kind: "fact" | "trust";
      proof: ProtocolProof;
      publicSignals: bigint[];
      state: WalletStateView;
      backup: Uint8Array;
    };
  };
  walletConfirmSourcePublication: {
    input: { draftId: string; transactionHash?: string; rawPassphrase: string };
    result: { state: WalletStateView; backup: Uint8Array; package: Uint8Array };
  };
  walletImportSourcePackage: {
    input: { package: Uint8Array; rawPassphrase: string };
    result: { requestId: string; state: WalletStateView; backup: Uint8Array };
  };
  walletPrepareQualificationIssue: {
    input: { requestId: string; rawPassphrase: string };
    result: {
      requestId: string;
      proof: ProtocolProof;
      publicSignals: bigint[];
      state: WalletStateView;
      backup: Uint8Array;
    };
  };
  walletConfirmQualificationIssue: {
    input: { requestId: string; transactionHash?: string; rawPassphrase: string };
    result: { state: WalletStateView; backup: Uint8Array };
  };
  walletPrepareRoleRevocation: {
    input: { sourceId: string; withdrawRelationship?: boolean };
    result: {
      roles: Array<0 | 1 | 2>;
      secrets: bigint[];
      mutation?:
        | { kind: "cancelEndorsement"; childIdentity: bigint }
        | {
            kind: "removeTrustedEndorser";
            parentIdentity: bigint;
            parentVersion: bigint;
            endorser: string;
          };
    };
  };
  walletExportSourcePackage: { input: { sourceId: string }; result: { package: Uint8Array } };
  walletRecover: {
    input: Record<string, never>;
    result: { state: WalletStateView; notes: WalletNoteView[]; letters: WalletLetterView[] };
  };
  walletPrepareShield: { input: { amount: string }; result: BoundarySubmission };
  walletPrepareUnshield: {
    input: { amount: string; recipient: string; noteHandle: string };
    result: BoundarySubmission;
  };
  walletPrepareTransfer: {
    input: { amount: string; code: string; noteHandle: string };
    result: TransferSubmission & { inputShardId: bigint };
  };
  walletPrepareDeposit: {
    input: { code: string; rule: string; budgetPeriods: string; noteHandle: string };
    result: DepositSubmission & { inputShardId: bigint };
  };
  walletPrepareClaim: {
    input: { noteHandle: string; periodIndex?: string };
    result: ClaimSubmission & { inputShardId: bigint };
  };
  walletPrepareLetter: {
    input: { code: string; body: string };
    result: { code: TransferSubmission["code"]; messageId: bigint; ciphertext: Uint8Array };
  };
  walletCreateRule: {
    input: { credentialIndex: number; rate: string; periodDays: string };
    result: { rule: string };
  };
}
