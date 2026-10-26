import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildZkBuildCommands,
  runZkBuild,
  parseArguments as parseBuild,
} from "../scripts/zk-build.mjs";
import {
  buildZkCheckCommands,
  runZkCheck,
  parseArguments as parseCheck,
} from "../scripts/zk-check.mjs";
import { CANONICAL_CIRCUIT_NAMES } from "../scripts/lib/zkCircuitSelection.mjs";
import { parseArguments as parseSetup } from "../scripts/zk-setup.mjs";

const root = path.resolve("/fixture/deepfamily");
const compilerInspector = async () => ({ path: path.join(root, "bin/circom") });
describe("current proving command surface", function () {
  it("exposes one business-named command for every local workflow", function () {
    const { scripts } = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const name of [
      "zk:build",
      "zk:setup",
      "zk:check",
      "zk:dev",
      "zk:dev:check",
      "zk:frontend",
      "test:proof",
      "test:evm",
      "test:contracts",
    ])
      assert.equal(typeof scripts[name], "string", name);
    assert.equal(
      Object.keys(scripts).some((name) => /anon|v2/iu.test(name)),
      false,
    );
    for (const value of Object.values(scripts))
      assert.doesNotMatch(value, /(?:anonymous|Anonymous|ANONYMOUS)/u);
  });
  it("accepts only the current 13 relations, with no obsolete proof selectors", function () {
    for (const parser of [parseBuild, parseCheck]) {
      assert.deepEqual(parser([]), { help: false, circuit: "all" });
      assert.deepEqual(parser(["--circuit=protocol:claim"]), {
        help: false,
        circuit: "protocol:claim",
      });
      assert.deepEqual(parser(["--circuit", "shielded:unshield4"]), {
        help: false,
        circuit: "shielded:unshield4",
      });
      for (const value of [
        "shielded:fund",
        "shielded:claim",
        "shielded:identityAuthorizationUpdate",
        "shielded:credential",
        "unknown",
      ])
        assert.throws(() => parser(["--circuit", value]), /expected one of/u);
      assert.throws(() => parser(["--circuit"]), /Usage/u);
    }
    assert.deepEqual(parseSetup([]), { help: false });
    assert.throws(() => parseSetup(["--rotate"]), /Usage/u);
  });
  it("builds the fixed relation graph using the inspected compiler and distinct output directories", async function () {
    const events = [];
    const commands = await runZkBuild({
      root,
      compilerInspector,
      overrideInspector: async () => null,
      directoryCreator: (directory) => events.push(["mkdir", directory]),
      runner: (command) => events.push(["run", command.circuit]),
    });
    assert.deepEqual(
      commands.map((command) => command.circuit),
      CANONICAL_CIRCUIT_NAMES,
    );
    assert.equal(commands.length, 13);
    assert.deepEqual(
      events.slice(0, 3),
      ["circuits", "shielded", "protocol"].map((name) => [
        "mkdir",
        path.join(root, "zk-artifacts", name),
      ]),
    );
    for (const command of commands) {
      assert.equal(command.executable, path.join(root, "bin/circom"));
      assert.deepEqual(command.args.slice(1, 7), [
        "--r1cs",
        "--wasm",
        "--sym",
        "--O2",
        "--sanity_check",
        "2",
      ]);
    }
    const [claim] = buildZkBuildCommands({ root, circuit: "protocol:claim" });
    assert.equal(claim.args[0], path.join("circuits", "budget_claim.circom"));
    assert.equal(claim.args.at(-1), path.join("zk-artifacts", "protocol"));
  });
  it("stops before later relations after a failed compiler or provenance check", async function () {
    const failure = new Error("compiler failed");
    const seen = [];
    await assert.rejects(
      runZkBuild({
        root,
        compilerInspector,
        overrideInspector: async () => null,
        directoryCreator: () => {},
        runner: (command) => {
          seen.push(command.circuit);
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.deepEqual(seen, ["person"]);
    await assert.rejects(
      runZkBuild({
        root,
        compilerInspector: async () => {
          throw failure;
        },
        overrideInspector: async () => null,
        directoryCreator: () => {
          throw new Error("must not create directories");
        },
      }),
      (error) => error === failure,
    );
  });
  it("checks compiled artifacts and all current public proof bindings without generating keys", function () {
    const commands = buildZkCheckCommands({ root });
    assert.equal(commands[0].check, "build");
    assert.equal(commands.filter((command) => command.check === "proof").length, 2);
    assert.equal(commands.at(-2).check, "development-artifact-hashes");
    assert.match(commands.at(-2).args[0], /check-protocol-artifacts\.mjs$/u);
    assert.equal(commands.at(-1).check, "real-proofs-and-public-binding");
    assert.ok(
      commands.every(
        (command) => !command.args.some((arg) => /zk-setup|protocol-zk-development/u.test(arg)),
      ),
    );
    const scoped = buildZkCheckCommands({ root, circuit: "shielded:unshield" });
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].check, "development-artifact-hashes");
  });
  it("stops on the first failed check and runs focused identity checks independently", function () {
    const seen = [];
    const failure = new Error("hash mismatch");
    assert.throws(
      () =>
        runZkCheck({
          root,
          runner: (command) => {
            seen.push(command.check);
            throw failure;
          },
        }),
      (error) => error === failure,
    );
    assert.deepEqual(seen, ["build"]);
    assert.deepEqual(
      buildZkCheckCommands({ root, circuit: "disclosure" }).map((command) => command.check),
      ["proof", "constraints"],
    );
  });
});
