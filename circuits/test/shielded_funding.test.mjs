// Run with: node --test circuits/test/shielded_funding.test.mjs
// Temporary witness/R1CS tests; no production verifier assets are produced.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import { SNARK_SCALAR_FIELD, computeShieldedEnrollmentNullifier } from "@deepfamily/protocol-core";
import { buildShieldedFundingFixtures } from "./generate_shielded_funding_input.mjs";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";
import {
  fixtureFundReceive,
  FUND_PRIVATE_BUDGET_PURPOSE,
  CLAIM_PRIVATE_BUDGET_PURPOSE,
} from "./shielded_budget_fixture.mjs";

import { shieldedFixtureScope, shieldedFixtureTag } from "./shielded_scope_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const legalBudgetBindings = [
  { budgetKind: 0, keyMode: 0 },
  { budgetKind: 0, keyMode: 1 },
  { budgetKind: 1, keyMode: 0 },
];

// Rebind both outputs independently of the circuit after changing owner or
// funding amounts, so unrelated commitment mismatches cannot mask a guard.
function withFundingOutputs(
  fixture,
  witness,
  changeAmount,
  privatePurpose = FUND_PRIVATE_BUDGET_PURPOSE,
) {
  const updated = structuredClone(witness);
  const scoped = (purpose) => shieldedFixtureTag(purpose, updated.chainId, updated.pool);
  const budgetAmount = BigInt(updated.rate) * BigInt(updated.budgetPeriods);
  const change = changeAmount ?? BigInt(updated.donorAmount) - budgetAmount;
  const publicBudget = updated.budgetKind === "1";
  const authorization = publicBudget
    ? poseidon7([
        scoped(1029n),
        BigInt(updated.rootIdentityCommitment),
        BigInt(updated.rootVersionIndex),
        BigInt(updated.heirIdentityCommitment),
        BigInt(updated.eligibleFrom),
        BigInt(updated.rate),
        BigInt(updated.periodDays),
      ])
    : poseidon5([
        scoped(1033n),
        BigInt(updated.heirOwnerCommitment),
        BigInt(updated.keyMode),
        BigInt(updated.heirViewKeyLo),
        BigInt(updated.heirViewKeyHi),
      ]);
  updated.outputCommitments = [
    poseidon8([
      scoped(publicBudget ? 1030n : privatePurpose),
      fixture.policy,
      fixture.enrollment,
      authorization,
      BigInt(updated.rate),
      budgetAmount,
      BigInt(updated.budgetNonce),
      BigInt(updated.ciphertextHashes[0]),
    ]),
    poseidon5([
      scoped(1014n),
      poseidon2([1013n, BigInt(updated.donorOwnerSecret)]),
      // Match field subtraction for negative change; the uint128 guard must reject it.
      ((change % SNARK_SCALAR_FIELD) + SNARK_SCALAR_FIELD) % SNARK_SCALAR_FIELD,
      BigInt(updated.changeNonce),
      BigInt(updated.ciphertextHashes[1]),
    ]),
  ].map(String);
  updated.publicBudget[7] = publicBudget ? String(budgetAmount) : "0";
  Object.assign(updated, fixtureFundReceive(updated));
  return updated;
}

function withClaimSource(witness, source) {
  const updated = structuredClone(witness);
  const scoped = (purpose) => shieldedFixtureTag(purpose, updated.chainId, updated.pool);
  const old = BigInt(source.commitment);
  const ownerSecret = BigInt(updated.ownerSecret);
  updated.budgetNonce = source.nonce;
  updated.budgetCiphertextHash = source.ciphertextHash;
  const siblings = [source.sibling, ...(source.prefixRoot ? [source.prefixRoot] : [])];
  updated.noteDepth = String(siblings.length);
  updated.noteIndex = source.prefixRoot ? "2" : "0";
  updated.noteSiblings = [...siblings, ...Array(32 - siblings.length).fill("0")];
  const pairRoot = poseidon2([old, BigInt(source.sibling)]);
  const root = source.prefixRoot ? poseidon2([BigInt(source.prefixRoot), pairRoot]) : pairRoot;
  updated.inputRoots = [String(root)];
  updated.inputNullifiers = [poseidon3([scoped(1016n), ownerSecret, old])].map(String);
  for (let slot = Number(updated.claimCount); slot < 3; slot++) {
    updated.periodNullifiers[slot] = String(
      poseidon4([scoped(1019n), ownerSecret, old, BigInt(slot)]),
    );
  }
  return updated;
}

