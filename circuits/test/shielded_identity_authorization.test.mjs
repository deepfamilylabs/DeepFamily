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
  prepareShieldedIdentityCounterAuthorization,
} from "@deepfamily/protocol-core";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("owner counter authorization proves identity, scope and exact increments without a tree path", async (t) => {
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
    const maxCounter = (1n << 64n) - 1n;
    for (const authorizationCounter of [0n, 3n, maxCounter - 1n]) {
      await t.test(
        `accepts counter ${authorizationCounter} with six authenticated public signals`,
        async () => {
          const authorization = prepareShieldedIdentityCounterAuthorization({
            ...identity,
            authorizationCounter,
          });
          const wires = await calc.calculateWitness(
            { ...privateIdentity, ...authorization.witness },
            1,
          );
          assert.equal(authorization.publicSignals.length, 6);
          assert.deepEqual(wires.slice(1, 7), authorization.publicSignals);
          assert.equal(authorization.publicSignals[4], authorizationCounter);
          assert.equal(authorization.publicSignals[5], authorizationCounter + 1n);
          for (const name of ["oldRoot", "newRoot", "siblings", "oldKey", "oldValue", "isOld0"])
            assert.equal(
              Object.hasOwn(authorization.witness, name),
              false,
              `${name} must not be an owner-proof input`,
            );
        },
      );
    }
    const authorization = prepareShieldedIdentityCounterAuthorization({
      ...identity,
      authorizationCounter: 0n,
    });
    const witness = { ...privateIdentity, ...authorization.witness };
    for (const [name, patch] of [
      [
        "wrong identity secret",
        { derivedSecretField: String(BigInt(lineage.derivedSecretField) + 1n) },
      ],
      ["zero identity secret", { derivedSecretField: "0" }],
      ["wrong identity name", { nameField: String(BigInt(lineage.nameField) + 1n) }],
      ["wrong identity birth date", { birthYear: String(BigInt(lineage.birthYear) + 1n) }],
      ["forged alias", { aliasR: String(authorization.publicSignals[3] + 1n) }],
      ["zero alias", { aliasR: "0" }],
      ["zero chain", { chainId: "0" }],
      ["oversized chain", { chainId: String(1n << 64n) }],
      ["zero consumer", { consumer: "0" }],
      ["oversized consumer", { consumer: String(1n << 160n) }],
      ["skipped increment", { newCounter: "2" }],
      ["unchanged counter", { newCounter: "0" }],
      ["negative old counter", { oldCounter: "-1", newCounter: "0" }],
      ["negative new counter", { newCounter: "-1" }],
      ["uint64 overflow", { oldCounter: String(maxCounter), newCounter: String(maxCounter + 1n) }],
      ["wrapped uint64 counter", { oldCounter: String(maxCounter), newCounter: "0" }],
    ]) {
      await t.test(`rejects ${name}`, async () => {
        await assertConstraintViolation(() => calc.calculateWitness({ ...witness, ...patch }, 1));
      });
    }
    await t.test(
      "a real depth-64 dictionary opening is not part of owner authorization",
      async () => {
        const current = prepareShieldedIdentityCounterAuthorization({
          ...identity,
          authorizationCounter: 3n,
        });
        const alias = current.publicSignals[3];
        const state = buildShieldedIdentityAuthorizationState([
          [alias, 3n],
          [alias ^ (1n << 63n), 1n],
        ]);
        const opening = getShieldedIdentityAuthorizationWitness(state, alias);
        assert.equal(opening.depth, 64n);
        assert.notEqual(opening.siblings[63], 0n);
        assert.deepEqual(
          (await calc.calculateWitness({ ...privateIdentity, ...current.witness }, 1)).slice(1, 7),
          current.publicSignals,
        );
      },
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
