import type { ProtocolInteger } from "./receive-code.js";

export const REVOCATION_SCAN_BATCH_SIZE: 32;
export const REVOCATION_SCAN_TAIL_SIZE: 8;
export interface RevocationScope {
  chainId: ProtocolInteger;
  sourceAddress: ProtocolInteger;
  role: ProtocolInteger;
}
export interface RevocationPageInput extends RevocationScope {
  start: ProtocolInteger;
  startHash: ProtocolInteger;
  secrets: readonly ProtocolInteger[];
  endHash: ProtocolInteger;
  nonce?: ProtocolInteger;
  tag?: ProtocolInteger;
}
export interface RevocationScanInput extends RevocationPageInput {
  nonce: ProtocolInteger;
  tag: ProtocolInteger;
}
export interface PreparedRevocationScan {
  witness: Record<string, bigint | bigint[]>;
  publicSignals: bigint[];
  start: bigint;
  end: bigint;
  startHash: bigint;
  endHash: bigint;
}
export function computeRevocationGenesis(input: RevocationScope): bigint;
export function computeRevocationDigest(input: { role: ProtocolInteger; previousHash: ProtocolInteger; secret: ProtocolInteger }): bigint;
export function verifyRevocationPage(input: RevocationPageInput): {
  start: bigint; end: bigint; startHash: bigint; endHash: bigint; checkpoints: bigint[]; revoked: boolean;
};
export function prepareRevocationScan(input: RevocationScanInput): PreparedRevocationScan;
export function planRevocationScans(input: RevocationScanInput & { tailSize?: number }): {
  scans: PreparedRevocationScan[]; checkedThrough: bigint; end: bigint; endHash: bigint;
};
