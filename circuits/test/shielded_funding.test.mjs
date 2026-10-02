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

test("shielded initial Fund and continuation Fund constraints", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-funding-"));
  try {
    const calculators = {};
    for (const action of ["fund"]) {
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
        computeShieldedEnrollmentNullifier({
          allocationKey: fixture.initial.allocationKey,
          policyCommitment: fixture.policy,
          heirIdentityCommitment: fixture.initial.heirIdentityCommitment,
        }).toString(),
      );
    });

    await t.test("valid initial Fund and continuation Fund satisfy compiled R1CS", async () => {
      const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
      for (const [action, witness] of [
        ["fund", fixture.initial],
        ["fund", fixture.continuation],
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
          ["fund", fixture.continuation],
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
      const { initial, policy, enrollment } = fixture;
      const withOwner = (owner) =>
        mutate(initial, (w) => {
          w.heirOwnerCommitment = owner.toString();
          w.outputCommitments[0] = poseidon8([
            1015n,
            policy,
            enrollment,
            owner,
            BigInt(w.rate),
            BigInt(w.rate) * BigInt(w.budgetPeriods),
            BigInt(w.budgetNonce),
            BigInt(w.ciphertextHashes[0]),
          ]).toString();
        });
      // The payer, not the circuit, checks that the owner belongs to the heir.
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
    await t.test("initial Fund rejects funding above donor balance", async () => {
      await invalid(
        "fund",
        mutate(fixture.initial, (w) => {
          w.budgetPeriods = "11";
        }),
      );
    });
    await t.test("continuation Fund cannot reset enrollment eligibility", async () => {
      await invalid(
        "fund",
        mutate(fixture.continuation, (w) => {
          w.eligibleFrom = (BigInt(w.eligibleFrom) - 2_592_000n).toString();
        }),
      );
    });
    await t.test("continuation Fund cannot count old budget value as new funding", async () => {
      const { continuation, policy, enrollment } = fixture;
      const attempted = mutate(continuation, (w) => {
        w.budgetPeriods = "7";
        w.outputCommitments[0] = poseidon8([
          1015n,
          policy,
          enrollment,
          BigInt(w.heirOwnerCommitment),
          BigInt(w.rate),
          700n,
          BigInt(w.budgetNonce),
          BigInt(w.ciphertextHashes[0]),
        ]).toString();
      });
      await invalid("fund", attempted);
    });
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
