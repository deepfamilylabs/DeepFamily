import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  prepareReceivePresentationWitness,
  prepareShieldedIdentityCounterAuthorization,
} from "@deepfamily/protocol-core";
import { buildLineageFixture } from "../circuits/test/generate_lineage_fixture.mjs";
import { buildShieldedClaimFixture } from "../circuits/test/generate_shielded_claim_input.mjs";
import { prepareReceiveProofFixtures } from "../scripts/receive-proof-smoke.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.join(root, "frontend/public/zk/shielded");
const sources = {
  anonymousIssuer: "shielded_anonymous_receive_credential",
  fundIssuer: "shielded_fund_receive_credential",
  anonymous: "shielded_anonymous_receive_presentation",
  fund: "shielded_fund_receive_presentation",
  owner: "shielded_identity_authorization_update",
};

// Constraint tests compile sources without proving artifacts. These separate
// root tests authenticate every public coordinate using the current shared
// WASM/zkey/vkey set; they never perform another setup or require a pTau file.
describe("Receive circuit real-proof public bindings", function () {
  this.timeout(180_000);
  let temporary, snarkjs, requests;

  const vkey = (source) =>
    JSON.parse(fs.readFileSync(path.join(directory, `${source}.vkey.json`), "utf8"));
  const prove = (source, witness) =>
    snarkjs.groth16.fullProve(
      witness,
      path.join(directory, `${source}.wasm`),
      path.join(directory, `${source}_final.zkey`),
      undefined,
      { singleThread: true },
      { singleThread: true },
    );
  async function rejectsEveryPublicMutation(key, data, expected, label) {
    assert.deepEqual(data.publicSignals, expected.map(String), `${label} public layout`);
    assert.equal(await snarkjs.groth16.verify(key, data.publicSignals, data.proof), true);
    for (let index = 0; index < data.publicSignals.length; index++) {
      const changed = [...data.publicSignals];
      changed[index] = String(BigInt(changed[index]) + 1n);
      assert.equal(
        await snarkjs.groth16.verify(key, changed, data.proof),
        false,
        `${label} public signal ${index} must be proof-bound`,
      );
    }
  }

  before(async function () {
    for (const source of Object.values(sources)) {
      for (const name of [`${source}.wasm`, `${source}_final.zkey`, `${source}.vkey.json`]) {
        assert.ok(
          fs.existsSync(path.join(directory, name)),
          `Required real artifact ${name} is missing; run npm run zk:setup`,
        );
      }
    }
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-bindings-"));
    const originalCpus = os.cpus;
    os.cpus = () => originalCpus().slice(0, 2);
    try {
      snarkjs = await import("snarkjs");
      await prepareReceiveProofFixtures(temporary, {
        issuerDirectory: directory,
      });
      requests = Object.fromEntries(
        ["anonymous", "fund"].map((kind) => [
          kind,
          JSON.parse(fs.readFileSync(path.join(temporary, `${kind}.input.json`), "utf8")),
        ]),
      );
    } finally {
      os.cpus = originalCpus;
    }
  });

  after(async function () {
    await globalThis.curve_bn128?.terminate?.();
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  });

  for (const [kind, count] of [
    ["anonymous", 22],
    ["fund", 23],
  ]) {
    it(`${kind}: rejects mutation of all ${count} credential and operation signals`, async function () {
      const prepared = prepareReceivePresentationWitness(requests[kind]);
      const data = await prove(sources[kind], prepared.witness);
      assert.equal(data.publicSignals.length, count);
      await rejectsEveryPublicMutation(
        vkey(sources[kind]),
        data,
        [...prepared.commonInputs, ...prepared.publicInputs],
        kind,
      );
    });
  }

  it("issuer proofs bind all 23 public signals and reject cross-disclosure reuse", async function () {
    const proofs = {};
    for (const [kind, count] of [
      ["anonymous", 11],
      ["fund", 12],
    ]) {
      const request = requests[kind];
      const data = {
        proof: request.credentialProof,
        publicSignals: request.credentialPublicSignals,
      };
      assert.equal(data.publicSignals.length, count);
      proofs[kind] = { key: vkey(sources[`${kind}Issuer`]), ...data };
      await rejectsEveryPublicMutation(
        proofs[kind].key,
        data,
        request.credentialPublicSignals,
        `${kind} issuer`,
      );
    }
    const stripped = proofs.fund.publicSignals.filter((_, index) => index !== 3);
    assert.deepEqual(stripped, proofs.anonymous.publicSignals);
    assert.equal(
      await snarkjs.groth16.verify(proofs.anonymous.key, stripped, proofs.fund.proof),
      false,
    );
    assert.equal(
      await snarkjs.groth16.verify(
        proofs.fund.key,
        proofs.fund.publicSignals,
        proofs.anonymous.proof,
      ),
      false,
    );
  });

  it("owner authorization proof binds all six public counter signals", async function () {
    const lineage = buildLineageFixture().witness;
    const authorization = prepareShieldedIdentityCounterAuthorization({
      identityCommitment: buildShieldedClaimFixture().heirIdentityCommitment,
      derivedSecretField: lineage.derivedSecretField,
      chainId: 31337n,
      authorizationStateAddress: "0x1111111111111111111111111111111111111111",
      authorizationCounter: 0n,
    });
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
    const data = await prove(sources.owner, { ...privateIdentity, ...authorization.witness });
    assert.equal(data.publicSignals.length, 6);
    await rejectsEveryPublicMutation(
      vkey(sources.owner),
      data,
      authorization.publicSignals,
      "owner",
    );
  });
});
