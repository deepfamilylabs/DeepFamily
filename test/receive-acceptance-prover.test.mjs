import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReceiveAcceptanceProver } from "../scripts/lib/receiveAcceptanceProver.mjs";
import { PROTOCOL_CIRCUITS } from "../scripts/lib/protocolCircuitCatalog.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "../scripts/lib/zkDeploymentCatalog.mjs";

const catalogue = { ...PROTOCOL_CIRCUITS, ...SHIELDED_DEPLOYMENT_CIRCUITS };
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const temporaryDirectories = [];

function fixture({ circuit = "code", explicitPaths = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-acceptance-prover-"));
  temporaryDirectories.push(root);
  const artifacts = {};
  const files = {};
  for (const [action, specification] of Object.entries(catalogue)) {
    const directory = Object.hasOwn(PROTOCOL_CIRCUITS, action) ? "protocol" : "shielded";
    const base = `frontend/public/zk/${directory}/${specification.source}`;
    files[action] = {
      wasm: path.join(root, `${base}.wasm`),
      zkey: path.join(root, `${base}_final.zkey`),
      vkey: path.join(root, `${base}.vkey.json`),
    };
    for (const file of Object.values(files[action]))
      fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(files[action].wasm, `fake-wasm:${action}`);
    fs.writeFileSync(files[action].zkey, `fake-zkey:${action}`);
    fs.writeFileSync(
      files[action].vkey,
      JSON.stringify({
        protocol: "groth16",
        curve: "bn128",
        nPublic: specification.publicSignals,
        fixture: action,
      }),
    );
    artifacts[action] = {
      source: specification.source,
      wasmSha256: sha256(files[action].wasm),
      zkeySha256: sha256(files[action].zkey),
      verificationKeySha256: sha256(files[action].vkey),
    };
  }
  if (explicitPaths) {
    for (const [kind, option] of [
      ["wasm", "wasmPath"],
      ["zkey", "zkeyPath"],
      ["vkey", "verificationKeyPath"],
    ]) {
      const relative = `custom-proof-files/${circuit}.${kind}`;
      const destination = path.join(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(files[circuit][kind], destination);
      files[circuit][kind] = destination;
      artifacts[circuit][option] = relative;
    }
  }
  const publicSignals = Array.from({ length: catalogue[circuit].publicSignals }, (_, index) =>
    String(index + 10),
  );
  const calls = [];
  const snarkjs = {
    groth16: {
      fullProve: async (...args) => {
        calls.push(["prove", ...args]);
        return { proof, publicSignals };
      },
      verify: async (...args) => {
        calls.push(["verify", ...args]);
        return true;
      },
    },
  };
  const create = () => createReceiveAcceptanceProver({ root, artifacts, snarkjs });
  return { root, artifacts, files, circuit, publicSignals, calls, snarkjs, create };
}

describe("receive acceptance prover artifact and statement validation", function () {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      fs.rmSync(directory, { recursive: true, force: true });
  });

  for (const circuit of ["code", "shield", "unshield", "unshield4"])
    it(`proves and independently verifies the pinned ${circuit} statement`, async () => {
      const context = fixture({ circuit });
      const witness = { privateInput: "not-report-material" };
      const prover = context.create();
      const result = await prover.prove({
        circuit,
        witness,
        expectedPublicSignals: context.publicSignals,
      });
      assert.deepEqual(result.publicSignals, context.publicSignals);
      assert.deepEqual(result.proof, proof);
      assert.match(result.solidityProof, /^0x[\da-f]{512}$/iu);
      assert.equal(context.calls[0][0], "prove");
      assert.equal(context.calls[0][1], witness);
      assert.equal(context.calls[0][2], context.files[circuit].wasm);
      assert.equal(context.calls[0][3], context.files[circuit].zkey);
      assert.equal(context.calls[1][0], "verify");
      assert.equal(context.calls[1][1].fixture, circuit);
      assert.deepEqual(context.calls[1][2], context.publicSignals);
      assert.equal(
        await prover.verify({ circuit, proof: result.proof, publicSignals: result.publicSignals }),
        true,
      );
    });

  it("uses explicit pinned file paths instead of unrelated canonical files", async () => {
    const context = fixture({ explicitPaths: true });
    await context
      .create()
      .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals });
    assert.equal(context.calls[0][2], context.files.code.wasm);
    assert.equal(context.calls[0][3], context.files.code.zkey);
  });

  for (const kind of ["wasm", "zkey", "vkey"])
    it(`rejects a changed ${kind} before calling Groth16`, async () => {
      const context = fixture();
      const prover = context.create();
      fs.appendFileSync(context.files.code[kind], "changed");
      await assert.rejects(async () =>
        prover.prove({
          circuit: "code",
          witness: {},
          expectedPublicSignals: context.publicSignals,
        }),
      );
      assert.deepEqual(context.calls, []);
    });

  it("rejects a different canonical source even when every file hash matches", async () => {
    const context = fixture();
    context.artifacts.code.source = PROTOCOL_CIRCUITS.claim.source;
    await assert.rejects(async () =>
      context
        .create()
        .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals }),
    );
    assert.deepEqual(context.calls, []);
  });

  for (const patch of [
    { protocol: "plonk" },
    { curve: "bls12381" },
    { nPublic: PROTOCOL_CIRCUITS.code.publicSignals + 1 },
  ])
    it(`rejects a hash-matching verification key with the wrong ${Object.keys(patch)[0]}`, async () => {
      const context = fixture();
      const file = context.files.code.vkey;
      fs.writeFileSync(
        file,
        JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...patch }),
      );
      context.artifacts.code.verificationKeySha256 = sha256(file);
      await assert.rejects(async () =>
        context
          .create()
          .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals }),
      );
      assert.deepEqual(context.calls, []);
    });

  it("rejects generated public signals with the wrong arity", async () => {
    const context = fixture();
    context.snarkjs.groth16.fullProve = async () => ({
      proof,
      publicSignals: context.publicSignals.slice(1),
    });
    await assert.rejects(async () =>
      context
        .create()
        .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals }),
    );
  });

  it("rejects a generated statement whose public coordinate differs from the expected statement", async () => {
    const context = fixture();
    const expected = [...context.publicSignals];
    expected[3] = "999";
    await assert.rejects(async () =>
      context.create().prove({ circuit: "code", witness: {}, expectedPublicSignals: expected }),
    );
  });

  it("rejects a proof that its own pinned verification key does not verify", async () => {
    const context = fixture();
    context.snarkjs.groth16.verify = async () => false;
    await assert.rejects(async () =>
      context
        .create()
        .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals }),
    );
  });

  it("rejects artifacts changed while the asynchronous proof is being generated", async () => {
    const context = fixture();
    context.snarkjs.groth16.fullProve = async () => {
      fs.appendFileSync(context.files.code.zkey, "changed-during-proof");
      return { proof, publicSignals: context.publicSignals };
    };
    await assert.rejects(async () =>
      context
        .create()
        .prove({ circuit: "code", witness: {}, expectedPublicSignals: context.publicSignals }),
    );
  });

  it("checks pinned files again when independently verifying an existing proof", async () => {
    const context = fixture();
    const prover = context.create();
    fs.appendFileSync(context.files.code.vkey, "changed-before-verification");
    await assert.rejects(async () =>
      prover.verify({ circuit: "code", proof, publicSignals: context.publicSignals }),
    );
    assert.deepEqual(context.calls, []);
  });

  it("rejects the wrong public signal arity before independent verification", async () => {
    const context = fixture();
    await assert.rejects(async () =>
      context
        .create()
        .verify({ circuit: "code", proof, publicSignals: context.publicSignals.slice(1) }),
    );
    assert.deepEqual(context.calls, []);
  });

  it("rejects noncanonical or out-of-field public coordinates before independent verification", async () => {
    const context = fixture();
    const prover = context.create();
    for (const coordinate of [
      "010",
      "-1",
      "21888242871839275222246405745257275088548364400416034343698204186575808495617",
    ]) {
      const signals = [...context.publicSignals];
      signals[0] = coordinate;
      await assert.rejects(async () =>
        prover.verify({ circuit: "code", proof, publicSignals: signals }),
      );
    }
    assert.deepEqual(context.calls, []);
  });

  it("rejects a key changed during independent asynchronous verification", async () => {
    const context = fixture();
    context.snarkjs.groth16.verify = async () => {
      fs.appendFileSync(context.files.code.vkey, "changed-during-verification");
      return true;
    };
    await assert.rejects(async () =>
      context.create().verify({ circuit: "code", proof, publicSignals: context.publicSignals }),
    );
  });

  it("returns the pinned Groth16 verifier's rejection for an existing invalid proof", async () => {
    const context = fixture();
    context.snarkjs.groth16.verify = async () => false;
    assert.equal(
      await context
        .create()
        .verify({ circuit: "code", proof, publicSignals: context.publicSignals }),
      false,
    );
  });
});
