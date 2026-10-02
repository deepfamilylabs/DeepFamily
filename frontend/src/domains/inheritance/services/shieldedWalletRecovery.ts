import {
  ProtocolError,
  buildShieldedHpkeAad,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  computeShieldedSpendNullifier,
  computeShieldedAllocationKeyCommitment,
  computeShieldedPolicyCommitment,
  encodeShieldedBudgetNotePayload,
  verifyShieldedNotePayload,
  type DecodedShieldedNotePayload,
  type ShieldedBudgetNotePayload,
  type ShieldedPolicyDescriptor,
} from "@deepfamily/protocol-core";
import { getBytes, getBigInt, type BigNumberish, type Contract } from "ethers";
import {
  getLocalShieldedNoteProof,
  loadShieldedPoolSnapshot,
  type OwnedShieldedNote,
  type PublicShieldedNote,
  type ShieldedPoolSnapshot,
} from "./shieldedPoolChain";

type ShieldedIdentityMaterial = {
  derivedSecretField: BigNumberish;
  identityCommitment?: BigNumberish;
};

export type LocalShieldedWalletSnapshot = ShieldedPoolSnapshot<DecodedShieldedNotePayload> & {
  /** Prevents an incremental scan from reusing notes decrypted for another identity. */
  walletOwnerCommitment: bigint;
  walletIdentityCommitment?: bigint;
  /** Donor-readable copies of child budget templates carried by change notes. */
  fundingTemplates?: Map<bigint, RecoveredFundingTemplate>;
  shieldedPolicies?: Map<bigint, ShieldedPolicyDescriptor>;
};

export type RecoveredFundingTemplate = {
  note: ShieldedBudgetNotePayload;
  commitment: bigint;
  ciphertext: Uint8Array;
  shardId: bigint;
};

export type ShieldedWalletRecoveryOptions = {
  fromBlock?: number;
  blockChunk?: number;
  previous?: LocalShieldedWalletSnapshot;
};

function identityFields(input: BigNumberish | ShieldedIdentityMaterial): ShieldedIdentityMaterial {
  return typeof input === "object" && input !== null && "derivedSecretField" in input
    ? input
    : { derivedSecretField: input };
}

/**
 * Rebuild the public note trees from unfiltered logs and open each ciphertext
 * locally. A decryption failure or an invalid note addressed to this viewing
 * key is ignored; neither can make the wallet unrecoverable. Public tree and
 * event inconsistencies still abort the scan in loadShieldedPoolSnapshot.
 */
export async function recoverLocalShieldedWallet(
  pool: Contract,
  identity: BigNumberish | ShieldedIdentityMaterial,
  options: ShieldedWalletRecoveryOptions = {},
): Promise<LocalShieldedWalletSnapshot> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Shielded pool has no provider");
  const material = identityFields(identity);
  const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
  const expectedIdentityCommitment =
    material.identityCommitment === undefined ? undefined : getBigInt(material.identityCommitment);
  if (
    options.previous &&
    (options.previous.walletOwnerCommitment !== keys.ownerCommitment ||
      options.previous.walletIdentityCommitment !== expectedIdentityCommitment)
  ) {
    throw new Error("Shielded wallet snapshot belongs to another identity");
  }

  const hpkeIkm = getBytes(keys.hpkeIkm);
  const fundingTemplates =
    options.previous?.fundingTemplates ?? new Map<bigint, RecoveredFundingTemplate>();
  const shieldedPolicies =
    options.previous?.shieldedPolicies ?? new Map<bigint, ShieldedPolicyDescriptor>();
  let precedingPublicNote: PublicShieldedNote | undefined;
  try {
    const chainId = (await provider.getNetwork()).chainId;
    const poolAddress = await pool.getAddress();
    buildShieldedHpkeAad({ chainId, poolAddress });
    const snapshot = await loadShieldedPoolSnapshot(
      pool,
      async (event) => {
        const previousPublicNote = precedingPublicNote;
        precedingPublicNote = event;
        let payload: Uint8Array;
        try {
          payload = await decryptShieldedNote({
            hpkeIkm,
            ciphertext: event.ciphertext,
            chainId,
            poolAddress,
          });
        } catch (error) {
          if (error instanceof ProtocolError && error.code === "SHIELDED_DECRYPTION_FAILED") {
            return null;
          }
          throw error;
        }
        try {
          const opened = verifyShieldedNotePayload({
            payload,
            ciphertext: event.ciphertext,
            noteCommitment: event.commitment,
          });
          const note = opened.note;
          if (
            (note.kind === "value" && note.ownerCommitment !== keys.ownerCommitment) ||
            (note.kind === "budget" &&
              (note.heirOwnerCommitment !== keys.ownerCommitment ||
                (expectedIdentityCommitment !== undefined &&
                  note.heirIdentityCommitment !== expectedIdentityCommitment)))
          ) {
            return null;
          }
          if (
            note.kind === "value" &&
            note.topUpMemo &&
            previousPublicNote?.commitment === note.topUpMemo.budgetCommitment
          ) {
            // Fund appends the child's budget directly before the
            // donor's change note. Match and validate it from the public scan;
            // no recipient or note-index query reaches the RPC.
            const budgetPayload = encodeShieldedBudgetNotePayload(note.topUpMemo.budgetNote);
            try {
              verifyShieldedNotePayload({
                payload: budgetPayload,
                ciphertext: previousPublicNote.ciphertext,
                noteCommitment: previousPublicNote.commitment,
              });
              fundingTemplates.set(previousPublicNote.commitment, {
                note: note.topUpMemo.budgetNote,
                commitment: previousPublicNote.commitment,
                ciphertext: previousPublicNote.ciphertext,
                shardId: previousPublicNote.shardId,
              });
              const allocationKey = note.topUpMemo.allocationKey;
              if (
                allocationKey !== undefined &&
                computeShieldedAllocationKeyCommitment(allocationKey) ===
                  note.topUpMemo.budgetNote.allocationKeyCommitment
              ) {
                const budget = note.topUpMemo.budgetNote;
                shieldedPolicies.set(computeShieldedPolicyCommitment(budget), {
                  rootIdentityCommitment: budget.rootIdentityCommitment,
                  rootVersionIndex: budget.rootVersionIndex,
                  amountPerPeriod: budget.amountPerPeriod,
                  policySalt: budget.policySalt,
                  allocationKey,
                });
              }
            } catch (error) {
              // A sender can put arbitrary encrypted memos in a value note.
              // Preserve a valid value note while ignoring a bad backup.
              if (!(error instanceof ProtocolError)) throw error;
            } finally {
              budgetPayload.fill(0);
            }
          }
          return { note, commitment: opened.noteCommitment };
        } catch (error) {
          // A sender can encrypt malformed data to any public viewing key. It
          // must not stop recovery of later, valid notes.
          if (error instanceof ProtocolError) return null;
          throw error;
        } finally {
          payload.fill(0);
        }
      },
      options,
    );
    return {
      ...snapshot,
      walletOwnerCommitment: keys.ownerCommitment,
      walletIdentityCommitment: expectedIdentityCommitment,
      fundingTemplates,
      shieldedPolicies,
    };
  } finally {
    hpkeIkm.fill(0);
  }
}

