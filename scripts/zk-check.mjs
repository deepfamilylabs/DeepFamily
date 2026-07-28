#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCircuitArguments, selectCircuitNames } from "./lib/zkCircuitSelection.mjs";

const PERSON_SUBMITTER = "0x1234567890123456789012345678901234567890";
const CHECKS = Object.freeze({
  person: Object.freeze({
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
  disclosure: Object.freeze({
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
});

const defaultRunner = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });

export const parseArguments = parseCircuitArguments;

export const buildZkCheckCommands = ({ root = process.cwd(), circuit = "all" } = {}) => {
  const resolvedRoot = path.resolve(root);
  return Object.freeze(
    selectCircuitNames(circuit).map((name) => {
      const check = CHECKS[name];
      return Object.freeze({
        circuit: name,
        executable: process.execPath,
        args: Object.freeze([path.join(resolvedRoot, check.task), ...check.args]),
        cwd: resolvedRoot,
      });
    }),
  );
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
  node scripts/zk-check.mjs [--circuit <all|person|disclosure>]

Generates and independently verifies a real proof for the selected circuit using the
repository's committed frontend ZK artifacts and proof input. The default is --circuit all.`);
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
