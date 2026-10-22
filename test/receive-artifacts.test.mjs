import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  inspectLinkedReceiveArtifacts,
  RECEIVE_LINK_KEYS_PATH,
} from "../scripts/lib/linkedReceiveArtifacts.mjs";
import {
  RECEIVE_PRESENTATION_CIRCUITS,
  SHIELDED_CIRCUITS,
} from "../scripts/lib/zkCircuitSelection.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("Circom receive linking artifacts", function () {
  let root;
  const read = (file) => fs.readFileSync(path.join(root, file));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
  };
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-link-artifacts-"));
    const files = [
      "circuits/shielded-development-manifest.json",
      RECEIVE_LINK_KEYS_PATH,
      "contracts/libraries/LinkedGroth16Verifier.sol",
    ];
    for (const [action, spec] of Object.entries(RECEIVE_PRESENTATION_CIRCUITS))
      files.push(
        `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[action]}.vkey.json`,
        `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[spec.issuer]}.vkey.json`,
        `contracts/${spec.contractName}.sol`,
      );
    for (const file of new Set(files)) write(file, fs.readFileSync(path.join(repository, file)));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("pins all three local linking verifiers without a second prover runtime", function () {
    const result = inspectLinkedReceiveArtifacts({ root });
    assert.equal(result.circuitCount, 3);
    assert.equal(result.status, "development");
    assert.equal(result.verification, "passed");
    assert.deepEqual(Object.keys(result.artifacts).sort(), ["anonymous", "attachment", "fund"]);
  });

  for (const file of [
    RECEIVE_LINK_KEYS_PATH,
    "contracts/libraries/LinkedGroth16Verifier.sol",
    "contracts/FundReceivePresentationVerifier.sol",
    "frontend/public/zk/shielded/shielded_anonymous_receive_credential.vkey.json",
    "frontend/public/zk/shielded/shielded_fund_receive_presentation.vkey.json",
  ]) {
    it(`rejects modified ${file}`, function () {
      write(file, `${read(file)} `);
      assert.throws(() => inspectLinkedReceiveArtifacts({ root }));
    });
  }

  it("rejects a presentation key swapped inside an otherwise freshly hashed bundle", function () {
    const keys = JSON.parse(read(RECEIVE_LINK_KEYS_PATH));
    keys.anonymous.verificationKey = keys.fund.verificationKey;
    const raw = JSON.stringify(keys);
    write(RECEIVE_LINK_KEYS_PATH, raw);
    const file = "circuits/shielded-development-manifest.json";
    const manifest = JSON.parse(read(file));
    manifest.linkKeys.sha256 = hash(raw);
    write(file, JSON.stringify(manifest));
    assert.throws(() => inspectLinkedReceiveArtifacts({ root }), /stale Circom presentation key/u);
  });

  it("rejects development artifacts when production is required", function () {
    assert.throws(
      () => inspectLinkedReceiveArtifacts({ root, requireProduction: true }),
      /production Circom artifacts/u,
    );
  });
});
