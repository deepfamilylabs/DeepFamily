import "../../zodInit";
import { z } from "zod";
import type { ShieldedAssetWorkerCallMap } from "./shieldedAssetWorkerTypes";

const text = z.string();
const count = z.number().int().nonnegative();
const suiteId = z.number().int().min(1).max(0xffffffff);
const slot = z.enum(["identity", "independent"]);
const bit = z.union([z.literal(0), z.literal(1)]);
const action = z.enum(["shield", "fund", "claim", "privateTransfer", "unshield"]);
const scalar = z.union([text, z.bigint(), z.number().int()]);
const bytes = z.union([text, z.instanceof(Uint8Array)]);
const session = z.strictObject({
  credentials: z.strictObject({ handle: text }).nullable(),
  identity: z
    .strictObject({
      handle: text,
      identitySuiteId: count,
      identityCommitment: text,
      personHash: text,
      identity: z.strictObject({ fullName: text }),
    })
    .nullable(),
  independentKey: z
    .strictObject({
      ownerCommitment: text,
      viewingKey: text,
      keyFingerprint: text,
      rootSource: z.enum(["random", "walletSignature", "imported"]),
      signerAddress: text.optional(),
      recoveryVerified: z.boolean(),
      recoveryPath: z.enum(["signature", "mnemonic", "shieldedKey"]).optional(),
      backupRequired: z.boolean().optional(),
    })
    .nullable(),
});
const wallet = z.strictObject({
  sessionState: session.optional(),
  familyRecordsAvailable: z.boolean().optional(),
  familyRecordsError: z.enum(["unavailable", "incompatible"]).optional(),
  toBlock: count,
  blockHash: text,
  notes: z.array(
    z.strictObject({
      commitment: text,
      ownerCommitment: text,
      slot,
      kind: z.enum(["value", "budget"]),
      amount: text,
      keyMode: bit.optional(),
      bindingKind: bit.optional(),
      amountPerPeriod: text.optional(),
      periodDays: text.optional(),
      eligibleFrom: text.optional(),
      pendingIdentity: z.boolean().optional(),
    }),
  ),
  policies: z.array(
    z.strictObject({
      handle: text,
      rootVersionIndex: text,
      amountPerPeriod: text,
      periodDays: text,
    }),
  ),
  templates: z.array(
    z.strictObject({
      handle: text,
      policyHandle: text,
      personHash: text,
      bindingKind: bit,
      keyMode: bit,
      ownerCommitment: text.optional(),
    }),
  ),
  claims: z.array(
    z.strictObject({
      handle: text,
      slot,
      budgets: z.array(text),
      periodIndices: z.array(text),
      amount: text,
      amountPerPeriod: text,
      totalRemaining: text.optional(),
      duePeriods: text.optional(),
      periodDays: text.optional(),
      status: text,
      nextDueAt: text.optional(),
      nextPeriodIndex: text.optional(),
      futurePeriods: text.optional(),
    }),
  ),
  parentVersions: z.array(count),
  children: z.array(
    z.strictObject({ personHash: text, rootVersionIndex: count, eligible: z.boolean(), identitySuiteId: suiteId.optional() }),
  ),
});
const receiveAuthorization = z.strictObject({
  checkpointId: scalar,
  asOf: scalar,
  deadline: scalar,
  recipientBinding: scalar,
  proof: text,
});
const point = z.tuple([
  z.union([text, z.bigint()]),
  z.union([text, z.bigint()]),
  z.union([text, z.bigint()]),
]);
const pair = z.tuple([z.union([text, z.bigint()]), z.union([text, z.bigint()])]);

// Strict objects reject unknown fields at every level. Secret exports have one
// explicit method; no other result can carry recovery material or note openings.
const results = {
  findWalletIdentities: z.strictObject({
    matches: z.array(z.strictObject({ identitySuiteId: suiteId, personHash: z.string().regex(/^0x[0-9a-f]{64}$/i) })),
  }),
  unlockIdentity: session,
  createIndependentKey: session,
  restoreSignature: session,
  importRecoveryMaterial: session,
  clearIndependentKey: session,
  clearPendingIndependentKey: session,
  exportRecoveryMaterial: z.strictObject({
    material: text,
    format: z.enum(["mnemonic", "shieldedKey"]),
    version: z.literal(1),
    keyFingerprint: text,
  }),
  prepareLetter: z.strictObject({
    delivery: z.strictObject({
      messageId: text,
      checkpointId: text,
      asOf: text,
      deadline: text,
      recipientBinding: text,
    }),
    ciphertext: text,
    proof: text,
  }),
  recoverLetters: z.strictObject({
    letters: z.array(
      z.strictObject({
        messageId: text,
        body: text,
        registeredAt: text,
        slot,
        transactionHash: text,
      }),
    ),
    unavailable: count,
  }),
  receiveCode: z.strictObject({ code: text }),
  authorizeIdentityCounter: z.strictObject({
    address: text,
    args: z.tuple([text, text, text, text, text]),
  }),
  recover: wallet,
  discover: z.strictObject({
    complete: z.boolean(),
    error: text.optional(),
    sessionState: session.optional(),
    pools: z.array(
      z.strictObject({
        assetAddress: text,
        poolAddress: text,
        status: z.enum(["recovered", "failed"]),
        rawValueBalance: text.optional(),
        rawBudgetBalance: text.optional(),
        error: text.optional(),
      }),
    ),
  }),
  preview: z.strictObject({
    handle: text,
    action,
    amount: text,
    slot,
    inputs: z.array(text),
    inputAmounts: z.array(text),
    steps: z.array(
      z.strictObject({ action: text, inputs: z.array(text), outputAmounts: z.array(text) }),
    ),
    outputAmounts: z.array(text),
    recipient: text.optional(),
    policyHandle: text.optional(),
  }),
  prove: z.strictObject({
    action,
    amount: text,
    recipient: text.optional(),
    data: z.strictObject({
      fundMode: scalar,
      budgetKind: scalar,
      inputShardIds: z.array(scalar),
      inputRoots: z.array(scalar),
      inputNullifiers: z.array(scalar),
      periodNullifiers: z.array(scalar),
      outputCommitments: z.tuple([scalar, scalar]),
      outputCiphertexts: z.tuple([bytes, bytes]),
      relation0: scalar,
      relation1: scalar,
      asOf: scalar,
      lineageCheckpointId: scalar,
      receiveAuthorizations: z.array(receiveAuthorization).optional(),
    }),
    proof: z.strictObject({
      pi_a: point,
      pi_b: z.tuple([pair, pair, pair]),
      pi_c: point,
      protocol: text,
      curve: text,
    }),
  }),
  cancelPreview: z.strictObject({ ok: z.literal(true) }),
} satisfies {
  [M in keyof ShieldedAssetWorkerCallMap]: z.ZodType<ShieldedAssetWorkerCallMap[M]["result"]>;
};

export function publicShieldedAssetResult<M extends keyof ShieldedAssetWorkerCallMap>(
  method: M,
  value: unknown,
): ShieldedAssetWorkerCallMap[M]["result"] {
  try {
    return results[method].parse(value);
  } catch {
    // Schema diagnostics can include private field names or values.
    throw new Error("Asset Worker returned an invalid public result");
  }
}