function fullSyntheticPath(leaf, depth, index, siblingSeed) {
  let root = BigInt(leaf);
  const siblings = [];
  for (let level = 0; level < depth; level += 1) {
    const sibling = BigInt(siblingSeed + level);
    siblings.push(sibling.toString());
    root =
      ((index >> BigInt(level)) & 1n) === 1n
        ? poseidon2([sibling, root])
        : poseidon2([root, sibling]);
  }
  return { root, siblings, index: index.toString(), depth: depth.toString() };
}

test("shielded initial Fund and continuation Fund constraints", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-funding-"));
  try {
    const calculators = {};
    for (const action of ["fund", "fund_continuation", "claim"]) {
      const circuit = action === "claim" ? "shielded_claim_64" : `shielded_${action}`;
      execFileSync(
        path.join(repoRoot, "bin/circom"),
        [
          `circuits/${circuit}.circom`,
          "--r1cs",
          "--wasm",
          "--sym",
          "--O2",
          "--sanity_check",
          "2",
          "-l",
          "node_modules",
          "-l",
          "node_modules/circomlib/circuits",
          "-o",
          output,
        ],
        { cwd: repoRoot, stdio: "pipe" },
      );
      calculators[action] = await WitnessCalculatorBuilder(
        fs.readFileSync(path.join(output, `${circuit}_js/${circuit}.wasm`)),
        { singleThread: true },
      );
    }
    const calculatorFor = (action, witness) =>
      calculators[action === "fund" && witness.fundMode === "1" ? "fund_continuation" : action];
    const valid = async (action, witness) => {
      assert.equal((await calculatorFor(action, witness).calculateWitness(witness, 1))[0], 1n);
    };
    const invalid = (action, witness) =>
      assertConstraintViolation(() => calculatorFor(action, witness).calculateWitness(witness, 1));
    const mutate = (witness, change) => {
      const copy = structuredClone(witness);
      change(copy);
      return copy;
    };
    const fixture = buildShieldedFundingFixtures();
    await t.test("separate funding circuits bind their own public mode", async () => {
      const initial = await calculators.fund.calculateWitness(fixture.initial, true);
      const continuation = await calculators.fund_continuation.calculateWitness(
        fixture.continuation,
        true,
      );
      assert.equal(initial[3], 0n);
      assert.equal(continuation[3], 1n);
      await assertConstraintViolation(() =>
        calculators.fund.calculateWitness(fixture.continuation, true),
      );
      await assertConstraintViolation(() =>
        calculators.fund_continuation.calculateWitness(fixture.initial, true),
      );
    });
    await t.test(
      "private Fund initial and top-up require the exact authenticated recipient binding",
      async () => {
        for (const witness of [fixture.initial, fixture.continuation]) {
          for (const field of ["receiveAuthorizationAlias", "receiveSalt"]) {
            await invalid(
              "fund",
              mutate(witness, (w) => {
                w[field] = "0";
              }),
            );
            await invalid(
              "fund",
              mutate(witness, (w) => {
                w[field] = String(BigInt(w[field]) + 1n);
              }),
            );
          }
          for (const slot of [0, 1]) {
            await invalid(
              "fund",
              mutate(witness, (w) => {
                w.receiveBindings[slot] = String(BigInt(w.receiveBindings[slot]) + 1n);
              }),
            );
          }
          await invalid(
            "fund",
            mutate(witness, (w) => {
              w.receiveBindings[0] = "0";
            }),
          );
        }
      },
    );

    await t.test("both funding bindings and modes enforce the public chain and pool", async () => {
      for (const budgetKind of [0, 1]) {
        const base = buildShieldedFundingFixtures({ budgetKind });
        for (const context of [
          { chainId: 71n },
          { poolAddress: "0x2222222222222222222222222222222222222222" },
        ]) {
          const changed = buildShieldedFundingFixtures({ budgetKind, ...context });
          assert.notEqual(changed.policy, base.policy);
          assert.notEqual(changed.enrollment, base.enrollment);
          for (const mode of ["initial", "continuation"]) {
            await valid("fund", changed[mode]);
            assert.notDeepEqual(changed[mode].inputNullifiers, base[mode].inputNullifiers);
            await invalid(
              "fund",
              mutate(base[mode], (w) => {
                w.chainId = changed[mode].chainId;
                w.pool = changed[mode].pool;
              }),
            );
          }
          assert.equal(changed.initial.heirOwnerCommitment, base.initial.heirOwnerCommitment);
          assert.equal(changed.initial.heirIdentityCommitment, base.initial.heirIdentityCommitment);
          assert.equal(changed.initial.endorsementRoot, base.initial.endorsementRoot);
          assert.equal(changed.initial.trustedRoot, base.initial.trustedRoot);
        }
      }
    });

    await t.test("both funding modes bind arbitrary positive uint32 day periods", async () => {
      for (const periodDays of [1n, 7n, 365n, (1n << 32n) - 1n]) {
        for (const budgetKind of [0, 1]) {
          const dayFixture = buildShieldedFundingFixtures({ periodDays, budgetKind });
          await valid("fund", dayFixture.initial);
          await valid("fund", dayFixture.continuation);
          assert.equal(dayFixture.initial.periodDays, String(periodDays));
          assert.equal(
            dayFixture.initial.publicBudget[9],
            budgetKind === 1 ? String(periodDays) : "0",
          );
        }
      }
    });
    await t.test(
      "fund rejects zero, negative and overflowing day periods with matching notes",
      async () => {
        for (const periodDays of [0n, -1n, 1n << 32n]) {
          for (const budgetKind of [0, 1]) {
            const dayFixture = buildShieldedFundingFixtures({ periodDays, budgetKind });
            await invalid("fund", dayFixture.initial);
            await invalid("fund", dayFixture.continuation);
          }
        }
      },
    );
    await t.test(
      "private funding keeps every recovery field, including its cycle, hidden",
      async () => {
        const witness = buildShieldedFundingFixtures({ periodDays: 7n }).initial;
        assert.deepEqual(witness.publicBudget, Array(10).fill("0"));
        for (let field = 0; field < witness.publicBudget.length; field += 1) {
          await invalid(
            "fund",
            mutate(witness, (w) => {
              w.publicBudget[field] = "1";
            }),
          );
        }
      },
    );
    await t.test(
      "continuation cannot shorten a historical budget cycle even with matching new outputs",
      async () => {
        for (const oldBudgetKind of [0, 1]) {
          for (const budgetKind of [0, 1]) {
            const original = buildShieldedFundingFixtures({ periodDays: 30n, oldBudgetKind });
            const changed = buildShieldedFundingFixtures({
              periodDays: 7n,
              budgetKind,
              oldBudgetKind,
            });
            const attempted = changed.continuation;
            attempted.inputRoots[1] = original.oldBudget.toString();
            attempted.inputNullifiers[1] = poseidon4([
              shieldedFixtureTag(1026n, attempted.chainId, attempted.pool),
              BigInt(attempted.policySalt),
              original.oldBudget,
              BigInt(attempted.budgetUseNonce),
            ]).toString();
            await invalid("fund", attempted);
          }
        }
      },
    );

    await t.test("continuation preserves binding and rejects cross-binding pairs", async () => {
      for (const budgetKind of [0, 1]) {
        await valid("fund", buildShieldedFundingFixtures({ budgetKind }).initial);
        for (const oldBudgetKind of [0, 1]) {
          await (budgetKind === oldBudgetKind ? valid : invalid)(
            "fund",
            buildShieldedFundingFixtures({ budgetKind, oldBudgetKind }).continuation,
          );
        }
      }
    });
    await t.test(
      "independent funding preserves mode and rejects authorization downgrade",
      async () => {
        const independent = buildShieldedFundingFixtures({ keyMode: 1 });
        await valid("fund", independent.initial);
        await valid("fund", independent.continuation);
        await invalid(
          "fund",
          buildShieldedFundingFixtures({ keyMode: 1, oldKeyMode: 0 }).continuation,
        );
        await invalid("fund", buildShieldedFundingFixtures({ budgetKind: 1, keyMode: 1 }).initial);
        assert.equal(independent.initial.inputNullifiers[1], fixture.initial.inputNullifiers[1]);
      },
    );
    await t.test("public addressing preserves enrollment uniqueness across binding modes", () => {
      const publicFixture = buildShieldedFundingFixtures({ budgetKind: 1 });
      assert.equal(publicFixture.initial.inputNullifiers[1], fixture.initial.inputNullifiers[1]);
    });
    await t.test(
      "refill authenticates both producer origins and preserves the exact view",
      async () => {
        for (const keyMode of [0, 1]) {
          for (const oldBudgetOrigin of ["fund", "claim"]) {
            const base = buildShieldedFundingFixtures({ keyMode, oldBudgetOrigin });
            await valid("fund", base.continuation);
            await invalid(
              "fund",
              mutate(base.continuation, (w) => {
                w.oldBudgetIsClaim = w.oldBudgetIsClaim === "1" ? "0" : "1";
              }),
            );
            await invalid(
              "fund",
              mutate(base.continuation, (w) => {
                w.oldBudgetIsClaim = "2";
              }),
            );
            for (const limb of ["heirViewKeyLo", "heirViewKeyHi"]) {
              const changed = {
                ...base.continuation,
                [limb]: String(BigInt(base.continuation[limb]) ^ 1n),
              };
              // A consistent output with a changed key still cannot open the historical template.
              await invalid("fund", withFundingOutputs(base, changed));
            }
          }
        }
        await invalid("fund", { ...fixture.initial, oldBudgetIsClaim: "1" });
        const identity = buildShieldedFundingFixtures({ budgetKind: 1 });
        await invalid("fund", { ...identity.continuation, oldBudgetIsClaim: "1" });
        for (const limb of ["heirViewKeyLo", "heirViewKeyHi"]) {
          await invalid("fund", { ...identity.initial, [limb]: "1" });
        }
        await invalid(
          "fund",
          withFundingOutputs(fixture, fixture.initial, undefined, CLAIM_PRIVATE_BUDGET_PURPOSE),
        );
      },
    );
    await t.test(
      "executed Fund and Claim outputs feed continuation and refill with their original keys",
      async () => {
        for (const keyMode of [0, 1]) {
          const funded = buildShieldedFundingFixtures({ keyMode });
          await valid("fund", funded.initial);
          const first = buildShieldedClaimFixture({ keyMode, claimCount: 1, remainingPeriods: 4 });
          assert.equal(first.policy, funded.policy);
          assert.equal(first.enrollment, funded.enrollment);
          const claim = withClaimSource(first.witness, {
            commitment: funded.initial.outputCommitments[0],
            sibling: funded.initial.outputCommitments[1],
            nonce: funded.initial.budgetNonce,
            ciphertextHash: funded.initial.ciphertextHashes[0],
          });
          await valid("claim", claim);

          const second = buildShieldedClaimFixture({
            keyMode,
            budgetOrigin: "claim",
            claimCount: 1,
            remainingPeriods: 3,
          });
          const continuation = withClaimSource(second.witness, {
            commitment: claim.outputCommitments[0],
            sibling: claim.outputCommitments[1],
            nonce: claim.newBudgetNonce,
            ciphertextHash: claim.ciphertextHashes[0],
            prefixRoot: claim.inputRoots[0],
          });
          const scoped = (purpose) =>
            shieldedFixtureTag(purpose, continuation.chainId, continuation.pool);
          continuation.periodIndices[0] = "1";
          continuation.asOf = String(
            BigInt(continuation.eligibleFrom) + 2n * BigInt(continuation.periodDays) * 86400n,
          );
          continuation.periodNullifiers[0] = String(
            poseidon4([scoped(1017n), BigInt(continuation.derivedSecretField), second.policy, 1n]),
          );
          // Give each produced note a fresh nonce throughout this sequential chain.
          continuation.newBudgetNonce = "100000";
          continuation.payoutNonce = "123457";
          continuation.outputCommitments = [
            poseidon8([
              scoped(CLAIM_PRIVATE_BUDGET_PURPOSE),
              second.policy,
              second.enrollment,
              poseidon5([
                scoped(1033n),
                second.ownerCommitment,
                BigInt(keyMode),
                BigInt(continuation.heirViewKeyLo),
                BigInt(continuation.heirViewKeyHi),
              ]),
              100n,
              200n,
              100000n,
              BigInt(continuation.ciphertextHashes[0]),
            ]),
            poseidon5([
              scoped(1014n),
              second.ownerCommitment,
              100n,
              123457n,
              BigInt(continuation.ciphertextHashes[1]),
            ]),
          ].map(String);
          await valid("claim", continuation);

          const refilled = buildShieldedFundingFixtures({
            keyMode,
            donorAmount: 600n,
            oldBudgetOrigin: "claim",
            oldBudgetRemainingPeriods: 2n,
          });
          const refill = withFundingOutputs(refilled, {
            ...refilled.continuation,
            donorNonce: funded.initial.changeNonce,
            donorCiphertextHash: funded.initial.ciphertextHashes[1],
            donorDepth: "1",
            donorIndex: "1",
            donorSiblings: [funded.initial.outputCommitments[0], ...Array(31).fill("0")],
            oldBudgetNonce: continuation.newBudgetNonce,
            oldBudgetCiphertextHash: continuation.ciphertextHashes[0],
            oldBudgetDepth: "2",
            oldBudgetIndex: "2",
            oldBudgetSiblings: [
              continuation.outputCommitments[1],
              continuation.inputRoots[0],
              ...Array(30).fill("0"),
            ],
            budgetNonce: "207",
            changeNonce: "209",
          });
          refill.inputRoots = [
            poseidon2(funded.initial.outputCommitments.map(BigInt)),
            poseidon2([
              BigInt(continuation.inputRoots[0]),
              poseidon2(continuation.outputCommitments.map(BigInt)),
            ]),
          ].map(String);
          refill.inputNullifiers = [
            poseidon3([
              scoped(1016n),
              BigInt(refill.donorOwnerSecret),
              BigInt(funded.initial.outputCommitments[1]),
            ]),
            poseidon4([
              scoped(1026n),
              BigInt(refill.policySalt),
              BigInt(continuation.outputCommitments[0]),
              BigInt(refill.budgetUseNonce),
            ]),
          ].map(String);
          await valid("fund", refill);
          for (const step of [claim, continuation, refill]) {
            assert.equal(step.heirViewKeyLo, funded.initial.heirViewKeyLo);
            assert.equal(step.heirViewKeyHi, funded.initial.heirViewKeyHi);
          }
          await invalid("fund", { ...refill, oldBudgetIsClaim: "0" });
          await invalid("claim", { ...continuation, inputBudgetIsClaim: ["0"] });
        }
      },
    );
    await t.test("public funding binds every disclosed field and hides rule openings", async () => {
      const witness = buildShieldedFundingFixtures({ budgetKind: 1 }).initial;
      assert.equal(witness.heirOwnerCommitment, "0");
      assert.equal(witness.publicBudget.length, 10);
      for (let field = 0; field < 10; field++) {
        await invalid(
          "fund",
          mutate(witness, (w) => {
            w.publicBudget[field] = String(BigInt(w.publicBudget[field]) + 1n);
          }),
        );
      }
      await invalid(
        "fund",
        mutate(witness, (w) => {
          w.heirOwnerCommitment = "123";
        }),
      );
      await invalid(
        "fund",
        mutate(witness, (w) => {
          w.budgetKind = "2";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.publicBudget[2] = w.heirIdentityCommitment;
        }),
      );
    });
    await t.test(
      "continuation cannot reinterpret a private template or change its private owner",
      async () => {
        await invalid(
          "fund",
          mutate(fixture.continuation, (w) => {
            w.oldBudgetKind = "1";
            w.oldHeirOwnerCommitment = "0";
          }),
        );
        for (const keyMode of [0, 1]) {
          const privateFixture = buildShieldedFundingFixtures({ chainId: 71n, keyMode });
          const unchanged = withFundingOutputs(privateFixture, privateFixture.continuation);
          assert.deepEqual(
            unchanged.outputCommitments,
            privateFixture.continuation.outputCommitments,
          );
          await valid("fund", unchanged);
          await invalid(
            "fund",
            withFundingOutputs(privateFixture, {
              ...privateFixture.continuation,
              heirOwnerCommitment: "123",
            }),
          );
        }
        const identity = buildShieldedFundingFixtures({ budgetKind: 1 });
        await invalid(
          "fund",
          mutate(identity.continuation, (w) => {
            w.oldBudgetKind = "0";
          }),
        );
      },
    );

    await t.test("first eligibility is exactly two hours after the proof timestamp", () => {
      assert.equal(BigInt(fixture.initial.eligibleFrom), BigInt(fixture.initial.asOf) + 7200n);
    });

    await t.test("one policy and heir keep the same allocation tag across changed funding", () => {
      const changedFunding = buildShieldedFundingFixtures({ donorAmount: 400n });
      assert.equal(fixture.initial.inputNullifiers[1], changedFunding.initial.inputNullifiers[1]);
      assert.notEqual(
        fixture.initial.outputCommitments[1],
        changedFunding.initial.outputCommitments[1],
      );
      assert.equal(
        fixture.initial.inputNullifiers[1],
        computeShieldedEnrollmentNullifier(
          {
            allocationKey: fixture.initial.allocationKey,
            policyCommitment: fixture.policy,
            heirIdentityCommitment: fixture.initial.heirIdentityCommitment,
          },
          shieldedFixtureScope(fixture.initial),
        ).toString(),
      );
    });

    await t.test("valid initial Fund and continuation Fund satisfy compiled R1CS", async () => {
      const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      for (const [action, witness] of [
        ["fund", fixture.initial],
        ["fund_continuation", fixture.continuation],
      ]) {
        await valid(action, witness);
        const circuit = `shielded_${action}`;
        const inputFile = path.join(output, `${circuit}.input.json`);
        const witnessFile = path.join(output, `${circuit}.wtns`);
        fs.writeFileSync(inputFile, JSON.stringify(witness));
        execFileSync(
          process.execPath,
          [
            cli,
            "wtns",
            "calculate",
            path.join(output, `${circuit}_js/${circuit}.wasm`),
            inputFile,
            witnessFile,
          ],
          { cwd: repoRoot, stdio: "pipe" },
        );
        const result = execFileSync(
          process.execPath,
          [cli, "wtns", "check", path.join(output, `${circuit}.r1cs`), witnessFile],
          { cwd: repoRoot, encoding: "utf8" },
        );
        assert.match(result, /WITNESS IS CORRECT/u);
      }
    });
    await t.test("initial Fund can spend exact donor amount with zero-value change", async () => {
      await valid("fund", buildShieldedFundingFixtures({ donorAmount: 400n }).initial);
    });
    await t.test("continuation Fund can reference an exhausted old budget", async () => {
      await valid(
        "fund",
        buildShieldedFundingFixtures({ oldBudgetRemainingPeriods: 0n }).continuation,
      );
    });
    await t.test("initial Fund accepts full 32-level donor membership", async () => {
      const { initial, donorNote } = buildShieldedFundingFixtures();
      const proof = fullSyntheticPath(donorNote, 32, 1n << 31n, 1100);
      initial.donorDepth = proof.depth;
      initial.donorIndex = proof.index;
      initial.donorSiblings = proof.siblings;
      initial.inputRoots = [proof.root, proof.root].map(String);
      await valid("fund", initial);
    });
    await t.test(
      "continuation Fund verifies a full-depth historical template with inactive lineage",
      async () => {
        const { continuation, oldBudget } = buildShieldedFundingFixtures();
        const proof = fullSyntheticPath(oldBudget, 32, (1n << 31n) | 5n, 1300);
        continuation.oldBudgetDepth = proof.depth;
        continuation.oldBudgetIndex = proof.index;
        continuation.oldBudgetSiblings = proof.siblings;
        continuation.inputRoots[1] = proof.root.toString();
        await valid("fund", continuation);
        await invalid(
          "fund",
          mutate(continuation, (w) => {
            w.oldBudgetSiblings[31] = String(BigInt(w.oldBudgetSiblings[31]) + 1n);
          }),
        );
      },
    );
    await t.test("initial Fund accepts full 64-level endorsement and trusted paths", async () => {
      const { initial } = buildShieldedFundingFixtures();
      const parents = poseidon3([
        1009n,
        BigInt(initial.fatherIdentityCommitment),
        BigInt(initial.motherIdentityCommitment),
      ]);
      const endorsementLeaf = poseidon5([
        1007n,
        BigInt(initial.heirIdentityCommitment),
        parents,
        BigInt(initial.heirVersionIndex),
        (BigInt(initial.writtenAt) << 160n) + BigInt(initial.endorser),
      ]);
      const trustedLeaf = poseidon4([
        1008n,
        BigInt(initial.rootIdentityCommitment),
        BigInt(initial.rootVersionIndex),
        BigInt(initial.endorser),
      ]);
      const endorsement = fullSyntheticPath(endorsementLeaf, 64, (1n << 63n) | 9n, 1400);
      const trusted = fullSyntheticPath(trustedLeaf, 64, (1n << 62n) | 6n, 1500);
      initial.endorsementDepth = endorsement.depth;
      initial.endorsementIndex = endorsement.index;
      initial.endorsementSiblings = endorsement.siblings;
      initial.endorsementRoot = endorsement.root.toString();
      initial.trustedDepth = trusted.depth;
      initial.trustedIndex = trusted.index;
      initial.trustedSiblings = trusted.siblings;
      initial.trustedRoot = trusted.root.toString();
      await valid("fund", initial);
      await invalid(
        "fund",
        mutate(initial, (w) => {
          w.endorsementSiblings[63] = (BigInt(w.endorsementSiblings[63]) + 1n).toString();
        }),
      );
    });
    await t.test("initial Fund rejects backdated first eligibility", async () => {
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.asOf = (BigInt(w.asOf) + 1n).toString();
        }),
      );
    });
    await t.test(
      "initial Fund rejects a non-child parent and a wrong direct-parent side",
      async () => {
        await invalid(
          "fund",
          mutate(fixture.initial, (w) => {
            w.fatherIdentityCommitment = (BigInt(w.fatherIdentityCommitment) + 1n).toString();
          }),
        );
        await invalid(
          "fund",
          mutate(fixture.initial, (w) => {
            w.rootIsMother = w.rootIsMother === "0" ? "1" : "0";
          }),
        );
      },
    );
    await t.test(
      "initial Fund rejects stale endorsement and recommendation witnesses",
      async () => {
        await invalid(
          "fund",
          mutate(fixture.initial, (w) => {
            w.endorsementRoot = "123";
          }),
        );
        await invalid(
          "fund",
          mutate(fixture.initial, (w) => {
            w.trustedRoot = "123";
          }),
        );
        await invalid(
          "fund",
          mutate(fixture.initial, (w) => {
            w.endorser = (BigInt(w.endorser) + 1n).toString();
          }),
        );
      },
    );
    await t.test("initial Fund cannot change its unique tag for a second allocation", async () => {
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.inputNullifiers[1] = (BigInt(w.inputNullifiers[1]) + 1n).toString();
        }),
      );
    });
    await t.test(
      "initial Fund and continuation Fund bind the heir owner into the new budget",
      async () => {
        for (const [action, witness] of [
          ["fund", fixture.initial],
          ["fund_continuation", fixture.continuation],
        ]) {
          await invalid(
            action,
            mutate(witness, (w) => {
              w.heirOwnerCommitment = "123";
            }),
          );
        }
      },
    );
    await t.test("initial Fund rejects a zero heir owner even with a matching budget", async () => {
      const withOwner = (owner) =>
        withFundingOutputs(fixture, {
          ...fixture.initial,
          heirOwnerCommitment: String(owner),
        });
      // The separate receipt proof authenticates this key; the business proof binds its opening.
      await valid("fund", withOwner(123n));
      await invalid("fund", withOwner(0n));
    });
    await t.test("initial Fund requires a repeated root and correct allocation key", async () => {
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.inputRoots[1] = "123";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.allocationKey = "123";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.oldBudgetNonce = "1";
        }),
      );
    });
    await t.test(
      "both funding modes reject overdrawn change even with matching outputs",
      async () => {
        for (const binding of legalBudgetBindings) {
          const funding = buildShieldedFundingFixtures({
            ...binding,
            chainId: 71n,
            poolAddress: "0x2222222222222222222222222222222222222222",
          });
          for (const mode of ["initial", "continuation"]) {
            const exact = withFundingOutputs(funding, {
              ...funding[mode],
              budgetPeriods: "10",
            });
            await valid("fund", exact);
            const overdrawn = withFundingOutputs(funding, {
              ...funding[mode],
              budgetPeriods: "11",
            });
            assert.ok(
              BigInt(overdrawn.rate) * BigInt(overdrawn.budgetPeriods) >
                BigInt(overdrawn.donorAmount),
            );
            await invalid("fund", overdrawn);
          }
        }
      },
    );
    await t.test("continuation Fund cannot reset enrollment eligibility", async () => {
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.eligibleFrom = (BigInt(w.eligibleFrom) - BigInt(w.periodDays) * 86400n).toString();
        }),
      );
    });
    await t.test(
      "continuation Fund cannot count old budget value as new funding with matching outputs",
      async () => {
        for (const binding of legalBudgetBindings) {
          const funding = buildShieldedFundingFixtures({
            ...binding,
            chainId: 71n,
            poolAddress: "0x2222222222222222222222222222222222222222",
          });
          const continuation = { ...funding.continuation, budgetPeriods: "7" };
          const fundedAmount = BigInt(continuation.rate) * BigInt(continuation.budgetPeriods);
          const correctChange = BigInt(continuation.donorAmount) - fundedAmount;
          await valid("fund", withFundingOutputs(funding, continuation, correctChange));
          const reusedChange = correctChange + BigInt(continuation.oldBudgetRemaining);
          const attempted = withFundingOutputs(funding, continuation, reusedChange);
          assert.equal(
            fundedAmount + reusedChange,
            BigInt(continuation.donorAmount) + BigInt(continuation.oldBudgetRemaining),
          );
          await invalid("fund", attempted);
        }
      },
    );
    await t.test("continuation Fund rejects forged change ciphertext hash", async () => {
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.ciphertextHashes[1] = "123";
        }),
      );
    });
    await t.test("fund rejects invalid mode and inactive branch witnesses", async () => {
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.fundMode = "2";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.allocationKey = "1";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.asOf = "1";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.endorsementSiblings[0] = "1";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.inputRoots[1] = "123";
        }),
      );
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.heirOwnerCommitment = "123";
        }),
      );
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
