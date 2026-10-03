import {
  ProtocolError,
  buildShieldedHpkeAad,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  computeShieldedSpendNullifier,
  computeShieldedAllocationKeyCommitment,
  getShieldedBudgetCommitments,
  decodePublicShieldedBudgetEnvelope,
  isPublicShieldedBudgetEnvelope,
  encodeShieldedBudgetNotePayload,
  verifyShieldedNotePayload,
  type DecodedShieldedNotePayload,
  type ShieldedBudgetNotePayload,
  type ShieldedBudgetRuleOpening,
  type ShieldedPolicyDescriptor,
} from "@deepfamily/protocol-core";
import { getBytes, getBigInt, type BigNumberish, type Contract } from "ethers";
import {
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
  ruleOpening?: ShieldedBudgetRuleOpening;
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
          if (isPublicShieldedBudgetEnvelope(event.ciphertext)) {
            const publicBudget = decodePublicShieldedBudgetEnvelope(event.ciphertext);
            if (
              !publicBudget ||
              expectedIdentityCommitment === undefined ||
              publicBudget.heirIdentityCommitment !== expectedIdentityCommitment
            )
              return null;
            payload = encodeShieldedBudgetNotePayload(publicBudget);
          } else {
            payload = await decryptShieldedNote({
              hpkeIkm,
              ciphertext: event.ciphertext,
              chainId,
              poolAddress,
            });
          }
        } catch (error) {
          if (error instanceof ProtocolError) return null;
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
              ((note.binding !== "identity" && note.heirOwnerCommitment !== keys.ownerCommitment) ||
                (expectedIdentityCommitment !== undefined &&
                  note.heirIdentityCommitment !== expectedIdentityCommitment)))
          ) {
            return null;
          }
          if (
            note.kind === "value" &&
            note.fundingMemo &&
            previousPublicNote?.commitment === note.fundingMemo.budgetCommitment
          ) {
            // Fund appends the child's budget directly before the
            // donor's change note. Match and validate it from the public scan;
            // no recipient or note-index query reaches the RPC.
            const budgetPayload = encodeShieldedBudgetNotePayload(note.fundingMemo.budgetNote);
            try {
              verifyShieldedNotePayload({
                payload: budgetPayload,
                ciphertext: previousPublicNote.ciphertext,
                noteCommitment: previousPublicNote.commitment,
              });
              fundingTemplates.set(previousPublicNote.commitment, {
                note: note.fundingMemo.budgetNote,
                commitment: previousPublicNote.commitment,
                ciphertext: previousPublicNote.ciphertext,
                shardId: previousPublicNote.shardId,
                ...(note.fundingMemo.ruleOpening
                  ? { ruleOpening: note.fundingMemo.ruleOpening }
                  : {}),
              });
              const allocationKey = note.fundingMemo.allocationKey;
              const budget = note.fundingMemo.budgetNote;
              const opening = budget.binding === "identity" ? note.fundingMemo.ruleOpening : budget;
              if (
                allocationKey !== undefined &&
                opening &&
                computeShieldedAllocationKeyCommitment(allocationKey) ===
                  opening.allocationKeyCommitment
              ) {
                shieldedPolicies.set(getShieldedBudgetCommitments(budget).policyCommitment, {
                  rootIdentityCommitment: budget.rootIdentityCommitment,
                  rootVersionIndex: budget.rootVersionIndex,
                  amountPerPeriod: budget.amountPerPeriod,
                  policySalt: opening.policySalt,
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
