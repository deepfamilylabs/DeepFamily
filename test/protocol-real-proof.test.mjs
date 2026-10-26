import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { poseidon2, poseidon5 } from "poseidon-lite";
import {
  PROTOCOL_CIRCUITS,
  PROTOCOL_DEVELOPMENT_MANIFEST,
  protocolArtifactPaths,
  inspectProtocolArtifacts,
  proveProtocol,
} from "../scripts/protocol-zk-development.mjs";
import {
  receiveCodeFixture,
  eligibilityFixture,
  capabilityFixture,
} from "../circuits/test/receive_fixture.mjs";
import {
  sourceFactFixture,
  sourceTrustFixture,
} from "../circuits/test/eligibility_source_fixture.mjs";
import { fundFixture, claimFixture, poolTag } from "../circuits/test/budget_fixture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const required = process.env.REQUIRE_PROTOCOL_REAL_PROOFS === "1";
const available = fs.existsSync(path.join(root, PROTOCOL_DEVELOPMENT_MANIFEST));
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Exported so EVM integration and standalone checks can use identical witnesses.
export function transferFixture(deposit = fundFixture()) {
  const source = deposit.witness;
  const witness = Object.fromEntries(
    [
      "chainId",
      "pool",
      "commonBinding",
      "ownerCommitment",
      "viewKeyLo",
      "viewKeyHi",
      "inputRoot",
      "inputNullifier",
      "donorOwnerSecret",
      "donorAmount",
      "donorNonce",
      "donorCiphertextHash",
      "donorDepth",
      "donorIndex",
      "donorSiblings",
    ].map((name) => [name, source[name]]),
  );
  Object.assign(witness, {
    amount: "20",
    recipientNonce: "65432",
    changeNonce: "54321",
    ciphertextHashes: ["43210", "32109"],
  });
  const w = Object.fromEntries(
    Object.entries(witness)
      .filter(([, value]) => !Array.isArray(value))
      .map(([name, value]) => [name, BigInt(value)]),
  );
  const tag = poolTag(1014, w.chainId, w.pool);
  const donorOwner = poseidon2([1013n, w.donorOwnerSecret]);
  const recipient = poseidon5([tag, w.ownerCommitment, w.amount, w.recipientNonce, 43210n]);
  const change = poseidon5([tag, donorOwner, w.donorAmount - w.amount, w.changeNonce, 32109n]);
  witness.outputCommitments = [String(recipient), String(change)];
  return {
    witness,
    publicSignals: [
      w.chainId,
      w.pool,
      w.commonBinding,
      w.ownerCommitment,
      w.viewKeyLo,
      w.viewKeyHi,
      w.inputRoot,
      w.inputNullifier,
      recipient,
      change,
      43210n,
      32109n,
    ],
  };
}

export function realProofFixtures() {
  const codeFixture = receiveCodeFixture();
  const issueFixture = eligibilityFixture();
  const fund = fundFixture({}, codeFixture, issueFixture);
  return {
    sourceFact: sourceFactFixture(),
    sourceTrust: sourceTrustFixture(),
    issue: issueFixture,
    code: codeFixture,
    capability: capabilityFixture(issueFixture, codeFixture),
    fund,
    claim: claimFixture(fund),
    transfer: transferFixture(fund),
  };
}

test(
  "receive real Groth16 proofs bind every public coordinate",
  {
    skip:
      !available && !required
        ? "Development artifacts absent; npm run test:proof requires all real artifacts"
        : false,
    timeout: 600_000,
  },
  async (t) => {
    inspectProtocolArtifacts({ root });
    const fixtures = realProofFixtures();
    const directory = path.join(root, "zk-artifacts/protocol-development/proof-smoke");
    fs.mkdirSync(directory, { recursive: true });
    const summary = {
      developmentOnly: true,
      generatedProofs: 0,
      rejectedPublicMutations: 0,
      circuits: {},
    };
    try {
      for (const [circuit, fixture] of Object.entries(fixtures)) {
        await t.test(circuit, async () => {
          const started = performance.now();
          const result = await proveProtocol({
            circuit,
            witness: fixture.witness,
            expectedPublicSignals: fixture.publicSignals,
            root,
          });
          const snarkjs = await import("snarkjs");
          const key = JSON.parse(
            fs.readFileSync(protocolArtifactPaths(circuit, { root }).vkey, "utf8"),
          );
          assert.equal(result.publicSignals.length, PROTOCOL_CIRCUITS[circuit].publicSignals);
          assert.deepEqual(result.publicSignals, fixture.publicSignals.map(String));
          assert.equal(await snarkjs.groth16.verify(key, result.publicSignals, result.proof), true);
          assert.equal(result.solidityProof.length, 2 + 256 * 2);
          for (let index = 0; index < result.publicSignals.length; index++) {
            const mutated = [...result.publicSignals];
            mutated[index] = String((BigInt(mutated[index]) + 1n) % FIELD);
            assert.equal(
              await snarkjs.groth16.verify(key, mutated, result.proof),
              false,
              `${circuit} public signal ${index} must be proof-bound`,
            );
            summary.rejectedPublicMutations++;
          }
          const elapsedMs = Math.round(performance.now() - started);
          fs.writeFileSync(
            path.join(directory, `${circuit}.json`),
            `${JSON.stringify(result, null, 2)}\n`,
          );
          summary.generatedProofs++;
          summary.circuits[circuit] = { publicSignals: result.publicSignals.length, elapsedMs };
        });
      }
      assert.equal(summary.generatedProofs, Object.keys(PROTOCOL_CIRCUITS).length);
      assert.equal(
        summary.rejectedPublicMutations,
        Object.values(PROTOCOL_CIRCUITS).reduce((total, spec) => total + spec.publicSignals, 0),
      );
      fs.writeFileSync(
        path.join(directory, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    } finally {
      await globalThis.curve_bn128?.terminate?.();
      delete globalThis.curve_bn128;
    }
  },
);
