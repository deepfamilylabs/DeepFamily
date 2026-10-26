import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { boundaryArtifactPaths, BOUNDARY_CIRCUITS, buildBoundaryDevelopment,
  inspectBoundaryDevelopment, parseBoundaryArguments, setupBoundaryDevelopment,
} from "../scripts/boundary-zk-development.mjs";

function binary(magic, entries) {
  const prefix = Buffer.alloc(12);
  prefix.write(magic); prefix.writeUInt32LE(1, 4); prefix.writeUInt32LE(entries.length, 8);
  return Buffer.concat([prefix, ...entries.flatMap(([kind, bytes]) => {
    const header = Buffer.alloc(12);
    header.writeUInt32LE(kind); header.writeBigUInt64LE(BigInt(bytes.length), 4);
    return [header, bytes];
  })]);
}
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("current asset boundary development setup", function () {
  let root;
  const runtimeInspector = () => ({ sha256: "b".repeat(64) });
  beforeEach(function () { root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-boundary-setup-")); });
  afterEach(function () { fs.rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
    for (const circuit of Object.keys(BOUNDARY_CIRCUITS)) {
      const files = boundaryArtifactPaths(circuit, { root });
      write(path.join(root, "circuits", `${files.source}.circom`), "pragma circom 2.2.3;\n");
    }
    const compiler = { path: path.join(root, "bin/circom"), sha256: "a".repeat(64), version: "2.2.3" };
    const build = async ({ circuit }) => {
      const files = boundaryArtifactPaths(circuit.slice("shielded:".length), { root });
      const header = Buffer.alloc(64);
      header.writeUInt32LE(32); header.writeUInt32LE(32, 36);
      header.writeUInt32LE(1, 40); header.writeUInt32LE(files.publicSignals - 1, 44); header.writeUInt32LE(16, 60);
      write(files.r1cs, binary("r1cs", [[1, header]]));
      write(files.compiledWasm, Buffer.from(`compiled ${files.source}`));
    };
    const tauHeader = Buffer.alloc(40);
    tauHeader.writeUInt32LE(32); tauHeader.writeUInt32LE(17, 36);
    write(path.join(root, "circuits/ptau/ppot_0080_17.ptau"), binary("ptau", [[1, tauHeader], [12, Buffer.alloc(0)]]));
    write(path.join(root, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"), "test template");
    const protectedFiles = ["circuits/zk-artifacts-manifest.json", "circuits/shielded-production-manifest.json"];
    for (const file of protectedFiles) write(path.join(root, file), "production sentinel");
    return { root, build, compilerInspector: async () => compiler, runtimeInspector, protectedFiles };
  }

  it("selects exactly the current three source and verifier paths", function () {
    assert.deepEqual(Object.keys(BOUNDARY_CIRCUITS), ["shield", "unshield", "unshield4"]);
    for (const circuit of Object.keys(BOUNDARY_CIRCUITS)) {
      const files = boundaryArtifactPaths(circuit, { root });
      assert.equal(files.r1cs, path.join(root, "zk-artifacts/shielded", `${files.source}.r1cs`));
      assert.equal(files.wasm, path.join(root, "frontend/public/zk/shielded", `${files.source}.wasm`));
      assert.equal(files.solidity, path.join(root, "contracts", `${files.verifierContractName}.sol`));
    }
    for (const circuit of ["fund", "claim", "transfer", "shielded:shield", "toString"])
      assert.throws(() => boundaryArtifactPaths(circuit, { root }));
  });

  it("parses explicit actions and rejects ambiguous or unsupported regeneration", function () {
    assert.deepEqual(parseBoundaryArguments(["--all"]), { action: "--all", circuits: ["shield", "unshield", "unshield4"], ptauPath: undefined });
    assert.deepEqual(parseBoundaryArguments(["--setup", "--circuit", "unshield4", "--ptau", "local.ptau"]),
      { action: "--setup", circuits: ["unshield4"], ptauPath: "local.ptau" });
    for (const args of [[], ["--all", "--setup"], ["--build", "--ptau", "file"],
      ["--all", "--circuit", "claim"], ["--all", "--circuit"], ["--all", "--circuit", "shield", "--circuit", "unshield"], ["--production"]])
      assert.throws(() => parseBoundaryArguments(args));
  });

  it("builds only current boundaries, copies exact WASM, invalidates setup and preserves production manifests", async function () {
    const options = fixture();
    const manifest = await buildBoundaryDevelopment(options);
    assert.equal(manifest.developmentOnly, true); assert.equal(manifest.productionReady, false);
    assert.deepEqual(Object.keys(manifest.circuits), ["shield", "unshield", "unshield4"]);
    for (const circuit of Object.keys(BOUNDARY_CIRCUITS)) {
      const files = boundaryArtifactPaths(circuit, { root });
      assert.equal(sha256(files.wasm), sha256(files.compiledWasm));
      assert.equal(manifest.circuits[circuit].zkeySha256, undefined);
    }
    inspectBoundaryDevelopment({ root, requireSetup: false, runtimeInspector });
    assert.throws(() => inspectBoundaryDevelopment({ root, runtimeInspector }), /artifact hash mismatch/);
    for (const file of options.protectedFiles) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), "production sentinel");
    fs.appendFileSync(path.join(root, "circuits/shielded_shield.circom"), "// changed\n");
    assert.throws(() => inspectBoundaryDevelopment({ root, requireSetup: false, runtimeInspector }), /source or catalogue mismatch/);
  });

  it("refuses a production-labelled destination before invoking the compiler", async function () {
    const options = fixture();
    fs.writeFileSync(path.join(root, "circuits/shielded-development-manifest.json"), JSON.stringify({
      schema: "deepfamily/shielded-development-keys@1", developmentOnly: false, productionReady: true, circuits: {},
    }));
    let invoked = false;
    await assert.rejects(buildBoundaryDevelopment({ ...options, build: async () => { invoked = true; } }), /isolated boundary development/);
    assert.equal(invoked, false);
  });

  it("verifies candidate keys before replacement and records matching development hashes", async function () {
    const options = fixture();
    await buildBoundaryDevelopment({ ...options, circuits: ["unshield"] });
    const files = boundaryArtifactPaths("unshield", { root });
    fs.writeFileSync(files.zkey, "previous key");
    let accepts = false;
    const key = { protocol: "groth16", curve: "bn128", nPublic: 11 };
    const runtime = async () => ({ zKey: {
      async newZKey(r1cs, tau, output) { assert.equal(r1cs, files.r1cs); assert.ok(tau instanceof Uint8Array); fs.writeFileSync(output, "initial"); },
      async contribute(input, output, name, entropy) { assert.equal(name, "boundary-local-development"); assert.match(entropy, /^[a-f0-9]{128}$/u); fs.writeFileSync(output, "new key"); return Buffer.alloc(64, 1); },
      async verifyFromR1cs(r1cs, tau) { assert.ok(tau instanceof Uint8Array); return accepts; },
      async exportVerificationKey() { return key; },
      async exportSolidityVerifier() { return "pragma solidity >=0.7.0 <0.9.0;\ncontract Groth16Verifier {}\n"; },
    } });
    await assert.rejects(setupBoundaryDevelopment({ root, circuits: ["unshield"], runtime, runtimeInspector }), /contribution verification failed/);
    assert.equal(fs.readFileSync(files.zkey, "utf8"), "previous key");
    assert.equal(fs.existsSync(path.join(files.directory, `${files.source}_staged.zkey`)), false);
    accepts = true;
    const manifest = await setupBoundaryDevelopment({ root, circuits: ["unshield"], runtime, runtimeInspector });
    assert.equal(fs.readFileSync(files.zkey, "utf8"), "new key");
    assert.equal(manifest.circuits.unshield.zkeySha256, sha256(files.zkey));
    assert.equal(manifest.circuits.unshield.solidityVerifierSha256, sha256(files.solidity));
    assert.match(fs.readFileSync(files.solidity, "utf8"), /DEVELOPMENT ONLY/);
    assert.match(fs.readFileSync(files.solidity, "utf8"), /contract ShieldedUnshieldVerifier/);
    for (const file of options.protectedFiles) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), "production sentinel");
  });
});
