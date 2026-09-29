// Run with: node --test circuits/test/shielded_funding.test.mjs
// Temporary witness/R1CS tests; no production verifier assets are produced.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon8 } from "poseidon-lite";
import { computeShieldedEnrollmentNullifier } from "@deepfamily/protocol-core";
import { buildShieldedFundingFixtures } from "./generate_shielded_funding_input.mjs";

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

test("shielded Allocate and TopUp constraints", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-funding-"));
  try {
    const calculators = {};
    for (const action of ["allocate", "top_up"]) {
      const circuit = `shielded_${action}`;
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
    const valid = async (action, witness) => {
      assert.equal((await calculators[action].calculateWitness(witness, 1))[0], 1n);
    };
    const invalid = async (action, witness) => {
      const originalError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculators[action].calculateWitness(witness, 1));
      } finally {
        console.error = originalError;
      }
    };
    const mutate = (witness, change) => {
      const copy = structuredClone(witness);
      change(copy);
      return copy;
    };
    const fixture = buildShieldedFundingFixtures();

    await t.test("first eligibility is exactly two hours after the proof timestamp", () => {
      assert.equal(
        BigInt(fixture.allocate.eligibleFrom),
        BigInt(fixture.allocate.publicSignals[29]) + 7200n,
      );
      assert.equal(fixture.allocate.publicSignals.length, 32);
      assert.equal(fixture.topUp.publicSignals.length, 32);
    });

    await t.test("one policy and heir keep the same allocation tag across changed funding", () => {
      const changedFunding = buildShieldedFundingFixtures({ donorAmount: 400n });
      assert.equal(fixture.allocate.publicSignals[8], changedFunding.allocate.publicSignals[8]);
      assert.notEqual(
        fixture.allocate.publicSignals[22],
        changedFunding.allocate.publicSignals[22],
      );
      assert.equal(
        fixture.allocate.publicSignals[8],
        computeShieldedEnrollmentNullifier({
          allocationKey: fixture.allocate.allocationKey,
          policyCommitment: fixture.policy,
          heirIdentityCommitment: fixture.allocate.heirIdentityCommitment,
        }).toString(),
      );
    });

    await t.test("valid Allocate and TopUp satisfy compiled R1CS", async () => {
      const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      for (const [action, witness] of [
        ["allocate", fixture.allocate],
        ["top_up", fixture.topUp],
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
    await t.test("Allocate can spend exact donor amount with zero-value change", async () => {
      await valid("allocate", buildShieldedFundingFixtures({ donorAmount: 400n }).allocate);
    });
    await t.test("TopUp can reference an exhausted old budget", async () => {
      await valid("top_up", buildShieldedFundingFixtures({ oldBudgetRemainingPeriods: 0n }).topUp);
    });
    await t.test("Allocate accepts full 32-level policy membership", async () => {
      const { allocate, policyNote } = buildShieldedFundingFixtures();
      let root = policyNote;
      for (let level = 0; level < 32; level += 1) {
        const sibling = BigInt(level + 1);
        allocate.policySiblings[level] = sibling.toString();
        root = level === 31 ? poseidon2([sibling, root]) : poseidon2([root, sibling]);
      }
      allocate.policyDepth = "32";
      allocate.policyIndex = (1n << 31n).toString();
      allocate.publicSignals[6] = root.toString();
      await valid("allocate", allocate);
    });
    await t.test("Allocate accepts full 32-level registered-heir membership", async () => {
      const { allocate, registryLeaf } = buildShieldedFundingFixtures();
      const path = fullSyntheticPath(registryLeaf, 32, (1n << 31n) | 5n, 1300);
      allocate.registrationDepth = path.depth;
      allocate.registrationIndex = path.index;
      allocate.registrationSiblings = path.siblings;
      allocate.publicSignals[30] = path.root.toString();
      await valid("allocate", allocate);
      await invalid(
        "allocate",
        mutate(allocate, (w) => {
          w.registrationSiblings[31] = (BigInt(w.registrationSiblings[31]) + 1n).toString();
        }),
      );
    });
    await t.test("Allocate and TopUp reject a changed private registration salt", async () => {
      for (const action of ["allocate", "top_up"]) {
        const witness = action === "allocate" ? fixture.allocate : fixture.topUp;
        await invalid(
          action,
          mutate(witness, (w) => {
            w.registrationSalt = (BigInt(w.registrationSalt) + 1n).toString();
          }),
        );
      }
    });
    await t.test("Allocate accepts full 64-level endorsement and trusted paths", async () => {
      const { allocate } = buildShieldedFundingFixtures();
      const parents = poseidon3([
        1009n,
        BigInt(allocate.fatherIdentityCommitment),
        BigInt(allocate.motherIdentityCommitment),
      ]);
      const endorsementLeaf = poseidon5([
        1007n,
        BigInt(allocate.heirIdentityCommitment),
        parents,
        BigInt(allocate.heirVersionIndex),
        (BigInt(allocate.writtenAt) << 160n) + BigInt(allocate.endorser),
      ]);
      const trustedLeaf = poseidon4([
        1008n,
        BigInt(allocate.rootIdentityCommitment),
        BigInt(allocate.rootVersionIndex),
        BigInt(allocate.endorser),
      ]);
      const endorsement = fullSyntheticPath(endorsementLeaf, 64, (1n << 63n) | 9n, 1400);
      const trusted = fullSyntheticPath(trustedLeaf, 64, (1n << 62n) | 6n, 1500);
      allocate.endorsementDepth = endorsement.depth;
      allocate.endorsementIndex = endorsement.index;
      allocate.endorsementSiblings = endorsement.siblings;
      allocate.publicSignals[27] = endorsement.root.toString();
      allocate.trustedDepth = trusted.depth;
      allocate.trustedIndex = trusted.index;
      allocate.trustedSiblings = trusted.siblings;
      allocate.publicSignals[28] = trusted.root.toString();
      await valid("allocate", allocate);
      await invalid(
        "allocate",
        mutate(allocate, (w) => {
          w.endorsementSiblings[63] = (BigInt(w.endorsementSiblings[63]) + 1n).toString();
        }),
      );
    });
    await t.test("Allocate rejects backdated first eligibility", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.publicSignals[29] = (BigInt(w.publicSignals[29]) + 1n).toString();
        }),
      );
    });
    await t.test("Allocate rejects a non-child parent and a wrong direct-parent side", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.fatherIdentityCommitment = (BigInt(w.fatherIdentityCommitment) + 1n).toString();
        }),
      );
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.rootIsMother = w.rootIsMother === "0" ? "1" : "0";
        }),
      );
    });
    await t.test("Allocate rejects stale endorsement and recommendation witnesses", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.publicSignals[27] = "123";
        }),
      );
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.publicSignals[28] = "123";
        }),
      );
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.endorser = (BigInt(w.endorser) + 1n).toString();
        }),
      );
    });
    await t.test("Allocate cannot change its unique tag for a second allocation", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.publicSignals[8] = (BigInt(w.publicSignals[8]) + 1n).toString();
        }),
      );
    });
    await t.test("Allocate rejects a mismatched registered heir owner", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.heirOwnerCommitment = "123";
        }),
      );
    });
    await t.test("Allocate rejects a policy note without membership", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.publicSignals[6] = "123";
        }),
      );
    });
    await t.test("Allocate rejects funding above donor balance", async () => {
      await invalid(
        "allocate",
        mutate(fixture.allocate, (w) => {
          w.budgetPeriods = "11";
        }),
      );
    });
    await t.test("TopUp cannot reset enrollment eligibility", async () => {
      await invalid(
        "top_up",
        mutate(fixture.topUp, (w) => {
          w.eligibleFrom = (BigInt(w.eligibleFrom) - 2_592_000n).toString();
        }),
      );
    });
    await t.test("TopUp cannot count old budget value as new funding", async () => {
      const { topUp, policy, enrollment } = fixture;
      const attempted = mutate(topUp, (w) => {
        w.topUpPeriods = "7";
        w.publicSignals[21] = poseidon8([
          1015n,
          policy,
          enrollment,
          BigInt(w.heirOwnerCommitment),
          BigInt(w.rate),
          700n,
          BigInt(w.newBudgetNonce),
          BigInt(w.publicSignals[23]),
        ]).toString();
      });
      await invalid("top_up", attempted);
    });
    await t.test("TopUp rejects forged change ciphertext hash", async () => {
      await invalid(
        "top_up",
        mutate(fixture.topUp, (w) => {
          w.publicSignals[24] = "123";
        }),
      );
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
