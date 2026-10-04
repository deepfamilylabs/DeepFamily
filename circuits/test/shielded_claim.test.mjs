// Run with: node --test circuits/test/shielded_claim.test.mjs
// This compiles the circuit to a temporary directory. It does not generate or
// trust a production Groth16 key.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import {
  computeShieldedBudgetNoteCommitment,
  computeShieldedClaimBatch,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  deriveShieldedHeirKeyMaterial,
} from "@deepfamily/protocol-core";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";

import { shieldedFixtureScope, shieldedFixtureTag } from "./shielded_scope_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

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

test("shielded claim constraints", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-claim-"));
  try {
    execFileSync(
      path.join(repoRoot, "bin/circom"),
      [
        "circuits/shielded_claim.circom",
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
    const wasm = fs.readFileSync(path.join(output, "shielded_claim_js/shielded_claim.wasm"));
    const calculator = await WitnessCalculatorBuilder(wasm, { singleThread: true });
    const valid = async (witness) => {
      const wires = await calculator.calculateWitness(witness, 1);
      assert.equal(wires[0], 1n);
    };
    const invalid = async (witness) => {
      // The WASM runtime prints each expected constraint failure to stderr.
      const originalError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(witness, 1));
      } finally {
        console.error = originalError;
      }
    };
    const mutate = (witness, change) => {
      const copy = structuredClone(witness);
      change(copy);
      return copy;
    };

    await t.test("private, public and mixed claims enforce chain and pool domains", async () => {
      for (const budgetKind of [0, 1]) {
        for (const secondRemainingPeriods of [0, 2]) {
          const options = { budgetKind, secondBudgetKind: 1 - budgetKind, secondRemainingPeriods };
          const base = buildShieldedClaimFixture(options);
          for (const context of [
            { chainId: 71n },
            { poolAddress: "0x2222222222222222222222222222222222222222" },
          ]) {
            const changed = buildShieldedClaimFixture({ ...options, ...context });
            await valid(changed.witness);
            assert.notEqual(changed.policy, base.policy);
            assert.notEqual(changed.enrollment, base.enrollment);
            assert.notEqual(changed.inputBudget, base.inputBudget);
            assert.notDeepEqual(changed.witness.inputNullifiers, base.witness.inputNullifiers);
            assert.notDeepEqual(changed.witness.periodNullifiers, base.witness.periodNullifiers);
            assert.equal(changed.ownerSecret, base.ownerSecret);
            assert.equal(changed.ownerCommitment, base.ownerCommitment);
            assert.equal(changed.heirIdentityCommitment, base.heirIdentityCommitment);
            assert.equal(changed.witness.endorsementRoot, base.witness.endorsementRoot);
            assert.equal(changed.witness.trustedRoot, base.witness.trustedRoot);
            await invalid(
              mutate(base.witness, (w) => {
                w.chainId = changed.witness.chainId;
                w.pool = changed.witness.pool;
              }),
            );
          }
        }
      }
    });

    await t.test(
      "private and public claims mature exactly at each configured day cycle",
      async () => {
        for (const periodDays of [1n, 7n, 365n, (1n << 32n) - 1n]) {
          for (const budgetKind of [0, 1]) {
            const { witness } = buildShieldedClaimFixture({ periodDays, budgetKind });
            assert.equal(
              BigInt(witness.asOf) - BigInt(witness.eligibleFrom),
              2n * periodDays * 86400n,
            );
            await valid(witness);
            await invalid(
              mutate(witness, (w) => {
                w.asOf = (BigInt(w.asOf) - 1n).toString();
              }),
            );
          }
        }
      },
    );
    await t.test(
      "claim rejects zero, negative and overflowing cycles with matching commitments",
      async () => {
        for (const periodDays of [0n, -1n, 1n << 32n]) {
          for (const budgetKind of [0, 1]) {
            await invalid(buildShieldedClaimFixture({ periodDays, budgetKind }).witness);
          }
        }
      },
    );
    await t.test("claim cannot shorten the cycle of either budget binding", async () => {
      for (const budgetKind of [0, 1]) {
        await invalid(
          mutate(buildShieldedClaimFixture({ periodDays: 30n, budgetKind }).witness, (w) => {
            w.periodDays = "1";
          }),
        );
      }
    });
    await t.test(
      "different cycles cannot be combined in either private or public input pair",
      async () => {
        for (const budgetKind of [0, 1]) {
          for (const secondBudgetKind of [0, 1]) {
            await invalid(
              buildShieldedClaimFixture({
                budgetKind,
                secondBudgetKind,
                periodDays: 30n,
                secondPeriodDays: 7n,
                secondRemainingPeriods: 2,
              }).witness,
            );
          }
        }
      },
    );
    await t.test(
      "the maximum uint64 index and uint32 cycle cannot wrap maturity into the past",
      async () => {
        const periodDays = (1n << 32n) - 1n;
        const periodIndex = (1n << 64n) - 1n;
        for (const budgetKind of [0, 1]) {
          const { witness, policy } = buildShieldedClaimFixture({
            claimCount: 1,
            periodDays,
            budgetKind,
          });
          const maturity = BigInt(witness.eligibleFrom) + (periodIndex + 1n) * periodDays * 86400n;
          assert.ok(maturity > (1n << 64n) - 1n);
          assert.ok(maturity < 1n << 113n);
          witness.periodIndices[0] = periodIndex.toString();
          witness.periodNullifiers[0] = poseidon4([
            shieldedFixtureTag(1017n, 1030n, 0x1111111111111111111111111111111111111111n),
            BigInt(witness.derivedSecretField),
            policy,
            periodIndex,
          ]).toString();
          witness.asOf = ((1n << 64n) - 1n).toString();
          await invalid(witness);
        }
      },
    );

    await t.test("identity-only and mixed-budget claims preserve hidden input types", async () => {
      for (const budgetKind of [0, 1]) {
        await valid(buildShieldedClaimFixture({ budgetKind }).witness);
        for (const secondBudgetKind of [0, 1]) {
          await valid(
            buildShieldedClaimFixture({ budgetKind, secondBudgetKind, secondRemainingPeriods: 2 })
              .witness,
          );
        }
      }
    });
    await t.test("public and private budgets share real period nullifiers", () => {
      const privateWitness = buildShieldedClaimFixture().witness;
      const publicWitness = buildShieldedClaimFixture({ budgetKind: 1 }).witness;
      assert.deepEqual(
        privateWitness.periodNullifiers.slice(0, 2),
        publicWitness.periodNullifiers.slice(0, 2),
      );
      assert.equal(publicWitness.policySalt, "0");
      assert.equal(publicWitness.enrollmentSalt, "0");
      assert.equal(publicWitness.allocationKeyCommitment, "0");
    });
    await t.test(
      "public claim requires identity and binds terms, opaque commitments and note kind",
      async () => {
        const witness = buildShieldedClaimFixture({ budgetKind: 1 }).witness;
        for (const field of [
          "derivedSecretField",
          "rootVersionIndex",
          "eligibleFrom",
          "rate",
          "periodDays",
          "policyCommitmentInput",
          "enrollmentCommitmentInput",
        ]) {
          await invalid(
            mutate(witness, (w) => {
              w[field] = String(BigInt(w[field]) + 1n);
            }),
          );
        }
        await invalid(
          mutate(witness, (w) => {
            w.budgetKind = "2";
          }),
        );
        await invalid(
          mutate(witness, (w) => {
            w.budgetKind = "0";
          }),
        );
        await invalid(
          mutate(witness, (w) => {
            w.secondBudgetKind = "1";
          }),
        );
        for (const field of ["policySalt", "allocationKeyCommitment", "enrollmentSalt"]) {
          await invalid(
            mutate(witness, (w) => {
              w[field] = "1";
            }),
          );
        }
      },
    );
    await t.test(
      "private input cannot bypass its opening or become an identity-bound remainder",
      async () => {
        for (const budgetKind of [0, 1]) {
          const fixture = buildShieldedClaimFixture({
            budgetKind,
            secondBudgetKind: 0,
            secondRemainingPeriods: 2,
          });
          const { witness } = fixture;
          for (const field of ["policySalt", "allocationKeyCommitment", "enrollmentSalt"]) {
            await invalid(
              mutate(witness, (w) => {
                w[field] = "0";
              }),
            );
          }
          await invalid(
            mutate(witness, (w) => {
              const terms = poseidon7([
                shieldedFixtureTag(1029n, 1030n, 0x1111111111111111111111111111111111111111n),
                BigInt(w.fatherIdentityCommitment),
                BigInt(w.rootVersionIndex),
                fixture.heirIdentityCommitment,
                BigInt(w.eligibleFrom),
                BigInt(w.rate),
                BigInt(w.periodDays),
              ]);
              w.outputCommitments[0] = poseidon8([
                shieldedFixtureTag(1030n, 1030n, 0x1111111111111111111111111111111111111111n),
                fixture.policy,
                fixture.enrollment,
                terms,
                BigInt(w.rate),
                BigInt(w.remaining) +
                  BigInt(w.secondRemaining) -
                  BigInt(w.claimCount) * BigInt(w.rate),
                BigInt(w.newBudgetNonce),
                BigInt(w.ciphertextHashes[0]),
              ]).toString();
            }),
          );
        }
      },
    );

    await t.test("witness formulas match protocol-core", () => {
      const fixture = buildShieldedClaimFixture();
      const { witness, policy, enrollment, inputBudget, heirIdentityCommitment } = fixture;
      const keys = deriveShieldedHeirKeyMaterial(witness.derivedSecretField);
      assert.equal(keys.ownerSecret, fixture.ownerSecret);
      assert.equal(keys.ownerCommitment, fixture.ownerCommitment);
      assert.equal(
        computeShieldedPolicyCommitment(
          {
            rootIdentityCommitment: witness.fatherIdentityCommitment,
            rootVersionIndex: witness.rootVersionIndex,
            amountPerPeriod: witness.rate,
            periodDays: witness.periodDays,
            policySalt: witness.policySalt,
            allocationKeyCommitment: witness.allocationKeyCommitment,
          },
          shieldedFixtureScope(witness),
        ),
        policy,
      );
      assert.equal(
        computeShieldedEnrollmentCommitment(
          {
            policyCommitment: policy,
            heirIdentityCommitment,
            eligibleFrom: witness.eligibleFrom,
            enrollmentSalt: witness.enrollmentSalt,
          },
          shieldedFixtureScope(witness),
        ),
        enrollment,
      );
      assert.equal(
        computeShieldedBudgetNoteCommitment(
          {
            policyCommitment: policy,
            enrollmentCommitment: enrollment,
            heirOwnerCommitment: fixture.ownerCommitment,
            amountPerPeriod: witness.rate,
            remaining: witness.remaining,
            nonce: witness.budgetNonce,
            ciphertextHashField: witness.budgetCiphertextHash,
          },
          shieldedFixtureScope(witness),
        ),
        inputBudget,
      );
      assert.equal(
        computeShieldedDummyInputNullifier(
          {
            ownerSecret: keys.ownerSecret,
            noteCommitment: inputBudget,
          },
          shieldedFixtureScope(witness),
        ).toString(),
        witness.inputNullifiers[1],
      );
      assert.equal(
        computeShieldedPeriodNullifier(
          {
            derivedSecretField: witness.derivedSecretField,
            policyCommitment: policy,
            periodIndex: witness.periodIndices[0],
          },
          shieldedFixtureScope(witness),
        ).toString(),
        witness.periodNullifiers[0],
      );
      assert.equal(witness.periodNullifiers.length, 12);
      assert.equal(
        computeShieldedDummyPeriodNullifier(
          {
            ownerSecret: keys.ownerSecret,
            budgetNoteCommitment: inputBudget,
            slotIndex: 2,
          },
          shieldedFixtureScope(witness),
        ).toString(),
        witness.periodNullifiers[2],
      );
      assert.deepEqual(
        computeShieldedClaimBatch({
          amountPerPeriod: witness.rate,
          remaining: witness.remaining,
          eligibleFrom: witness.eligibleFrom,
          periodDays: witness.periodDays,
          now: witness.asOf,
          periodIndices: witness.periodIndices.slice(0, Number(witness.claimCount)),
        }),
        {
          periodIndices: witness.periodIndices.slice(0, Number(witness.claimCount)).map(BigInt),
          amount: 200n,
          remaining: 100n,
        },
      );
    });

    await t.test("one full period and zero-balance continuation", async () => {
      await valid(buildShieldedClaimFixture({ claimCount: 1, remainingPeriods: 1 }).witness);
    });
    await t.test("valid witness satisfies the generated R1CS", async () => {
      const witness = buildShieldedClaimFixture().witness;
      const inputFile = path.join(output, "shielded-claim-input.json");
      const witnessFile = path.join(output, "shielded-claim.wtns");
      const snarkjsCli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      fs.writeFileSync(inputFile, JSON.stringify(witness));
      execFileSync(
        process.execPath,
        [
          snarkjsCli,
          "wtns",
          "calculate",
          path.join(output, "shielded_claim_js/shielded_claim.wasm"),
          inputFile,
          witnessFile,
        ],
        { cwd: repoRoot, stdio: "pipe" },
      );
      const check = execFileSync(
        process.execPath,
        [snarkjsCli, "wtns", "check", path.join(output, "shielded_claim.r1cs"), witnessFile],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.match(check, /WITNESS IS CORRECT/u);
    });
    await t.test("twelve full periods", async () => {
      await valid(buildShieldedClaimFixture({ claimCount: 12, remainingPeriods: 12 }).witness);
    });
    await t.test(
      "two budgets jointly fund a claim exceeding either individual balance",
      async () => {
        await valid(
          buildShieldedClaimFixture({
            claimCount: 4,
            remainingPeriods: 2,
            secondRemainingPeriods: 2,
          }).witness,
        );
      },
    );
    await t.test(
      "second budget must be distinct, spendable, and share the enrollment",
      async () => {
        const fixture = buildShieldedClaimFixture({ secondRemainingPeriods: 2 });
        await invalid(
          mutate(fixture.witness, (w) => {
            w.inputRoots[1] = "123";
          }),
        );
        await invalid(
          mutate(fixture.witness, (w) => {
            w.inputNullifiers[1] = "123";
          }),
        );
        await invalid(
          mutate(fixture.witness, (w) => {
            w.secondBudgetNonce = "0";
          }),
        );
        await invalid(
          mutate(fixture.witness, (w) => {
            w.secondRemaining = w.remaining;
            w.secondRemainingPeriods = w.remainingPeriods;
            w.secondBudgetNonce = w.budgetNonce;
            w.secondBudgetCiphertextHash = w.budgetCiphertextHash;
            w.inputRoots[1] = w.inputRoots[0];
            w.inputNullifiers[1] = w.inputNullifiers[0];
            // Balance the attempted double spend so only note distinctness
            // rejects it, rather than an unrelated output-value mismatch.
            w.outputCommitments[0] = computeShieldedBudgetNoteCommitment(
              {
                policyCommitment: fixture.policy,
                enrollmentCommitment: fixture.enrollment,
                heirOwnerCommitment: fixture.ownerCommitment,
                amountPerPeriod: w.rate,
                remaining: 2n * BigInt(w.remaining) - BigInt(w.claimCount) * BigInt(w.rate),
                nonce: w.newBudgetNonce,
                ciphertextHashField: w.ciphertextHashes[0],
              },
              shieldedFixtureScope(w),
            ).toString();
          }),
        );
        const wrongEnrollmentBudget = computeShieldedBudgetNoteCommitment(
          {
            policyCommitment: fixture.policy,
            enrollmentCommitment: fixture.enrollment + 1n,
            heirOwnerCommitment: fixture.ownerCommitment,
            amountPerPeriod: fixture.witness.rate,
            remaining: fixture.witness.secondRemaining,
            nonce: fixture.witness.secondBudgetNonce,
            ciphertextHashField: fixture.witness.secondBudgetCiphertextHash,
          },
          shieldedFixtureScope(fixture.witness),
        );
        await invalid(
          mutate(fixture.witness, (w) => {
            w.inputRoots[1] = String(wrongEnrollmentBudget);
          }),
        );
      },
    );
    await t.test(
      "absent second input has canonical zero witnesses and repeated public root",
      async () => {
        const witness = buildShieldedClaimFixture().witness;
        await invalid(
          mutate(witness, (w) => {
            w.hasSecondInput = "2";
          }),
        );
        await invalid(
          mutate(witness, (w) => {
            w.secondRemaining = "100";
            w.secondRemainingPeriods = "1";
          }),
        );
        await invalid(
          mutate(witness, (w) => {
            w.secondNoteSiblings[0] = "1";
          }),
        );
        await invalid(
          mutate(witness, (w) => {
            w.inputRoots[1] = "123";
          }),
        );
      },
    );
    await t.test("combined period count cannot overflow uint64", async () => {
      await invalid(
        buildShieldedClaimFixture({
          remainingPeriods: 1n << 63n,
          secondRemainingPeriods: 1n << 63n,
        }).witness,
      );
    });
    await t.test("exact 32-level note path", async () => {
      const { witness, inputBudget } = buildShieldedClaimFixture();
      let root = inputBudget;
      for (let level = 0; level < 32; level += 1) {
        const sibling = BigInt(level + 1);
        witness.noteSiblings[level] = sibling.toString();
        root = level === 31 ? poseidon2([sibling, root]) : poseidon2([root, sibling]);
      }
      witness.noteDepth = "32";
      witness.noteIndex = (1n << 31n).toString();
      witness.inputRoots = [root.toString(), root.toString()];
      await valid(witness);
    });
    await t.test("mixed claim binds the second full-depth budget path", async () => {
      const { witness } = buildShieldedClaimFixture({
        secondRemainingPeriods: 2,
        secondBudgetKind: 1,
      });
      const proof = fullSyntheticPath(BigInt(witness.inputRoots[1]), 32, (1n << 31n) | 5n, 1800);
      witness.secondNoteDepth = proof.depth;
      witness.secondNoteIndex = proof.index;
      witness.secondNoteSiblings = proof.siblings;
      witness.inputRoots[1] = proof.root.toString();
      await valid(witness);
      await invalid(
        mutate(witness, (w) => {
          w.secondNoteSiblings[31] = String(BigInt(w.secondNoteSiblings[31]) + 1n);
        }),
      );
    });
    await t.test("full 64-level endorsement and trusted paths verify the child", async () => {
      const { witness, heirIdentityCommitment } = buildShieldedClaimFixture();
      const parents = poseidon3([
        1009n,
        BigInt(witness.fatherIdentityCommitment),
        BigInt(witness.motherIdentityCommitment),
      ]);
      const rootIdentityCommitment =
        witness.rootIsMother === "1"
          ? BigInt(witness.motherIdentityCommitment)
          : BigInt(witness.fatherIdentityCommitment);
      const endorsementLeaf = poseidon5([
        1007n,
        heirIdentityCommitment,
        parents,
        BigInt(witness.versionIndex),
        (BigInt(witness.writtenAt) << 160n) + BigInt(witness.endorser),
      ]);
      const trustedLeaf = poseidon4([
        1008n,
        rootIdentityCommitment,
        BigInt(witness.rootVersionIndex),
        BigInt(witness.endorser),
      ]);
      const endorsement = fullSyntheticPath(endorsementLeaf, 64, (1n << 63n) | 5n, 1600);
      const trusted = fullSyntheticPath(trustedLeaf, 64, (1n << 62n) | 10n, 1700);
      witness.endorsementDepth = endorsement.depth;
      witness.endorsementIndex = endorsement.index;
      witness.endorsementSiblings = endorsement.siblings;
      witness.endorsementRoot = endorsement.root.toString();
      witness.trustedDepth = trusted.depth;
      witness.trustedIndex = trusted.index;
      witness.trustedSiblings = trusted.siblings;
      witness.trustedRoot = trusted.root.toString();
      await valid(witness);
      await invalid(
        mutate(witness, (w) => {
          w.trustedSiblings[63] = (BigInt(w.trustedSiblings[63]) + 1n).toString();
        }),
      );
    });
    await t.test("later re-endorsement keeps the original eligibleFrom", async () => {
      const { witness, heirIdentityCommitment } = buildShieldedClaimFixture();
      const newWrittenAt = BigInt(witness.eligibleFrom) + 86400n;
      const parents = poseidon3([
        1009n,
        BigInt(witness.fatherIdentityCommitment),
        BigInt(witness.motherIdentityCommitment),
      ]);
      let root = poseidon5([
        1007n,
        heirIdentityCommitment,
        parents,
        BigInt(witness.versionIndex),
        (newWrittenAt << 160n) + BigInt(witness.endorser),
      ]);
      const index = BigInt(witness.endorsementIndex);
      for (let level = 0; level < Number(witness.endorsementDepth); level += 1) {
        const sibling = BigInt(witness.endorsementSiblings[level]);
        root =
          ((index >> BigInt(level)) & 1n) === 1n
            ? poseidon2([sibling, root])
            : poseidon2([root, sibling]);
      }
      witness.writtenAt = newWrittenAt.toString();
      witness.endorsementRoot = root.toString();
      assert.ok(newWrittenAt > BigInt(witness.eligibleFrom));
      await valid(witness);
    });

    const base = buildShieldedClaimFixture().witness;
    await t.test("rejects 13 periods", async () => {
      await invalid(
        mutate(base, (w) => {
          w.claimCount = "13";
        }),
      );
    });
    await t.test("rejects a period before its full end", async () => {
      await invalid(
        mutate(base, (w) => {
          w.asOf = (BigInt(w.asOf) - 1n).toString();
        }),
      );
    });
    await t.test("rejects a later period that has not matured from eligibility", async () => {
      await invalid(
        mutate(base, (w) => {
          w.periodIndices[0] = "2";
          w.periodIndices[1] = "3";
          const policy = computeShieldedPolicyCommitment(
            {
              rootIdentityCommitment: w.fatherIdentityCommitment,
              rootVersionIndex: w.rootVersionIndex,
              amountPerPeriod: w.rate,
              periodDays: w.periodDays,
              policySalt: w.policySalt,
              allocationKeyCommitment: w.allocationKeyCommitment,
            },
            shieldedFixtureScope(w),
          );
          w.periodNullifiers[0] = computeShieldedPeriodNullifier(
            {
              derivedSecretField: w.derivedSecretField,
              policyCommitment: policy,
              periodIndex: 2n,
            },
            shieldedFixtureScope(w),
          ).toString();
          w.periodNullifiers[1] = computeShieldedPeriodNullifier(
            {
              derivedSecretField: w.derivedSecretField,
              policyCommitment: policy,
              periodIndex: 3n,
            },
            shieldedFixtureScope(w),
          ).toString();
        }),
      );
    });
    await t.test("rejects duplicate period indices", async () => {
      await invalid(
        mutate(base, (w) => {
          w.periodIndices[1] = w.periodIndices[0];
          w.periodNullifiers[1] = w.periodNullifiers[0];
        }),
      );
    });
    await t.test("rejects an insufficient whole-period budget", async () => {
      await invalid(
        mutate(base, (w) => {
          w.remainingPeriods = "1";
        }),
      );
    });
    await t.test("rejects a changed allocation key commitment in the budget policy", async () => {
      await invalid(
        mutate(base, (w) => {
          w.allocationKeyCommitment = "123";
        }),
      );
    });
    await t.test("rejects a different child identity secret", async () => {
      await invalid(
        mutate(base, (w) => {
          w.derivedSecretField = "987654";
        }),
      );
    });
    await t.test("rejects an unrelated note root", async () => {
      await invalid(
        mutate(base, (w) => {
          w.inputRoots[0] = "123";
        }),
      );
    });
    await t.test("rejects a forged payout commitment", async () => {
      await invalid(
        mutate(base, (w) => {
          w.outputCommitments[1] = "123";
        }),
      );
    });
    await t.test("rejects ciphertext substitution", async () => {
      await invalid(
        mutate(base, (w) => {
          w.ciphertextHashes[1] = "123";
        }),
      );
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