export function listRecoveredFundingTemplates(
  snapshot: LocalShieldedWalletSnapshot,
): RecoveredFundingTemplate[] {
  if (snapshot.invalidated) throw new Error("Shielded wallet snapshot is invalid");
  return [...(snapshot.fundingTemplates?.values() ?? [])];
}

export function getRecoveredFundingTemplate(
  snapshot: LocalShieldedWalletSnapshot,
  commitment: bigint,
): RecoveredFundingTemplate {
  if (snapshot.invalidated) throw new Error("Shielded wallet snapshot is invalid");
  const template = snapshot.fundingTemplates?.get(commitment);
  if (!template) throw new Error("Funding template is not recoverable from this wallet");
  return template;
}

/** Recovered from all donor change notes, including spent and zero-value notes. */
export function listRecoveredShieldedPolicies(
  snapshot: LocalShieldedWalletSnapshot,
): ShieldedPolicyDescriptor[] {
  if (snapshot.invalidated) throw new Error("Shielded wallet snapshot is invalid");
  return [...(snapshot.shieldedPolicies?.values() ?? [])];
}

/** Nullifiers are computed only on the device from the holder's secret. */
export function listUnspentRecoveredShieldedNotes(
  snapshot: LocalShieldedWalletSnapshot,
  derivedSecretField: BigNumberish,
): OwnedShieldedNote<DecodedShieldedNotePayload>[] {
  if (snapshot.invalidated) throw new Error("Shielded pool snapshot is invalid");
  const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
  if (keys.ownerCommitment !== snapshot.walletOwnerCommitment) {
    throw new Error("Shielded wallet snapshot belongs to another identity");
  }
  return [...snapshot.ownedNotes.values()].filter(
    (event) =>
      !snapshot.spentNullifiers.has(
        computeShieldedSpendNullifier({
          ownerSecret: keys.ownerSecret,
          noteCommitment: event.commitment,
        }),
      ),
  );
}

/** Uses the locally replayed shard; no leaf-index or recipient RPC request. */
export function getRecoveredShieldedNoteProof(
  snapshot: LocalShieldedWalletSnapshot,
  commitment: bigint,
) {
  return getLocalShieldedNoteProof(snapshot, commitment);
}

export type ShieldedGasWalletIssue =
  | "insufficientGas"
  | "directPublicWalletFunding"
  | "reusedPublicWallet"
  | "immediateWithdrawal"
  | "distinctiveWithdrawalAmount";

/**
 * Inputs about wallet history are supplied by the caller; this helper cannot
 * infer them from a CFX balance. It returns UI-independent risk codes.
 */
export function assessShieldedGasWallet(input: {
  gasBalanceDrip: bigint;
  estimatedMaxFeeDrip: bigint;
  directlyFundedFromPublicWallet?: boolean;
  reusedForPublicActivity?: boolean;
  withdrawingImmediately?: boolean;
  distinctiveWithdrawalAmount?: boolean;
}): { canSubmit: boolean; issues: ShieldedGasWalletIssue[] } {
  if (input.gasBalanceDrip < 0n || input.estimatedMaxFeeDrip < 0n) {
    throw new Error("Gas balance and estimated fee must be nonnegative");
  }
  const issues: ShieldedGasWalletIssue[] = [];
  const gasSufficient = input.gasBalanceDrip >= input.estimatedMaxFeeDrip;
  const canSubmit =
    gasSufficient && !input.directlyFundedFromPublicWallet && !input.reusedForPublicActivity;
  if (!gasSufficient) issues.push("insufficientGas");
  if (input.directlyFundedFromPublicWallet) issues.push("directPublicWalletFunding");
  if (input.reusedForPublicActivity) issues.push("reusedPublicWallet");
  if (input.withdrawingImmediately) issues.push("immediateWithdrawal");
  if (input.distinctiveWithdrawalAmount) issues.push("distinctiveWithdrawalAmount");
  return { canSubmit, issues };
}
