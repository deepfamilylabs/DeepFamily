// Fresh temporary circuit assets, including real issuer proofs. No release keys
// or verifier assets are produced by this test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon3 } from "poseidon-lite";
import {
  computeShieldedOwnerCommitment,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
} from "@deepfamily/protocol-core";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const publicNames = [
  "authorizationCounter",
  "expiresAt",
  "ownerCommitment",
  "viewKeyLo",
  "viewKeyHi",
  "keyMode",
  "identitySuiteId",
  "independentKeySuiteId",
  "independentKeyDerivationVersion",
  "receiveCodeVersion",
];

function expectedSignals(witness, discloseIdentity) {
  const alias = poseidon3([
    202610210001n,
    BigInt(witness.identityCommitment),
    BigInt(witness.derivedSecretField),
  ]);
  const names = [...publicNames];
  if (discloseIdentity) names.splice(2, 0, "identityCommitment");
  return [alias, ...names.map((name) => BigInt(witness[name]))];
}

test("anonymous and Fund credentials authenticate canonical R, keys, counter and expiry", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-code-"));
  const originalCpus = os.cpus;
  // Bound only the local development setup worker count. Proofs are single-threaded.
  os.cpus = () => originalCpus().slice(0, 2);
  try {
    const lineage = buildLineageFixture().witness;
    const identityCommitment = buildShieldedClaimFixture().heirIdentityCommitment;
    const keys = deriveShieldedHeirKeyMaterial(BigInt(lineage.derivedSecretField));
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const view = splitShieldedViewPublicKey(viewingKey);
    const identityNames = [
      "nameField",
      "derivedSecretField",
      "isBirthBC",
      "birthYear",
      "birthMonth",
      "birthDay",
      "gender",
      "suiteId",
    ];
    const witness = {
      ...Object.fromEntries(identityNames.map((name) => [name, lineage[name]])),
      identityCommitment: String(identityCommitment),
      authorizationCounter: "3",
      expiresAt: "1900000000",
      ownerCommitment: String(keys.ownerCommitment),
      viewKeyLo: String(view.viewKeyLo),
      viewKeyHi: String(view.viewKeyHi),
      keyMode: "0",
      identitySuiteId: "1",
      independentKeySuiteId: "1",
      independentKeyDerivationVersion: "1",
      receiveCodeVersion: "2",
      spendingSecret: String(keys.ownerSecret),
    };
    const independent = {
      ...witness,
      keyMode: "1",
      spendingSecret: "987654321",
      ownerCommitment: String(computeShieldedOwnerCommitment(987654321n)),
    };
    const assets = [];
    for (const [circuit, discloseIdentity] of [
      ["shielded_anonymous_receive_credential", false],
      ["shielded_fund_receive_credential", true],
    ]) {
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
      const wasm = path.join(output, `${circuit}_js/${circuit}.wasm`);
      const calculator = await WitnessCalculatorBuilder(fs.readFileSync(wasm), {
        singleThread: true,
      });
      const valid = async (input) => {
        const wires = await calculator.calculateWitness(input, 1);
        const expected = expectedSignals(input, discloseIdentity);
        assert.deepEqual(wires.slice(1, expected.length + 1), expected);
        return wires;
      };
      const invalid = (source, change) =>
        assertConstraintViolation(() => calculator.calculateWitness({ ...source, ...change }, 1));
      await t.test(
        `${circuit}: both modes share canonical alias and exact public layout`,
        async () => {
          const first = await valid(witness);
          const second = await valid(independent);
          assert.equal(first[1], second[1]);
          const count = discloseIdentity ? 12 : 11;
          const symbols = fs.readFileSync(path.join(output, `${circuit}.sym`), "utf8");
          const identityWire = Number(
            symbols
              .split("\n")
              .find((line) => line.endsWith(",main.identityCommitment"))
              .split(",")[1],
          );
          assert.ok(discloseIdentity ? identityWire === 4 : identityWire > count);
          for (const source of [witness, independent]) {
            await valid({ ...source, authorizationCounter: "0", expiresAt: "1" });
            await valid({
              ...source,
              authorizationCounter: String((1n << 64n) - 1n),
              expiresAt: String((1n << 64n) - 1n),
            });
            await invalid(source, {
              derivedSecretField: String(BigInt(source.derivedSecretField) + 1n),
            });
            await invalid(source, { identityCommitment: String(identityCommitment + 1n) });
            await invalid(source, { ownerCommitment: String(BigInt(source.ownerCommitment) + 1n) });
            await invalid(source, { viewKeyLo: "0", viewKeyHi: "0" });
            for (const field of ["viewKeyLo", "viewKeyHi"]) {
              await invalid(source, { [field]: String(1n << 128n) });
            }
            for (const field of ["authorizationCounter", "expiresAt"]) {
              await invalid(source, { [field]: String(1n << 64n) });
              await invalid(source, { [field]: "-1" });
            }
            for (const change of [
              { keyMode: "2" },
              { spendingSecret: "0" },
              { independentKeySuiteId: "2" },
              { independentKeyDerivationVersion: "2" },
              { receiveCodeVersion: "1" },
              { identitySuiteId: "2" },
            ]) {
              await invalid(source, change);
            }
          }
          await invalid(independent, { keyMode: "0" });
          // Possessing the issuer secrets permits fresh issuance; metadata never
          // changes canonical R or existing owner/viewing key derivation.
          const renewed = await valid({
            ...witness,
            authorizationCounter: "4",
            expiresAt: "1900000001",
          });
          assert.equal(first[1], renewed[1]);
        },
      );
      assets.push({
        circuit,
        discloseIdentity,
        wasm,
        r1cs: path.join(output, `${circuit}.r1cs`),
        witness,
      });
    }
    await t.test(
      "real issuer proofs reject every public mutation and cross-disclosure reuse",
      async () => {
        const snarkjs = await import("snarkjs");
        const proofs = [];
        for (const asset of assets) {
          const zkey = path.join(output, `${asset.circuit}.DEVELOPMENT.zkey`);
          await snarkjs.zKey.newZKey(
            asset.r1cs,
            path.join(repoRoot, "circuits/ptau/ppot_0080_17.ptau"),
            zkey,
          );
          const vkey = await snarkjs.zKey.exportVerificationKey(zkey);
          const data = await snarkjs.groth16.fullProve(
            asset.witness,
            asset.wasm,
            zkey,
            undefined,
            { singleThread: true },
            { singleThread: true },
          );
          assert.equal(await snarkjs.groth16.verify(vkey, data.publicSignals, data.proof), true);
          assert.deepEqual(
            data.publicSignals,
            expectedSignals(asset.witness, asset.discloseIdentity).map(String),
          );
          for (let slot = 0; slot < data.publicSignals.length; slot++) {
            const changed = [...data.publicSignals];
            changed[slot] = String(BigInt(changed[slot]) + 1n);
            assert.equal(await snarkjs.groth16.verify(vkey, changed, data.proof), false);
          }
          proofs.push({ vkey, ...data });
        }
        const strippedFundSignals = proofs[1].publicSignals.filter((_, index) => index !== 3);
        assert.deepEqual(strippedFundSignals, proofs[0].publicSignals);
        assert.equal(
          await snarkjs.groth16.verify(proofs[0].vkey, strippedFundSignals, proofs[1].proof),
          false,
        );
        if (globalThis.curve_bn128?.terminate) await globalThis.curve_bn128.terminate();
      },
    );
  } finally {
    os.cpus = originalCpus;
    fs.rmSync(output, { recursive: true, force: true });
  }
});
