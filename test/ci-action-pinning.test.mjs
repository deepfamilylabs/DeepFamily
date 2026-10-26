import { expect } from "chai";
import { readFile } from "node:fs/promises";

const EXPECTED_ACTION_PINS = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/cache", "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"],
]);

describe("CI action supply-chain policy", function () {
  it("pins every first-party action to the reviewed immutable commit", async function () {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s+(.+))?$/gm)].map(
      ([, action, revision, annotation]) => ({ action, revision, annotation }),
    );

    expect(uses).to.have.length(7);
    expect(uses.map(({ action }) => action)).to.have.members([
      "actions/checkout",
      "actions/setup-node",
      "actions/checkout",
      "actions/setup-node",
      "actions/cache",
      "actions/checkout",
      "actions/setup-node",
    ]);
    for (const { action, revision, annotation } of uses) {
      expect(revision, action).to.equal(EXPECTED_ACTION_PINS.get(action));
      expect(annotation, action).to.match(/^v\d+\.\d+\.\d+$/);
    }
  });

  it("keeps setup-node's implicit package-manager cache disabled in every job", async function () {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const setupNodeSteps = workflow.split(/^\s*- name: Setup Node\.js\s*$/m).slice(1);

    expect(setupNodeSteps).to.have.length(3);
    for (const stepAndRemainder of setupNodeSteps) {
      const step = stepAndRemainder.split(/^\s*- name:/m, 1)[0];
      expect(step).to.include("package-manager-cache: false");
    }
  });

  it("runs circuit constraints independently of proving artifacts through the local check entry", async function () {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const circuitJob = workflow
      .split(/^  circuit-constraints:\s*$/m)[1]
      ?.split(/^  [a-z][a-z0-9-]*:\s*$/m, 1)[0];
    expect(circuitJob, "Independent circuit constraints job").to.be.a("string");
    const commands = [...circuitJob.matchAll(/^\s*run:\s*(.+)$/gm)].map(([, command]) => command);
    expect(commands).to.deep.equal([
      "npm ci --no-audit --no-fund",
      "npm run zk:fetch",
      "npm run test:circuits",
    ]);
    expect(circuitJob).not.to.match(/^\s*(?:needs|if):/m);
    expect(circuitJob).not.to.match(/zk:(?:ptau|assets|development|production|artifacts)/);
    expect(workflow.match(/run: npm run test:circuits/g)).to.have.length(1);

    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    expect(manifest.scripts["test:circuits"]).to.equal("node --test circuits/test/*.test.mjs");
    expect(manifest.scripts.check).to.match(/^npm run test:circuits && /);
    expect(manifest.scripts.test).not.to.include("test:circuits");
  });

  it("uses the complete contract gate before frontend checks without repeating its steps", async function () {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const buildJob = workflow
      .split(/^  build-test:\s*$/m)[1]
      ?.split(/^  [a-z][a-z0-9-]*:\s*$/m, 1)[0];
    const commands = [...buildJob.matchAll(/^\s*run:\s*(.+)$/gm)].map(([, command]) => command);
    expect(commands.filter((command) => command === "npm run contracts:check")).to.have.length(1);
    expect(commands.indexOf("npm run contracts:check")).to.be.lessThan(
      commands.indexOf("npm run frontend:check"),
    );
    for (const duplicate of [
      "npm run lint",
      "npm run build",
      "npm run storage:check",
      "npm test",
    ]) {
      expect(commands).not.to.include(duplicate);
    }
    expect(commands).to.include("npm run csp:scan --workspace deepfamily-frontend");
    expect(commands).to.include("git diff --exit-code -- frontend/src/abi");
    const nativeJob = workflow.split(/^  zk-native-platforms:\s*$/m)[1];
    expect(nativeJob.indexOf("run: npm run build")).to.be.lessThan(
      nativeJob.indexOf("run: npm test -- --no-compile"),
    );
    expect(nativeJob).to.include("run: npm test -- --no-compile");
  });
});
