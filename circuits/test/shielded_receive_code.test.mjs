// Run with: node --test circuits/test/shielded_receive_code.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import {
  buildShieldedReceiveCodePublicSignals,
  computeShieldedOwnerCommitment,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
} from "@deepfamily/protocol-core";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("a receive code proves the identity holder chose the owner and viewing keys", async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-code-"));
  try {
    execFileSync(
      path.join(repoRoot, "bin/circom"),
      [
        "circuits/shielded_receive_code.circom",
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
        output,
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
    const wasm = fs.readFileSync(
      path.join(output, "shielded_receive_code_js/shielded_receive_code.wasm"),
    );
    const calculator = await WitnessCalculatorBuilder(wasm, { singleThread: true });
    const lineage = buildLineageFixture().witness;
    const identityCommitment = buildShieldedClaimFixture().heirIdentityCommitment;
    const derivedSecretField = BigInt(lineage.derivedSecretField);
    const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const publicSignals = buildShieldedReceiveCodePublicSignals({
      identityCommitment,
      ownerCommitment: keys.ownerCommitment,
      viewingKey,
    });
    const witness = {
      identityCommitment: String(publicSignals[0]),
      ownerCommitment: String(publicSignals[1]),
      viewKeyLo: String(publicSignals[2]),
      viewKeyHi: String(publicSignals[3]),
      keyMode: "0", identitySuiteId: "1", assetSuiteId: "1", assetDerivationVersion: "1", receiveCodeVersion: "2", spendingSecret: String(keys.ownerSecret),
      nameField: lineage.nameField,
      derivedSecretField: lineage.derivedSecretField,
      isBirthBC: lineage.isBirthBC,
      birthYear: lineage.birthYear,
      birthMonth: lineage.birthMonth,
      birthDay: lineage.birthDay,
      gender: lineage.gender,
      suiteId: 1,
    };
    const wires = await calculator.calculateWitness(witness, 1);
    assert.equal(wires[0], 1n);
    assert.deepEqual(wires.slice(1, 10), publicSignals);
    const invalid = async (change) => {
      const changed = { ...witness, ...change };
      const originalError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(changed, 1));
      } finally {
        console.error = originalError;
      }
    };
    // Another person's secret cannot vouch for this identity.
    await invalid({ derivedSecretField: String(derivedSecretField + 1n) });
    await invalid({ identityCommitment: String(identityCommitment + 1n) });
    // The owner key must derive from the identity secret.
    await invalid({ ownerCommitment: String(keys.ownerCommitment + 1n) });
    await invalid({ viewKeyLo: "0", viewKeyHi: "0" });
    await invalid({ viewKeyHi: String(1n << 128n) });
    const independent = { ...witness, keyMode: "1", spendingSecret: "987654321", ownerCommitment: String(computeShieldedOwnerCommitment(987654321n)) };
    assert.equal((await calculator.calculateWitness(independent, 1))[0], 1n);
    const independentInvalid = async (change) => {
      const originalError = console.error; console.error = () => {};
      try { await assert.rejects(() => calculator.calculateWitness({ ...independent, ...change }, 1)); } finally { console.error = originalError; }
    };
    await independentInvalid({ keyMode: "0" });
    await independentInvalid({ keyMode: "2" });
    await independentInvalid({ spendingSecret: "0" });
    await independentInvalid({ assetSuiteId: "2" });
    await independentInvalid({ assetDerivationVersion: "2" });
    await independentInvalid({ receiveCodeVersion: "1" });
    await independentInvalid({ identitySuiteId: "2" });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
