import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { receiveCodeFixture, eligibilityFixture } from "./receive_fixture.mjs";
import { fundFixture, claimFixture } from "./budget_fixture.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";
const root = path.resolve(import.meta.dirname, "../..");
async function compile(out, name) {
  execFileSync(
    path.join(root, "bin/circom"),
    [
      `circuits/${name}.circom`,
      "--r1cs",
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
  return WitnessCalculatorBuilder(fs.readFileSync(path.join(out, `${name}_js/${name}.wasm`)), {
    singleThread: true,
  });
}

test("budget independent contributions and canonical subject period claims", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-budget-"));
  try {
    const fund = await compile(out, "budget_deposit"),
      claim = await compile(out, "budget_claim");
    const valid = async (calc, f) => {
      const wires = await calc.calculateWitness(f.witness, 1);
      assert.deepEqual(wires.slice(1, f.publicSignals.length + 1), f.publicSignals);
    };
    const invalid = (calc, f, patch) =>
      assertConstraintViolation(() => calc.calculateWitness({ ...f.witness, ...patch }, 1));
    const deposit = fundFixture(),
      withdraw = claimFixture(deposit);
    await t.test(
      "stranger Fund uses only donor secrets and a future policy",
      async () => {
        await valid(fund, deposit);
        assert.equal(deposit.publicSignals.length, 20);
        for (const name of [
          "derivedSecretField",
          "codeRootSecret",
          "codeSecret",
          "ownerSecret",
          "identityCommitment",
          "parentIdentity",
          "endorser",
          "xChild",
          "xEndorse",
          "xTrust",
        ])
          assert.equal(Object.hasOwn(deposit.witness, name), false);
        for (const name of [
          "chainId",
          "pool",
          "codeAlias",
          "nonce",
          "ownerCommitment",
          "viewKeyLo",
          "viewKeyHi",
          "familyTag",
          "parentVersion",
          "policyCommitment",
          "budgetKey",
          "eligibleFrom",
          "inputRoot",
          "inputNullifier",
          "donorOwnerSecret",
          "donorAmount",
          "donorNonce",
          "donorCiphertextHash",
          "familyCommitment",
          "rate",
          "periodDays",
          "policySalt",
          "allocationKeyCommitment",
          "budgetPeriods",
          "budgetNonce",
          "changeNonce",
        ]) {
          await invalid(fund, deposit, { [name]: String(BigInt(deposit.witness[name]) + 1n) });
        }
        for (const name of [
          "commonBinding",
          "capabilityBinding",
          "nonce",
          "parentVersion",
          "budgetPeriods",
          "budgetNonce",
          "changeNonce",
        ])
          await invalid(fund, deposit, { [name]: "0" });
        for (const name of ["outputCommitments", "ciphertextHashes"]) {
          for (let i = 0; i < 2; i++) {
            const changed = [...deposit.witness[name]];
            changed[i] = String(BigInt(changed[i]) + 1n);
            await invalid(fund, deposit, { [name]: changed });
          }
        }
      },
    );
    await t.test("Fund conserves money and rejects range/negative-change attacks", async () => {
      await invalid(fund, fundFixture({ donorAmount: 29n }), {});
      await valid(fund, fundFixture({ donorAmount: 30n }));
      for (const patch of [
        { donorAmount: String(1n << 128n) },
        { budgetPeriods: String(1n << 64n) },
        { eligibleFrom: String(1n << 64n) },
        { viewKeyLo: String(1n << 128n) },
        { viewKeyHi: String(1n << 128n) },
        { donorDepth: "33" },
        { donorIndex: String(1n << 32n) },
      ])
        await invalid(fund, deposit, patch);
      const full = fundFixture({
        donorDepth: 32n,
        donorIndex: (1n << 31n) + 3n,
        donorSiblings: Array.from({ length: 32 }, (_, i) => BigInt(i + 1)),
      });
      await valid(fund, full);
      await invalid(fund, full, { donorIndex: "2" });
    });
    await t.test(
      "another donor contribution preserves the existing budget record and time",
      async () => {
        const topup = fundFixture({
          donorOwnerSecret: 87655n,
          donorNonce: 76544n,
          budgetNonce: 32110n,
          changeNonce: 21099n,
        });
        await valid(fund, topup);
        for (const name of [
          "commonBinding",
          "codeAlias",
          "policyCommitment",
          "budgetKey",
          "eligibleFrom",
          "ownerCommitment",
          "viewKeyLo",
          "viewKeyHi",
        ])
          assert.equal(deposit.witness[name], topup.witness[name]);
        assert.notEqual(deposit.witness.inputNullifier, topup.witness.inputNullifier);
        assert.notEqual(deposit.witness.outputCommitments[0], topup.witness.outputCommitments[0]);
      },
    );
    await t.test(
      "Claim spends a real contribution into a VALUE note and bound remainder",
      async () => {
        await valid(claim, withdraw);
        assert.equal(withdraw.publicSignals.length, 23);
        assert.equal(withdraw.witness.inputRoot, deposit.witness.outputCommitments[0]);
        for (const name of [
          "chainId",
          "pool",
          "codeAlias",
          "nonce",
          "ownerCommitment",
          "viewKeyLo",
          "viewKeyHi",
          "policyCommitment",
          "budgetKey",
          "eligibleFrom",
          "inputRoot",
          "inputNullifier",
          "periodNullifier",
          "authorizerScope",
          "issuanceRoot",
          "childTag",
          "endorsementTag",
          "trustedTag",
          "issueNonce",
          "endorser",
          "xChild",
          "xEndorse",
          "xTrust",
          "credentialSalt",
          "derivedSecretField",
          "codeSecret",
          "ownerSecret",
          "familyCommitment",
          "parentVersion",
          "rate",
          "periodDays",
          "policySalt",
          "allocationKeyCommitment",
          "remaining",
          "remainingPeriods",
          "budgetNonce",
          "budgetCiphertextHash",
          "periodIndex",
          "outputBudgetNonce",
          "valueNonce",
        ])
          await invalid(claim, withdraw, { [name]: String(BigInt(withdraw.witness[name]) + 1n) });
        for (const name of ["outputCommitments", "ciphertextHashes"]) {
          for (let i = 0; i < 2; i++) {
            const changed = [...withdraw.witness[name]];
            changed[i] = String(BigInt(changed[i]) + 1n);
            await invalid(claim, withdraw, { [name]: changed });
          }
        }
      },
    );
    await t.test(
      "maturity uses the immutable start and never wraps a far-future index",
      async () => {
        await invalid(claim, withdraw, { asOf: String(BigInt(withdraw.witness.asOf) - 1n) });
        const max = (1n << 64n) - 1n;
        await invalid(claim, claimFixture(deposit, { periodIndex: max, asOf: max }), {});
        await invalid(claim, withdraw, { asOf: String(1n << 64n) });
        await invalid(claim, withdraw, { periodIndex: String(1n << 64n) });
        const one = fundFixture({ budgetPeriods: 1n });
        await valid(claim, claimFixture(one));
        const empty = claimFixture(deposit, { remaining: 0n, remainingPeriods: 0n });
        await invalid(claim, empty, {});
        const full = claimFixture(deposit, {
          noteDepth: 32n,
          noteIndex: (1n << 31n) + 3n,
          noteSiblings: Array.from({ length: 32 }, (_, i) => BigInt(i + 1)),
        });
        await valid(claim, full);
        await invalid(claim, full, { noteIndex: "2" });
      },
    );
    await t.test(
      "Claim authenticates current qualification for the same subject and policy family",
      async () => {
        const matching = claimFixture(deposit, {
          credentialDepth: 32n,
          credentialIndex: (1n << 31n) + 3n,
          credentialSiblings: Array.from({ length: 32 }, (_, i) => BigInt(i + 1)),
        });
        await valid(claim, matching);
        for (const patch of [
          { credentialDepth: "33" },
          { credentialIndex: String(1n << 32n) },
          { credentialIndex: "2" },
          { authorizerScope: "0" },
          { authorizerScope: String(1n << 160n) },
        ])
          await invalid(claim, matching, patch);
        const other = eligibilityFixture({ derivedSecretField: 111111n });
        // A valid credential belonging to another subject cannot be
        // attached to this contribution, even with all of that credential's
        // other opening fields supplied consistently.
        const borrowed = claimFixture(deposit, {
          issuanceRoot: other.credentialCommitment,
        });
        await invalid(claim, borrowed, {});
        const otherFamily = eligibilityFixture({ parentIdentity: 777777n, familySalt: 888888n });
        await invalid(
          claim,
          claimFixture(deposit, { issuanceRoot: otherFamily.credentialCommitment }),
          {},
        );
        for (const role of ["xChild", "xEndorse", "xTrust"]) {
          await invalid(claim, claimFixture(deposit, { [role]: 999999n }), {});
        }
      },
    );
    await t.test(
      "changing receive codes never grants a second allowance for the same subject/policy/period",
      async () => {
        const fresh = receiveCodeFixture({
          nonce: 9002n,
          codeSecret: 335n,
          ownerSecret: 446n,
          viewKeyLo: 225n,
          viewKeyHi: 226n,
        });
        const secondFund = fundFixture({}, fresh);
        await valid(fund, secondFund);
        const secondClaim = claimFixture(secondFund);
        await valid(claim, secondClaim);
        assert.notEqual(deposit.witness.codeAlias, secondFund.witness.codeAlias);
        assert.notEqual(deposit.witness.budgetKey, secondFund.witness.budgetKey);
        assert.notEqual(withdraw.witness.inputNullifier, secondClaim.witness.inputNullifier);
        assert.equal(withdraw.witness.periodNullifier, secondClaim.witness.periodNullifier);
        const nextPeriod = claimFixture(secondFund, {
          periodIndex: 1n,
          asOf:
            BigInt(secondFund.witness.eligibleFrom) +
            BigInt(secondFund.witness.periodDays) * 2n * 86400n,
        });
        await valid(claim, nextPeriod);
        assert.notEqual(withdraw.witness.periodNullifier, nextPeriod.witness.periodNullifier);
      },
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
