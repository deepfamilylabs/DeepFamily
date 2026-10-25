import type { IdentityFields } from "./index.js";
import type { ProtocolInteger } from "./receive-code.js";
export function createRoleOpening(role: "child" | "endorsement" | "trusted"): { secret: bigint; commitment: bigint };
export function createFamilyCommitment(input: { parentIdentity: ProtocolInteger; familySalt?: ProtocolInteger }): { familyCommitment: bigint; familySalt: bigint };
export interface SourceFactInput {
  childIdentity: ProtocolInteger; parentIdentity: ProtocolInteger; endorser: ProtocolInteger; parentVersion: ProtocolInteger;
  xChild?: ProtocolInteger; xEndorse?: ProtocolInteger; sourceFactSalt?: ProtocolInteger;
}
export interface SourceTrustInput {
  parentIdentity: ProtocolInteger; endorser: ProtocolInteger; parentVersion: ProtocolInteger;
  xTrust?: ProtocolInteger; sourceTrustSalt?: ProtocolInteger;
}
export function createSourceFact(input: SourceFactInput): {
  childIdentity: bigint; parentIdentity: bigint; endorser: bigint; parentVersion: bigint;
  xChild: bigint; xEndorse: bigint; sourceFactSalt: bigint;
  factLeaf: bigint; childRoleCommitment: bigint; endorsementRoleCommitment: bigint;
};
export function createSourceTrust(input: SourceTrustInput): {
  parentIdentity: bigint; endorser: bigint; parentVersion: bigint; xTrust: bigint; sourceTrustSalt: bigint;
  trustLeaf: bigint; trustRoleCommitment: bigint;
};
export interface SourcePath {
  root: ProtocolInteger; depth: ProtocolInteger; index: ProtocolInteger; siblings: readonly ProtocolInteger[];
}
export interface EligibilityIssueInput {
  identity: IdentityFields; identitySuiteId?: number; derivedSecretField: ProtocolInteger;
  chainId: ProtocolInteger; authorizerScope: ProtocolInteger; parentIdentity: ProtocolInteger; parentVersion: ProtocolInteger;
  endorser: ProtocolInteger; familySalt: ProtocolInteger; xChild: ProtocolInteger; xEndorse: ProtocolInteger;
  xTrust: ProtocolInteger; sourceFactSalt: ProtocolInteger; sourceTrustSalt: ProtocolInteger;
  sourcePath: SourcePath; trustedPath: SourcePath;
  issueNonce?: ProtocolInteger; credentialSalt?: ProtocolInteger;
}
export function prepareEligibilityIssue(input: EligibilityIssueInput): {
  witness: Record<string, bigint | bigint[]>; credentialCommitment: bigint; familyRoot: bigint; publicSignals: bigint[];
};
