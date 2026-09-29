// Run with: node --test circuits/test/shielded_key_registration.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import {
  buildShieldedKeyRegistrationPublicSignals,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
} from "@deepfamily/protocol-core";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("anonymous key registration proves identity ownership without a public identity signal", async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-anonymous-registration-"));
  try {
    execFileSync(
      path.join(repoRoot, "bin/circom"),
      [
        "circuits/shielded_key_registration.circom",
        "--r1cs", "--wasm", "--O2", "--sanity_check", "2",
        "-l", "node_modules", "-l", "node_modules/circomlib/circuits", "-o", output,
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
    const wasm = fs.readFileSync(
      path.join(output, "shielded_key_registration_js/shielded_key_registration.wasm"),
    );
    const calculator = await WitnessCalculatorBuilder(wasm, { singleThread: true });
    const lineage = buildLineageFixture().witness;
    const identityCommitment = buildShieldedClaimFixture().heirIdentityCommitment;
    const derivedSecretField = BigInt(lineage.derivedSecretField);
    const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const publicSignals = buildShieldedKeyRegistrationPublicSignals({
      derivedSecretField,
      identityCommitment,
      ownerCommitment: keys.ownerCommitment,
      viewingKey,
      chainId: 1030n,
      registryAddress: "0x1111111111111111111111111111111111111111",
    });
    assert.equal(publicSignals.length, 7);
    assert.equal(publicSignals.includes(identityCommitment), false);
    const witness = {
      ownerCommitment: String(publicSignals[0]),
      viewKeyLo: String(publicSignals[1]),
      viewKeyHi: String(publicSignals[2]),
      chainId: String(publicSignals[3]),
      registryAddress: String(publicSignals[4]),
      registrationTag: String(publicSignals[5]),
      registrationLeaf: String(publicSignals[6]),
      identityCommitment: String(identityCommitment),
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
    assert.deepEqual(wires.slice(1, 8), publicSignals);
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
    await invalid({ derivedSecretField: String(derivedSecretField + 1n) });
    await invalid({ registrationTag: String(publicSignals[5] + 1n) });
    await invalid({ registrationLeaf: String(publicSignals[6] + 1n) });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
