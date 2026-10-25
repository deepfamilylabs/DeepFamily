import type {
  ProtocolBytes, ProtocolInteger, ProtocolProof, ProtocolProofVerifier,
  ReceiveCode, ReceiveCodeInput, Capability, ReceiveKeyMaterial,
} from "./receive-code.js";

export interface PoolScope { chainId: ProtocolInteger; poolAddress: string }
export interface BudgetPolicyInput {
  familyCommitment: ProtocolInteger;
  parentVersion: ProtocolInteger;
  rate: ProtocolInteger;
  periodDays: ProtocolInteger;
  policySalt: ProtocolInteger;
  allocationKeyCommitment: ProtocolInteger;
}
export interface BudgetPolicy {
  familyCommitment: bigint;
  parentVersion: bigint;
  rate: bigint;
  periodDays: bigint;
  policySalt: bigint;
  allocationKeyCommitment: bigint;
}
export interface BudgetNoteInput extends BudgetPolicyInput {
  kind?: "budget";
  version?: 1;
  codeAlias: ProtocolInteger;
  /** Recovery memo; the canonical subject/code secret must recompute codeAlias before claiming. */
  codeNonce: ProtocolInteger;
  ownerCommitment: ProtocolInteger;
  viewingKey: ProtocolBytes;
  eligibleFrom: ProtocolInteger;
  remaining: ProtocolInteger;
  nonce: ProtocolInteger;
}
export interface BudgetNote extends BudgetPolicy {
  kind: "budget";
  version: 1;
  codeAlias: bigint;
  codeNonce: bigint;
  ownerCommitment: bigint;
  viewingKey: Uint8Array;
  eligibleFrom: bigint;
  remaining: bigint;
  nonce: bigint;
}
export interface ValueNote { ownerCommitment: bigint; amount: bigint; nonce: bigint }
export interface MembershipInput {
  depth: ProtocolInteger;
  index: ProtocolInteger;
  siblings: readonly ProtocolInteger[];
  root?: ProtocolInteger;
}
export interface VerifiedBudget {
  note: BudgetNote;
  noteCommitment: bigint;
  ciphertextHashField: bigint;
  policyCommitment: bigint;
  budgetKey: bigint;
}
export interface FundPublicInput {
  commonBinding: ProtocolInteger;
  codeAlias: ProtocolInteger;
  nonce: ProtocolInteger;
  ownerCommitment: ProtocolInteger;
  viewKeyLo: ProtocolInteger;
  viewKeyHi: ProtocolInteger;
  capabilityBinding: ProtocolInteger;
  familyTag: ProtocolInteger;
  parentVersion: ProtocolInteger;
  policyCommitment: ProtocolInteger;
  budgetKey: ProtocolInteger;
  eligibleFrom: ProtocolInteger;
  inputRoot: ProtocolInteger;
  inputNullifier: ProtocolInteger;
  outputCommitments: readonly ProtocolInteger[];
  ciphertextHashes: readonly ProtocolInteger[];
}
export interface ClaimRoleStatus {
  issuanceRoot: bigint;
  nonce: bigint;
  childTag: bigint;
  endorsementTag: bigint;
  trustedTag: bigint;
}
export interface ClaimQualificationInput {
  issuanceRoot: ProtocolInteger;
  familyRoot?: ProtocolInteger;
  parentVersion?: ProtocolInteger;
  issueNonce: ProtocolInteger;
  endorser: ProtocolInteger;
  xChild: ProtocolInteger;
  xEndorse: ProtocolInteger;
  xTrust: ProtocolInteger;
  credentialSalt: ProtocolInteger;
  credentialDepth: ProtocolInteger;
  credentialIndex: ProtocolInteger;
  credentialSiblings: readonly ProtocolInteger[];
}
export interface ClaimPublicInput {
  authorizerScope: ProtocolInteger;
  issuanceRoot: ProtocolInteger;
  childTag: ProtocolInteger;
  endorsementTag: ProtocolInteger;
  trustedTag: ProtocolInteger;
  codeAlias: ProtocolInteger;
  nonce: ProtocolInteger;
  ownerCommitment: ProtocolInteger;
  viewKeyLo: ProtocolInteger;
  viewKeyHi: ProtocolInteger;
  policyCommitment: ProtocolInteger;
  budgetKey: ProtocolInteger;
  eligibleFrom: ProtocolInteger;
  asOf: ProtocolInteger;
  inputRoot: ProtocolInteger;
  inputNullifier: ProtocolInteger;
  periodNullifier: ProtocolInteger;
  outputCommitments: readonly ProtocolInteger[];
  ciphertextHashes: readonly ProtocolInteger[];
}
/** Private witness callbacks must run locally, using pinned circuit artifacts. */
export type LocalProver = (witness: Record<string, bigint | bigint[]>) => Promise<{
  proof: ProtocolProof;
  publicSignals: readonly ProtocolInteger[];
}>;
export interface BudgetRecordInput {
  exists?: boolean;
  commonBinding: ProtocolInteger;
  policyCommitment: ProtocolInteger;
  eligibleFrom: ProtocolInteger;
}
export interface PreparedDeposit {
  /** Informational snapshot; the contract chooses create/append atomically. */
  kind: "create" | "append";
  code: ReceiveCode;
  capabilityIndex: number;
  policyCommitment: bigint;
  budgetKey: bigint;
  eligibleFrom: bigint;
  note: BudgetNote;
  changeNote: ValueNote;
  outputCommitments: bigint[];
  ciphertextHashes: bigint[];
  outputCiphertexts: Uint8Array[];
  publicInput: FundPublicInput;
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export interface PreparedClaim {
  note: BudgetNote;
  valueNote: ValueNote;
  periodNullifier: bigint;
  inputNullifier: bigint;
  outputCommitments: bigint[];
  ciphertextHashes: bigint[];
  outputCiphertexts: Uint8Array[];
  publicInput: ClaimPublicInput;
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export const BUDGET_NOTE_VERSION: 1;
export const BUDGET_NOTE_PAYLOAD_BYTES: 314;
export const FUND_PUBLIC_SIGNAL_COUNT: 20;
export const CLAIM_PUBLIC_SIGNAL_COUNT: 23;
export const BUDGET_ELIGIBILITY_DELAY: 7200n;
export function computePolicyCommitment(input: BudgetPolicyInput, scope: PoolScope): bigint;
export function computeBudgetKey(input: { codeAlias: ProtocolInteger; policyCommitment: ProtocolInteger }, scope: PoolScope): bigint;
export function computeBudgetNoteCommitment(input: BudgetNoteInput & { ciphertextHashField: ProtocolInteger }, scope: PoolScope): bigint;
export function encodeBudgetNotePayload(input: BudgetNoteInput, scope: PoolScope): Uint8Array;
export function decodeBudgetNotePayload(input: ProtocolBytes, scope: PoolScope): BudgetNote;
export function verifyBudgetNotePayload(input: {
  payload: ProtocolBytes; ciphertext: ProtocolBytes; noteCommitment: ProtocolInteger;
}, scope: PoolScope): VerifiedBudget;
export function decryptBudgetNote(input: {
  hpkeIkm: ProtocolBytes; ciphertext: ProtocolBytes; noteCommitment: ProtocolInteger;
}, scope: PoolScope): Promise<VerifiedBudget>;
export function buildFundPublicSignals(input: FundPublicInput, scope: PoolScope): bigint[];
export function buildClaimPublicSignals(input: ClaimPublicInput, scope: PoolScope): bigint[];
export function computePeriodNullifier(input: {
  derivedSecretField: ProtocolInteger; policyCommitment: ProtocolInteger; periodIndex: ProtocolInteger;
}, scope: PoolScope): bigint;
export function prepareBudgetDeposit(input: {
  code: string | ReceiveCodeInput;
  authorizerScope: ProtocolInteger;
  policy: BudgetPolicyInput;
  asOf: ProtocolInteger;
  budgetPeriods: ProtocolInteger;
  donor: {
    ownerSecret: ProtocolInteger;
    ownerCommitment?: ProtocolInteger;
    amount: ProtocolInteger;
    nonce: ProtocolInteger;
    ciphertext?: ProtocolBytes;
    ciphertextHashField?: ProtocolInteger;
    viewingKey: ProtocolBytes;
    membership: MembershipInput;
  };
  readBudgetRecord: (budgetKey: bigint) => Promise<BudgetRecordInput | null> | BudgetRecordInput | null;
  verifyAuthorization: ProtocolProofVerifier;
  verifyCapability: ProtocolProofVerifier;
  checkEligibility?: (code: ReceiveCode, capability: Capability) => Promise<boolean> | boolean;
  proveFund: LocalProver;
  verifyFund?: ProtocolProofVerifier;
  capabilityIndex?: ProtocolInteger;
  budgetNonce?: ProtocolInteger;
  changeNonce?: ProtocolInteger;
}, scope: PoolScope): Promise<PreparedDeposit>;
export function prepareBudgetClaim(input: {
  authorizerScope: ProtocolInteger;
  qualification: ClaimQualificationInput;
  checkQualification?: (status: ClaimRoleStatus) => Promise<boolean> | boolean;
  note: BudgetNoteInput;
  ciphertext: ProtocolBytes;
  noteCommitment: ProtocolInteger;
  keyMaterial: Pick<ReceiveKeyMaterial, "ownerSecret" | "codeSecret" | "codeRootSecret"> & { viewingKey?: ProtocolBytes };
  derivedSecretField?: ProtocolInteger;
  membership: MembershipInput;
  asOf: ProtocolInteger;
  periodIndex: ProtocolInteger;
  proveClaim: LocalProver;
  verifyClaim?: ProtocolProofVerifier;
  isPeriodSpent?: (periodNullifier: bigint) => Promise<boolean> | boolean;
  outputBudgetNonce?: ProtocolInteger;
  valueNonce?: ProtocolInteger;
}, scope: PoolScope): Promise<PreparedClaim>;
export const TRANSFER_PUBLIC_SIGNAL_COUNT: 12;
export interface TransferPublicInput {
  commonBinding: ProtocolInteger;
  ownerCommitment: ProtocolInteger;
  viewKeyLo: ProtocolInteger;
  viewKeyHi: ProtocolInteger;
  inputRoot: ProtocolInteger;
  inputNullifier: ProtocolInteger;
  outputCommitments: readonly ProtocolInteger[];
  ciphertextHashes: readonly ProtocolInteger[];
}
export interface PreparedTransfer {
  code: ReceiveCode;
  note: ValueNote;
  changeNote: ValueNote;
  inputNullifier: bigint;
  outputCommitments: bigint[];
  ciphertextHashes: bigint[];
  outputCiphertexts: Uint8Array[];
  publicInput: TransferPublicInput;
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export function buildTransferPublicSignals(input: TransferPublicInput, scope: PoolScope): bigint[];
export function prepareTransfer(input: {
  code: string | ReceiveCodeInput;
  authorizerScope: ProtocolInteger;
  asOf: ProtocolInteger;
  amount: ProtocolInteger;
  donor: Parameters<typeof prepareBudgetDeposit>[0]["donor"];
  verifyAuthorization: ProtocolProofVerifier;
  verifyCapability?: ProtocolProofVerifier;
  proveTransfer: LocalProver;
  verifyTransfer?: ProtocolProofVerifier;
  recipientNonce?: ProtocolInteger;
  changeNonce?: ProtocolInteger;
}, scope: PoolScope): Promise<PreparedTransfer>;
