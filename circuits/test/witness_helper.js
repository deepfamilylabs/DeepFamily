import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function calculateCircuitProofIsolated(inputData, circuitName) {
  const artifactDirectory = path.resolve(__dirname, "../../zk-artifacts/circuits");
  const wasmPath = path.join(artifactDirectory, `${circuitName}_js/${circuitName}.wasm`);
  const zkeyPath = path.join(artifactDirectory, `${circuitName}_final.zkey`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputData,
    wasmPath,
    zkeyPath,
    undefined,
    undefined,
    { singleThread: true },
  );
  return { proof, publicSignals: publicSignals.map(String) };
}

export function calculateWitnessIsolated(inputData) {
  return calculateCircuitProofIsolated(inputData, "person_commitment");
}
