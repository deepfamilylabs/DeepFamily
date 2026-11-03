import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SHIELDED_POOL_PUBLIC_INPUTS } from "@deepfamily/protocol-core";
import { SHIELDED_CIRCUITS, shieldedCircuitSource } from "../scripts/lib/zkCircuitSelection.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "../scripts/lib/shieldedProductionSetup.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/zk-shielded-development-proof-smoke.mjs");
const requireFromScript = createRequire(SCRIPT);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function write(root, relative, contents) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

async function createFixture(present = Object.keys(SHIELDED_CIRCUITS)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-scoped-proof-smoke-"));
  try {
    // Preserve the script body while resolving its imports from the real checkout. Its
    // import.meta.url then points at this isolated artifact directory on every supported OS.
    const script = fs
      .readFileSync(SCRIPT, "utf8")
      .replace(/from "([^"]+)";/gu, (match, specifier) =>
        specifier.startsWith("node:")
          ? match
          : 'from "' + pathToFileURL(requireFromScript.resolve(specifier)).href + '";',
      );
    write(root, "scripts/zk-shielded-development-proof-smoke.mjs", script);
    const manifest = {
      schema: "deepfamily/shielded-development-keys@1",
      developmentOnly: true,
      productionReady: false,
      circuits: {},
    };
    for (const [action, source] of Object.entries(SHIELDED_CIRCUITS)) {
      const spec = SHIELDED_SETUP_CIRCUITS[action];
      const prefix = "frontend/public/zk/shielded/" + source;
      const files = {
        sourceSha256: shieldedCircuitSource(source),
        r1csSha256: "zk-artifacts/shielded/" + source + ".r1cs",
        wasmSha256: prefix + ".wasm",
        zkeySha256: prefix + "_final.zkey",
        verificationKeySha256: prefix + ".vkey.json",
        ...(spec.verifierPath && { solidityVerifierSha256: spec.verifierPath }),
      };
      const item = { source };
      if (spec.verifierPath) {
        Object.assign(item, {
          verifierPath: spec.verifierPath,
          verifierContractName: spec.verifierContractName,
        });
      }
      for (const [field, file] of Object.entries(files)) {
        const contents = action + " " + field + "\n";
        item[field] = sha256(contents);
        if (present.includes(action)) write(root, file, contents);
      }
      manifest.circuits[action] = item;
    }
    write(root, "circuits/shielded-development-manifest.json", JSON.stringify(manifest));
    write(
      root,
      "layouts.json",
      JSON.stringify({
        [SHIELDED_CIRCUITS.fund]: SHIELDED_POOL_PUBLIC_INPUTS[1],
        [SHIELDED_CIRCUITS.claim]: SHIELDED_POOL_PUBLIC_INPUTS[2],
        [SHIELDED_CIRCUITS.claim32]: SHIELDED_POOL_PUBLIC_INPUTS[2],
      }),
    );
    // This test exercises selection, artifact validation and the complete subprocess flow;
    // mathematical proof correctness is covered by the real circuit and integration tests.
    write(
      root,
      "node_modules/snarkjs/build/cli.cjs",
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        "const args = process.argv.slice(2);",
        'fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");',
        'if (args[0] !== "groth16") throw new Error("Unexpected command");',
        'if (args[1] === "fullprove") {',
        '  const witness = JSON.parse(fs.readFileSync(args[2], "utf8"));',
        '  const layouts = JSON.parse(fs.readFileSync("layouts.json", "utf8"));',
        '  const fields = layouts[path.basename(args[3], ".wasm")];',
        "  const signals = fields.flatMap((field) => [witness[field]].flat().map(String));",
        '  fs.writeFileSync(args[5], "{}");',
        "  fs.writeFileSync(args[6], JSON.stringify(signals));",
        '} else if (args[1] === "verify") {',
        '  console.log("OK!");',
        '} else throw new Error("Unexpected Groth16 command");',
      ].join("\n"),
    );
    const smoke = await import(
      pathToFileURL(path.join(root, "scripts/zk-shielded-development-proof-smoke.mjs")).href
    );
    const calls = () => {
      const file = path.join(root, "calls.jsonl");
      return fs.existsSync(file)
        ? fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse)
        : [];
    };
    return { root, smoke, calls };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

describe("shielded development proof smoke selection", function () {
  this.timeout(10_000);
  let fixture;
  afterEach(function () {
    if (fixture) fs.rmSync(fixture.root, { recursive: true, force: true });
    fixture = undefined;
  });

  for (const [action, proofCount] of [
    ["fund", 2],
    ["claim", 1],
    ["claim32", 1],
  ]) {
    it("proves " + action + " without requiring unrelated circuit artifacts", async function () {
      fixture = await createFixture([action]);
      fixture.smoke.smokeDevelopmentProofs([action]);
      const calls = fixture.calls();
      assert.deepEqual(
        calls.map((args) => args[1]),
        Array(proofCount).fill(["fullprove", "verify"]).flat(),
      );
      assert(
        calls
          .filter((args) => args[1] === "fullprove")
          .every((args) => path.basename(args[3]) === SHIELDED_CIRCUITS[action] + ".wasm"),
      );
    });
  }

  it("ignores stale unrelated artifacts in a focused proof check", async function () {
    fixture = await createFixture();
    write(
      fixture.root,
      "frontend/public/zk/shielded/" + SHIELDED_CIRCUITS.unshield4 + ".wasm",
      "stale unrelated wasm",
    );
    fixture.smoke.smokeDevelopmentProofs(["claim"]);
    assert.deepEqual(
      fixture.calls().map((args) => args[1]),
      ["fullprove", "verify"],
    );
  });

  it("checks every artifact by default while proving all three available fixtures", async function () {
    fixture = await createFixture();
    fixture.smoke.smokeDevelopmentProofs();
    const proved = fixture.calls().filter((args) => args[1] === "fullprove");
    assert.deepEqual(
      proved.map((args) => path.basename(args[3])),
      [
        SHIELDED_CIRCUITS.fund + ".wasm",
        SHIELDED_CIRCUITS.fund + ".wasm",
        SHIELDED_CIRCUITS.claim + ".wasm",
        SHIELDED_CIRCUITS.claim32 + ".wasm",
      ],
    );
    assert.equal(fixture.calls().filter((args) => args[1] === "verify").length, 4);
  });

  for (const change of ["missing", "stale"]) {
    it(
      "rejects a " + change + " non-fixture artifact in the default complete check",
      async function () {
        fixture = await createFixture();
        const file = path.join(
          fixture.root,
          "frontend/public/zk/shielded/" + SHIELDED_CIRCUITS.unshield4 + ".wasm",
        );
        if (change === "missing") fs.rmSync(file);
        else fs.writeFileSync(file, "stale wasm");
        assert.throws(
          () => fixture.smoke.smokeDevelopmentProofs(),
          /unshield4 development artifacts changed/,
        );
        assert.deepEqual(fixture.calls(), []);
      },
    );
  }

  it("rejects stale selected artifacts before attempting their proofs", async function () {
    fixture = await createFixture(["claim"]);
    write(
      fixture.root,
      "frontend/public/zk/shielded/" + SHIELDED_CIRCUITS.claim + "_final.zkey",
      "stale key",
    );
    assert.throws(
      () => fixture.smoke.smokeDevelopmentProofs(["claim"]),
      /claim development artifacts changed/,
    );
    assert.deepEqual(fixture.calls(), []);
  });
});
