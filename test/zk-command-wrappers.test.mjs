import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

import {
  buildZkBuildCommands,
  parseArguments as parseBuildArguments,
  runZkBuild,
} from "../scripts/zk-build.mjs";
import {
  buildZkCheckCommands,
  parseArguments as parseCheckArguments,
  runZkCheck,
} from "../scripts/zk-check.mjs";

const fixtureRoot = path.resolve("/fixture/deepfamily");

describe("public ZK command surface", function () {
  it("exposes only the eight supported top-level npm commands", function () {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(Object.keys(packageJson.scripts).filter((name) => name.startsWith("zk:"))).to.deep.equal(
      [
        "zk:fetch",
        "zk:ptau:fetch",
        "zk:build",
        "zk:dev:refresh",
        "zk:production:setup",
        "zk:check",
        "zk:artifacts:check",
        "zk:ceremony:verify",
      ],
    );
  });
});

describe("parameterized ZK command wrappers", function () {
  for (const [label, parser] of [
    ["build", parseBuildArguments],
    ["check", parseCheckArguments],
  ]) {
    describe(`${label} argument parsing`, function () {
      it("defaults to all and accepts every supported circuit syntax", function () {
        expect(parser([])).to.deep.equal({ help: false, circuit: "all" });
        expect(parser(["--circuit", "all"])).to.deep.equal({
          help: false,
          circuit: "all",
        });
        expect(parser(["--circuit", "person"])).to.deep.equal({
          help: false,
          circuit: "person",
        });
        expect(parser(["--circuit=disclosure"])).to.deep.equal({
          help: false,
          circuit: "disclosure",
        });
        expect(parser(["-h"])).to.deep.equal({ help: true, circuit: "all" });
        expect(parser(["--help"])).to.deep.equal({ help: true, circuit: "all" });
      });

      it("rejects missing, unsupported, duplicate and unrelated arguments", function () {
        expect(() => parser(["--circuit"])).to.throw(/Usage/);
        expect(() => parser(["--circuit", "unknown"])).to.throw(
          /expected one of: all, person, disclosure/,
        );
        expect(() => parser(["--circuit="])).to.throw(/expected one of: all, person, disclosure/);
        expect(() => parser(["--circuit", "person", "--circuit", "disclosure"])).to.throw(/Usage/);
        expect(() => parser(["--unknown"])).to.throw(/Usage/);
        expect(() => parser("all")).to.throw(/argv must be an array/);
      });
    });
  }

  describe("zk-build", function () {
    it("builds the fixed person command without a shell", function () {
      expect(buildZkBuildCommands({ root: fixtureRoot, circuit: "person" })).to.deep.equal([
        {
          circuit: "person",
          executable: path.join(fixtureRoot, "bin", "circom"),
          args: [
            path.join("circuits", "person_commitment.circom"),
            "--r1cs",
            "--wasm",
            "--sym",
            "-l",
            "node_modules",
            "-l",
            path.join("node_modules", "circomlib", "circuits"),
            "-o",
            path.join("zk-artifacts", "circuits"),
          ],
          cwd: fixtureRoot,
        },
      ]);
    });

    it("runs person before disclosure and creates the output directory first", function () {
      const events = [];
      const commands = runZkBuild({
        root: fixtureRoot,
        circuit: "all",
        directoryCreator: (directory) => events.push(["mkdir", directory]),
        runner: (command) => events.push(["run", command.circuit]),
      });

      expect(commands.map(({ circuit }) => circuit)).to.deep.equal(["person", "disclosure"]);
      expect(events).to.deep.equal([
        ["mkdir", path.join(fixtureRoot, "zk-artifacts", "circuits")],
        ["run", "person"],
        ["run", "disclosure"],
      ]);
      expect(commands[1].args[0]).to.equal(path.join("circuits", "disclosure_binding.circom"));
    });

    it("propagates a compiler error and does not run the next circuit", function () {
      const failure = new Error("circom failed");
      const seen = [];
      expect(() =>
        runZkBuild({
          root: fixtureRoot,
          directoryCreator: () => {},
          runner: (command) => {
            seen.push(command.circuit);
            throw failure;
          },
        }),
      ).to.throw(failure);
      expect(seen).to.deep.equal(["person"]);
    });

    it("validates injected collaborators before making changes", function () {
      expect(() => runZkBuild({ runner: null })).to.throw(/runner must be a function/);
      expect(() => runZkBuild({ directoryCreator: null })).to.throw(
        /directoryCreator must be a function/,
      );
    });
  });

  describe("zk-check", function () {
    it("builds the fixed proof-check commands in person/disclosure order", function () {
      const commands = buildZkCheckCommands({ root: fixtureRoot });
      expect(commands).to.deep.equal([
        {
          circuit: "person",
          executable: process.execPath,
          args: [
            path.join(fixtureRoot, "tasks", "zk-person-hash-check.mjs"),
            "--prove",
            "--wasm",
            "./frontend/public/zk/person_commitment.wasm",
            "--zkey",
            "./frontend/public/zk/person_commitment_final.zkey",
            "--input",
            "./circuits/test/proof/person_commitment_input.json",
            "--submitter",
            "0x1234567890123456789012345678901234567890",
          ],
          cwd: fixtureRoot,
        },
        {
          circuit: "disclosure",
          executable: process.execPath,
          args: [
            path.join(fixtureRoot, "tasks", "zk-disclosure-binding-check.mjs"),
            "--prove",
            "--wasm",
            "./frontend/public/zk/disclosure_binding.wasm",
            "--zkey",
            "./frontend/public/zk/disclosure_binding_final.zkey",
            "--input",
            "./circuits/test/proof/disclosure_binding_input.json",
          ],
          cwd: fixtureRoot,
        },
      ]);
    });

    it("runs only the selected circuit", function () {
      const seen = [];
      const commands = runZkCheck({
        root: fixtureRoot,
        circuit: "disclosure",
        runner: (command) => seen.push(command.circuit),
      });
      expect(commands.map(({ circuit }) => circuit)).to.deep.equal(["disclosure"]);
      expect(seen).to.deep.equal(["disclosure"]);
    });

    it("propagates a proof-check error and does not run the next circuit", function () {
      const failure = new Error("proof verification failed");
      const seen = [];
      expect(() =>
        runZkCheck({
          root: fixtureRoot,
          runner: (command) => {
            seen.push(command.circuit);
            throw failure;
          },
        }),
      ).to.throw(failure);
      expect(seen).to.deep.equal(["person"]);
    });

    it("rejects an invalid runner and programmatic circuit selection", function () {
      expect(() => runZkCheck({ runner: null })).to.throw(/runner must be a function/);
      expect(() => buildZkCheckCommands({ circuit: "invalid" })).to.throw(
        /expected one of: all, person, disclosure/,
      );
    });
  });
});
