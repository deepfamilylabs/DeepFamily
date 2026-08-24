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

    expect(uses).to.have.length(5);
    expect(uses.map(({ action }) => action)).to.have.members([
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

    expect(setupNodeSteps).to.have.length(2);
    for (const stepAndRemainder of setupNodeSteps) {
      const step = stepAndRemainder.split(/^\s*- name:/m, 1)[0];
      expect(step).to.include("package-manager-cache: false");
    }
  });
});
