import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
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
import {
  receiveBuildIsCurrent,
  receiveGoBuildEnvironment,
  syncCurrentReceiveArtifacts,
} from "../scripts/receive-build.mjs";
import {
  RECEIVE_BUILD_MANIFEST,
  RECEIVE_CIRCUITS,
  RECEIVE_DEVELOPMENT_MANIFEST,
  receiveArtifactSha256,
  receiveProverSourceHashes,
} from "../scripts/lib/receiveArtifacts.mjs";

const fixtureRoot = path.resolve("/fixture/deepfamily");

const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};

const inspectFixtureCompiler = async ({ root, platform }) => ({
  path: path.join(root, "bin", platform === "win32" ? "circom.exe" : "circom"),
});

describe("public ZK command surface", function () {
  it("exposes the identity, disclosure and shielded top-level npm commands", function () {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(Object.keys(packageJson.scripts).filter((name) => name.startsWith("zk:"))).to.deep.equal(
      [
        "zk:fetch",
        "zk:ptau:fetch",
        "zk:assets:fetch",
        "zk:assets:publish",
        "zk:build",
        "zk:development:setup",
        "zk:production:setup",
        "zk:check",
        "zk:artifacts:check",
        "zk:ceremony:verify",
      ],
    );
  });

  it("uses one local deploy command for every verifier and the pool", function () {
    const { scripts } = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(scripts["dev:deploy"]).to.equal(
      "node scripts/ensure-zk-artifacts.mjs && hardhat --config hardhat.config.mjs run scripts/deploy-integrated.mjs --network localhost",
    );
    expect(scripts["dev:contract"]).to.equal(
      "npm run dev:deploy && npm run dev:fund && npm run dev:seed",
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
        expect(parser(["--circuit", "core"])).to.deep.equal({
          help: false,
          circuit: "core",
        });
        expect(parser(["--circuit", "person"])).to.deep.equal({
          help: false,
          circuit: "person",
        });
        expect(parser(["--circuit=disclosure"])).to.deep.equal({
          help: false,
          circuit: "disclosure",
        });
        expect(parser(["--circuit", "shielded"])).to.deep.equal({
          help: false,
          circuit: "shielded",
        });
        expect(parser(["--circuit=shielded:claim"])).to.deep.equal({
          help: false,
          circuit: "shielded:claim",
        });
        expect(parser(["-h"])).to.deep.equal({ help: true, circuit: "all" });
        expect(parser(["--help"])).to.deep.equal({ help: true, circuit: "all" });
      });

      it("rejects missing, unsupported, duplicate and unrelated arguments", function () {
        expect(() => parser(["--circuit"])).to.throw(/Usage/);
        expect(() => parser(["--circuit", "unknown"])).to.throw(
          /expected one of: all, core, person, disclosure/,
        );
        expect(() => parser(["--circuit="])).to.throw(
          /expected one of: all, core, person, disclosure/,
        );
        expect(() => parser(["--circuit", "legacy"])).to.throw(
          /expected one of: all, core, person, disclosure/,
        );
        expect(() => parser(["--circuit", "person", "--circuit", "disclosure"])).to.throw(/Usage/);
        expect(() => parser(["--unknown"])).to.throw(/Usage/);
        expect(() => parser("all")).to.throw(/argv must be an array/);
      });
    });
  }

  describe("zk-build", function () {
    it("builds the fixed person command without a shell", function () {
      expect(
        buildZkBuildCommands({
          root: fixtureRoot,
          circuit: "person",
          platform: "linux",
        }),
      ).to.deep.equal([
        {
          circuit: "person",
          executable: path.join(fixtureRoot, "bin", "circom"),
          args: [
            path.join("circuits", "person_commitment.circom"),
            "--r1cs",
            "--wasm",
            "--sym",
            "--O2",
            "--sanity_check",
            "2",
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

    it("uses the Windows Circom executable name on win32", function () {
      const [command] = buildZkBuildCommands({
        root: fixtureRoot,
        circuit: "person",
        platform: "win32",
      });

      expect(command.executable).to.equal(path.join(fixtureRoot, "bin", "circom.exe"));
    });

    it("can compile before public receive keys are available without invoking synchronization", async function () {
      const commands = await runZkBuild({
        root: fixtureRoot,
        circuit: "all",
        syncReceive: false,
        platform: "linux",
        arch: "x64",
        compilerInspector: inspectFixtureCompiler,
        directoryCreator() {},
        runner() {},
      });
      expect(commands.at(-1).circuit).to.equal("receive");
      expect(commands.at(-1).args).to.deep.equal([
        path.join(fixtureRoot, "scripts", "receive-build.mjs"),
        "--if-needed",
      ]);
    });

    it("inspects the compiler, then creates the output directory and runs in order", async function () {
      const events = [];
      const commands = await runZkBuild({
        root: fixtureRoot,
        circuit: "all",
        platform: "linux",
        arch: "x64",
        compilerInspector: async ({ root, platform, arch }) => {
          events.push(["inspect", root, platform, arch]);
          return inspectFixtureCompiler({ root, platform });
        },
        directoryCreator: (directory) => events.push(["mkdir", directory]),
        runner: (command) => events.push(["run", command.circuit]),
      });

      expect(commands.map(({ circuit }) => circuit)).to.deep.equal([
        "person",
        "disclosure",
        "shielded:receiveCode",
        "shielded:anonymousReceiveCredential",
        "shielded:fundReceiveCredential",
        "shielded:identityAuthorizationUpdate",
        "shielded:shield",
        "shielded:fund",
        "shielded:claim",
        "shielded:privateTransfer",
        "shielded:unshield",
        "receive",
      ]);
      expect(events).to.deep.equal([
        ["inspect", fixtureRoot, "linux", "x64"],
        ["mkdir", path.join(fixtureRoot, "zk-artifacts", "circuits")],
        ["mkdir", path.join(fixtureRoot, "zk-artifacts", "shielded")],
        ["run", "person"],
        ["run", "disclosure"],
        ["run", "shielded:receiveCode"],
        ["run", "shielded:anonymousReceiveCredential"],
        ["run", "shielded:fundReceiveCredential"],
        ["run", "shielded:identityAuthorizationUpdate"],
        ["run", "shielded:shield"],
        ["run", "shielded:fund"],
        ["run", "shielded:claim"],
        ["run", "shielded:privateTransfer"],
        ["run", "shielded:unshield"],
        ["run", "receive"],
      ]);
      expect(commands[1].args[0]).to.equal(path.join("circuits", "disclosure_binding.circom"));
      expect(commands[2].args[0]).to.equal(path.join("circuits", "shielded_receive_code.circom"));
      expect(commands[2].args.at(-1)).to.equal(path.join("zk-artifacts", "shielded"));
      expect(commands.at(-1)).to.deep.equal({
        circuit: "receive",
        executable: process.execPath,
        args: [
          path.join(fixtureRoot, "scripts", "receive-build.mjs"),
          "--if-needed",
          "--sync-current",
        ],
        cwd: fixtureRoot,
      });
    });

    it("can compile one shielded action through the shared compiler path", async function () {
      const commands = await runZkBuild({
        root: fixtureRoot,
        circuit: "shielded:claim",
        platform: "linux",
        compilerInspector: inspectFixtureCompiler,
        directoryCreator: () => {},
        runner: () => {},
      });
      expect(commands).to.have.length(1);
      expect(commands[0].args[0]).to.equal(path.join("circuits", "shielded_claim.circom"));
      expect(commands[0].args.at(-1)).to.equal(path.join("zk-artifacts", "shielded"));
    });

    it("keeps receive builds outside every explicit Circom-only selection", function () {
      for (const circuit of ["core", "person", "disclosure", "shielded", "shielded:claim"]) {
        expect(
          buildZkBuildCommands({ root: fixtureRoot, circuit }).every(
            (command) => command.circuit !== "receive",
          ),
        ).to.equal(true);
      }
    });

    it("only reuses receive builds while their sources, binaries and loaders match", function () {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "receive-build-snapshot-"));
      const sources = path.join(root, "packages/receive-prover");
      const outDir = path.join(root, "zk-artifacts/receive");
      const native = process.platform === "win32" ? "receive-prover.exe" : "receive-prover";
      try {
        fs.mkdirSync(sources, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true });
        for (const name of ["main.go", "go.mod", "go.sum", "poseidon-constants.json"]) {
          fs.writeFileSync(path.join(sources, name), `fixture ${name}`);
        }
        for (const name of ["browser.mjs", "worker.mjs", "wasm_exec.js"]) {
          fs.writeFileSync(path.join(sources, name), `fixture ${name}`);
          fs.copyFileSync(path.join(sources, name), path.join(outDir, name));
        }
        for (const name of [native, "receive-prover.wasm"]) {
          fs.writeFileSync(path.join(outDir, name), `fixture ${name}`);
        }
        const manifest = {
          schema: "deepfamily/receive-prover-build@1",
          sourceFiles: receiveProverSourceHashes({ root }),
          artifacts: Object.fromEntries(
            [native, "receive-prover.wasm", "wasm_exec.js"].map((name) => [
              name,
              receiveArtifactSha256(path.join(outDir, name)),
            ]),
          ),
        };
        fs.writeFileSync(path.join(outDir, RECEIVE_BUILD_MANIFEST), JSON.stringify(manifest));
        expect(receiveBuildIsCurrent({ root, outDir })).to.equal(true);
        for (const [directory, name] of [
          [sources, "main.go"],
          [sources, "worker.mjs"],
          [outDir, native],
          [outDir, "receive-prover.wasm"],
          [outDir, "browser.mjs"],
        ]) {
          const file = path.join(directory, name);
          const original = fs.readFileSync(file);
          fs.writeFileSync(file, "changed");
          expect(receiveBuildIsCurrent({ root, outDir }), name).to.equal(false);
          fs.writeFileSync(file, original);
        }
        fs.unlinkSync(path.join(outDir, RECEIVE_BUILD_MANIFEST));
        expect(receiveBuildIsCurrent({ root, outDir })).to.equal(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("selects the exact Go patch from go.mod despite a newer installed toolchain", function () {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "receive-build-toolchain-"));
      try {
        const moduleFile = path.join(root, "packages/receive-prover/go.mod");
        fs.mkdirSync(path.dirname(moduleFile), { recursive: true });
        fs.writeFileSync(moduleFile, "module fixture\n\ngo 1.26.8\n");
        expect(
          receiveGoBuildEnvironment({
            root,
            env: {
              PATH: "/fixture/bin",
              GOTOOLCHAIN: "go1.27.0",
              GOROOT: "/fixture/go1.27.0",
              GOOS: "js",
              GOARCH: "wasm",
              gotoolchain: "auto",
              GOWORK: "/fixture/go.work",
            },
          }),
        ).to.deep.equal({ PATH: "/fixture/bin", GOTOOLCHAIN: "go1.26.8", GOWORK: "off" });
        fs.writeFileSync(moduleFile, "module fixture\n\ngo 1.26\n");
        expect(() => receiveGoBuildEnvironment({ root })).to.throw("exact Go patch version");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    describe("current receive key reuse", function () {
      let root;
      let outDir;
      let summary;
      let inspector;
      beforeEach(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "receive-native-key-sync-"));
        outDir = path.join(root, "zk-artifacts/receive");
        summary = { kinds: {} };
        for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
          const directory = path.join(root, "frontend/public/zk/receive", kind);
          fs.mkdirSync(directory, { recursive: true });
          fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
          const artifacts = {};
          for (const name of ["receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"]) {
            const file =
              name === "ReceiptVerifier.sol"
                ? path.join(root, "contracts", `${spec.contractName}.sol`)
                : path.join(directory, name);
            fs.writeFileSync(file, `${kind}/${name}`);
            artifacts[name] = receiveArtifactSha256(file);
          }
          const manifestFile = path.join(directory, "manifest.json");
          fs.writeFileSync(manifestFile, JSON.stringify({ kind, artifacts }));
          summary.kinds[kind] = { artifacts, manifestSha256: receiveArtifactSha256(manifestFile) };
        }
        const summaryFile = path.join(root, RECEIVE_DEVELOPMENT_MANIFEST);
        fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
        fs.writeFileSync(summaryFile, JSON.stringify(summary));
        inspector = ({ root: inspectedRoot }) => {
          expect(inspectedRoot).to.equal(root);
          return { status: "development", manifestSha256: receiveArtifactSha256(summaryFile) };
        };
      });
      afterEach(function () {
        fs.rmSync(root, { recursive: true, force: true });
      });

      it("copies all three verified browser key sets and canonical contract sources without setup", function () {
        expect(syncCurrentReceiveArtifacts({ root, outDir, inspector }).copied).to.equal(15);
        for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
          for (const [name, expected] of Object.entries(summary.kinds[kind].artifacts)) {
            expect(receiveArtifactSha256(path.join(outDir, kind, name))).to.equal(expected);
          }
          expect(fs.readFileSync(path.join(outDir, kind, "ReceiptVerifier.sol"), "utf8")).to.equal(
            fs.readFileSync(path.join(root, "contracts", `${spec.contractName}.sol`), "utf8"),
          );
          expect(receiveArtifactSha256(path.join(outDir, kind, "manifest.json"))).to.equal(
            summary.kinds[kind].manifestSha256,
          );
        }
        expect(
          syncCurrentReceiveArtifacts({
            root,
            outDir,
            inspector,
            copyFile() {
              throw new Error("Matching files must not be rewritten");
            },
          }).copied,
        ).to.equal(0);
        fs.writeFileSync(path.join(outDir, "fund/receipt.pk"), "stale native key");
        expect(syncCurrentReceiveArtifacts({ root, outDir, inspector }).copied).to.equal(1);
      });

      it("writes no native artifacts when public inspection or a source digest fails", function () {
        expect(() =>
          syncCurrentReceiveArtifacts({
            root,
            outDir,
            inspector() {
              throw new Error("fixed issuer mismatch");
            },
          }),
        ).to.throw("fixed issuer mismatch");
        expect(fs.existsSync(outDir)).to.equal(false);
        fs.writeFileSync(
          path.join(root, "frontend/public/zk/receive/fund/receipt.pk"),
          "changed key",
        );
        expect(() => syncCurrentReceiveArtifacts({ root, outDir, inspector })).to.throw(
          "artifact changed after inspection",
        );
        expect(fs.existsSync(outDir)).to.equal(false);
      });

      it("preserves every native file when any existing kind uses production keys", function () {
        const productionDirectory = path.join(outDir, "attachment");
        fs.mkdirSync(productionDirectory, { recursive: true });
        const manifestFile = path.join(productionDirectory, "manifest.json");
        const keyFile = path.join(productionDirectory, "receipt.pk");
        const manifest = JSON.stringify({
          kind: "attachment",
          productionCeremony: true,
          setup: "single-operator-mpc",
        });
        const key = Buffer.from("existing production key bytes");
        fs.writeFileSync(manifestFile, manifest);
        fs.writeFileSync(keyFile, key);
        expect(() => syncCurrentReceiveArtifacts({ root, outDir, inspector })).to.throw(
          "Refusing to overwrite production receive artifacts with development keys: attachment",
        );
        expect(fs.readdirSync(outDir)).to.deep.equal(["attachment"]);
        expect(fs.readFileSync(manifestFile, "utf8")).to.equal(manifest);
        expect(fs.readFileSync(keyFile).equals(key)).to.equal(true);
        expect(fs.readdirSync(productionDirectory).sort()).to.deep.equal([
          "manifest.json",
          "receipt.pk",
        ]);
      });

      it("rejects a changed staged copy before replacing the native file", function () {
        expect(() =>
          syncCurrentReceiveArtifacts({
            root,
            outDir,
            inspector,
            copyFile(source, destination, flags) {
              expect(flags).to.equal(fs.constants.COPYFILE_FICLONE);
              fs.copyFileSync(source, destination, flags);
              fs.writeFileSync(destination, "changed while copying");
            },
          }),
        ).to.throw("artifact changed while copying");
        expect(fs.readdirSync(path.join(outDir, "anonymous"))).to.deep.equal([]);
      });
    });

    it("propagates a compiler execution error and does not run the next circuit", async function () {
      const failure = new Error("circom failed");
      const seen = [];
      const error = await captureError(() =>
        runZkBuild({
          root: fixtureRoot,
          platform: "linux",
          arch: "x64",
          compilerInspector: inspectFixtureCompiler,
          directoryCreator: () => {},
          runner: (command) => {
            seen.push(command.circuit);
            throw failure;
          },
        }),
      );

      expect(error).to.equal(failure);
      expect(seen).to.deep.equal(["person"]);
    });

    it("propagates an inspection error before creating directories or running commands", async function () {
      const failure = new Error("compiler provenance mismatch");
      const events = [];
      const error = await captureError(() =>
        runZkBuild({
          root: fixtureRoot,
          platform: "linux",
          arch: "x64",
          compilerInspector: async () => {
            throw failure;
          },
          directoryCreator: () => events.push("mkdir"),
          runner: () => events.push("run"),
        }),
      );

      expect(error).to.equal(failure);
      expect(events).to.deep.equal([]);
    });

    it("validates injected collaborators before making changes", async function () {
      const runnerError = await captureError(() => runZkBuild({ runner: null }));
      expect(runnerError?.message).to.match(/runner must be a function/);

      const directoryCreatorError = await captureError(() =>
        runZkBuild({ directoryCreator: null }),
      );
      expect(directoryCreatorError?.message).to.match(/directoryCreator must be a function/);

      const compilerInspectorError = await captureError(() =>
        runZkBuild({ compilerInspector: null }),
      );
      expect(compilerInspectorError?.message).to.match(/compilerInspector must be a function/);

      const overrideInspectorError = await captureError(() =>
        runZkBuild({ overrideInspector: null }),
      );
      expect(overrideInspectorError?.message).to.match(/overrideInspector must be a function/);
    });
  });

  describe("zk-check", function () {
    it("builds fixed proof and constraint commands in person/disclosure order", function () {
      const commands = buildZkCheckCommands({ root: fixtureRoot, circuit: "core" });
      expect(commands).to.deep.equal([
        {
          circuit: "person",
          check: "proof",
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
          circuit: "person",
          check: "constraints",
          executable: process.execPath,
          args: [
            path.join(fixtureRoot, "circuits", "test", "test_circuit_constraints.js"),
            "--circuit",
            "person",
          ],
          cwd: fixtureRoot,
        },
        {
          circuit: "person",
          check: "parents",
          executable: process.execPath,
          args: [path.join(fixtureRoot, "circuits", "test", "test_parent_existence.js")],
          cwd: fixtureRoot,
        },
        {
          circuit: "disclosure",
          check: "proof",
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
        {
          circuit: "disclosure",
          check: "constraints",
          executable: process.execPath,
          args: [
            path.join(fixtureRoot, "circuits", "test", "test_circuit_constraints.js"),
            "--circuit",
            "disclosure",
          ],
          cwd: fixtureRoot,
        },
      ]);
    });

    it("checks configured shielded development artifacts and the available real proof fixtures by default", function () {
      const commands = buildZkCheckCommands({ root: fixtureRoot });
      expect(commands.map(({ circuit, check }) => [circuit, check]).at(-2)).to.deep.equal([
        "shielded",
        "development-artifacts-and-proof-smoke",
      ]);
      expect(commands.at(-2).args).to.deep.equal([
        path.join(fixtureRoot, "scripts", "zk-shielded-development-proof-smoke.mjs"),
      ]);
      expect(commands.at(-1)).to.deep.equal({
        circuit: "receive",
        check: "current-artifacts-and-proof-smoke",
        executable: process.execPath,
        args: [path.join(fixtureRoot, "scripts", "receive-proof-smoke.mjs"), "--current"],
        cwd: fixtureRoot,
      });
      expect(
        buildZkCheckCommands({ root: fixtureRoot, circuit: "shielded:unshield" }).at(-1).args,
      ).to.deep.equal([
        path.join(fixtureRoot, "scripts", "zk-shielded-development-proof-smoke.mjs"),
        "--artifact",
        "unshield",
      ]);
    });

    it("selects production artifact and ceremony verification when production artifacts are declared", function () {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zk-check-production-selection-"));
      try {
        fs.mkdirSync(path.join(root, "circuits"));
        fs.writeFileSync(path.join(root, "circuits", "shielded-production-manifest.json"), "{}");
        const commands = buildZkCheckCommands({ root });
        expect(commands.at(-2).check).to.equal("production-ceremony");
        expect(commands.at(-2).args[0]).to.equal(
          path.join(root, "scripts", "zk-shielded-production-check.mjs"),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("checks receive presentations last and never adds them to explicit Circom selections", function () {
      const seen = [];
      runZkCheck({ root: fixtureRoot, runner: (command) => seen.push(command.circuit) });
      expect(seen.at(-1)).to.equal("receive");
      expect(seen.filter((name) => name === "receive")).to.have.length(1);
      for (const circuit of ["core", "person", "disclosure", "shielded", "shielded:claim"]) {
        expect(
          buildZkCheckCommands({ root: fixtureRoot, circuit }).every(
            (command) => command.circuit !== "receive",
          ),
        ).to.equal(true);
      }
    });

    it("runs only the selected circuit", function () {
      const seen = [];
      const commands = runZkCheck({
        root: fixtureRoot,
        circuit: "disclosure",
        runner: (command) => seen.push(`${command.circuit}:${command.check}`),
      });
      expect(commands.map(({ circuit, check }) => `${circuit}:${check}`)).to.deep.equal([
        "disclosure:proof",
        "disclosure:constraints",
      ]);
      expect(seen).to.deep.equal(["disclosure:proof", "disclosure:constraints"]);
    });

    it("propagates a proof-check error and does not run the next circuit", function () {
      const failure = new Error("proof verification failed");
      const seen = [];
      expect(() =>
        runZkCheck({
          root: fixtureRoot,
          runner: (command) => {
            seen.push(`${command.circuit}:${command.check}`);
            throw failure;
          },
        }),
      ).to.throw(failure);
      expect(seen).to.deep.equal(["person:proof"]);
    });

    it("rejects an invalid runner and programmatic circuit selection", function () {
      expect(() => runZkCheck({ runner: null })).to.throw(/runner must be a function/);
      expect(() => buildZkCheckCommands({ circuit: "invalid" })).to.throw(
        /expected one of: all, core, person, disclosure/,
      );
    });
  });
});
