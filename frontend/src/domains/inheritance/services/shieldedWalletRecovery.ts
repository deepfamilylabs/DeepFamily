import {
  ProtocolError,
  buildShieldedHpkeAad,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  computeShieldedOwnerCommitment,
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
import { getBytes, getBigInt, hexlify, type BigNumberish, type Contract } from "ethers";
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

export type ShieldedWalletKeyMaterial = {
  ownerSecret: BigNumberish;
  ownerCommitment: BigNumberish;
  hpkeIkm: string | Uint8Array;
  keyMode?: 0 | 1;
};

export type ShieldedWalletRecoveryInput =
  | BigNumberish
  | ShieldedIdentityMaterial
  | {
      keyMaterial: ShieldedWalletKeyMaterial;
      identityCommitment?: BigNumberish;
    };

export type LocalShieldedWalletSnapshot = ShieldedPoolSnapshot<DecodedShieldedNotePayload> & {
  /** Prevents an incremental scan from reusing notes decrypted for another identity. */
  walletOwnerCommitment: bigint;
  walletIdentityCommitment?: bigint;
  walletKeyMode?: 0 | 1;
  /** Opened independent budgets whose identity has not yet been authenticated. */
  pendingIdentityBudgets?: Map<bigint, OwnedShieldedNote<DecodedShieldedNotePayload>>;
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
  /** Preserve the original recipient view key for private continuation funding. */
  viewingKey?: string;
};

export type ShieldedWalletRecoveryOptions = {
  fromBlock?: number;
  toBlock?: number;
  blockChunk?: number;
  previous?: LocalShieldedWalletSnapshot;
};

function identityFields(input: BigNumberish | ShieldedIdentityMaterial): ShieldedIdentityMaterial {
  return typeof input === "object" && input !== null && "derivedSecretField" in input
    ? input
    : { derivedSecretField: input };
}

function recoveryMaterial(input: ShieldedWalletRecoveryInput) {
  if (typeof input === "object" && input !== null && "keyMaterial" in input) {
    const keys = input.keyMaterial;
    const ownerSecret = getBigInt(keys.ownerSecret);
    const ownerCommitment = getBigInt(keys.ownerCommitment);
    if (
      computeShieldedOwnerCommitment(ownerSecret) !== ownerCommitment ||
      getBytes(keys.hpkeIkm).length !== 32 ||
      (keys.keyMode !== 0 && keys.keyMode !== 1)
    )
      throw new Error("Invalid explicit shielded wallet key material");
    return {
      keys: { ...keys, ownerSecret, ownerCommitment },
      keyMode: keys.keyMode,
      identityCommitment:
        input.identityCommitment === undefined ? undefined : getBigInt(input.identityCommitment),
    };
  }
  const identity = identityFields(input);
  return {
    keys: deriveShieldedHeirKeyMaterial(identity.derivedSecretField),
    keyMode: 0 as const,
    identityCommitment:
      identity.identityCommitment === undefined
        ? undefined
        : getBigInt(identity.identityCommitment),
  };
}

/**
 * Rebuild the public note trees from unfiltered logs and open each ciphertext
 * locally. A decryption failure or an invalid note addressed to this viewing
 * key is ignored; neither can make the wallet unrecoverable. Public tree and
 * event inconsistencies still abort the scan in loadShieldedPoolSnapshot.
 */
export async function recoverLocalShieldedWallet(
  pool: Contract,
  identity: ShieldedWalletRecoveryInput,
  options: ShieldedWalletRecoveryOptions = {},
): Promise<LocalShieldedWalletSnapshot> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Shielded pool has no provider");
  const {
    keys,
    keyMode,
    identityCommitment: expectedIdentityCommitment,
  } = recoveryMaterial(identity);
  if (
    options.previous &&
    (options.previous.walletOwnerCommitment !== keys.ownerCommitment ||
      options.previous.walletIdentityCommitment !== expectedIdentityCommitment ||
      (options.previous.walletKeyMode ?? 0) !== keyMode)
  ) {
    throw new Error("Shielded wallet snapshot belongs to another identity");
  }

  const hpkeIkm = getBytes(keys.hpkeIkm);
  const fundingTemplates =
    options.previous?.fundingTemplates ?? new Map<bigint, RecoveredFundingTemplate>();
  const shieldedPolicies =
    options.previous?.shieldedPolicies ?? new Map<bigint, ShieldedPolicyDescriptor>();
  const pendingIdentityBudgets =
    options.previous?.pendingIdentityBudgets ??
    new Map<bigint, OwnedShieldedNote<DecodedShieldedNotePayload>>();
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
            const publicBudget = decodePublicShieldedBudgetEnvelope(event.ciphertext, {
              chainId,
              poolAddress,
            });
            if (
              !publicBudget ||
              keyMode !== 0 ||
              expectedIdentityCommitment === undefined ||
              publicBudget.heirIdentityCommitment !== expectedIdentityCommitment
            )
              return null;
            payload = encodeShieldedBudgetNotePayload(publicBudget, { chainId, poolAddress });
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
          const opened = verifyShieldedNotePayload(
            {
              payload,
              ciphertext: event.ciphertext,
              noteCommitment: event.commitment,
            },
            { chainId, poolAddress },
          );
          const note = opened.note;
          if (
            note.kind === "budget" &&
            (note.binding === "identity" ? 0n : getBigInt(note.keyMode ?? 0)) !== BigInt(keyMode)
          )
            return null;
          if (
            (note.kind === "value" && note.ownerCommitment !== keys.ownerCommitment) ||
            (note.kind === "budget" &&
              ((note.binding !== "identity" && note.heirOwnerCommitment !== keys.ownerCommitment) ||
                (expectedIdentityCommitment !== undefined &&
                  note.heirIdentityCommitment !== expectedIdentityCommitment)))
          ) {
            return null;
          }
          if (note.kind === "budget" && expectedIdentityCommitment === undefined) {
            pendingIdentityBudgets.set(event.commitment, { ...event, note });
            return null;
          }
          if (
            note.kind === "value" &&
            note.fundingMemo &&
            previousPublicNote?.commitment === note.fundingMemo.budgetCommitment &&
            previousPublicNote.transactionHash !== undefined &&
            previousPublicNote.transactionHash === event.transactionHash &&
            previousPublicNote.blockNumber === event.blockNumber &&
            previousPublicNote.logIndex < event.logIndex &&
            event.action === 1 &&
            previousPublicNote.action === 1 &&
            event.actionLogIndex === previousPublicNote.actionLogIndex &&
            previousPublicNote.outputIndex === 0 &&
            event.outputIndex === 1
          ) {
            // Fund appends the child's budget directly before the
            // donor's change note. Match and validate it from the public scan;
            // no recipient or note-index query reaches the RPC.
            const budgetPayload = encodeShieldedBudgetNotePayload(note.fundingMemo.budgetNote, {
              chainId,
              poolAddress,
            });
            try {
              verifyShieldedNotePayload(
                {
                  payload: budgetPayload,
                  ciphertext: previousPublicNote.ciphertext,
                  noteCommitment: previousPublicNote.commitment,
                },
                { chainId, poolAddress },
              );
              fundingTemplates.set(previousPublicNote.commitment, {
                note: note.fundingMemo.budgetNote,
                commitment: previousPublicNote.commitment,
                ciphertext: previousPublicNote.ciphertext,
                shardId: previousPublicNote.shardId,
                ...(note.fundingMemo.ruleOpening
                  ? { ruleOpening: note.fundingMemo.ruleOpening }
                  : {}),
                ...(note.fundingMemo.viewingKey
                  ? { viewingKey: hexlify(note.fundingMemo.viewingKey) }
                  : {}),
              });
              const allocationKey = note.fundingMemo.allocationKey;
              const budget = note.fundingMemo.budgetNote;
              const opening = budget.binding === "identity" ? note.fundingMemo.ruleOpening : budget;
              if (
                allocationKey !== undefined &&
                opening &&
                computeShieldedAllocationKeyCommitment(allocationKey, { chainId, poolAddress }) ===
                  opening.allocationKeyCommitment
              ) {
                shieldedPolicies.set(
                  getShieldedBudgetCommitments(budget, { chainId, poolAddress }).policyCommitment,
                  {
                    rootIdentityCommitment: budget.rootIdentityCommitment,
                    rootVersionIndex: budget.rootVersionIndex,
                    amountPerPeriod: budget.amountPerPeriod,
                    periodDays: budget.periodDays,
                    policySalt: opening.policySalt,
                    allocationKey,
                  },
                );
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
      walletKeyMode: keyMode,
      pendingIdentityBudgets,
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
  derivedSecretField: BigNumberish | ShieldedWalletKeyMaterial,
): OwnedShieldedNote<DecodedShieldedNotePayload>[] {
  if (snapshot.invalidated) throw new Error("Shielded pool snapshot is invalid");
  const keys =
    typeof derivedSecretField === "object" &&
    derivedSecretField !== null &&
    "ownerSecret" in derivedSecretField
      ? {
          ownerSecret: getBigInt(derivedSecretField.ownerSecret),
          ownerCommitment: getBigInt(derivedSecretField.ownerCommitment),
        }
      : deriveShieldedHeirKeyMaterial(derivedSecretField);
  if (computeShieldedOwnerCommitment(keys.ownerSecret) !== keys.ownerCommitment)
    throw new Error("Invalid shielded wallet owner material");
  if (keys.ownerCommitment !== snapshot.walletOwnerCommitment) {
    throw new Error("Shielded wallet snapshot belongs to another identity");
  }
  return [...snapshot.ownedNotes.values()].filter(
    (event) =>
      !snapshot.spentNullifiers.has(
        computeShieldedSpendNullifier(
          {
            ownerSecret: keys.ownerSecret,
            noteCommitment: event.commitment,
          },
          snapshot,
        ),
      ),
  );
}
