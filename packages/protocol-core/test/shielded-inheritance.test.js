import test from "node:test";
import assert from "node:assert/strict";
import {
  SECONDS_PER_DAY,
  MAX_UINT32,
  MAX_UINT64,
  MAX_UINT128,
  SHIELDED_CIPHERTEXT_BYTES,
  SHIELDED_MAX_BATCH_PERIODS,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedClaimBatch,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedEnrollmentNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedOwnerCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedBudgetUseNullifier,
  computeShieldedValueNoteCommitment,
  deriveShieldedHeirKeyMaterial,
  generateShieldedRandomField,
} from "../index.js";

const P = 30n * SECONDS_PER_DAY;
const VECTOR_CIPHERTEXT = Uint8Array.from(
  { length: SHIELDED_CIPHERTEXT_BYTES },
  (_, index) => index & 255,
);
const policyInput = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  amountPerPeriod: 100n,
  periodDays: 30n,
  policySalt: 17n,
  allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n),
};

test("shielded v1 commitments and nullifiers match pinned protocol vectors", () => {
  const ciphertextHashField = computeShieldedCiphertextHashField(VECTOR_CIPHERTEXT);
  const heir = deriveShieldedHeirKeyMaterial(13n);
  const policyCommitment = computeShieldedPolicyCommitment(policyInput);
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment,
    heirIdentityCommitment: 19n,
    eligibleFrom: P + 1n,
    enrollmentSalt: 23n,
  });
  const valueNoteCommitment = computeShieldedValueNoteCommitment({
    ownerCommitment: heir.ownerCommitment,
    amount: 500n,
    nonce: 29n,
    ciphertextHashField,
  });
  const budgetNoteCommitment = computeShieldedBudgetNoteCommitment({
    policyCommitment,
    enrollmentCommitment,
    heirOwnerCommitment: heir.ownerCommitment,
    amountPerPeriod: 100n,
    remaining: 1200n,
    nonce: 31n,
    ciphertextHashField,
  });

  assert.equal(
    ciphertextHashField,
    1537342667018031068362779594768727523203332949267693610561733636580859526108n,
  );
  assert.equal(
    heir.ownerSecret,
    21419015082973176344230914283021037419529481047520974754558949869324994768745n,
  );
  assert.equal(
    heir.ownerCommitment,
    10045948813454472068390136104604294393070745540597364893873210373055648740254n,
  );
  assert.equal(heir.hpkeIkm, "0x29740155a57b5dc45ac948f6bc836d3f11df1c862f8a015c347a649935cdd143");
  assert.equal(computeShieldedOwnerCommitment(heir.ownerSecret), heir.ownerCommitment);
  assert.equal(
    policyInput.allocationKeyCommitment,
    17051948607816588678695458510812716073234775117834920922105799600721151339295n,
  );
  assert.equal(
    policyCommitment,
    19310841630603058484626458080449091643568779900304409563120868079775335987259n,
  );
  assert.equal(
    enrollmentCommitment,
    13747024855232904791225134773475486823701232574736745555382372597611173108911n,
  );
  assert.equal(
    valueNoteCommitment,
    8259827521509372735162531367617764762139076004185761408324764441316243602719n,
  );
  assert.equal(
    budgetNoteCommitment,
    11489898753023386408650495576199234495025162531856392102048405137345752250676n,
  );
  assert.equal(
    computeShieldedSpendNullifier({
      ownerSecret: heir.ownerSecret,
      noteCommitment: budgetNoteCommitment,
    }),
    18054125844079294789351217663986402439494306560621950192468921510084785192514n,
  );
  assert.equal(
    computeShieldedPeriodNullifier({ derivedSecretField: 13n, policyCommitment, periodIndex: 4n }),
    10121477007367674691819576106516151898893253406057278698084852191158785426676n,
  );
  assert.equal(
    computeShieldedDummyPeriodNullifier({
      ownerSecret: heir.ownerSecret,
      budgetNoteCommitment,
      slotIndex: 3n,
    }),
    20822359478869110524760714230431351480200856502910265011836758239763442378015n,
  );
  assert.equal(
    computeShieldedDummyInputNullifier({
      ownerSecret: heir.ownerSecret,
      noteCommitment: budgetNoteCommitment,
    }),
    16808997284876111345611160341347153695904743151047682072112147658006572974467n,
  );
  assert.equal(
    computeShieldedEnrollmentNullifier({
      allocationKey: 41n,
      policyCommitment,
      heirIdentityCommitment: 19n,
    }),
    18663827911999272209578867059178806550412831640623847370024908588102964586674n,
  );
});

