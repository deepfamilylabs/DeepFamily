import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import {
  buildShieldedIdentityAuthorizationState,
  getShieldedIdentityAuthorizationWitness,
  prepareShieldedIdentityAuthorizationIncrement,
} from "@deepfamily/protocol-core";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("64-level owner authorization proves canonical empty/collision/increment transitions", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-identity-counter-"));
  const originalCpus = os.cpus;
  os.cpus = () => originalCpus().slice(0, 2);
  try {
    execFileSync(
      path.join(root, "bin/circom"),
      [
        "circuits/shielded_identity_authorization_update.circom",
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
    const wasm = path.join(
      out,
      "shielded_identity_authorization_update_js/shielded_identity_authorization_update.wasm",
    );
    const calc = await WitnessCalculatorBuilder(fs.readFileSync(wasm), { singleThread: true });
    const lineage = buildLineageFixture().witness;
    const identity = {
      identityCommitment: buildShieldedClaimFixture().heirIdentityCommitment,
      derivedSecretField: lineage.derivedSecretField,
      chainId: 31337n,
      authorizationStateAddress: "0x1111111111111111111111111111111111111111",
    };
    const privateIdentity = Object.fromEntries(
      [
        "nameField",
        "derivedSecretField",
        "isBirthBC",
        "birthYear",
        "birthMonth",
        "birthDay",
        "gender",
        "suiteId",
      ].map((name) => [name, lineage[name]]),
    );
    let first;
    for (const state of [
      buildShieldedIdentityAuthorizationState(),
      buildShieldedIdentityAuthorizationState([[11n, 1n]]),
    ]) {
      const transition = prepareShieldedIdentityAuthorizationIncrement({ ...identity, state });
      const witness = { ...privateIdentity, ...transition.witness };
      const wires = await calc.calculateWitness(witness, 1);
      assert.deepEqual(wires.slice(1, 9), transition.publicSignals);
      assert.equal(transition.witness.siblings.length, 64);
      assert.equal(
        getShieldedIdentityAuthorizationWitness(transition.nextState, transition.publicSignals[3])
          .authorizationCounter,
        1n,
      );
      const second = prepareShieldedIdentityAuthorizationIncrement({
        ...identity,
        state: transition.nextState,
      });
      assert.deepEqual(
        (await calc.calculateWitness({ ...privateIdentity, ...second.witness }, 1)).slice(1, 9),
        second.publicSignals,
      );
      for (const patch of [
        { derivedSecretField: String(BigInt(lineage.derivedSecretField) + 1n) },
        { aliasR: String(transition.publicSignals[3] + 1n) },
        { oldRoot: String(transition.publicSignals[4] + 1n) },
        { newRoot: String(transition.publicSignals[5] + 1n) },
        { newCounter: "2" },
        { oldCounter: "1" },
        { isOld0: "2" },
      ])
        await assertConstraintViolation(() => calc.calculateWitness({ ...witness, ...patch }, 1));
      first ??= { transition, witness };
    }
    await t.test("actual Groth16 owner proof rejects every changed public signal", async () => {
      const snarkjs = await import("snarkjs");
      const zkey = path.join(out, "owner.DEVELOPMENT.zkey");
      await snarkjs.zKey.newZKey(
        path.join(out, "shielded_identity_authorization_update.r1cs"),
        path.join(root, "circuits/ptau/ppot_0080_17.ptau"),
        zkey,
      );
      const vkey = await snarkjs.zKey.exportVerificationKey(zkey);
      const data = await snarkjs.groth16.fullProve(
        first.witness,
        wasm,
        zkey,
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      assert.deepEqual(data.publicSignals, first.transition.publicSignals.map(String));
      assert.equal(await snarkjs.groth16.verify(vkey, data.publicSignals, data.proof), true);
      for (let index = 0; index < 8; index++) {
        const changed = [...data.publicSignals];
        changed[index] = String(BigInt(changed[index]) + 1n);
        assert.equal(await snarkjs.groth16.verify(vkey, changed, data.proof), false);
      }
    });
  } finally {
    if (globalThis.curve_bn128?.terminate) await globalThis.curve_bn128.terminate();
    os.cpus = originalCpus;
    fs.rmSync(out, { recursive: true, force: true });
  }
});
