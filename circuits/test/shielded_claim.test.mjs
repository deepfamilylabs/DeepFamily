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
import { poseidon2, poseidon3, poseidon4, poseidon5 } from "poseidon-lite";
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

    await t.test("witness formulas match protocol-core", () => {
      const fixture = buildShieldedClaimFixture();
      const { witness, policy, enrollment, inputBudget, heirIdentityCommitment } = fixture;
      const keys = deriveShieldedHeirKeyMaterial(witness.derivedSecretField);
      assert.equal(keys.ownerSecret, fixture.ownerSecret);
      assert.equal(keys.ownerCommitment, fixture.ownerCommitment);
      assert.equal(
        computeShieldedPolicyCommitment({
          rootIdentityCommitment: witness.fatherIdentityCommitment,
          rootVersionIndex: witness.rootVersionIndex,
          amountPerPeriod: witness.rate,
          policySalt: witness.policySalt,
          allocationKeyCommitment: witness.allocationKeyCommitment,
        }),
        policy,
      );
      assert.equal(
        computeShieldedEnrollmentCommitment({
          policyCommitment: policy,
          heirIdentityCommitment,
          eligibleFrom: witness.eligibleFrom,
          enrollmentSalt: witness.enrollmentSalt,
        }),
        enrollment,
      );
      assert.equal(
        computeShieldedBudgetNoteCommitment({
          policyCommitment: policy,
          enrollmentCommitment: enrollment,
          heirOwnerCommitment: fixture.ownerCommitment,
          amountPerPeriod: witness.rate,
          remaining: witness.remaining,
          nonce: witness.budgetNonce,
          ciphertextHashField: witness.budgetCiphertextHash,
        }),
        inputBudget,
      );
      assert.equal(
        computeShieldedDummyInputNullifier({
          ownerSecret: keys.ownerSecret,
          noteCommitment: inputBudget,
        }).toString(),
        witness.inputNullifiers[1],
      );
      assert.equal(
        computeShieldedPeriodNullifier({
          derivedSecretField: witness.derivedSecretField,
          policyCommitment: policy,
          periodIndex: witness.periodIndices[0],
        }).toString(),
        witness.periodNullifiers[0],
      );
      assert.equal(witness.periodNullifiers.length, 12);
      assert.equal(
        computeShieldedDummyPeriodNullifier({
          ownerSecret: keys.ownerSecret,
          budgetNoteCommitment: inputBudget,
          slotIndex: 2,
        }).toString(),
        witness.periodNullifiers[2],
      );
      assert.deepEqual(
        computeShieldedClaimBatch({
          amountPerPeriod: witness.rate,
          remaining: witness.remaining,
          eligibleFrom: witness.eligibleFrom,
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
      witness.inputRoot = root.toString();
      await valid(witness);
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
          const policy = computeShieldedPolicyCommitment({
            rootIdentityCommitment: w.fatherIdentityCommitment,
            rootVersionIndex: w.rootVersionIndex,
            amountPerPeriod: w.rate,
            policySalt: w.policySalt,
            allocationKeyCommitment: w.allocationKeyCommitment,
          });
          w.periodNullifiers[0] = computeShieldedPeriodNullifier({
            derivedSecretField: w.derivedSecretField,
            policyCommitment: policy,
            periodIndex: 2n,
          }).toString();
          w.periodNullifiers[1] = computeShieldedPeriodNullifier({
            derivedSecretField: w.derivedSecretField,
            policyCommitment: policy,
            periodIndex: 3n,
          }).toString();
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
          w.inputRoot = "123";
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
