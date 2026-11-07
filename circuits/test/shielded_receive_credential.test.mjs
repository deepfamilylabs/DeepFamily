import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import {
  SNARK_SCALAR_FIELD,
  buildShieldedReceiveCredentialPublicSignals,
  computeIdentityFromDerivedSecret,
  computeShieldedAuthorizationAlias,
  computeShieldedOwnerCommitment,
  computeShieldedValueOwnerCommitment,
  createShieldedReceiveDiversifier,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedReceiveOwnerNonce,
  deriveShieldedReceivePublicKey,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
} from "@deepfamily/protocol-core";
import { circomIncludeArguments } from "../../scripts/lib/circomToolchain.mjs";
import { shieldedCircuitSource } from "../../scripts/lib/zkCircuitSelection.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const material = computeIdentityFromDerivedSecret({
  identity: {
    fullName: "Receive Owner",
    isBirthBC: false,
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 17,
    gender: 2,
  },
  identitySuiteId: 1,
  derivedSecretField: 123456789n,
});
const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);

async function fixture(purpose, keyMode, diversifier) {
  const spendingSecret = keyMode === 0 ? keys.ownerSecret : 37n;
  const viewingKey =
    purpose === "receive"
      ? await deriveShieldedReceivePublicKey(
          keys.hpkeIkm,
          createShieldedReceiveDiversifier(0n, 1900000000n, new Uint8Array(16).fill(diversifier)),
        )
      : await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const ownerCommitment =
    purpose === "receive"
      ? computeShieldedValueOwnerCommitment(
          spendingSecret,
          deriveShieldedReceiveOwnerNonce(viewingKey),
        )
      : computeShieldedOwnerCommitment(spendingSecret);
  const statement = {
    purpose,
    authorizationAlias: computeShieldedAuthorizationAlias(material),
    authorizationCounter: 0n,
    expiresAt: 1900000000n,
    ownerCommitment,
    viewingKey,
    keyMode,
    ...(purpose === "fund" ? { identityCommitment: material.identityCommitment } : {}),
  };
  const view = splitShieldedViewPublicKey(viewingKey);
  const witness = {
    authorizationCounter: "0",
    expiresAt: String(statement.expiresAt),
    identityCommitment: String(material.identityCommitment),
    ownerCommitment: String(ownerCommitment),
    viewKeyLo: String(view.viewKeyLo),
    viewKeyHi: String(view.viewKeyHi),
    keyMode,
    receiveCodeVersion: 1,
    spendingSecret: String(spendingSecret),
    nameField: String(material.nameField),
    derivedSecretField: String(material.derivedSecretField),
    isBirthBC: 0,
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 17,
    gender: 2,
    suiteId: 1,
  };
  return { witness, publicSignals: buildShieldedReceiveCredentialPublicSignals(statement) };
}

test("credential issuers bind diversified VALUE owners and fixed budget owners in both key modes", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-owner-"));
  try {
    for (const purpose of ["receive", "fund"]) {
      const name =
        purpose === "fund" ? "shielded_fund_receive_credential" : "shielded_receive_credential";
      execFileSync(
        path.join(root, "bin/circom"),
        [
          shieldedCircuitSource(name),
          "--wasm",
          "--O2",
          "--sanity_check",
          "2",
          ...circomIncludeArguments(),
          "-o",
          out,
        ],
        { cwd: root, stdio: "pipe" },
      );
      const calc = await WitnessCalculatorBuilder(
        fs.readFileSync(path.join(out, `${name}_js/${name}.wasm`)),
        { singleThread: true },
      );
      await t.test(`${purpose}: exact reduced statement and owner constraints`, async () => {
        for (const keyMode of [0, 1]) {
          const first = await fixture(purpose, keyMode, 1);
          const second = await fixture(purpose, keyMode, 2);
          for (const example of [first, second]) {
            const wires = await calc.calculateWitness(example.witness, 1);
            assert.deepEqual(
              wires.slice(1, example.publicSignals.length + 1),
              example.publicSignals,
            );
            assert.equal(example.publicSignals.length, purpose === "fund" ? 9 : 8);
          }
          assert.equal(first.publicSignals[0], second.publicSignals[0]);
          if (purpose === "receive") {
            assert.notEqual(first.witness.ownerCommitment, second.witness.ownerCommitment);
            await assertConstraintViolation(() =>
              calc.calculateWitness(
                {
                  ...first.witness,
                  ownerCommitment: second.witness.ownerCommitment,
                },
                1,
              ),
            );
            await assertConstraintViolation(() =>
              calc.calculateWitness(
                {
                  ...first.witness,
                  viewKeyLo: String(SNARK_SCALAR_FIELD % (1n << 128n)),
                  viewKeyHi: String(SNARK_SCALAR_FIELD >> 128n),
                },
                1,
              ),
            );
          } else {
            assert.equal(first.witness.ownerCommitment, second.witness.ownerCommitment);
          }
          await assertConstraintViolation(() =>
            calc.calculateWitness({ ...first.witness, receiveCodeVersion: 2 }, 1),
          );
          await assertConstraintViolation(() =>
            calc.calculateWitness({ ...first.witness, spendingSecret: "0" }, 1),
          );
        }
        const independent = await fixture(purpose, 1, 3);
        await assertConstraintViolation(() =>
          calc.calculateWitness({ ...independent.witness, keyMode: 0 }, 1),
        );
      });
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
