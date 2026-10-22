import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  BN254_BASE_FIELD,
  BN254_SCALAR_FIELD,
  linkGroth16Proofs,
  verifyLinkedGroth16Proof,
} from "../packages/protocol-core/groth16-link.js";
import { linkedVerifierSource, readZkeyDeltaG1 } from "../scripts/lib/linkedVerifierSource.mjs";

const root = path.resolve(import.meta.dirname, "..");
const replaceWord = (proof, i, value) => {
  const words = proof.slice(2).match(/.{64}/gu);
  words[i] = value.toString(16).padStart(64, "0");
  return `0x${words.join("")}`;
};
const word = (proof, i) => BigInt(`0x${proof.slice(2 + i * 64, 66 + i * 64)}`);

describe("LinkG16 authenticated hidden inputs", function () {
  this.timeout(180_000);
  let temp, parameters, proof, snarkjs, presentationFiles;
  before(async function () {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-linkg16-test-"));
    const sources = {
      issuer: `pragma circom 2.2.3;
template Issuer() {
  signal input secret;
  signal output common;
  common <== secret * secret;
}
component main = Issuer();`,
      presentation: `pragma circom 2.2.3;
template Presentation() {
  signal input commonValue;
  signal input salt;
  signal output common;
  signal output operation;
  common <== commonValue;
  operation <== commonValue * salt;
}
component main = Presentation();`,
    };
    const cpus = os.cpus;
    os.cpus = () => cpus().slice(0, 2);
    try {
      snarkjs = await import("snarkjs");
      const keys = {};
      for (const [name, source] of Object.entries(sources)) {
        const file = path.join(temp, `${name}.circom`);
        fs.writeFileSync(file, source);
        execFileSync(
          path.join(root, "bin/circom"),
          [file, "--r1cs", "--wasm", "--O2", "-o", temp],
          { stdio: "pipe" },
        );
        const base = path.join(temp, name);
        const initial = `${base}.initial.zkey`;
        const zkey = `${base}.zkey`;
        await snarkjs.zKey.newZKey(
          `${base}.r1cs`,
          path.join(root, "circuits/ptau/ppot_0080_17.ptau"),
          initial,
        );
        await snarkjs.zKey.contribute(
          initial,
          zkey,
          "isolated LinkG16 test",
          randomBytes(32).toString("hex"),
        );
        keys[name] = {
          verificationKey: await snarkjs.zKey.exportVerificationKey(zkey),
          deltaG1: await readZkeyDeltaG1(zkey),
        };
        if (name === "presentation") presentationFiles = { wasm: `${base}_js/${name}.wasm`, zkey };
      }
      const issuerProof = await snarkjs.groth16.fullProve(
        { secret: "7" },
        path.join(temp, "issuer_js/issuer.wasm"),
        path.join(temp, "issuer.zkey"),
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      const presentationProof = await snarkjs.groth16.fullProve(
        { commonValue: "49", salt: "11" },
        presentationFiles.wasm,
        presentationFiles.zkey,
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      assert.deepEqual(issuerProof.publicSignals, ["49"]);
      assert.deepEqual(presentationProof.publicSignals, ["49", "539"]);
      parameters = {
        issuer: { ...keys.issuer, proof: issuerProof.proof },
        presentation: { ...keys.presentation, proof: presentationProof.proof },
        commonInputs: ["49"],
        publicInputs: ["539"],
      };
      proof = await linkGroth16Proofs(parameters);
    } finally {
      os.cpus = cpus;
      await globalThis.curve_bn128?.terminate?.();
    }
  });
  after(async function () {
    await globalThis.curve_bn128?.terminate?.();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  });

  const verifies = (bytes = proof, changes = {}) =>
    verifyLinkedGroth16Proof({ ...parameters, proof: bytes, ...changes });

  it("links an existing issuer proof without the issuer witness and rerandomizes every use", async function () {
    assert.equal((proof.length - 2) / 2, 32 * 27);
    assert.equal(await verifies(), true);
    const second = await linkGroth16Proofs(parameters);
    assert.notEqual(second, proof);
    assert.equal(await verifies(second), true);
  });

  it("rejects every changed proof point, commitment and response", async function () {
    for (let i = 0; i < 27; i++) {
      assert.equal(await verifies(replaceWord(proof, i, word(proof, i) + 1n)), false, `word ${i}`);
    }
  });

  it("binds the actual public operation and exact verification keys", async function () {
    assert.equal(await verifies(proof, { publicInputs: ["540"] }), false);
    assert.equal(await verifies(proof, { publicInputs: [BN254_SCALAR_FIELD] }), false);
    assert.equal(
      await verifies(proof, {
        issuer: { ...parameters.issuer, deltaG1: ["1", "2", "1"] },
      }),
      false,
    );
    assert.equal(
      await verifies(proof, {
        issuer: parameters.presentation,
        presentation: parameters.issuer,
      }),
      false,
    );
  });

  it("rejects noncanonical scalars, point coordinates, lengths and infinity proofs", async function () {
    assert.equal(
      await verifies(replaceWord(proof, 24, word(proof, 24) + BN254_SCALAR_FIELD)),
      false,
    );
    assert.equal(await verifies(replaceWord(proof, 16, word(proof, 16) + BN254_BASE_FIELD)), false);
    assert.equal(await verifies(`${proof}${"00".repeat(32)}`), false);
    assert.equal(await verifies(proof.slice(0, -64)), false);
    assert.equal(await verifies(replaceWord(replaceWord(proof, 0, 0n), 1, 0n)), false);
  });

  it("refuses to link independently valid proofs with different authenticated inputs", async function () {
    const other = await snarkjs.groth16.fullProve(
      { commonValue: "64", salt: "11" },
      presentationFiles.wasm,
      presentationFiles.zkey,
      undefined,
      { singleThread: true },
      { singleThread: true },
    );
    await assert.rejects(
      linkGroth16Proofs({
        ...parameters,
        presentation: { ...parameters.presentation, proof: other.proof },
        publicInputs: ["704"],
      }),
      /underlying proof does not verify/u,
    );
  });

  it("generates fixed keys and rejects a mismatched delta or unsupported gamma", async function () {
    const options = {
      contractName: "IsolatedLinkedVerifier",
      issuerVerificationKey: parameters.issuer.verificationKey,
      issuerDeltaG1: parameters.issuer.deltaG1,
      presentationVerificationKey: parameters.presentation.verificationKey,
      presentationDeltaG1: parameters.presentation.deltaG1,
      publicSignals: 1,
    };
    const source = await linkedVerifierSource(options);
    assert.match(source, /contract IsolatedLinkedVerifier is LinkedGroth16Verifier/u);
    assert.match(source, /uint256\[1\] calldata input/u);
    assert.doesNotMatch(source, /constructor\s*\(/u);
    await assert.rejects(
      linkedVerifierSource({ ...options, issuerDeltaG1: ["1", "2", "1"] }),
      /delta G1 and G2/u,
    );
    const badGamma = structuredClone(options.issuerVerificationKey);
    badGamma.vk_gamma_2 = badGamma.vk_delta_2;
    await assert.rejects(
      linkedVerifierSource({ ...options, issuerVerificationKey: badGamma }),
      /gamma = 1/u,
    );
  });
});
