import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function calculateCircuitProofIsolated(inputData, circuitName) {
  const artifactDirectory = path.resolve(__dirname, "../../frontend/public/zk");
  const wasmPath = path.join(artifactDirectory, `${circuitName}.wasm`);
  const zkeyPath = path.join(artifactDirectory, `${circuitName}_final.zkey`);
  const verificationKeyPath = path.join(artifactDirectory, `${circuitName}.vkey.json`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputData,
    wasmPath,
    zkeyPath,
    undefined,
    undefined,
    { singleThread: true },
  );
  const normalizedPublicSignals = publicSignals.map(String);
  const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, "utf8"));
  const verified = await snarkjs.groth16.verify(verificationKey, normalizedPublicSignals, proof);
  if (!verified) {
    throw new Error(`${circuitName} generated a Groth16 proof that did not verify`);
  }
  return { proof, publicSignals: normalizedPublicSignals };
}

export function calculateWitnessIsolated(inputData) {
  return calculateCircuitProofIsolated(inputData, "person_commitment");
}
