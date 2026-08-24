import { readFile } from "node:fs/promises";
import { expect } from "chai";

const MINIMUM_NODE_VERSION = "22.13.0";
const CI_NODE_VERSION = "22.23.2";
const NODE_ENGINE = `>=${MINIMUM_NODE_VERSION}`;
const MANIFESTS = [
  "package.json",
  "frontend/package.json",
  "packages/proof-core/package.json",
  "packages/protocol-core/package.json",
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

describe("Node.js version policy", function () {
  it("keeps every workspace manifest and lockfile entry on the supported minimum", async function () {
    for (const manifestPath of MANIFESTS) {
      const manifest = await readJson(manifestPath);
      expect(manifest.engines?.node, manifestPath).to.equal(NODE_ENGINE);
    }

    const packageLock = await readJson("package-lock.json");
    for (const workspacePath of ["", "frontend", "packages/proof-core", "packages/protocol-core"]) {
      expect(packageLock.packages[workspacePath]?.engines?.node, `lockfile:${workspacePath}`).to.equal(
        NODE_ENGINE,
      );
    }
  });

  it("pins every CI runtime to a Node.js version supported by jsdom", async function () {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const nodePins = [...workflow.matchAll(/^\s*node-version:\s*([^\s#]+)\s*$/gm)].map(
      ([, version]) => version,
    );

    expect(nodePins).to.have.length.greaterThan(0);
    expect(new Set(nodePins)).to.deep.equal(new Set([CI_NODE_VERSION]));
  });

  it("documents the same minimum in the README", async function () {
    const readme = await readFile("README.md", "utf8");

    expect(readme).to.include("Node.js-22.13+-green");
    expect(readme).to.include(`**Node.js** >= ${MINIMUM_NODE_VERSION}`);
  });
});