test("ciphertext bytes, note nonce, and owner secret bind outputs independently", () => {
  const heir = deriveShieldedHeirKeyMaterial(13n);
  const base = {
    ownerCommitment: heir.ownerCommitment,
    amount: 500n,
    nonce: 29n,
    ciphertextHashField: computeShieldedCiphertextHashField(VECTOR_CIPHERTEXT),
  };
  const note = computeShieldedValueNoteCommitment(base);
  assert.notEqual(
    note,
    computeShieldedValueNoteCommitment({
      ...base,
      ciphertextHashField: computeShieldedCiphertextHashField(
        Uint8Array.from(VECTOR_CIPHERTEXT, (byte, index) => (index === 0 ? byte ^ 1 : byte)),
      ),
    }),
  );
  assert.notEqual(note, computeShieldedValueNoteCommitment({ ...base, nonce: 30n }));
  assert.ok(computeShieldedValueNoteCommitment({ ...base, amount: 0n }) > 0n);
  assert.notEqual(
    computeShieldedSpendNullifier({ ownerSecret: heir.ownerSecret, noteCommitment: note }),
    computeShieldedSpendNullifier({ ownerSecret: 14n, noteCommitment: note }),
  );
  assert.notEqual(
    computeShieldedPeriodNullifier({
      derivedSecretField: 13n,
      policyCommitment: computeShieldedPolicyCommitment(policyInput),
      periodIndex: 4n,
    }),
    computeShieldedPeriodNullifier({
      derivedSecretField: 13n,
      policyCommitment: computeShieldedPolicyCommitment(policyInput),
      periodIndex: 5n,
    }),
  );
});

test("funding uniqueness and read-only use tags keep separate purposes", () => {
  const policyCommitment = computeShieldedPolicyCommitment(policyInput);
  const enrollmentTag = computeShieldedEnrollmentNullifier({
    allocationKey: 41n,
    policyCommitment,
    heirIdentityCommitment: 19n,
  });
  assert.notEqual(
    enrollmentTag,
    computeShieldedEnrollmentNullifier({
      allocationKey: 41n,
      policyCommitment,
      heirIdentityCommitment: 20n,
    }),
  );
  assert.notEqual(
    enrollmentTag,
    computeShieldedEnrollmentNullifier({
      allocationKey: 42n,
      policyCommitment,
      heirIdentityCommitment: 19n,
    }),
  );
  assert.notEqual(
    enrollmentTag,
    computeShieldedEnrollmentNullifier({
      allocationKey: 41n,
      policyCommitment: 1n,
      heirIdentityCommitment: 19n,
    }),
  );
  assert.notEqual(
    policyCommitment,
    computeShieldedPolicyCommitment({
      ...policyInput,
      allocationKeyCommitment: computeShieldedAllocationKeyCommitment(42n),
    }),
  );
  assert.notEqual(
    enrollmentTag,
    computeShieldedBudgetUseNullifier({
      policySalt: policyInput.policySalt,
      budgetNoteCommitment: 47n,
      useNonce: 43n,
    }),
  );
});

test("only full 30-day periods from private eligibility count and batches are all-or-nothing", () => {
  assert.equal(SHIELDED_MAX_BATCH_PERIODS, 12);
  const base = { amountPerPeriod: 100n, periodDays: 30n, remaining: 1200n, eligibleFrom: P + 1n };
  assert.deepEqual(computeShieldedClaimBatch({ ...base, now: 2n * P + 1n, periodIndices: [0n] }), {
    periodIndices: [0n],
    amount: 100n,
    remaining: 1100n,
  });
  assert.throws(
    () => computeShieldedClaimBatch({ ...base, now: 2n * P, periodIndices: [0n] }),
    (error) => error.code === "SHIELDED_PERIOD_NOT_DUE",
  );
  assert.throws(
    () => computeShieldedClaimBatch({ ...base, now: 2n * P + 1n, periodIndices: [1n] }),
    (error) => error.code === "SHIELDED_PERIOD_NOT_DUE",
  );
  const twelve = Array.from({ length: 12 }, (_, index) => BigInt(index));
  assert.deepEqual(
    computeShieldedClaimBatch({ ...base, now: 13n * P + 1n, periodIndices: twelve }),
    {
      periodIndices: twelve,
      amount: 1200n,
      remaining: 0n,
    },
  );
  assert.throws(
    () =>
      computeShieldedClaimBatch({ ...base, now: 14n * P + 1n, periodIndices: [...twelve, 12n] }),
    (error) => error.code === "INVALID_SHIELDED_BATCH_SIZE",
  );
  assert.throws(
    () => computeShieldedClaimBatch({ ...base, now: 13n * P + 1n, periodIndices: [0n, 0n] }),
    (error) => error.code === "SHIELDED_PERIOD_ORDER",
  );
  assert.throws(
    () =>
      computeShieldedClaimBatch({
        ...base,
        remaining: 100n,
        now: 13n * P + 1n,
        periodIndices: [0n, 1n],
      }),
    (error) => error.code === "INSUFFICIENT_SHIELDED_BUDGET",
  );
});

