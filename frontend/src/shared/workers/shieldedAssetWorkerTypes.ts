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
export type ShieldedKeySlot = "identity" | "asset";
export type ShieldedPublicFunds = {
  ownerCommitment: string;
  viewingKey: string;
  fundsFingerprint: string;
  rootSource: "random" | "walletSignature" | "imported";
  signerAddress?: string;
  recoveryVerified: boolean;
  recoveryPath?: "signature" | "history" | "mnemonic" | "shieldedKey";
  /** Public creation challenge; re-signing cannot replace an independent backup. */
  backupRequired?: boolean;
};
export type ShieldedAssetSessionState = {
  identity: ShieldedPublicIdentity | null;
  funds: ShieldedPublicFunds | null;
};
export type ShieldedWorkerContext = {
  rpcUrl: string;
  chainId: string;
  factoryAddress: string;
  factoryDeploymentBlock: number;
  familyAddress: string;
  lineageIndexAddress: string;
  poolAddress: string;
  poolDeploymentBlock: number;
  assetKind: "native" | "erc20";
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
  status: string;
  nextDueAt?: string;
};
export type ShieldedWalletSummary = {
  /** Public recovery-gate updates, including a signature candidate confirmed by history. */
  sessionState?: ShieldedAssetSessionState;
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
  /** Confirmed proof-independent receiving-code fingerprint. */
  recipientFingerprint?: string;
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
    params: { identity: IdentityFields; rawPassphrase: string };
    result: ShieldedAssetSessionState;
  };
  createFunds: {
    params: {
      intent: "create";
      rootSource: "random" | "walletSignature";
      signerAddress?: string;
      signature?: string;
      context: ShieldedWorkerContext;
    };
    result: ShieldedAssetSessionState;
  };
  restoreSignature: {
    params: {
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
      fundsFingerprint: string;
    };
  };
  importRecoveryMaterial: {
    params: {
      format: "mnemonic" | "shieldedKey";
      material: string;
      expectedFingerprint?: string;
      pendingBackupFingerprints?: readonly string[];
      context: ShieldedWorkerContext;
    };
    result: ShieldedAssetSessionState;
  };
  receiveCode: {
    params: { slot: ShieldedKeySlot };
    result: { code: string; fingerprint: string };
  };
  recover: { params: { context: ShieldedWorkerContext }; result: ShieldedWalletSummary };
  discover: {
    params: { context: ShieldedWorkerContext };
    result: { complete: boolean; pools: ShieldedDiscoveredPoolSummary[]; error?: string };
  };
  preview: { params: ShieldedAssetActionRequest; result: ShieldedActionPreview };
  prove: {
    params: { handle: string; context: ShieldedWorkerContext };
    result: ShieldedProvenAction;
  };
  cancelPreview: { params: Record<string, never>; result: { ok: true } };
};
