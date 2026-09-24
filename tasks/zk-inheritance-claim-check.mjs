/* FamilyInheritanceClaim v1 checker for the family_inheritance_claim circuit artifact. */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { INHERITANCE_CLAIM_V1_PUBLIC_SIGNAL_SPEC } from "@deepfamily/proof-core";

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function parseArgs(rawArgs) {
  const args = { prove: false, help: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = rawArgs[index];
    if (["--input", "--wasm", "--zkey", "--vkey"].includes(current)) {
      args[current.slice(2)] = rawArgs[++index];
    } else if (current === "--prove") {
      args.prove = true;
    } else if (current === "--help" || current === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${current}`);
    }
  }
  return args;
}

/** The claim circuit has no outputs: its public signals are the public inputs, in spec order. */
function expectedPublicSignals(input) {
  return INHERITANCE_CLAIM_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.map((name) => {
    if (input[name] === undefined) throw new Error(`Input is missing public field ${name}`);
    return BigInt(input[name]).toString();
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.input || (args.prove && (!args.wasm || !args.zkey || !args.vkey))) {
    console.log(
      "Usage: node tasks/zk-inheritance-claim-check.mjs --input FILE [--prove --wasm FILE --zkey FILE --vkey FILE]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const input = loadJson(args.input);
  const expected = expectedPublicSignals(input);
  console.log("FamilyInheritanceClaim v1 public signals:");
  INHERITANCE_CLAIM_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((name, index) => {
    console.log(`  ${name}: ${expected[index]}`);
  });
  if (!args.prove) return;

  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, args.wasm, args.zkey);
  const actual = publicSignals.map(String);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Generated claim signals mismatch: ${JSON.stringify({ expected, actual })}`);
  }
  const verificationKey = loadJson(args.vkey);
  if (!(await snarkjs.groth16.verify(verificationKey, actual, proof))) {
    throw new Error("Generated FamilyInheritanceClaim proof failed verification");
  }
  // Every public signal, including the recipient, must be bound by the proof.
  for (let index = 0; index < actual.length; index += 1) {
    const tampered = [...actual];
    tampered[index] = (BigInt(tampered[index]) + 1n).toString();
    if (await snarkjs.groth16.verify(verificationKey, tampered, proof)) {
      throw new Error(
        `FamilyInheritanceClaim verifier accepted a tampered ${INHERITANCE_CLAIM_V1_PUBLIC_SIGNAL_SPEC.fieldOrder[index]}`,
      );
    }
  }
  console.log("Generated proof verifies; every tampered public signal is rejected.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

export { expectedPublicSignals, parseArgs };