test("each explicit day interval binds the policy and the per-heir period nullifier", () => {
  const policies = new Set();
  const nullifiers = new Set();
  for (const periodDays of [1n, 2n, 3n, 7n, 14n, 21n, 30n, 365n, MAX_UINT32]) {
    const policyCommitment = computeShieldedPolicyCommitment({ ...policyInput, periodDays });
    policies.add(policyCommitment);
    nullifiers.add(
      computeShieldedPeriodNullifier({
        derivedSecretField: 13n,
        policyCommitment,
        periodIndex: 0n,
      }),
    );
    const duration = periodDays * SECONDS_PER_DAY;
    const batch = {
      amountPerPeriod: 100n,
      remaining: 300n,
      periodDays,
      eligibleFrom: 7200n,
      periodIndices: [0n],
    };
    assert.throws(
      () => computeShieldedClaimBatch({ ...batch, now: batch.eligibleFrom + duration - 1n }),
      (error) => error.code === "SHIELDED_PERIOD_NOT_DUE",
    );
    assert.deepEqual(computeShieldedClaimBatch({ ...batch, now: batch.eligibleFrom + duration }), {
      periodIndices: [0n],
      amount: 100n,
      remaining: 200n,
    });
  }
  assert.equal(policies.size, 9);
  assert.equal(nullifiers.size, 9);
});

test("periods require explicit positive uint32 days and maturity never wraps uint64 time", () => {
  const batch = {
    amountPerPeriod: 100n,
    remaining: 100n,
    eligibleFrom: 0n,
    now: MAX_UINT64,
    periodIndices: [0n],
  };
  for (const periodDays of [undefined, 0n, -1n, 1.5, MAX_UINT32 + 1n]) {
    assert.throws(() => computeShieldedPolicyCommitment({ ...policyInput, periodDays }));
    assert.throws(() => computeShieldedClaimBatch({ ...batch, periodDays }));
  }
  const duration = MAX_UINT32 * SECONDS_PER_DAY;
  assert.equal(
    computeShieldedClaimBatch({
      ...batch,
      periodDays: MAX_UINT32,
      eligibleFrom: MAX_UINT64 - duration,
    }).amount,
    100n,
  );
  assert.throws(
    () =>
      computeShieldedClaimBatch({
        ...batch,
        periodDays: MAX_UINT32,
        eligibleFrom: MAX_UINT64 - duration + 1n,
      }),
    (error) => error.code === "SHIELDED_PERIOD_NOT_DUE",
  );
  assert.throws(
    () =>
      computeShieldedClaimBatch({ ...batch, periodDays: MAX_UINT32, periodIndices: [MAX_UINT64] }),
    (error) => error.code === "SHIELDED_PERIOD_NOT_DUE",
  );
});

test("field, uint128, randomness, and whole-period budget bounds are enforced", () => {
  assert.ok(computeShieldedPolicyCommitment({ ...policyInput, rootVersionIndex: MAX_UINT64 }) > 0n);
  assert.throws(
    () => computeShieldedPolicyCommitment({ ...policyInput, rootVersionIndex: MAX_UINT64 + 1n }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () => computeShieldedPolicyCommitment({ ...policyInput, policySalt: 0n }),
    (error) => error.code === "ZERO_SHIELDED_SECRET",
  );
  assert.throws(
    () =>
      computeShieldedValueNoteCommitment({
        ownerCommitment: 1n,
        amount: 1n,
        nonce: 0n,
        ciphertextHashField: 1n,
      }),
    (error) => error.code === "ZERO_SHIELDED_SECRET",
  );
  assert.throws(
    () =>
      computeShieldedValueNoteCommitment({
        ownerCommitment: 1n,
        amount: MAX_UINT128 + 1n,
        nonce: 1n,
        ciphertextHashField: 1n,
      }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () =>
      computeShieldedBudgetNoteCommitment({
        policyCommitment: 1n,
        enrollmentCommitment: 2n,
        heirOwnerCommitment: 3n,
        amountPerPeriod: 100n,
        remaining: 150n,
        nonce: 4n,
        ciphertextHashField: 5n,
      }),
    (error) => error.code === "FRACTIONAL_SHIELDED_BUDGET",
  );
  assert.ok(
    computeShieldedBudgetNoteCommitment({
      policyCommitment: 1n,
      enrollmentCommitment: 2n,
      heirOwnerCommitment: 3n,
      amountPerPeriod: 100n,
      remaining: 0n,
      nonce: 4n,
      ciphertextHashField: 5n,
    }) > 0n,
  );
  assert.throws(
    () =>
      computeShieldedClaimBatch({
        amountPerPeriod: MAX_UINT128,
        periodDays: 30n,
        remaining: MAX_UINT128,
        eligibleFrom: 0n,
        now: 2n * P,
        periodIndices: [0n, 1n],
      }),
    (error) => error.code === "SHIELDED_AMOUNT_OVERFLOW",
  );
  assert.throws(
    () =>
      computeShieldedBudgetNoteCommitment({
        policyCommitment: 1n,
        enrollmentCommitment: 2n,
        heirOwnerCommitment: 3n,
        amountPerPeriod: 1n,
        remaining: 1n << 64n,
        nonce: 4n,
        ciphertextHashField: 5n,
      }),
    (error) => error.code === "SHIELDED_PERIOD_COUNT_OVERFLOW",
  );
  assert.throws(
    () => computeShieldedCiphertextHashField("0x"),
    (error) => error.code === "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
  );
  const sample = generateShieldedRandomField();
  assert.ok(sample > 0n);
});
