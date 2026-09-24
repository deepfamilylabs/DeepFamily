import type { FriendlyError } from "../../../shared/lib/errors";

/**
 * The identity form this domain reads at the moment of an action. The page passes the person
 * domain's calculator, which fits this shape; the passphrase goes straight from the form to the
 * crypto worker and never enters React state.
 */
export interface IdentityFormHandle {
  getPublicFormData: () => {
    fullName: string;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isBirthBC: boolean;
  };
  getSecretInputs: () => { passphrase: string };
}

export type IdentityFormRef = { readonly current: IdentityFormHandle | null };

/** Why the page cannot act yet; every panel shows the same gate. */
export type InheritanceBlocker =
  | "loading"
  | "not-configured"
  | "not-wired"
  | "unreachable"
  | "wrong-network";

export interface CreateReview {
  credential: bigint;
  rootPersonHash: string;
  rootVersionIndex: number;
  trustedEndorserCount: number;
  amountPerPeriod: bigint;
  amount: bigint;
}

export type CreateState =
  | { step: "idle" }
  | { step: "deriving" }
  | { step: "checking" }
  | { step: "review"; review: CreateReview }
  | { step: "approving"; review: CreateReview }
  | { step: "submitting"; review: CreateReview }
  | { step: "success"; review: CreateReview; id: bigint; transactionHash: string }
  | { step: "error"; error: FriendlyError };

export interface InheritanceInfo {
  id: bigint;
  startTime: bigint;
  amountPerPeriod: bigint;
  balance: bigint;
}

export type DepositState =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "found"; info: InheritanceInfo }
  | { step: "approving"; info: InheritanceInfo }
  | { step: "submitting"; info: InheritanceInfo }
  | { step: "success"; info: InheritanceInfo; amount: bigint; transactionHash: string }
  | { step: "error"; info?: InheritanceInfo; error: FriendlyError };

/** One inheritance as the heir sees it. Nothing here is secret. */
export interface ClaimRowView {
  id: bigint;
  startTime: bigint;
  amountPerPeriod: bigint;
  balance: bigint;
  claimed: bigint;
  eligibleFrom: bigint;
  /** The first period has begun. */
  ready: boolean;
  /** Accrued minus claimed, before the balance cap. */
  owed: bigint;
  /** What a claim would pay now. */
  claimable: bigint;
}

export interface ClaimLookup {
  heirPersonHash: string;
  rootPersonHash: string;
  rootVersionIndex: number;
  /** The heir's version and endorser that open the earliest period. */
  versionIndex: number;
  endorser: string;
  rows: ClaimRowView[];
}

export type SearchStage = "deriving" | "scanning";
export type ClaimStage = "deriving" | "scanning" | "proving" | "submitting";

export type ClaimState =
  | { step: "idle" }
  | { step: "searching"; stage: SearchStage }
  | { step: "found"; lookup: ClaimLookup }
  | { step: "claiming"; lookup: ClaimLookup; id: bigint; stage: ClaimStage }
  | {
      step: "claimed";
      lookup: ClaimLookup;
      id: bigint;
      amount: bigint;
      transactionHash: string;
    }
  | { step: "error"; lookup?: ClaimLookup; error: FriendlyError };
