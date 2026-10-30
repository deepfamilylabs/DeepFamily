import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon3 } from "poseidon-lite";
import {
  buildShieldedIdentityAuthorizationState,
  computeShieldedBudgetNoteCommitment,
  prepareReceivePresentationWitness,
  prepareShieldedReceivePresentation,
  SHIELDED_RECEIVE_PROOF_LIFETIME,
} from "@deepfamily/protocol-core";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const pool = "0x2222222222222222222222222222222222222222";
// A consistent asOf/deadline pair; the circuit fixes deadline = asOf + 15 minutes.
const at = (asOf) => ({
  asOf: String(asOf),
  deadline: String(asOf + SHIELDED_RECEIVE_PROOF_LIFETIME),
});
const circuitNames = {
  anonymous: "shielded_anonymous_receive_presentation",
  fund: "shielded_fund_receive_presentation",
  attachment: "shielded_attached_receive_presentation",
};

// The fixture needs only the public credential statement. Authentication of its
// issuer proof is a separate linked-verifier obligation, never a recursive
// constraint in these presentation circuits.
function fixture(
  kind,
  { counter = 3n, keyMode = 0n, entries, noteDepth = 0, noteIndex = 0n } = {},
) {
  const alias = 17n;
  const credential = {
    disclosure: kind === "fund" ? "fund" : "anonymous",
    authorizationAlias: alias,
    authorizationCounter: counter,
    expiresAt: 1900000000n,
    ownerCommitment: 23n,
    viewingKey: new Uint8Array(32).fill(1),
    keyMode,
    ...(kind === "fund" ? { identityCommitment: 41n } : {}),
  };
  const state = buildShieldedIdentityAuthorizationState(
    entries ??
      (counter === 0n
        ? []
        : [
            [alias, counter],
            [alias ^ (1n << 63n), 5n],
          ]),
  );
  const prepared = prepareShieldedReceivePresentation({
    credential,
    chainId: 31337n,
    consumer: "0x1111111111111111111111111111111111111111",
    action: kind === "fund" ? 3n : kind === "attachment" ? 2n : 1n,
    messageId: kind === "fund" ? 0n : 42n,
    payloadHash: `0x${"ab".repeat(32)}`,
    checkpointId: 2n,
    asOf: 1800000000n,
    state,
    salt: 4321n,
  });
  const witness = {
    credentialPublicSignals: prepared.request.credentialPublicSignals,
    ...prepared.presentation,
  };
  const publicSignals = [...witness.credentialPublicSignals.map(BigInt), ...prepared.publicSignals];
  if (kind === "attachment") {
    const note = {
      budgetOrigin: "fund",
      policyCommitment: 31n,
      enrollmentCommitment: 32n,
      heirOwnerCommitment: credential.ownerCommitment,
      viewingKey: credential.viewingKey,
      keyMode,
      amountPerPeriod: 5n,
      remaining: 15n,
      nonce: 33n,
      ciphertextHashField: 34n,
    };
    const leaf = computeShieldedBudgetNoteCommitment(note, { chainId: 31337n, poolAddress: pool });
    const siblings = Array.from({ length: 32 }, (_, i) => (i < noteDepth ? BigInt(i + 1) : 0n));
    let noteRoot = leaf;
    for (let i = 0; i < noteDepth; i++)
      noteRoot =
        (noteIndex >> BigInt(i)) & 1n
          ? poseidon2([siblings[i], noteRoot])
          : poseidon2([noteRoot, siblings[i]]);
    const relation = poseidon3([
      poseidon3([202610210401n, BigInt(pool), leaf]),
      prepared.recipientBinding,
      4321n,
    ]);
    Object.assign(witness, {
      budgetPool: String(BigInt(pool)),
      budgetRoot: String(noteRoot),
      relation: String(relation),
      budgetPolicy: "31",
      budgetEnrollment: "32",
      budgetRate: "5",
      budgetRemaining: "15",
      budgetNonce: "33",
      budgetCiphertextHash: "34",
      budgetDepth: String(noteDepth),
      budgetIndex: String(noteIndex),
      budgetSiblings: siblings.map(String),
    });
    prepared.request.attachment = {
      budgetPool: witness.budgetPool,
      budgetRoot: witness.budgetRoot,
      relation: witness.relation,
      policy: witness.budgetPolicy,
      enrollment: witness.budgetEnrollment,
      rate: witness.budgetRate,
      remaining: witness.budgetRemaining,
      nonce: witness.budgetNonce,
      ciphertextHash: witness.budgetCiphertextHash,
      depth: witness.budgetDepth,
      index: witness.budgetIndex,
      siblings: witness.budgetSiblings,
    };
    publicSignals.push(BigInt(pool), noteRoot, relation);
  }
  const flattened = prepareReceivePresentationWitness(prepared.request);
  assert.deepEqual(
    flattened.witness,
    witness,
    "Raw request flattening must preserve circuit inputs",
  );
  assert.deepEqual(
    [...flattened.commonInputs, ...flattened.publicInputs].map(BigInt),
    publicSignals,
  );
  return { witness: flattened.witness, publicSignals };
}

