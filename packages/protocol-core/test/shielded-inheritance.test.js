import test from "node:test";
import assert from "node:assert/strict";
import {
  INHERITANCE_PERIOD_SECONDS,
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
  computeShieldedPolicyNoteCommitment,
  computeShieldedRegistrationLeaf,
  computeShieldedRegistrationTag,
  computeShieldedSpendNullifier,
  computeShieldedTopUpUseNullifier,
  computeShieldedValueNoteCommitment,
  deriveShieldedHeirKeyMaterial,
  generateShieldedRandomField,
} from "../index.js";

const P = INHERITANCE_PERIOD_SECONDS;
const VECTOR_CIPHERTEXT = Uint8Array.from(
  { length: SHIELDED_CIPHERTEXT_BYTES },
  (_, index) => index & 255,
);
const policyInput = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  amountPerPeriod: 100n,
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
    3897603553801422502043273171212827981912817414838535884542698774635475729990n,
  );
  assert.equal(
    enrollmentCommitment,
    1380203662798740573717870298545608105264465180351902836614265303100706701352n,
  );
  assert.equal(
    valueNoteCommitment,
    8259827521509372735162531367617764762139076004185761408324764441316243602719n,
  );
  assert.equal(
    budgetNoteCommitment,
    19008509772000430992374370852921226317546218683189672857676162528366963759743n,
  );
  assert.equal(
    computeShieldedSpendNullifier({
      ownerSecret: heir.ownerSecret,
      noteCommitment: budgetNoteCommitment,
    }),
    9810254550271033599037501490165978434486073542269983724071702968983219012048n,
  );
  assert.equal(
    computeShieldedPeriodNullifier({ derivedSecretField: 13n, policyCommitment, periodIndex: 4n }),
    279178691955842504004116408907273125440019011800873272327166639580190000285n,
  );
  assert.equal(
    computeShieldedDummyPeriodNullifier({
      ownerSecret: heir.ownerSecret,
      budgetNoteCommitment,
      slotIndex: 3n,
    }),
    15486008269977869799066835044280556734625411998813900587497219572121352148138n,
  );
  assert.equal(
    computeShieldedDummyInputNullifier({
      ownerSecret: heir.ownerSecret,
      noteCommitment: budgetNoteCommitment,
    }),
    11547919785056721174303655617424566607719897835308992206915797098888494272232n,
  );
  assert.equal(
    computeShieldedEnrollmentNullifier({
      allocationKey: 41n,
      policyCommitment,
      heirIdentityCommitment: 19n,
    }),
    12001897392482960812365406448463074777459291847217290518247189554253528529057n,
  );
  assert.equal(
    computeShieldedRegistrationLeaf({
      identityCommitment: 19n,
      ownerCommitment: heir.ownerCommitment,
      viewKeyHi: 2n,
      viewKeyLo: 1n,
    }),
    19349709071285623768469286676373440792219380078139969497260329055242930810832n,
  );
  assert.equal(
    computeShieldedRegistrationTag({
      derivedSecretField: 13n,
      identityCommitment: 19n,
      ownerCommitment: heir.ownerCommitment,
      viewKeyLo: 1n,
      viewKeyHi: 2n,
      chainId: 1030n,
      registryAddress: "0x0000000000000000000000000000000000000001",
    }),
    13679518065608758139791935362468749469255697864143206147972258982062477129940n,
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

test("allocation uniqueness and read-only use tags keep separate purposes", () => {
  const policyCommitment = computeShieldedPolicyCommitment(policyInput);
  const allocationTag = computeShieldedEnrollmentNullifier({
    allocationKey: 41n,
    policyCommitment,
    heirIdentityCommitment: 19n,
  });
  assert.notEqual(
    allocationTag,
    computeShieldedEnrollmentNullifier({
      allocationKey: 41n,
      policyCommitment,
      heirIdentityCommitment: 20n,
    }),
  );
  assert.notEqual(
    allocationTag,
    computeShieldedEnrollmentNullifier({
      allocationKey: 42n,
      policyCommitment,
      heirIdentityCommitment: 19n,
    }),
  );
  assert.notEqual(
    allocationTag,
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
  const policyNote = computeShieldedPolicyNoteCommitment({
    policyCommitment,
    nonce: 41n,
    ciphertextHashField: computeShieldedCiphertextHashField(VECTOR_CIPHERTEXT),
  });
  const differentCiphertext = Uint8Array.from(VECTOR_CIPHERTEXT);
  differentCiphertext[0] ^= 1;
  assert.notEqual(
    policyNote,
    computeShieldedPolicyNoteCommitment({
      policyCommitment,
      nonce: 41n,
      ciphertextHashField: computeShieldedCiphertextHashField(differentCiphertext),
    }),
  );
  assert.notEqual(
    allocationTag,
    computeShieldedTopUpUseNullifier({
      policySalt: policyInput.policySalt,
      budgetNoteCommitment: 47n,
      useNonce: 43n,
    }),
  );
});

test("only full 30-day periods from private eligibility count and batches are all-or-nothing", () => {
  assert.equal(SHIELDED_MAX_BATCH_PERIODS, 12);
  const base = { amountPerPeriod: 100n, remaining: 1200n, eligibleFrom: P + 1n };
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

test("field, uint128, randomness, and whole-period budget bounds are enforced", () => {
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

test("registration tag binds exact chain, contract, and public key limbs", () => {
  const heir = deriveShieldedHeirKeyMaterial(13n);
  const base = {
    derivedSecretField: 13n,
    identityCommitment: 19n,
    ownerCommitment: heir.ownerCommitment,
    viewKeyLo: 1n,
    viewKeyHi: 2n,
    chainId: 1030n,
    registryAddress: "0x0000000000000000000000000000000000000001",
  };
  const original = computeShieldedRegistrationTag(base);
  assert.notEqual(original, computeShieldedRegistrationTag({ ...base, viewKeyHi: 3n }));
  assert.notEqual(original, computeShieldedRegistrationTag({ ...base, chainId: 1031n }));
  assert.notEqual(
    original,
    computeShieldedRegistrationTag({
      ...base,
      registryAddress: "0x0000000000000000000000000000000000000002",
    }),
  );
  assert.notEqual(
    computeShieldedRegistrationLeaf({
      identityCommitment: 19n,
      ownerCommitment: heir.ownerCommitment,
      viewKeyHi: 2n,
      viewKeyLo: 1n,
    }),
    computeShieldedRegistrationLeaf({
      identityCommitment: 19n,
      ownerCommitment: heir.ownerCommitment,
      viewKeyHi: 1n,
      viewKeyLo: 2n,
    }),
  );
  assert.throws(
    () => computeShieldedRegistrationTag({ ...base, viewKeyLo: MAX_UINT128 + 1n }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () => computeShieldedRegistrationTag({ ...base, chainId: 1n << 64n }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () =>
      computeShieldedRegistrationTag({
        ...base,
        registryAddress: "0x0000000000000000000000000000000000000000",
      }),
    (error) => error.code === "INVALID_REGISTRY_ADDRESS",
  );
});
