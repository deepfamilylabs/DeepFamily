#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCircuitArguments, selectCircuitNames } from "./lib/zkCircuitSelection.mjs";

const OUTPUT_DIRECTORY = path.join("zk-artifacts", "circuits");
const INCLUDE_ARGUMENTS = Object.freeze([
  "-l",
  "node_modules",
  "-l",
  path.join("node_modules", "circomlib", "circuits"),
]);
const CIRCUIT_SOURCES = Object.freeze({
  person: path.join("circuits", "person_commitment.circom"),
  disclosure: path.join("circuits", "disclosure_binding.circom"),
});

const defaultRunner = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });

const defaultDirectoryCreator = (directory) => {
  fs.mkdirSync(directory, { recursive: true });
};

export const parseArguments = parseCircuitArguments;

export const buildZkBuildCommands = ({ root = process.cwd(), circuit = "all" } = {}) => {
  const resolvedRoot = path.resolve(root);
  const executable = path.join(resolvedRoot, "bin", "circom");
  return Object.freeze(
    selectCircuitNames(circuit).map((name) =>
      Object.freeze({
        circuit: name,
        executable,
        args: Object.freeze([
          CIRCUIT_SOURCES[name],
          "--r1cs",
          "--wasm",
          "--sym",
          ...INCLUDE_ARGUMENTS,
          "-o",
          OUTPUT_DIRECTORY,
        ]),
        cwd: resolvedRoot,
      }),
    ),
  );
};

export const runZkBuild = ({
  root = process.cwd(),
  circuit = "all",
  runner = defaultRunner,
  directoryCreator = defaultDirectoryCreator,
} = {}) => {
  if (typeof runner !== "function") {
    throw new TypeError("runner must be a function");
  }
  if (typeof directoryCreator !== "function") {
    throw new TypeError("directoryCreator must be a function");
  }

  const resolvedRoot = path.resolve(root);
  const commands = buildZkBuildCommands({ root: resolvedRoot, circuit });
  directoryCreator(path.join(resolvedRoot, OUTPUT_DIRECTORY));
  for (const command of commands) {
    runner(command);
  }
  return commands;
};

const printUsage = () => {
  console.log(`Usage:
  node scripts/zk-build.mjs [--circuit <all|person|disclosure>]

Compiles the selected Circom circuit with the repository's fixed R1CS, WASM, symbol,
include-path and output settings. The default is --circuit all.`);
};

export const main = (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    printUsage();
    return [];
  }
  return runZkBuild({ circuit: parsed.circuit });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[zk-build] ${error.message}`);
    process.exitCode = 1;
  }
}
