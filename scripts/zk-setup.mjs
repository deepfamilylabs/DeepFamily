#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runZkBuild } from "./zk-build.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import {
  parseCircuitArguments,
  selectCircuitNames,
  CORE_CIRCUITS,
} from "./lib/zkCircuitSelection.mjs";
import { buildProtocolDevelopment, setupProtocolDevelopment } from "./protocol-zk-development.mjs";
import { buildBoundaryDevelopment, setupBoundaryDevelopment } from "./boundary-zk-development.mjs";
import { checkCurrentArtifacts } from "./check-zk-artifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const USAGE = `Usage: npm run zk:setup -- [--circuit <all|core|person|disclosure|shielded|shielded:action|protocol|protocol:action>] [--ptau path]

The default compiles all 13 current relations, reuses matching identity/disclosure keys,
and regenerates the eight receiving and three asset-boundary key sets.
Focused selections rebuild and regenerate only the selected relations; the final check
still requires the complete 13-relation bundle. Identity keys are checked, never rotated.
An explicit --ptau applies to receiving and boundary setup.
Generated keys retain their local setup provenance; this command does not approve a ceremony.`;

export function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError("Expected a setup argument array");
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]))
    return { help: true, circuit: "all", ptauPath: undefined };
  const values = {};
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (typeof argument !== "string") throw new TypeError("Expected string setup arguments");
    const separator = argument.indexOf("=");
    const option = separator === -1 ? argument : argument.slice(0, separator);
    if (!["--circuit", "--ptau"].includes(option))
      throw new Error(`Unknown setup argument: ${argument}\n${USAGE}`);
    if (Object.hasOwn(values, option)) throw new Error(`Duplicate setup option: ${option}`);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (typeof value !== "string" || value.trim() === "" || value.startsWith("-"))
      throw new Error(`Expected one value for ${option}`);
    values[option] = value;
  }
  const parsed = parseCircuitArguments(
    values["--circuit"] === undefined ? [] : ["--circuit", values["--circuit"]],
  );
  return { ...parsed, ptauPath: values["--ptau"] };
}

/** Explicit key setup; existing identity keys and their provenance are preserved. */
export async function runZkSetup({
  root = ROOT,
  circuit = "all",
  ptauPath,
  buildCore = runZkBuild,
  inspectIdentity = inspectZkReleaseArtifacts,
  buildProtocol = buildProtocolDevelopment,
  setupProtocol = setupProtocolDevelopment,
  buildBoundary = buildBoundaryDevelopment,
  setupBoundary = setupBoundaryDevelopment,
  check = checkCurrentArtifacts,
} = {}) {
  root = path.resolve(root);
  const circuits = selectCircuitNames(circuit);
  const core = circuits.filter((name) => CORE_CIRCUITS.includes(name));
  const protocol = circuits
    .filter((name) => name.startsWith("protocol:"))
    .map((name) => name.slice("protocol:".length));
  const boundaries = circuits
    .filter((name) => name.startsWith("shielded:"))
    .map((name) => name.slice("shielded:".length));

  if (core.length)
    await buildCore({ root, circuit: core.length === CORE_CIRCUITS.length ? "core" : core[0] });
  // Validate existing identity keys before any receiving/boundary key rotation.
  await inspectIdentity({ root, requireBuiltR1cs: true });
  if (protocol.length) {
    await buildProtocol({ root, circuits: protocol });
    await setupProtocol({ root, circuits: protocol, ptauPath });
  }
  if (boundaries.length) {
    await buildBoundary({ root, circuits: boundaries });
    await setupBoundary({ root, circuits: boundaries, ptauPath });
  }
  const artifacts = await check({ root });
  return {
    circuits,
    regeneratedCircuits: circuits.filter((name) => !CORE_CIRCUITS.includes(name)),
    artifacts,
  };
}

export async function main(argv = process.argv.slice(2), { log = console.log, ...options } = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    log(USAGE);
    return;
  }
  const result = await runZkSetup({
    ...options,
    circuit: parsed.circuit,
    ptauPath: parsed.ptauPath,
  });
  log(
    `[zk-setup] All 13 artifact sets verified; ${result.regeneratedCircuits.length} key sets regenerated. Existing identity keys and setup provenance are preserved.`,
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[zk-setup] ${error.message}`);
    process.exitCode = 1;
  } finally {
    await globalThis.curve_bn128?.terminate?.();
  }
}
