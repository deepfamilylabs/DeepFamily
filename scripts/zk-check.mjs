#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCircuitArguments, selectCircuitNames } from "./lib/zkCircuitSelection.mjs";

const PERSON_SUBMITTER = "0x1234567890123456789012345678901234567890";
const CHECKS = Object.freeze({
  person: Object.freeze([
    Object.freeze({
      check: "proof",
      task: path.join("tasks", "zk-person-hash-check.mjs"),
      args: Object.freeze([
        "--prove",
        "--wasm",
        "./frontend/public/zk/person_commitment.wasm",
        "--zkey",
        "./frontend/public/zk/person_commitment_final.zkey",
        "--input",
        "./circuits/test/proof/person_commitment_input.json",
        "--submitter",
        PERSON_SUBMITTER,
      ]),
    }),
    Object.freeze({
      check: "constraints",
      task: path.join("circuits", "test", "test_circuit_constraints.js"),
      args: Object.freeze(["--circuit", "person"]),
    }),
    Object.freeze({
      check: "parents",
      task: path.join("circuits", "test", "test_parent_existence.js"),
      args: Object.freeze([]),
    }),
  ]),
  disclosure: Object.freeze([
    Object.freeze({
      check: "proof",
      task: path.join("tasks", "zk-disclosure-binding-check.mjs"),
      args: Object.freeze([
        "--prove",
        "--wasm",
        "./frontend/public/zk/disclosure_binding.wasm",
        "--zkey",
        "./frontend/public/zk/disclosure_binding_final.zkey",
        "--input",
        "./circuits/test/proof/disclosure_binding_input.json",
      ]),
    }),
    Object.freeze({
      check: "constraints",
      task: path.join("circuits", "test", "test_circuit_constraints.js"),
      args: Object.freeze(["--circuit", "disclosure"]),
    }),
  ]),
});

const defaultRunner = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });

export const parseArguments = (argv) => {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  const artifactFlags = argv.filter((argument) => argument === "--artifacts-only");
  if (artifactFlags.length === 0) return parseCircuitArguments(argv);
  if (artifactFlags.length > 1) throw new Error("Duplicate --artifacts-only option");
  const parsed = parseCircuitArguments(argv.filter((argument) => argument !== "--artifacts-only"));
  if (parsed.help) throw new Error("Use --help without other options");
  return Object.freeze({ ...parsed, artifactsOnly: true });
};

export const buildZkCheckCommands = ({
  root = process.cwd(),
  circuit = "all",
  artifactsOnly = false,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const selected = selectCircuitNames(circuit);
  const core = selected.filter((name) => Object.hasOwn(CHECKS, name));
  const protocol = selected.filter((name) => name.startsWith("protocol:"));
  const boundaries = selected.filter((name) => name.startsWith("shielded:"));
  const script = (check, filename, extra = []) =>
    Object.freeze({
      circuit: "canonical",
      check,
      executable: process.execPath,
      args: Object.freeze([path.join(resolvedRoot, "scripts", filename), ...extra]),
      cwd: resolvedRoot,
    });
  const artifacts = script("artifact-hashes", "check-zk-artifacts.mjs");
  if (artifactsOnly) return Object.freeze([artifacts]);
  return Object.freeze([
    ...(circuit === "all" ? [script("build", "zk-build.mjs")] : []),
    ...core.flatMap((name) =>
      CHECKS[name].map((check) =>
        Object.freeze({
          circuit: name,
          check: check.check,
          executable: process.execPath,
          args: Object.freeze([path.join(resolvedRoot, check.task), ...check.args]),
          cwd: resolvedRoot,
        }),
      ),
    ),
    ...(boundaries.length || protocol.length ? [artifacts] : []),
    ...(protocol.length
      ? [
          Object.freeze({
            circuit: "protocol",
            check: "real-proofs-and-public-binding",
            executable: process.execPath,
            args: Object.freeze([
              "--test",
              path.join(resolvedRoot, "test/protocol-real-proof.test.mjs"),
            ]),
            cwd: resolvedRoot,
          }),
        ]
      : []),
  ]);
};

export const runZkCheck = ({
  root = process.cwd(),
  circuit = "all",
  artifactsOnly = false,
  runner = defaultRunner,
} = {}) => {
  if (typeof runner !== "function") {
    throw new TypeError("runner must be a function");
  }

  const commands = buildZkCheckCommands({ root, circuit, artifactsOnly });
  for (const command of commands) {
    runner(command);
  }
  return commands;
};

const printUsage = () => {
  console.log(`Usage:
  npm run zk:check -- [--circuit <all|core|person|disclosure|shielded|shielded:action|protocol|protocol:action>] [--artifacts-only]

The default check rebuilds the canonical relations, checks identity proofs/constraints,
validates local artifact hashes and checks all eight protocol Groth16 statements.
Development artifact verification is not production ceremony approval.
Every step reuses the current keys; no check generates replacement keys.
Use --artifacts-only to verify all 13 pinned artifact sets without compiling or proving.
Use --circuit to select checks without rebuilding. Receiving and boundary checks authenticate
the complete pinned bundle and its prior local compilation; run zk:build after source changes.`);
};

export const main = (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    printUsage();
    return [];
  }
  return runZkCheck({ circuit: parsed.circuit, artifactsOnly: parsed.artifactsOnly });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[zk-check] ${error.message}`);
    process.exitCode = 1;
  }
}
