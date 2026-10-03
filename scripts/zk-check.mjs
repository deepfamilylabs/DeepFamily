#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCircuitArguments,
  selectCircuitNames,
  SHIELDED_CIRCUIT_NAMES,
} from "./lib/zkCircuitSelection.mjs";

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

export const parseArguments = parseCircuitArguments;

export const buildZkCheckCommands = ({ root = process.cwd(), circuit = "all" } = {}) => {
  const resolvedRoot = path.resolve(root);
  const productionManifest = path.join(
    resolvedRoot,
    "circuits",
    "shielded-production-manifest.json",
  );
  const selected = selectCircuitNames(circuit);
  const core = selected.filter((name) => !name.startsWith("shielded:"));
  const shielded = selected.filter((name) => name.startsWith("shielded:"));
  return Object.freeze([
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
    ...(shielded.length === 0
      ? []
      : fs.existsSync(productionManifest)
        ? [
            Object.freeze({
              circuit: "shielded",
              check: "production-ceremony",
              executable: process.execPath,
              args: Object.freeze([
                path.join(resolvedRoot, "scripts", "zk-shielded-production-check.mjs"),
              ]),
              cwd: resolvedRoot,
            }),
          ]
        : shielded.length === SHIELDED_CIRCUIT_NAMES.length
          ? [
              Object.freeze({
                circuit: "shielded",
                check: "development-artifacts-and-proof-smoke",
                executable: process.execPath,
                args: Object.freeze([
                  path.join(resolvedRoot, "scripts", "zk-shielded-development-proof-smoke.mjs"),
                ]),
                cwd: resolvedRoot,
              }),
            ]
          : shielded.map((name) => {
              const action = name.slice("shielded:".length);
              const hasProofFixture = ["fund", "claim"].includes(action);
              return Object.freeze({
                circuit: name,
                check: hasProofFixture ? "development-proof-smoke" : "development-artifacts",
                executable: process.execPath,
                args: Object.freeze([
                  path.join(resolvedRoot, "scripts", "zk-shielded-development-proof-smoke.mjs"),
                  ...(hasProofFixture ? [action] : ["--artifact", action]),
                ]),
                cwd: resolvedRoot,
              });
            })),
  ]);
};

export const runZkCheck = ({
  root = process.cwd(),
  circuit = "all",
  runner = defaultRunner,
} = {}) => {
  if (typeof runner !== "function") {
    throw new TypeError("runner must be a function");
  }

  const commands = buildZkCheckCommands({ root, circuit });
  for (const command of commands) {
    runner(command);
  }
  return commands;
};

const printUsage = () => {
  console.log(`Usage:
  node scripts/zk-check.mjs [--circuit <all|core|person|disclosure|shielded|shielded:action>]

Checks the selected circuits. Person/disclosure run real proofs and constraints. Shielded checks
all seven development artifact sets and proves fund/claim when no production manifest exists;
with a production manifest it verifies production artifacts and ceremony. Default: --circuit all.`);
};

export const main = (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    printUsage();
    return [];
  }
  return runZkCheck({ circuit: parsed.circuit });
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
