import type {
  ProtocolInteger,
  ProtocolProof,
  ProtocolProofVerifier,
  ReceiveKeyMaterial,
} from "./receive-code.js";
import type { LocalProver, MembershipInput, PoolScope, ValueNote } from "./budget.js";
export interface PreparedShield {
  amount: bigint;
  notes: ValueNote[];
  outputCommitments: bigint[];
  outputCiphertexts: Uint8Array[];
  ciphertextHashes: bigint[];
  publicInput: {
    chainId: bigint;
    pool: bigint;
    amount: bigint;
    inputShardIds: bigint[];
    inputRoots: bigint[];
    inputNullifiers: bigint[];
    outputCommitments: bigint[];
    ciphertextHashes: bigint[];
  };
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export interface ValueDonor {
  ownerSecret: ProtocolInteger;
  amount: ProtocolInteger;
  nonce: ProtocolInteger;
  viewingKey: Uint8Array;
  ciphertext?: Uint8Array;
  ciphertextHashField?: ProtocolInteger;
  membership: MembershipInput;
  shardId?: ProtocolInteger;
}
export interface PreparedUnshield {
  amount: bigint;
  recipient: string;
  capacity: 1 | 4;
  notes: ValueNote[];
  outputCommitments: bigint[];
  outputCiphertexts: Uint8Array[];
  ciphertextHashes: bigint[];
  publicInput: {
    chainId: bigint;
    pool: bigint;
    amount: bigint;
    recipient: bigint;
    inputShardIds: bigint[];
    inputRoots: bigint[];
    inputNullifiers: bigint[];
    outputCommitments: bigint[];
    ciphertextHashes: bigint[];
  };
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export function prepareShield(
  input: {
    keyMaterial: Pick<ReceiveKeyMaterial, "ownerSecret" | "viewingKey"> & {
      ownerCommitment?: ProtocolInteger;
    };
    amount: ProtocolInteger;
    nonce?: ProtocolInteger;
    dummyNonce?: ProtocolInteger;
    proveShield: LocalProver;
    verifyShield?: ProtocolProofVerifier;
  },
  scope: PoolScope,
): Promise<PreparedShield>;
export function prepareUnshield(
  input: {
    donor?: ValueDonor;
    donors?: ValueDonor[];
    amount: ProtocolInteger;
    recipient: string;
    changeNonce?: ProtocolInteger;
    dummyNonce?: ProtocolInteger;
    proveUnshield: (
      witness: Record<string, bigint | bigint[] | bigint[][]>,
      capacity: 1 | 4,
    ) => ReturnType<LocalProver>;
    verifyUnshield?: ProtocolProofVerifier;
  },
  scope: PoolScope,
): Promise<PreparedUnshield>;
