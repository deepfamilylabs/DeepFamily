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

test("64-level owner authorization proves canonical empty/collision/increment transitions", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-identity-counter-"));
  try {
    execFileSync(
      path.join(root, "bin/circom"),
      [
        "circuits/shielded_identity_authorization_update.circom",
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
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
