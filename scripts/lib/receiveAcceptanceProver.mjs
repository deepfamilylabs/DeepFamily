import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AbiCoder } from "ethers";
import { PROTOCOL_CIRCUITS } from "./protocolCircuitCatalog.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";

const CIRCUITS = { ...PROTOCOL_CIRCUITS, ...SHIELDED_DEPLOYMENT_CIRCUITS };
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Uses caller-authenticated pins for every proof, independently of how the keys were generated. */
export function createReceiveAcceptanceProver({ root = process.cwd(), artifacts, snarkjs } = {}) {
  root = path.resolve(root);
  let runtime = snarkjs;
  const load = (circuit) => {
    const spec = Object.hasOwn(CIRCUITS, circuit) ? CIRCUITS[circuit] : undefined;
    const artifact = artifacts?.[circuit];
    if (!spec || !artifact || artifact.source !== spec.source)
      throw new Error(`Receive ${circuit} source does not match the fixed circuit catalogue`);
    const directory = Object.hasOwn(PROTOCOL_CIRCUITS, circuit) ? "protocol" : "shielded";
    const prefix = `frontend/public/zk/${directory}/${spec.source}`;
    const files = {};
    for (const [name, filename, field] of [
      ["wasm", `${prefix}.wasm`, "wasmSha256"],
      ["zkey", `${prefix}_final.zkey`, "zkeySha256"],
      ["verificationKey", `${prefix}.vkey.json`, "verificationKeySha256"],
    ]) {
      const file = path.resolve(root, artifact[`${name}Path`] ?? filename);
      if (!/^[a-f0-9]{64}$/u.test(artifact[field] ?? ""))
        throw new Error(`Receive ${circuit} ${name} hash pin is missing or invalid`);
      const bytes = fs.readFileSync(file);
      if (digest(bytes) !== artifact[field])
        throw new Error(`Receive ${circuit} ${name} hash mismatch`);
      files[name] = { file, bytes };
    }
    const key = JSON.parse(files.verificationKey.bytes);
    if (key.protocol !== "groth16" || key.curve !== "bn128" || key.nPublic !== spec.publicSignals)
      throw new Error(`Receive ${circuit} verification key public-signal arity mismatch`);
    return { spec, files, key };
  };
  const signals = (circuit, values, count) => {
    if (
      !Array.isArray(values) ||
      values.length !== count ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(value) ||
          BigInt(value) >= FIELD,
      )
    )
      throw new Error(`Receive ${circuit} public signals do not match the fixed statement`);
    return values;
  };
  const getRuntime = async () => (runtime ??= await import("snarkjs"));
  return {
    async prove({ circuit, witness, expectedPublicSignals }) {
      const { spec, files, key } = load(circuit);
      const engine = await getRuntime();
      const result = await engine.groth16.fullProve(
        witness,
        files.wasm.file,
        files.zkey.file,
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      signals(circuit, result.publicSignals, spec.publicSignals);
      if (expectedPublicSignals !== undefined)
        assert.deepEqual(
          result.publicSignals,
          expectedPublicSignals.map(String),
          `Receive ${circuit} public signals differ from the requested statement`,
        );
      if (!(await engine.groth16.verify(key, result.publicSignals, result.proof)))
        throw new Error(`Receive ${circuit} generated proof did not verify`);
      load(circuit);
      return {
        ...result,
        solidityProof: AbiCoder.defaultAbiCoder().encode(
          ["uint256[2]", "uint256[2][2]", "uint256[2]"],
          [
            result.proof.pi_a.slice(0, 2),
            result.proof.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
            result.proof.pi_c.slice(0, 2),
          ],
        ),
      };
    },
    async verify({ circuit, proof, publicSignals }) {
      const { spec, key } = load(circuit);
      signals(circuit, publicSignals, spec.publicSignals);
      const verified = await (await getRuntime()).groth16.verify(key, publicSignals, proof);
      load(circuit);
      return verified;
    },
  };
}