test("linked receive presentations preserve credential prefixes and complete operation constraints", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-linked-receive-"));
  const calculators = {};
  try {
    for (const [kind, name] of Object.entries(circuitNames)) {
      execFileSync(
        path.join(root, "bin/circom"),
        [
          `circuits/${name}.circom`,
          "--wasm",
          "--O2",
          "--sanity_check",
          "2",
          "-l",
          "node_modules",
          "-l",
          "node_modules/circomlib/circuits",
          "-o",
          out,
        ],
        { cwd: root, stdio: "pipe" },
      );
      const wasm = path.join(out, `${name}_js/${name}.wasm`);
      const calc = await WitnessCalculatorBuilder(fs.readFileSync(wasm), { singleThread: true });
      calculators[kind] = calc;
      await t.test(`${kind}: exact output layout and both key modes`, async () => {
        for (const keyMode of [0n, 1n]) {
          const example = fixture(kind, { keyMode });
          const wires = await calc.calculateWitness(example.witness, 1);
          assert.deepEqual(wires.slice(1, example.publicSignals.length + 1), example.publicSignals);
          assert.equal(
            example.publicSignals.length,
            kind === "attachment" ? 25 : kind === "fund" ? 23 : 22,
          );
        }
      });
    }

    await t.test(
      "all disclosures reject expired, malformed and unbound recipient statements",
      async () => {
        for (const [kind, calc] of Object.entries(calculators)) {
          const { witness } = fixture(kind);
          const invalid = (patch) =>
            assertConstraintViolation(() => calc.calculateWitness({ ...witness, ...patch }, 1));
          const expiry = BigInt(witness.credentialPublicSignals[2]);
          for (const patch of [
            at(expiry),
            at(expiry + 1n),
            { deadline: String(BigInt(witness.deadline) + 1n) },
            { deadline: String(BigInt(witness.deadline) - 1n) },
            { chainId: "0" },
            { consumer: "0" },
            { checkpointId: "0" },
            { salt: "0" },
            { binding: "0" },
            { binding: String(BigInt(witness.binding) + 1n) },
            { chainId: String(1n << 64n) },
            { consumer: String(1n << 160n) },
            { messageId: String(1n << 128n) },
            { cipherLo: String(1n << 128n) },
            { cipherHi: String(1n << 128n) },
            { oldValue: String(1n << 64n) },
            { action: kind === "anonymous" ? "2" : "1" },
          ])
            await invalid(patch);
          const offset = kind === "fund" ? 1 : 0;
          for (const [slot, value] of [
            [0, "0"],
            [1, String(1n << 64n)],
            [2, String(1n << 64n)],
            [3 + offset, "0"],
            [4 + offset, String(1n << 128n)],
            [5 + offset, String(1n << 128n)],
            [6 + offset, "2"],
            [7 + offset, "2"],
            [8 + offset, "2"],
            [9 + offset, "2"],
            [10 + offset, "2"],
          ]) {
            const changed = [...witness.credentialPublicSignals];
            changed[slot] = value;
            await invalid({ credentialPublicSignals: changed });
          }
          // The public deadline must still fit the consumers' uint64 field.
          const lastExpiry = [...witness.credentialPublicSignals];
          lastExpiry[2] = String((1n << 64n) - 1n);
          await invalid({ credentialPublicSignals: lastExpiry, ...at((1n << 64n) - 100n) });
        }
      },
    );

    await t.test("a deadline may pass the code's expiry only when asOf precedes it", async () => {
      for (const [kind, calc] of Object.entries(calculators)) {
        const { witness } = fixture(kind);
        const expiry = BigInt(witness.credentialPublicSignals[2]);
        await calc.calculateWitness({ ...witness, ...at(expiry - 1n) }, 1);
      }
    });

    await t.test(
      "letters permit a message ID while money operations require output slots",
      async () => {
        const calc = calculators.anonymous;
        const { witness } = fixture("anonymous");
        for (const messageId of ["0", "1"])
          await calc.calculateWitness({ ...witness, action: "4", messageId }, 1);
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...witness, action: "4", messageId: "2" }, 1),
        );
        const fund = fixture("fund").witness;
        await calculators.fund.calculateWitness({ ...fund, messageId: "1" }, 1);
        await assertConstraintViolation(() =>
          calculators.fund.calculateWitness({ ...fund, messageId: "2" }, 1),
        );
      },
    );

    await t.test(
      "canonical authorization membership, absence and compressed collision proofs",
      async () => {
        const calc = calculators.anonymous;
        for (const options of [
          { counter: 0n },
          { counter: 0n, entries: [[18n, 2n]] },
          {
            counter: 0n,
            entries: [
              [19n, 2n],
              [21n, 3n],
            ],
          },
          { counter: 3n, entries: [[17n, 3n]] },
          { counter: (1n << 64n) - 1n, entries: [[17n, (1n << 64n) - 1n]] },
          { counter: 3n },
        ]) {
          const { witness } = fixture("anonymous", options);
          await calc.calculateWitness(witness, 1);
          for (const patch of [
            { absent: witness.absent === "1" ? "0" : "1" },
            { absent: "2" },
            { isOld0: "2" },
            { oldKey: String(BigInt(witness.oldKey) + 1n) },
            { oldValue: String(BigInt(witness.oldValue) + 1n) },
            { stateRoot: String(BigInt(witness.stateRoot) + 1n) },
            { depth: "65" },
          ])
            await assertConstraintViolation(() =>
              calc.calculateWitness({ ...witness, ...patch }, 1),
            );
        }
        const zeroDepth = fixture("anonymous", { entries: [[17n, 3n]] }).witness;
        const padded = [...zeroDepth.siblings];
        padded[63] = "1";
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...zeroDepth, siblings: padded }, 1),
        );
        // A redundant unary suffix gives another mathematical root, but cannot
        // give another canonical compressed dictionary witness.
        const redundantRoot = poseidon2([0n, BigInt(zeroDepth.stateRoot)]);
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...zeroDepth, depth: "1", stateRoot: String(redundantRoot) }, 1),
        );
        const full = fixture("anonymous").witness;
        assert.equal(full.depth, "64");
        const deepest = [...full.siblings];
        deepest[63] = "0";
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...full, siblings: deepest }, 1),
        );
      },
    );

    await t.test(
      "attachments authenticate budget note contents and the full 64/32 paths",
      async () => {
        const calc = calculators.attachment;
        for (const keyMode of [0n, 1n]) {
          const { witness, publicSignals } = fixture("attachment", {
            keyMode,
            noteDepth: 32,
            noteIndex: (1n << 31n) + 17n,
          });
          const wires = await calc.calculateWitness(witness, 1);
          assert.deepEqual(wires.slice(1, 26), publicSignals);
          assert.equal(witness.depth, "64");
          for (const name of [
            "budgetPool",
            "budgetRoot",
            "relation",
            "budgetPolicy",
            "budgetEnrollment",
            "budgetRate",
            "budgetRemaining",
            "budgetNonce",
            "budgetCiphertextHash",
            "budgetIndex",
          ])
            await assertConstraintViolation(() =>
              calc.calculateWitness({ ...witness, [name]: String(BigInt(witness[name]) + 1n) }, 1),
            );
          for (const patch of [
            { budgetPool: "0" },
            { budgetPool: String(1n << 160n) },
            { budgetRate: "0" },
            { budgetRate: String(1n << 128n) },
            { budgetRemaining: String(1n << 128n) },
            { budgetDepth: "33" },
            { budgetIndex: String(1n << 32n) },
          ])
            await assertConstraintViolation(() =>
              calc.calculateWitness({ ...witness, ...patch }, 1),
            );
        }
        const compact = fixture("attachment").witness;
        const siblings = [...compact.budgetSiblings];
        siblings[31] = "1";
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...compact, budgetSiblings: siblings }, 1),
        );
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...compact, budgetIndex: "1" }, 1),
        );
      },
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
