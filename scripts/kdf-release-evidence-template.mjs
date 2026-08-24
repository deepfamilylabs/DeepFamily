#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildKdfAttackerStudyV2Template,
  buildKdfDeviceMatrixV2Template,
  canonicalKdfEvidenceJson,
} from "./lib/kdfReleaseEvidence.mjs";
import { inspectProtocolReleaseManifest } from "./lib/protocolReleaseManifest.mjs";

const KINDS = Object.freeze(["device-matrix", "attacker-study"]);
const USAGE =
  "node scripts/kdf-release-evidence-template.mjs " + "--kind <device-matrix|attacker-study>";

export const parseKdfReleaseEvidenceTemplateArguments = (argv) => {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--kind" ||
    !KINDS.includes(argv[1])
  ) {
    throw new Error(`Usage: ${USAGE}`);
  }
  return Object.freeze({ kind: argv[1] });
};

export const buildKdfReleaseEvidenceTemplate = ({
  kind,
  root = process.cwd(),
  manifestInspector = inspectProtocolReleaseManifest,
} = {}) => {
  if (!KINDS.includes(kind)) throw new Error(`Unsupported KDF evidence template kind: ${kind}`);
  const { manifest } = manifestInspector({ root, requireProduction: false });
  return kind === "device-matrix"
    ? buildKdfDeviceMatrixV2Template(manifest)
    : buildKdfAttackerStudyV2Template(manifest);
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseKdfReleaseEvidenceTemplateArguments(argv);
  process.stdout.write(canonicalKdfEvidenceJson(buildKdfReleaseEvidenceTemplate(options)));
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[kdf-release-evidence-template] ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  });
}
