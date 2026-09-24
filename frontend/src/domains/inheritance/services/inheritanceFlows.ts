import type { ethers } from "ethers";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import {
  buildInheritanceClaimWitness,
  computeInheritanceEligibleFrom,
  computeInheritanceEntitlement,
} from "@deepfamily/protocol-core";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { Groth16Proof } from "../../../shared/zk/zk";
import type { InheritanceClaimWitness } from "../../../shared/zk/zkSnark";
import { InheritanceError } from "../model/inheritanceErrors";
import type { HeirLegitimacy, InheritanceRow, LineageSnapshot } from "./inheritanceChain";

export type InheritanceTxStage = "approving" | "submitting";

export type TokenContract = {
  allowance: (owner: string, spender: string) => Promise<bigint>;
  approve: (spender: string, amount: bigint) => Promise<{ wait: () => Promise<unknown> }>;
};

type FundingInput = {
  inheritance: ethers.Contract;
  token: TokenContract;
  owner: string;
  amount: bigint;
  onStage?: (stage: InheritanceTxStage) => void;
};

/** Refuses to send when the wallet is on another chain than the one the page reads. */
export async function assertWalletChain(signer: ethers.Signer, chainId: number): Promise<void> {
  const network = await signer.provider?.getNetwork();
  if (!network || Number(network.chainId) !== chainId) throw new InheritanceError("wrongNetwork");
}

function findEvent(
  inheritance: ethers.Contract,
  receipt: ethers.TransactionReceipt | null,
  name: string,
): ethers.LogDescription | null {
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = inheritance.interface.parseLog(log);
      if (parsed?.name === name) return parsed;
    } catch {
      // Not an inheritance event (the token's Transfer, for example).
    }
  }
  return null;
}

/** Approves exactly the deposit, and only when the current allowance falls short. */
async function approveFunding({ inheritance, token, owner, amount, onStage }: FundingInput) {
  const spender = await inheritance.getAddress();
  if ((await token.allowance(owner, spender)) < amount) {
    onStage?.("approving");
    await (await token.approve(spender, amount)).wait();
  }
  onStage?.("submitting");
}

export async function createInheritanceFlow(
  input: FundingInput & { credential: bigint; amountPerPeriod: bigint },
): Promise<{ id: bigint; transactionHash: string }> {
  await approveFunding(input);
  const tx = await input.inheritance.createInheritance(
    input.credential,
    input.amountPerPeriod,
    input.amount,
  );
  const receipt = await tx.wait();
  const created = findEvent(input.inheritance, receipt, "InheritanceCreated");
  if (!created) throw new Error("InheritanceCreated event missing from the receipt");
  return { id: BigInt(created.args.id), transactionHash: tx.hash };
}

export async function depositFlow(
  input: FundingInput & { id: bigint },
): Promise<{ transactionHash: string }> {
  await approveFunding(input);
  const tx = await input.inheritance.deposit(input.id, input.amount);
  await tx.wait();
  return { transactionHash: tx.hash };
}

export type ClaimSignals = {
  endorsementRoot: bigint;
  trustedRoot: bigint;
  claimTag: bigint;
  eligibleFrom: bigint;
  recipient: string;
};

export type ClaimSummary = {
  eligibleFrom: bigint;
  /** The first period has begun. */
  ready: boolean;
  /** Accrued minus claimed, before the balance cap. */
  owed: bigint;
  /** What a claim would pay now: accrued minus claimed, capped by the balance. */
  claimable: bigint;
};

/** Mirrors the contract's accrual for one heir at block time `now`. */
export function summarizeClaim(
  row: Pick<InheritanceRow, "startTime" | "amountPerPeriod" | "balance" | "claimed">,
  writtenAt: bigint,
  now: bigint,
): ClaimSummary {
  const eligibleFrom = computeInheritanceEligibleFrom({ startTime: row.startTime, writtenAt });
  if (now < eligibleFrom) return { eligibleFrom, ready: false, owed: 0n, claimable: 0n };
  const entitlement = computeInheritanceEntitlement({
    amountPerPeriod: row.amountPerPeriod,
    eligibleFrom,
    now,
  });
  const owed = entitlement > row.claimed ? entitlement - row.claimed : 0n;
  return { eligibleFrom, ready: true, owed, claimable: owed < row.balance ? owed : row.balance };
}

export type ClaimPreview =
  | (ClaimSummary & { ready: false })
  | (ClaimSummary & { ready: true; witness: InheritanceClaimWitness; signals: ClaimSignals });

type PrepareClaimInput = {
  heir: IdentityMaterialV1Result;
  root: IdentityMaterialV1Result;
  rootVersionIndex: number;
  legitimacy: HeirLegitimacy;
  snapshot: LineageSnapshot;
  row: InheritanceRow;
  recipient: string;
  /** Latest block time; the contract measures accrual against it, not the local clock. */
  now: bigint;
};

export function prepareClaim({
  heir,
  root,
  rootVersionIndex,
  legitimacy,
  snapshot,
  row,
  recipient,
  now,
}: PrepareClaimInput): ClaimPreview {
  const summary = summarizeClaim(row, legitimacy.writtenAt, now);
  if (!summary.ready) return { ...summary, ready: false };
  const { eligibleFrom } = summary;

  const { witness, publicSignals } = buildInheritanceClaimWitness({
    heir: {
      identity: heir.identity,
      identitySuiteId: heir.identitySuiteId,
      derivedSecretField: heir.derivedSecretField,
    },
    versionIndex: legitimacy.versionIndex,
    fatherIdentityCommitment: legitimacy.fatherIdentityCommitment,
    motherIdentityCommitment: legitimacy.motherIdentityCommitment,
    rootIsMother: legitimacy.rootIsMother,
    endorser: legitimacy.endorser,
    writtenAt: legitimacy.writtenAt,
    endorsementTree: snapshot.endorsementTree,
    endorsementLeafIndex: legitimacy.endorsementLeafIndex,
    root: {
      identityCommitment: root.identityCommitment,
      versionIndex: rootVersionIndex,
      derivedSecretField: root.derivedSecretField,
    },
    trustedTree: snapshot.trustedTree,
    trustedLeafIndex: legitimacy.trustedLeafIndex,
    eligibleFrom,
    recipient,
  });
  return {
    ...summary,
    ready: true,
    witness: witness as InheritanceClaimWitness,
    signals: {
      endorsementRoot: publicSignals.endorsementRoot,
      trustedRoot: publicSignals.trustedRoot,
      claimTag: publicSignals.claimTag,
      eligibleFrom,
      recipient,
    },
  };
}

export async function submitClaim({
  inheritance,
  id,
  signals,
  proof,
}: {
  inheritance: ethers.Contract;
  id: bigint;
  signals: ClaimSignals;
  proof: Groth16Proof;
}): Promise<{ amount: bigint; transactionHash: string }> {
  const proofData = encodeGroth16AbcProofData(normalizeGroth16Proof(proof));
  const tx = await inheritance.claim(id, signals, proofData);
  const receipt = await tx.wait();
  const claimed = findEvent(inheritance, receipt, "InheritanceClaimed");
  if (!claimed) throw new Error("InheritanceClaimed event missing from the receipt");
  return { amount: BigInt(claimed.args.amount), transactionHash: tx.hash };
}
