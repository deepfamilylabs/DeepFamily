import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import { prepareReceivePresentationWitness } from "../../packages/protocol-core/shielded-receive-presentation.js";
import {
  linkGroth16Proofs,
  verifyLinkedGroth16Proof,
} from "../../packages/protocol-core/groth16-link.js";
import { RECEIVE_PRESENTATION_CIRCUITS, SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";
import {
  RECEIVE_LINK_KEYS_PATH,
  inspectLinkedReceiveArtifacts,
} from "./linkedReceiveArtifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

export async function proveReceivePresentation({ root = ROOT, request }) {
  inspectLinkedReceiveArtifacts({ root });
  const prepared = prepareReceivePresentationWitness(request);
  const spec = RECEIVE_PRESENTATION_CIRCUITS[prepared.circuit];
  const directory = path.join(root, "frontend/public/zk/shielded");
  const source = SHIELDED_CIRCUITS[prepared.circuit];
  const keys = JSON.parse(fs.readFileSync(path.join(root, RECEIVE_LINK_KEYS_PATH), "utf8"))[
    spec.kind
  ];
  const issuer = {
    proof: request.credentialProof,
    verificationKey: JSON.parse(
      fs.readFileSync(path.join(directory, `${SHIELDED_CIRCUITS[spec.issuer]}.vkey.json`), "utf8"),
    ),
    deltaG1: keys.issuerDeltaG1,
  };
  const result = await groth16.fullProve(
    prepared.witness,
    path.join(directory, `${source}.wasm`),
    path.join(directory, `${source}_final.zkey`),
    undefined,
    undefined,
    { singleThread: true },
  );
  if (
    JSON.stringify(result.publicSignals) !==
    JSON.stringify([...prepared.commonInputs, ...prepared.publicInputs])
  ) {
    throw new Error(
      "Receive presentation public input order does not match the credential and operation",
    );
  }
  const presentation = {
    proof: result.proof,
    verificationKey: keys.verificationKey,
    deltaG1: keys.deltaG1,
  };
  const solidityProof = await linkGroth16Proofs({
    issuer,
    presentation,
    commonInputs: prepared.commonInputs,
    publicInputs: prepared.publicInputs,
  });
  const verified = await verifyLinkedGroth16Proof({
    proof: solidityProof,
    issuer,
    presentation,
    publicInputs: prepared.publicInputs,
  });
  if (!verified) throw new Error("Fresh linked receive proof failed local verification");
  return { solidityProof, publicSignals: prepared.publicInputs, verified };
}

export async function verifyReceivePresentation({ root = ROOT, kind, proof, publicSignals }) {
  const item = Object.entries(RECEIVE_PRESENTATION_CIRCUITS).find(([, spec]) => spec.kind === kind);
  if (!item) throw new Error("Unsupported receive presentation kind");
  const [, spec] = item;
  const keys = JSON.parse(fs.readFileSync(path.join(root, RECEIVE_LINK_KEYS_PATH), "utf8"))[kind];
  const issuerKeyFile = path.join(
    root,
    "frontend/public/zk/shielded",
    `${SHIELDED_CIRCUITS[spec.issuer]}.vkey.json`,
  );
  return verifyLinkedGroth16Proof({
    proof,
    publicInputs: publicSignals,
    issuer: {
      verificationKey: JSON.parse(fs.readFileSync(issuerKeyFile, "utf8")),
      deltaG1: keys.issuerDeltaG1,
    },
    presentation: { verificationKey: keys.verificationKey, deltaG1: keys.deltaG1 },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output")
    throw new Error("Expected --input <request.json> --output <proof.json>");
  try {
    const result = await proveReceivePresentation({
      request: JSON.parse(fs.readFileSync(args[1], "utf8")),
    });
    fs.writeFileSync(args[3], `${JSON.stringify(result)}\n`, { mode: 0o600 });
  } finally {
    await globalThis.curve_bn128?.terminate?.();
  }
}
