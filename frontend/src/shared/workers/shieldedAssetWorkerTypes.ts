import type { ShieldedStateReadMode } from "../config/shieldedStateReadMode";
import type { IdentityFields } from "@deepfamily/protocol-core";
import type { Groth16Proof } from "../zk/zk";
import type { ShieldedPoolActionData } from "../zk/shieldedActionTypes";

/** Only public identifiers and display summaries cross the asset-session boundary. */
export type ShieldedPublicIdentity = {
  handle: string;
  identitySuiteId: number;
  identityCommitment: string;
  personHash: string;
  identity: { fullName: string };
};
export type ShieldedKeySlot = "identity" | "independent";
export type ShieldedPublicIndependentKey = {
  ownerCommitment: string;
  viewingKey: string;
  keyFingerprint: string;
  rootSource: "random" | "walletSignature" | "imported";
  signerAddress?: string;
  recoveryVerified: boolean;
  recoveryPath?: "signature" | "history" | "mnemonic" | "shieldedKey";
  /** Public creation challenge; re-signing cannot replace an independent backup. */
  backupRequired?: boolean;
};
export type ShieldedAssetSessionState = {
  /** Independent-key credentials remain available even when the identity proof suite is unavailable. */
  credentials: { handle: string } | null;
  identity: ShieldedPublicIdentity | null;
  independentKey: ShieldedPublicIndependentKey | null;
};
export type ShieldedWorkerContext = {
  /** Omitted means privacy-preserving local history reconstruction. */
  stateReadMode?: ShieldedStateReadMode;
  rpcUrl: string;
  chainId: string;
  factoryAddress: string;
  factoryDeploymentBlock: number;
  familyAddress: string;
  lineageIndexAddress: string;
  poolAddress: string;
  poolDeploymentBlock: number;
  assetKind: "native" | "erc20";
  lettersAddress?: string;
  lettersDeploymentBlock?: number;
};
export type ShieldedNoteSummary = {
  commitment: string;
  ownerCommitment: string;
  slot: ShieldedKeySlot;
  kind: "value" | "budget";
  amount: string;
  keyMode?: 0 | 1;
  bindingKind?: 0 | 1;
  amountPerPeriod?: string;
  periodDays?: string;
  eligibleFrom?: string;
  pendingIdentity?: boolean;
};
export type ShieldedPolicySummary = {
  handle: string;
  rootVersionIndex: string;
  amountPerPeriod: string;
  periodDays: string;
};
export type ShieldedTemplateSummary = {
  handle: string;
  policyHandle: string;
  personHash: string;
  bindingKind: 0 | 1;
  keyMode: 0 | 1;
  ownerCommitment?: string;
};
export type ShieldedClaimSummary = {
  handle: string;
  slot: ShieldedKeySlot;
  budgets: string[];
  periodIndices: string[];
  amount: string;
  amountPerPeriod: string;
  /** Includes future periods, even when there is no currently claimable batch. */
  totalRemaining?: string;
  periodDays?: string;
  status: string;
  nextDueAt?: string;
  /** The period due at nextDueAt and the funded periods from it on, for one schedule. */
  nextPeriodIndex?: string;
  futurePeriods?: string;
};
export type ShieldedWalletSummary = {
  /** Public recovery-gate updates, including a signature candidate confirmed by history. */
  sessionState?: ShieldedAssetSessionState;
  /** Whether the unlocked identity's family records loaded; omitted without identity proof capability. */
  familyRecordsAvailable?: boolean;
  /** A public failure category; raw RPC errors never leave the Worker. */
  familyRecordsError?: "unavailable" | "incompatible";
  toBlock: number;
  blockHash: string;
  notes: ShieldedNoteSummary[];
  policies: ShieldedPolicySummary[];
  templates: ShieldedTemplateSummary[];
  claims: ShieldedClaimSummary[];
  parentVersions: number[];
  children: { personHash: string; rootVersionIndex: number; eligible: boolean }[];
};
export type ShieldedFundingEntry = "public" | "privateConvenient" | "privateIndependent";
export type ShieldedAssetActionRequest = {
  context: ShieldedWorkerContext;
  slot: ShieldedKeySlot;
  action: "shield" | "fund" | "claim" | "privateTransfer" | "unshield";
  amount?: string;
  candidates?: string[];
  recipientCode?: string;
  publicRecipient?: string;
  fundingEntry?: ShieldedFundingEntry;
  rootVersionIndex?: number;
  periodDays?: string;
  periods?: string;
  policyHandle?: string;
  claimHandle?: string;
  periodIndices?: string[];
};
export type ShieldedActionPreview = {
  handle: string;
  action: ShieldedAssetActionRequest["action"];
  amount: string;
  slot: ShieldedKeySlot;
  inputs: string[];
  inputAmounts: string[];
  /** Every preparatory transfer is displayed before any proof or transaction. */
  steps: { action: string; inputs: string[]; outputAmounts: string[] }[];
  outputAmounts: string[];
  recipient?: string;
  policyHandle?: string;
};
export type ShieldedProvenAction = {
  action: ShieldedAssetActionRequest["action"];
  data: ShieldedPoolActionData;
  proof: Groth16Proof;
  amount: string;
  recipient?: string;
};
export type ShieldedDiscoveredPoolSummary = {
  assetAddress: string;
  poolAddress: string;
  status: "recovered" | "failed";
  rawValueBalance?: string;
  rawBudgetBalance?: string;
  error?: string;
};
export type ShieldedAssetWorkerCallMap = {
  unlockIdentity: {
    params: { identity: IdentityFields; rawPassphrase: string; identitySuiteId?: number };
    result: ShieldedAssetSessionState;
  };
  createIndependentKey: {
    params: {
      intent: "create";
      expectedCredentialsHandle: string;
      rootSource: "random" | "walletSignature";
      signerAddress?: string;
      signature?: string;
      context: ShieldedWorkerContext;
    };
    result: ShieldedAssetSessionState;
  };
  restoreSignature: {
    params: {
      expectedCredentialsHandle: string;
      signerAddress: string;
      signature: string;
      expectedFingerprint?: string;
      pendingBackupFingerprints?: readonly string[];
      context: ShieldedWorkerContext;
    };
    result: ShieldedAssetSessionState;
  };
  /** Explicit secret export. Material must only reach a transient uncontrolled DOM field. */
  exportRecoveryMaterial: {
    params: { format: "mnemonic" | "shieldedKey"; context: ShieldedWorkerContext };
    result: {
      material: string;
      format: "mnemonic" | "shieldedKey";
      version: 1;
      keyFingerprint: string;
    };
  };
  importRecoveryMaterial: {
    params: {
      expectedCredentialsHandle: string;
      format: "mnemonic" | "shieldedKey";
      material: string;
      expectedFingerprint?: string;
      /** Original public creation challenges retained by this tab across a lock or reload. */
      pendingBackupFingerprints?: readonly string[];
      context: ShieldedWorkerContext;
    };
    result: ShieldedAssetSessionState;
  };
  /** Removes the independent key root and its branches; credentials and identity capability remain. */
  clearIndependentKey: { params: Record<string, never>; result: ShieldedAssetSessionState };
  /** Clears only the matching unverified root before restarting independent key setup. */
  clearPendingIndependentKey: {
    params: { expectedCredentialsHandle: string; expectedFingerprint: string };
    result: ShieldedAssetSessionState;
  };
  prepareLetter: {
    params: { context: ShieldedWorkerContext; code: string; body: string };
    result: import("../../domains/inheritance/services/privateLetterChain").ProvenPrivateLetter;
  };
  recoverLetters: {
    params: { context: ShieldedWorkerContext };
    result: { letters: { messageId: string; body: string; registeredAt: string; slot: ShieldedKeySlot; transactionHash: string }[]; unavailable: number };
  };
  receiveCode: {
    params: { slot: ShieldedKeySlot; context?: ShieldedWorkerContext; disclosure?: "anonymous" | "fund"; expiresAt?: string };
    result: { code: string };
  };
  authorizeIdentityCounter: {
    params: { context: ShieldedWorkerContext };
    result: { address: string; args: [string, string, string, string, string] };
  };
  recover: { params: { context: ShieldedWorkerContext }; result: ShieldedWalletSummary };
  discover: {
    params: { context: ShieldedWorkerContext };
    result: {
      complete: boolean;
      pools: ShieldedDiscoveredPoolSummary[];
      error?: string;
      sessionState?: ShieldedAssetSessionState;
    };
  };
  preview: { params: ShieldedAssetActionRequest; result: ShieldedActionPreview };
  prove: {
    params: { handle: string; context: ShieldedWorkerContext };
    result: ShieldedProvenAction;
  };
  cancelPreview: { params: Record<string, never>; result: { ok: true } };
};
